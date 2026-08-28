-- ============================================================================
-- 0039_finance_corrections — collections & expenses become APPEND-ONLY.
-- ============================================================================
--
-- WHY (Decision 2026-08-27, plan finance-corrections-path-b.md)
-- A finance record is "true" as a faithful, tamper-evident account of what was
-- claimed and when — not as a guaranteed-correct number. So no row is ever edited
-- or deleted. A mistake is fixed by a REVERSAL row (+ an optional REPLACEMENT
-- entry), never by mutating the original. This retires collections' old 3-hour
-- edit/delete window (0016) at every layer and gives expenses a correction path
-- it never had.
--
-- THE MODEL
--   * `kind` ∈ (entry, reversal). amount stays > 0; a reversal negates via the
--     SIGNED SUM  amount * (kind='reversal' ? -1 : 1)  that every aggregate now uses.
--   * `corrects_id` self-links a reversal (and a replacement) to the original.
--   * Reversals/replacements are written ONLY by the SECURITY DEFINER RPCs below,
--     which copy the original's figures server-side — a client can never post a
--     reversal that fails to cancel. Client INSERT is narrowed to plain entries.
--   * created_by is server-stamped by the existing set_created_by() trigger (0013).
--
-- SECURITY: net REDUCTION in write surface. collections loses UPDATE/DELETE; both
-- tables become SELECT, INSERT + two definer RPCs. Corrections gated on
-- can_write_finance() AND can_write_church(original.from_church).
--
-- ROLLBACK: see rollback.sql — restores the 0009 grants, the 0016 window policies,
-- the 0031 view body, the 0035 event-total RPC, and drops everything added here.
-- Grant changes have no compile-time signal (0009) — verify every finance view by
-- hand on staging after deploy AND after any rollback.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Columns — collections (needs created_by; expenses already has it)
-- ---------------------------------------------------------------------------
-- collections.id is BIGSERIAL, so corrects_id is bigint (not uuid like `from`).
ALTER TABLE public.collections
  ADD COLUMN kind        text NOT NULL DEFAULT 'entry',
  ADD COLUMN corrects_id bigint,
  ADD COLUMN reason      text,
  ADD COLUMN reason_note text,
  ADD COLUMN created_by  uuid;

ALTER TABLE public.collections
  ADD CONSTRAINT collections_corrects_fkey
    FOREIGN KEY (corrects_id) REFERENCES public.collections(id) ON DELETE RESTRICT,
  ADD CONSTRAINT collections_kind_check
    CHECK (kind IN ('entry','reversal')),
  -- A reversal must name what it reverses and why.
  ADD CONSTRAINT collections_reversal_shape
    CHECK (kind <> 'reversal' OR (corrects_id IS NOT NULL AND reason IS NOT NULL)),
  -- A reason lives only on a reversal; a replacement (kind='entry', corrects_id set)
  -- carries none.
  ADD CONSTRAINT collections_reason_only_on_reversal
    CHECK (reason IS NULL OR kind = 'reversal'),
  ADD CONSTRAINT collections_reason_enum
    CHECK (reason IS NULL OR reason IN
      ('duplicate','wrong_amount','wrong_contributor','wrong_date','other')),
  ADD CONSTRAINT collections_reason_note_required
    CHECK (reason <> 'other' OR (reason_note IS NOT NULL AND length(trim(reason_note)) > 0));

-- ---------------------------------------------------------------------------
-- 2. Columns — expenses
-- ---------------------------------------------------------------------------
ALTER TABLE public.expenses
  ADD COLUMN kind        text NOT NULL DEFAULT 'entry',
  ADD COLUMN corrects_id bigint,
  ADD COLUMN reason      text,
  ADD COLUMN reason_note text;

ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_corrects_fkey
    FOREIGN KEY (corrects_id) REFERENCES public.expenses(id) ON DELETE RESTRICT,
  ADD CONSTRAINT expenses_kind_check
    CHECK (kind IN ('entry','reversal')),
  ADD CONSTRAINT expenses_reversal_shape
    CHECK (kind <> 'reversal' OR (corrects_id IS NOT NULL AND reason IS NOT NULL)),
  ADD CONSTRAINT expenses_reason_only_on_reversal
    CHECK (reason IS NULL OR kind = 'reversal'),
  ADD CONSTRAINT expenses_reason_enum
    CHECK (reason IS NULL OR reason IN
      ('duplicate','wrong_amount','wrong_description','wrong_date','other')),
  ADD CONSTRAINT expenses_reason_note_required
    CHECK (reason <> 'other' OR (reason_note IS NOT NULL AND length(trim(reason_note)) > 0));

-- Collapse lookup: find a unit's children by the original's id.
CREATE INDEX collections_corrects_idx ON public.collections (corrects_id) WHERE corrects_id IS NOT NULL;
CREATE INDEX expenses_corrects_idx    ON public.expenses    (corrects_id) WHERE corrects_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Author trigger — reuse set_created_by() (0013). Stamps auth.uid() on every
--    INSERT, ordinary entry or RPC-written correction alike (auth.uid() reads the
--    JWT, unaffected by SECURITY DEFINER). Client-sent created_by is ignored.
-- ---------------------------------------------------------------------------
CREATE TRIGGER collections_set_created_by
  BEFORE INSERT ON public.collections
  FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER expenses_set_created_by
  BEFORE INSERT ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

-- ---------------------------------------------------------------------------
-- 4. Grants — collections drops UPDATE/DELETE (and the 0009 column-scoped
--    UPDATE(amount)); both tables are now SELECT, INSERT only. All mutation of an
--    existing row goes through the RPCs in §6.
-- ---------------------------------------------------------------------------
REVOKE UPDATE, DELETE ON TABLE public.collections FROM authenticated;

-- ---------------------------------------------------------------------------
-- 5. RLS — drop the window policies; narrow INSERT so clients may write only
--    plain entries. Reversals/replacements come solely from the definer RPCs,
--    which run as owner and bypass RLS.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS collections_update_own_church_in_window ON public.collections;
DROP POLICY IF EXISTS collections_delete_own_church_in_window ON public.collections;
DROP POLICY IF EXISTS expenses_update_own_church ON public.expenses;

DROP POLICY IF EXISTS collections_insert_own_church ON public.collections;
CREATE POLICY collections_insert_own_church ON public.collections
  FOR INSERT TO authenticated
  WITH CHECK (
    public.can_write_finance() AND public.can_write_church(from_church)
    AND kind = 'entry' AND corrects_id IS NULL AND reason IS NULL
  );

DROP POLICY IF EXISTS expenses_insert_own_church ON public.expenses;
CREATE POLICY expenses_insert_own_church ON public.expenses
  FOR INSERT TO authenticated
  WITH CHECK (
    public.can_write_finance() AND public.can_write_church(from_church)
    AND kind = 'entry' AND corrects_id IS NULL AND reason IS NULL
  );

-- ---------------------------------------------------------------------------
-- 6. Correction RPCs — the ONLY path that can create a reversal. Definer-owned,
--    so RLS is bypassed and the body self-enforces the finance/church gate. The
--    reversal copies the original's figures verbatim; the replacement (if any)
--    takes the caller's new values, church always inherited.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.correct_collection(
  p_target           bigint,
  p_reason           text,
  p_note             text    DEFAULT NULL,
  p_replace          boolean DEFAULT false,
  p_new_amount       real    DEFAULT NULL,
  p_new_from         uuid    DEFAULT NULL,
  p_new_is_tithes    boolean DEFAULT NULL,
  p_new_collected_on date    DEFAULT NULL,
  p_new_event_id     uuid    DEFAULT NULL
)
RETURNS SETOF public.collections
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_orig        public.collections;
  v_reversal_id bigint;
  v_new_id      bigint := NULL;
BEGIN
  SELECT * INTO v_orig FROM public.collections WHERE id = p_target FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'collection not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT (public.can_write_finance() AND public.can_write_church(v_orig.from_church)) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Only a live original entry may be corrected; reversed rows and reversals are frozen.
  IF v_orig.kind <> 'entry' THEN
    RAISE EXCEPTION 'only an entry can be corrected' USING ERRCODE = 'raise_exception';
  END IF;
  IF EXISTS (SELECT 1 FROM public.collections WHERE corrects_id = p_target AND kind = 'reversal') THEN
    RAISE EXCEPTION 'this record has already been corrected' USING ERRCODE = 'raise_exception';
  END IF;

  IF p_reason NOT IN ('duplicate','wrong_amount','wrong_contributor','wrong_date','other') THEN
    RAISE EXCEPTION 'invalid reason' USING ERRCODE = 'raise_exception';
  END IF;
  IF p_reason = 'other' AND (p_note IS NULL OR length(trim(p_note)) = 0) THEN
    RAISE EXCEPTION 'a note is required for reason other' USING ERRCODE = 'raise_exception';
  END IF;

  -- Reversal — copy the original's figures so it fully cancels (period date
  -- inherited). id is BIGSERIAL, so it is left to the sequence.
  INSERT INTO public.collections
    ("from", amount, is_tithes, "collectedOn", from_church, event_id, kind, corrects_id, reason, reason_note)
  VALUES
    (v_orig."from", v_orig.amount, v_orig.is_tithes, v_orig."collectedOn",
     v_orig.from_church, v_orig.event_id, 'reversal', p_target, p_reason, p_note)
  RETURNING id INTO v_reversal_id;

  -- Replacement — full new state from the caller; church never changes. A NULL
  -- p_new_from is a legitimate anonymous contributor, so it is taken as given.
  IF p_replace THEN
    IF p_new_amount IS NULL OR p_new_is_tithes IS NULL OR p_new_collected_on IS NULL THEN
      RAISE EXCEPTION 'a replacement needs amount, tithes flag and date' USING ERRCODE = 'raise_exception';
    END IF;
    INSERT INTO public.collections
      ("from", amount, is_tithes, "collectedOn", from_church, event_id, kind, corrects_id)
    VALUES
      (p_new_from, p_new_amount, p_new_is_tithes, p_new_collected_on,
       v_orig.from_church, p_new_event_id, 'entry', p_target)
    RETURNING id INTO v_new_id;
  END IF;

  RETURN QUERY SELECT * FROM public.collections WHERE id = v_reversal_id OR id = v_new_id;
END
$$;

CREATE OR REPLACE FUNCTION public.correct_expense(
  p_target          bigint,
  p_reason          text,
  p_note            text    DEFAULT NULL,
  p_replace         boolean DEFAULT false,
  p_new_amount      numeric DEFAULT NULL,
  p_new_description text    DEFAULT NULL,
  p_new_spent_on    date    DEFAULT NULL,
  p_new_notes       text    DEFAULT NULL
)
RETURNS SETOF public.expenses
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_orig        public.expenses;
  v_reversal_id bigint;
  v_new_id      bigint := NULL;
BEGIN
  SELECT * INTO v_orig FROM public.expenses WHERE id = p_target FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'expense not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT (public.can_write_finance() AND public.can_write_church(v_orig.from_church)) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_orig.kind <> 'entry' THEN
    RAISE EXCEPTION 'only an entry can be corrected' USING ERRCODE = 'raise_exception';
  END IF;
  IF EXISTS (SELECT 1 FROM public.expenses WHERE corrects_id = p_target AND kind = 'reversal') THEN
    RAISE EXCEPTION 'this record has already been corrected' USING ERRCODE = 'raise_exception';
  END IF;

  IF p_reason NOT IN ('duplicate','wrong_amount','wrong_description','wrong_date','other') THEN
    RAISE EXCEPTION 'invalid reason' USING ERRCODE = 'raise_exception';
  END IF;
  IF p_reason = 'other' AND (p_note IS NULL OR length(trim(p_note)) = 0) THEN
    RAISE EXCEPTION 'a note is required for reason other' USING ERRCODE = 'raise_exception';
  END IF;

  -- Reversal carries a positive amount tagged 'reversal'; the signed sum negates it,
  -- so the CHECK (amount > 0) still holds.
  INSERT INTO public.expenses
    (from_church, spent_on, description, amount, notes, event_id, kind, corrects_id, reason, reason_note)
  VALUES
    (v_orig.from_church, v_orig.spent_on, v_orig.description, v_orig.amount, v_orig.notes,
     v_orig.event_id, 'reversal', p_target, p_reason, p_note)
  RETURNING id INTO v_reversal_id;

  IF p_replace THEN
    IF p_new_amount IS NULL OR p_new_description IS NULL OR p_new_spent_on IS NULL THEN
      RAISE EXCEPTION 'a replacement needs amount, description and date' USING ERRCODE = 'raise_exception';
    END IF;
    -- event linkage is inherited, never changed by a correction.
    INSERT INTO public.expenses
      (from_church, spent_on, description, amount, notes, event_id, kind, corrects_id)
    VALUES
      (v_orig.from_church, p_new_spent_on, p_new_description, p_new_amount, p_new_notes, v_orig.event_id, 'entry', p_target)
    RETURNING id INTO v_new_id;
  END IF;

  RETURN QUERY SELECT * FROM public.expenses WHERE id = v_reversal_id OR id = v_new_id;
END
$$;

REVOKE ALL ON FUNCTION public.correct_collection(bigint, text, text, boolean, real, uuid, boolean, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.correct_collection(bigint, text, text, boolean, real, uuid, boolean, date, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.correct_expense(bigint, text, text, boolean, numeric, text, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.correct_expense(bigint, text, text, boolean, numeric, text, date, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. Sign-aware aggregates. Rebuild collectives_service_totals (0031) so the
--    Funds report and Overview net reversals; same owner-rights shape and guard.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS public.collectives_service_totals;

CREATE VIEW public.collectives_service_totals
WITH (security_invoker = off) AS
WITH collection_totals AS (
  SELECT from_church,
         "collectedOn" AS service_date,
         sum(CASE WHEN is_tithes THEN amount::numeric ELSE 0 END
             * CASE kind WHEN 'reversal' THEN -1 ELSE 1 END) AS tithes,
         sum(CASE WHEN is_tithes THEN 0 ELSE amount::numeric END
             * CASE kind WHEN 'reversal' THEN -1 ELSE 1 END) AS offering
  FROM public.collections
  WHERE public.can_view_finance() AND public.can_read_church(from_church)
  GROUP BY from_church, "collectedOn"
),
expense_totals AS (
  SELECT from_church,
         spent_on AS service_date,
         sum(amount * CASE kind WHEN 'reversal' THEN -1 ELSE 1 END) AS expenses
  FROM public.expenses
  WHERE public.can_view_finance() AND public.can_read_church(from_church)
  GROUP BY from_church, spent_on
)
SELECT coalesce(c.from_church, e.from_church) AS from_church,
       coalesce(c.service_date, e.service_date) AS service_date,
       coalesce(c.tithes, 0)   AS tithes,
       coalesce(c.offering, 0) AS offering,
       coalesce(e.expenses, 0) AS expenses
FROM collection_totals c
FULL OUTER JOIN expense_totals e
  ON c.from_church = e.from_church
 AND c.service_date = e.service_date;

COMMENT ON VIEW public.collectives_service_totals IS
  'Per (church, service date) sums of tithes/offering/expenses, NET of reversals (0039). Owner-rights (security_invoker off) since 0031: reads the ledger under its own privileges and re-imposes can_view_finance AND can_read_church in-body. Sign: amount * (kind=reversal ? -1 : 1).';

REVOKE ALL ON TABLE public.collectives_service_totals FROM anon, authenticated;
GRANT SELECT ON TABLE public.collectives_service_totals TO authenticated;

-- Event collection total (0035) — net reversals.
CREATE OR REPLACE FUNCTION public.event_collection_total(p_event_id uuid)
RETURNS numeric
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT COALESCE(SUM(c.amount::numeric * CASE c.kind WHEN 'reversal' THEN -1 ELSE 1 END), 0)
  FROM public.collections c
  JOIN public.events e ON e.id = c.event_id
  WHERE c.event_id = p_event_id
    AND public.can_read_church(e.church_id)
    AND (public.can_view_events() OR public.can_view_finance())
$$;

COMMIT;

-- PostgREST caches the schema; the new columns, RPCs and rebuilt view 404 until reload:
NOTIFY pgrst, 'reload schema';

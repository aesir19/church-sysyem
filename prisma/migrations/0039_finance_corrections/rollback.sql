-- ============================================================================
-- Rollback for 0039_finance_corrections.
--
-- Restores the pre-0039 state: the 0016 window policies + original INSERT
-- policies, the 0009 collections UPDATE(amount)/DELETE grants, the 0031 view
-- body, and the 0035 event-total RPC. Drops the correction columns, triggers,
-- constraints, indexes and RPCs.
--
-- WARNING (0009): grant changes have no compile-time signal. After running this,
-- exercise every finance view by hand on staging.
-- ============================================================================

BEGIN;

-- 1. Drop the correction RPCs.
DROP FUNCTION IF EXISTS public.correct_collection(bigint, text, text, boolean, real, uuid, boolean, date, uuid);
DROP FUNCTION IF EXISTS public.correct_expense(bigint, text, text, boolean, numeric, text, date, text);

-- 2. Restore the 0035 event-total RPC (no sign term).
CREATE OR REPLACE FUNCTION public.event_collection_total(p_event_id uuid)
RETURNS numeric
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT COALESCE(SUM(c.amount::numeric), 0)
  FROM public.collections c
  JOIN public.events e ON e.id = c.event_id
  WHERE c.event_id = p_event_id
    AND public.can_read_church(e.church_id)
    AND (public.can_view_events() OR public.can_view_finance())
$$;

-- 3. Restore the 0031 view body (no sign term).
DROP VIEW IF EXISTS public.collectives_service_totals;
CREATE VIEW public.collectives_service_totals
WITH (security_invoker = off) AS
WITH collection_totals AS (
  SELECT from_church,
         "collectedOn" AS service_date,
         sum(CASE WHEN is_tithes THEN amount::numeric ELSE 0 END) AS tithes,
         sum(CASE WHEN is_tithes THEN 0 ELSE amount::numeric END) AS offering
  FROM public.collections
  WHERE public.can_view_finance() AND public.can_read_church(from_church)
  GROUP BY from_church, "collectedOn"
),
expense_totals AS (
  SELECT from_church,
         spent_on AS service_date,
         sum(amount) AS expenses
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
REVOKE ALL ON TABLE public.collectives_service_totals FROM anon, authenticated;
GRANT SELECT ON TABLE public.collectives_service_totals TO authenticated;

-- 4. Restore the 0016 INSERT + window policies.
DROP POLICY IF EXISTS collections_insert_own_church ON public.collections;
CREATE POLICY collections_insert_own_church ON public.collections
  FOR INSERT TO authenticated
  WITH CHECK (public.can_write_finance() AND public.can_write_church(from_church));

DROP POLICY IF EXISTS expenses_insert_own_church ON public.expenses;
CREATE POLICY expenses_insert_own_church ON public.expenses
  FOR INSERT TO authenticated
  WITH CHECK (public.can_write_finance() AND public.can_write_church(from_church));

CREATE POLICY collections_update_own_church_in_window ON public.collections
  FOR UPDATE TO authenticated
  USING (
    public.can_write_finance() AND public.can_write_church(from_church)
    AND created_at > now() - interval '3 hours'
  )
  WITH CHECK (public.can_write_finance() AND public.can_write_church(from_church));

CREATE POLICY collections_delete_own_church_in_window ON public.collections
  FOR DELETE TO authenticated
  USING (
    public.can_write_finance() AND public.can_write_church(from_church)
    AND created_at > now() - interval '3 hours'
  );

CREATE POLICY expenses_update_own_church ON public.expenses
  FOR UPDATE TO authenticated
  USING (public.can_write_finance() AND public.can_write_church(from_church))
  WITH CHECK (public.can_write_finance() AND public.can_write_church(from_church));

-- 5. Restore the 0009 collections grants.
GRANT DELETE ON TABLE public.collections TO authenticated;
GRANT UPDATE (amount) ON TABLE public.collections TO authenticated;

-- 6. Drop triggers, then the columns (constraints/indexes drop with them).
DROP TRIGGER IF EXISTS collections_set_created_by ON public.collections;
DROP TRIGGER IF EXISTS expenses_set_created_by ON public.expenses;

ALTER TABLE public.collections
  DROP COLUMN IF EXISTS kind,
  DROP COLUMN IF EXISTS corrects_id,
  DROP COLUMN IF EXISTS reason,
  DROP COLUMN IF EXISTS reason_note,
  DROP COLUMN IF EXISTS created_by;

ALTER TABLE public.expenses
  DROP COLUMN IF EXISTS kind,
  DROP COLUMN IF EXISTS corrects_id,
  DROP COLUMN IF EXISTS reason,
  DROP COLUMN IF EXISTS reason_note;

COMMIT;

NOTIFY pgrst, 'reload schema';

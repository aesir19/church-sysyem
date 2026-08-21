-- ============================================================================
-- 0031_contributor_identity_rls — Make the database enforce what the Funds screen
-- already claims: who gave is visible only to callers who may record money.
-- ============================================================================
--
-- WHY (issue #57)
-- The Church Funds report shows the Contributors table only when the client holds
-- canWriteFinance, so a Pastor / Church Leader / Head Pastor sees the month's
-- totals with no names. The screen reads as though contributor identity is
-- finance-only. The database did not agree: collections_select_own_church (0016)
-- grants SELECT to can_view_finance() — SuperAdmin, Head Pastor, Pastor, Church
-- Leader AND Finance — over the whole row, `from` included. Four of those five can
-- resolve that member id to a name (can_see_member_detail). The anon key ships to
-- every browser, so the request needs nothing more than a session and a URL. This
-- is a UI-only control standing in for an authorization boundary, which ADR-0001
-- says is not a control at all.
--
-- THE FIX, IN TWO MOVES
--   1. collections SELECT narrows from can_view_finance() to a new predicate
--      can_see_contributor_identity() (= can_write_finance() today). A row of the
--      giving ledger carries `from`; you may read it only if you may see who gave.
--      Writers (Finance / SuperAdmin) keep reading the row and its member embed
--      exactly as before, so the Contributors table still works for them with no
--      new read path. Everyone else stops being able to retrieve the row at all.
--
--   2. That lockdown would blind the report for the four VIEWER roles, because the
--      whole month — totals, allocations, balance — is derived from per-date sums
--      that collectives_service_totals (0012) reads off `collections`. That view is
--      security_invoker, so once collections SELECT excludes viewers the view
--      returns them zero rows. So the view is rebuilt as an OWNER-RIGHTS view that
--      reads the ledger under its own privileges and re-imposes the *aggregate*
--      gate in its body: can_view_finance() AND can_read_church(from_church). It
--      exposes only per-date sums, never `from` (ADR-0004), so widening the read to
--      the five viewer roles leaks no identity — it hands back exactly the figures
--      the report always showed them, by a path that never carries a name.
--
-- WHY AN OWNER-RIGHTS VIEW IS SAFE HERE (reversing 0012's mandatory security_invoker)
-- 0012 made the view security_invoker=on precisely so it could NOT bypass the base
-- RLS and leak cross-church. That guarantee is now carried explicitly instead: the
-- view body filters on can_read_church(from_church), so from_church scoping is
-- re-imposed, and can_view_finance() gates the aggregate to the viewer roles. The
-- guard is load-bearing — dropping either predicate reopens the exact cross-church
-- leak 0012 warned about, which is why scripts/sql/capture-security-state.sql now
-- carries a verification query for this view (see docs/SECURITY.md §3.22).
--
-- WHAT IS DELIBERATELY NOT TOUCHED
--   * expenses. An expense carries no giver identity — from_church is a church, not
--     a person — so its SELECT stays can_view_finance() and the report's
--     expense-by-description read is unchanged.
--   * collections writes (insert / update-in-window / delete-in-window). Who may
--     RECORD money is already correct (can_write_finance); this migration changes
--     only who may READ the identity-bearing row.
--   * The anonymous-gift guarantee (ADR-0003, nullable `from`). The view already
--     never reads `from`; nothing here weakens it.
--   * SuperAdmin / Finance access. Unchanged — they can still see every name.
--
-- ROLLBACK: see rollback.sql. It restores the 0016 collections SELECT policy
-- (can_view_finance) and the 0012 security_invoker view, and drops the new
-- predicate. Restoring reopens the finding; it exists only to undo cleanly.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The predicate. Defined separately from can_write_finance() on purpose:
--    "may record money" and "may see who gave" are different questions that
--    happen to share an answer today. Collapsing them means the next role change
--    silently moves both. Mirrors the 0014 predicate family: SECURITY DEFINER,
--    STABLE, SET search_path = public; revoked from PUBLIC/anon, granted to
--    authenticated only.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_see_contributor_identity()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$ SELECT public.can_write_finance() $$;

COMMENT ON FUNCTION public.can_see_contributor_identity() IS
  'May the caller see WHO gave (collections.from), as opposed to only the aggregate figures? = can_write_finance() today, defined separately so the two can diverge without silently moving together. Gates the collections SELECT policy. Added by 0031 (issue #57).';

REVOKE ALL ON FUNCTION public.can_see_contributor_identity() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_see_contributor_identity() TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. collections SELECT — narrowed to identity-holders. Only this policy changes;
--    the insert / update-in-window / delete-in-window policies (0016) are left
--    exactly as they are.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS collections_select_own_church ON public.collections;
CREATE POLICY collections_select_own_church
ON public.collections
FOR SELECT
TO authenticated
USING (public.can_see_contributor_identity() AND public.can_read_church(from_church));

-- ---------------------------------------------------------------------------
-- 3. collectives_service_totals — rebuilt as an owner-rights aggregate that stays
--    visible to every finance viewer after the lockdown above. Same columns and
--    same shape as 0012; the only changes are security_invoker off and the two
--    guard predicates in each CTE's WHERE. DROP + CREATE because CREATE OR REPLACE
--    cannot flip security_invoker.
--
--    The guard is inside each base scan (before GROUP BY): can_view_finance() is
--    row-independent and STABLE; can_read_church(from_church) filters per church.
-- ---------------------------------------------------------------------------

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
-- FULL OUTER JOIN, not LEFT: a date can carry expenses with no collections (a bill
-- paid midweek) or collections with no expenses. Both must appear.
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
  'Per (church, service date) sums of tithes/offering/expenses for the Funds report and Overview. Owner-rights (security_invoker off) since 0031: it reads the ledger under its own privileges and re-imposes the gate in its body (can_view_finance AND can_read_church), so it survives the 0031 collections lockdown while still leaking no cross-church data and no contributor identity. The two WHERE predicates are load-bearing — verify with capture-security-state.sql query 10.';

-- Strip Supabase's default privileges before granting (see 0012 header — GRANT is
-- additive and cannot undo them, so the revoke comes first and names both roles).
REVOKE ALL ON TABLE public.collectives_service_totals FROM anon, authenticated;
GRANT SELECT ON TABLE public.collectives_service_totals TO authenticated;

COMMIT;

-- PostgREST caches the schema; the rebuilt view and new function 404 until reload:
NOTIFY pgrst, 'reload schema';

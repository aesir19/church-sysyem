-- ============================================================================
-- Rollback for 0031_contributor_identity_rls.
--
-- Restores the 0016 collections SELECT policy (can_view_finance) and the 0012
-- security_invoker view, and drops the predicate added by 0031. Running this
-- REOPENS issue #57 — contributor identity becomes readable again by every
-- can_view_finance() role. It exists only so the change undoes cleanly.
-- ============================================================================

BEGIN;

-- 1. Restore the 0016 collections SELECT policy (viewer-wide read).
DROP POLICY IF EXISTS collections_select_own_church ON public.collections;
CREATE POLICY collections_select_own_church
ON public.collections
FOR SELECT
TO authenticated
USING (public.can_view_finance() AND public.can_read_church(from_church));

-- 2. Restore the 0012 security_invoker view (no in-body guard; it relied on the
--    base-table RLS above, which the restored policy re-widens to viewers).
DROP VIEW IF EXISTS public.collectives_service_totals;

CREATE VIEW public.collectives_service_totals
WITH (security_invoker = on) AS
WITH collection_totals AS (
  SELECT from_church,
         "collectedOn" AS service_date,
         sum(CASE WHEN is_tithes THEN amount::numeric ELSE 0 END) AS tithes,
         sum(CASE WHEN is_tithes THEN 0 ELSE amount::numeric END) AS offering
  FROM public.collections
  GROUP BY from_church, "collectedOn"
),
expense_totals AS (
  SELECT from_church,
         spent_on AS service_date,
         sum(amount) AS expenses
  FROM public.expenses
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

-- 3. Drop the predicate 0031 added.
DROP FUNCTION IF EXISTS public.can_see_contributor_identity();

COMMIT;

NOTIFY pgrst, 'reload schema';

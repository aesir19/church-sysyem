-- ============================================================================
-- 0012_collectives_service_totals — Give the report a live running balance.
-- ============================================================================
--
-- WHY
-- The Church Funds report rendered a hardcoded fixture (SAMPLE_COLLECTIVES) for
-- every contribution line. It opened on February 2026 showing invented names and
-- amounts, and every other month — including the current one — rendered empty.
-- Only expenses were live. docs/ARCHITECTURE.md §9.14 tracked it.
--
-- Wiring the report to `collections` is mostly application work. The one part
-- that needs the database is the **opening balance**: the report's balance card
-- carries funds forward, so the opening balance for any month is the accumulated
-- net of every service that came before it. Answering that purely in the browser
-- means downloading the entire collections history on every visit, and growing
-- that download forever.
--
-- THE SHAPE — one row per service date, computed on read.
-- This view collapses the whole ledger to one row per (church, service date):
-- roughly 52 rows per year, a few KB for a decade. The client fetches it once,
-- runs it back through the existing allocation calculator, and has the correct
-- opening balance for every month.
--
-- It is a view, not a snapshot table, and that is the point. There is no
-- month-close step and nothing is ever frozen: correcting a three-month-old
-- entry immediately re-derives every balance after it. A stored opening_balance
-- column would have required closing off each month and would drift the moment
-- a correction landed behind the close.
--
-- security_invoker = on IS MANDATORY, NOT STYLISTIC.
-- Postgres views run as their *owner* by default. An owner-rights view over
-- these two tables would bypass collections_select_own_church (0006) and
-- expenses_select_own_church, handing every authenticated user a per-date
-- summary of every church's ledger — a cross-church data leak in the one place
-- it matters most. With invoker semantics the base-table RLS is evaluated as the
-- caller, so from_church scoping is inherited and this view needs no predicate
-- of its own. Verify with:
--
--   SELECT relname, reloptions FROM pg_class
--   WHERE relname = 'collectives_service_totals';
--
-- WHAT IS DELIBERATELY NOT HERE
--
--   Allocation percentages. The 10% tithes-of-tithes / 5% project / 5% student
--   program / 50-50 pastor-church split lives in src/utils/collectivesReport.js
--   and stays there. This view aggregates; it does not allocate. Duplicating the
--   money rules in SQL would create a second source of truth that drifts
--   silently — the two copies would disagree only in the totals, and only
--   sometimes. Keep it that way when extending this.
--
--   A grant to anon. 0009_narrow_grants revoked anon from every funds table.
--   Granting it here would reintroduce exactly what that migration removed.
--
--   NOTE — the REVOKE below is not decorative, and omitting it is the easy
--   mistake. Supabase's DEFAULT PRIVILEGES fire on every new object in `public`,
--   so a freshly created view arrives with ALL privileges already granted to
--   anon AND authenticated before this migration grants anything. Verified
--   empirically: without the REVOKE, `role_table_grants` showed anon holding
--   SELECT/INSERT/UPDATE/DELETE/TRUNCATE on this view. Adding a GRANT does not
--   displace them — GRANT is additive. This is the same mechanism §3.12 of
--   docs/SECURITY.md describes for the five base tables, and the same order
--   0009 uses: revoke everything, then grant back only what the app calls.
--
--   With security_invoker = on this was not directly exploitable — anon lacks
--   SELECT on `collections` and `expenses` (0009), and permission on the base
--   tables is checked against the *caller* under invoker semantics, so the read
--   fails there. But it is one edit away from being live: flip this view to
--   owner rights, or grant anon anything on a base table, and it opens.
--
--   Anonymity. The view exposes only per-date sums, never `from`, so it carries
--   no contributor identity and nothing about who gave anonymously. Contributor
--   detail stays on the base table under its own policy.
--
-- WHY amount::numeric
-- collections.amount is `real` (float4). Summing float4 across a year of
-- services accumulates binary-float error into a figure that is meant to
-- reconcile against a paper report to the centavo. The cast makes the running
-- total exact. expenses.amount is already numeric(12,2) and needs no cast.
-- (The underlying `real` column is the wrong type for money and should become
-- numeric eventually; that is a separate migration with a data rewrite.)
--
-- NOT IN schema.prisma, DELIBERATELY
-- Prisma models views only under the `views` preview feature, which this project
-- does not enable. `prisma db pull` will therefore not add it and the absence is
-- not drift. Nothing needs it there either: the view is read exclusively through
-- supabase-js, like every other runtime query (ARCHITECTURE.md §6.5).
--
-- ROLLBACK: see rollback.sql in this directory. It is clean — dropping a view
-- destroys no data.
-- ============================================================================

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
-- FULL OUTER JOIN, not LEFT: a date can carry expenses with no collections (a
-- bill paid midweek) or collections with no expenses. Both must appear, so
-- neither side can be the driving table.
SELECT coalesce(c.from_church, e.from_church) AS from_church,
       coalesce(c.service_date, e.service_date) AS service_date,
       coalesce(c.tithes, 0)   AS tithes,
       coalesce(c.offering, 0) AS offering,
       coalesce(e.expenses, 0) AS expenses
FROM collection_totals c
FULL OUTER JOIN expense_totals e
  ON c.from_church = e.from_church
 AND c.service_date = e.service_date;

-- Strip Supabase's default privileges first (see the header). GRANT is additive
-- and cannot undo them, so the revoke has to come first and has to name both
-- roles. The view is an aggregate over a FULL OUTER JOIN and therefore not
-- auto-updatable, but the INSERT/UPDATE/DELETE/TRUNCATE defaults are revoked on
-- principle: nothing should hold a privilege it has no use for.
REVOKE ALL ON TABLE public.collectives_service_totals FROM anon, authenticated;

GRANT SELECT ON TABLE public.collectives_service_totals TO authenticated;

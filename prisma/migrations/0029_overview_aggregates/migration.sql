-- ============================================================================
-- 0029 — Overview aggregates: one round-trip per Overview intent.
-- ============================================================================
-- WHY THIS EXISTS. The Overview read the base `members` table directly to count
-- active/archived members and to build the "Needs attention" tile. That path is
-- subject to the members SELECT policy (0015), which requires
-- can_see_member_detail(). A Welcome Team account fails that check, so RLS hid
-- every row and every tile collapsed to 0 — even though the Members page shows a
-- full roster, because that page reads through directory_search() (0028), a
-- SECURITY DEFINER function the "widen directory" work opened to the same role.
-- Two data paths, one of them blind. This migration gives the Overview its own
-- definer-scoped read so the numbers agree.
--
-- WHY IT IS ALSO FASTER. The Overview fanned out into ~19 PostgREST round-trips
-- on every visit: three member counts, four needs-attention queries, and one
-- attendance COUNT per service (an N+1). Rule 1 is a bandwidth/latency budget on
-- free-tier Nano compute, where each round-trip pays full network latency. Both
-- functions below fold their work into a single statement:
--   overview_member_stats()    — 7 queries -> 1
--   overview_recent_services() — up to 11 queries -> 1
--
-- SCOPE & POSTURE. overview_member_stats mirrors directory_search exactly:
-- SECURITY DEFINER, gated by has_directory_access() (a scopeless account gets
-- zeros), and church-scoped by the same is_global / my_church rule so a
-- SuperAdmin sees the one selected church, not every church merged.
-- overview_recent_services is SECURITY INVOKER on purpose: the services /
-- attendance SELECT policies (0016) already admit exactly the roles that may see
-- attendance (can_view_attendance + can_read_church), so it reuses them rather
-- than re-deriving the gate — a role without attendance access gets no rows.
--
-- ROLLBACK: see rollback.sql (drops both functions).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. overview_member_stats() — every member-derived Overview number, one pass.
-- ---------------------------------------------------------------------------
-- Returns exactly one row (aggregates with no GROUP BY always do), so the caller
-- never has to distinguish "no members" from "no row" — an empty church answers
-- all-zeros. When has_directory_access() is false the WHERE removes every row and
-- the same all-zeros row comes back: fail-closed, matching directory_search.
--
-- date_joined is nullable; the month/90-day comparisons treat NULL as "not in
-- range" (NULL >= date is NULL is not true), which matches the .gte()/.lt()
-- filters the client used before.

DROP FUNCTION IF EXISTS public.overview_member_stats(uuid);

CREATE FUNCTION public.overview_member_stats(
  p_church_id uuid DEFAULT NULL
)
RETURNS TABLE (
  active             integer,
  archived           integer,
  joined_this_month  integer,
  no_one_to_one      integer,
  not_baptized       integer,
  in_no_group        integer
)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  WITH scope AS (
    SELECT (public.is_super_admin() OR public.is_head_pastor()) AS is_global,
           public.get_my_church_id()     AS my_church,
           public.has_directory_access() AS allowed
  ),
  bounds AS (
    SELECT date_trunc('month', now())::date AS month_start,
           (now() - interval '90 days')::date AS ninety_days_ago
  )
  SELECT
    count(*) FILTER (WHERE m.archived_at IS NULL)::int,
    count(*) FILTER (WHERE m.archived_at IS NOT NULL)::int,
    count(*) FILTER (
      WHERE m.archived_at IS NULL AND m.date_joined >= b.month_start
    )::int,
    count(*) FILTER (
      WHERE m.archived_at IS NULL
        AND m.is_one_to_one_completed = false
        AND m.date_joined < b.ninety_days_ago
    )::int,
    count(*) FILTER (
      WHERE m.archived_at IS NULL AND m.is_baptized = false
    )::int,
    count(*) FILTER (
      WHERE m.archived_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.ministry_members mm WHERE mm.member_id = m.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.small_group_members sgm WHERE sgm.member_id = m.id
        )
    )::int
  FROM public.members AS m
  CROSS JOIN scope  AS s
  CROSS JOIN bounds AS b
  WHERE s.allowed
    AND (s.is_global OR m.member_of = s.my_church)
    AND (p_church_id IS NULL OR m.member_of = p_church_id)
$$;

COMMENT ON FUNCTION public.overview_member_stats(uuid) IS
  'Every member-derived Overview figure in one row: active/archived/joined-this-month and the three Needs-attention counts. SECURITY DEFINER, gated by has_directory_access(), church-scoped like directory_search(). Added by 0029.';

REVOKE ALL ON FUNCTION public.overview_member_stats(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.overview_member_stats(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. overview_recent_services() — recent services with present-counts, one join.
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER: the services/attendance policies (0016) already scope this to
-- can_view_attendance() + can_read_church(), so the join runs under the caller's
-- own visibility and a role without attendance access simply gets no rows. Newest
-- first and capped; the client reverses to oldest-first for the chart.

DROP FUNCTION IF EXISTS public.overview_recent_services(uuid, integer);

CREATE FUNCTION public.overview_recent_services(
  p_church_id uuid,
  p_limit     integer DEFAULT 10
)
RETURNS TABLE (
  id           uuid,
  label        text,
  service_date date,
  present      integer
)
LANGUAGE sql SECURITY INVOKER SET search_path = public STABLE
AS $$
  SELECT
    s.id,
    s.label::text,
    s.service_date,
    count(a.id)::int AS present
  FROM public.services AS s
  LEFT JOIN public.attendance AS a ON a.service_id = s.id
  WHERE (p_church_id IS NULL OR s.church_id = p_church_id)
  GROUP BY s.id, s.label, s.service_date
  ORDER BY s.service_date DESC
  LIMIT greatest(1, least(coalesce(p_limit, 10), 100))
$$;

COMMENT ON FUNCTION public.overview_recent_services(uuid, integer) IS
  'Recent services with their attendance present-count, one LEFT JOIN + GROUP BY instead of an N+1. SECURITY INVOKER so it reuses the services/attendance SELECT policies. Added by 0029.';

REVOKE ALL ON FUNCTION public.overview_recent_services(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.overview_recent_services(uuid, integer) TO authenticated;

COMMIT;

-- PostgREST caches the schema; the two new functions 404 until it reloads:
NOTIFY pgrst, 'reload schema';

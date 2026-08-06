-- ============================================================================
-- 0015_members_rbac — Split member access into a PII-detail path and a safe
-- name/group directory path, and role-gate member writes.
-- ============================================================================
--
-- WHY
-- Today (after 0007/0010) any authenticated linked member of a church can SELECT
-- full member rows and INSERT/UPDATE/archive them — church-scoped but not
-- role-gated. Under RBAC:
--
--   * Only Pastor, Church Leader, Secretariat, and SuperAdmin may see member PII
--     DETAIL. Head Pastor and baseline users must NOT — but baseline still needs a
--     name list + search + "which ministry/small group is this person in", and Head
--     Pastor needs that same directory across ALL churches (read-only).
--   * Only Secretariat (+ SuperAdmin) may add/update/archive member records. Pastor
--     is see-only.
--
-- RLS is row-level, not column-level, so one table read cannot return different
-- columns to different callers. Two paths:
--
--   1. DETAIL — the base members SELECT policy, gated to can_see_member_detail().
--      Privileged users read full rows here (detail modals). Head Pastor and
--      baseline get zero rows from the base table.
--   2. DIRECTORY — a SECURITY DEFINER RPC returning ONLY id, names, and the
--      member's ministry + small-group names. Church-scoped, cross-church for
--      SuperAdmin/Head Pastor. This is the baseline list/search and Head Pastor's
--      only member view. Callers never touch the base table, so no PII leaks.
--
-- A SECURITY DEFINER RPC — not a security_invoker view — because with base-table
-- SELECT restricted to privileged users, an invoker view returns nothing for
-- baseline callers. The RPC is the established pattern here (get_my_church, the
-- check-in RPCs) and gives exact column control in one round-trip.
--
-- FRONTEND CONTRACT: DashboardView must branch — privileged callers query the
-- members table (current path), everyone else calls directory_search(). The
-- ministry member-lookup search must do the same. See docs/security/VERIFICATION.md.
--
-- ROLLBACK: see rollback.sql (restores the 0010 church-only policies, drops the RPC).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. members SELECT — detail path, gated to privileged viewers.
-- ---------------------------------------------------------------------------
-- Head Pastor is intentionally NOT in can_see_member_detail(); it reads the
-- directory RPC instead. archived_at stays OUT of the policy (0010): filtering
-- archived rows remains the application's job (CLAUDE.md), and re-adding it here
-- would break the archive UPDATE exactly as 0010 documented.

DROP POLICY IF EXISTS members_select_own_church ON public.members;
CREATE POLICY members_select_own_church
ON public.members
FOR SELECT
TO authenticated
USING (
  public.can_read_church(member_of)
  AND public.can_see_member_detail()
);

-- ---------------------------------------------------------------------------
-- 2. members INSERT / UPDATE — role-gated to Secretariat (+ SuperAdmin).
-- ---------------------------------------------------------------------------
-- can_write_church(member_of) preserves tenant pinning for non-super-admins
-- (it reduces to member_of = get_my_church_id()); SuperAdmin may write any church.
-- WITH CHECK on UPDATE omits archived_at so archiving is permitted, matching 0007.

DROP POLICY IF EXISTS members_insert_own_church ON public.members;
CREATE POLICY members_insert_own_church
ON public.members
FOR INSERT
TO authenticated
WITH CHECK (
  public.can_write_church(member_of)
  AND public.can_write_members()
  AND archived_at IS NULL
);

DROP POLICY IF EXISTS members_update_own_church ON public.members;
CREATE POLICY members_update_own_church
ON public.members
FOR UPDATE
TO authenticated
USING (
  public.can_write_church(member_of)
  AND public.can_write_members()
)
WITH CHECK (
  public.can_write_church(member_of)
  AND public.can_write_members()
);

-- No DELETE policy (unchanged from 0007): archiving stays the only deletion path.
-- members grants are unchanged (0009: SELECT, INSERT, UPDATE to authenticated);
-- RLS is what now denies baseline and Head Pastor.

-- ---------------------------------------------------------------------------
-- 3. directory_search() — the safe name/group path.
-- ---------------------------------------------------------------------------
-- Returns ONLY id, names, church id, and the member's ministry + small-group
-- names — never birthdate, address, contact, baptismal/marital status, or any
-- other PII (Q4: name + groups only). SECURITY DEFINER so it bypasses the base
-- members RLS and can serve baseline callers who cannot read the table directly.
--
-- SCOPE, computed once (cheaper than can_read_church per row):
--   * SuperAdmin / Head Pastor  → all churches (optionally narrowed by p_church_id)
--   * everyone else linked       → their own church only
--   * unlinked / anon-with-JWT-less → get_my_church_id() is NULL → no rows
--
-- p_query does a case-insensitive substring match on the full name. p_limit bounds
-- the result (the 300-member/church threshold means own-church lists are small;
-- the bound matters for the cross-church SuperAdmin/Head-Pastor case).

CREATE OR REPLACE FUNCTION public.directory_search(
  p_query     text    DEFAULT NULL,
  p_church_id uuid    DEFAULT NULL,
  p_limit     integer DEFAULT 200
)
RETURNS TABLE (
  member_id    uuid,
  first_name   text,
  last_name    text,
  church_id    uuid,
  ministries   text[],
  small_groups text[]
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH scope AS (
    SELECT (public.is_super_admin() OR public.is_head_pastor()) AS is_global,
           public.get_my_church_id() AS my_church
  )
  SELECT
    m.id,
    m.first_name::text,
    m.last_name::text,
    m.member_of,
    coalesce(array_agg(DISTINCT g.name) FILTER (WHERE g.type = 'Ministry'), '{}') AS ministries,
    coalesce(array_agg(DISTINCT g.name) FILTER (WHERE g.type = 'Small Group'), '{}') AS small_groups
  FROM public.members AS m
  CROSS JOIN scope AS s
  LEFT JOIN public.group_members AS gm ON gm.member_id = m.id
  LEFT JOIN public.groups        AS g  ON g.id = gm.group_id
  WHERE m.archived_at IS NULL
    AND (s.is_global OR m.member_of = s.my_church)
    AND (p_church_id IS NULL OR m.member_of = p_church_id)
    AND (
      p_query IS NULL
      OR (m.first_name || ' ' || m.last_name) ILIKE '%' || p_query || '%'
    )
  GROUP BY m.id, m.first_name, m.last_name, m.member_of
  ORDER BY m.last_name, m.first_name
  LIMIT greatest(1, least(coalesce(p_limit, 200), 1000))
$$;

REVOKE ALL ON FUNCTION public.directory_search(text, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.directory_search(text, uuid, integer) TO authenticated;

COMMIT;

-- PostgREST caches the schema. If directory_search 404s right after deploy:
--   NOTIFY pgrst, 'reload schema';

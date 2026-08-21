-- ============================================================================
-- 0028_directory_journey_access — Widen the safe member directory to everyone
-- with a scope, and let a small-group leader record two journey milestones.
-- ============================================================================
--
-- WHY
-- The RBAC split (0014/0015) drew the line between "member PII detail" and "the
-- name/group directory" in the right place, but two things were wrong for how the
-- church actually works, confirmed with the owner:
--
--   1. The directory returned NAME + GROUP only. A Welcome Team member recording
--      attendance, a Finance member entering a collection, a small-group leader
--      looking at their roster — none of them could see a member's GENDER, MIDDLE
--      NAME, or DISCIPLESHIP JOURNEY, which are exactly the operational facts those
--      roles work from. Those four journey flags plus gender and middle name are NOT
--      PII in the sense rule 2 protects (birthdate, address, contact, marital
--      status) — they are ministry-operational, and the owner has ruled they are
--      visible to every assigned role. Baptismal status travels with the journey by
--      that same ruling.
--
--   2. The directory returned rows to ANY authenticated caller with a church, so a
--      brand-new 'unassigned'/'member' account with no ministry could browse the
--      whole congregation. That is the one place "show everyone" brushed against
--      fail-closed, and the owner chose to close it: directory access now requires
--      an assigned role or ministry (has_directory_access), and a scopeless account
--      sees nothing.
--
-- WHAT STAYS SECRETARIAT-EXCLUSIVE. Everything still on the base `members` table
-- and gated by can_see_member_detail(): birthdate, gender-aside, address, contact,
-- email, date joined, marital status, wedding anniversary, facebook. The base-table
-- SELECT policy (0015) is unchanged — this migration only widens the SECURITY
-- DEFINER directory path and adds a narrow journey writer. Head Pastor remains
-- outside member detail and reads the directory like everyone else.
--
-- THE JOURNEY WRITE (set_member_journey). Small-group leaders may now tick the
-- one-to-one and turning-point milestones — and ONLY those two — for the members of
-- the small groups they lead. Baptism and membership certification stay a
-- Secretariat/SuperAdmin write through the members form. RLS restricts rows, not
-- columns, so a two-column write for a role that cannot write the table at all
-- cannot be a policy; it is a SECURITY DEFINER function that checks leadership and
-- touches exactly those two columns. This mirrors how every other leader power is
-- written (assign_small_group_leader, 0022/0026).
--
-- ROLLBACK: see rollback.sql (restores the 0026 directory_search body and drops
-- has_directory_access + set_member_journey).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. has_directory_access() — does this caller have any assigned scope?
-- ---------------------------------------------------------------------------
-- The union of every real role and ministry. A plain 'member' or 'unassigned'
-- account that has been given nothing answers false, and directory_search() below
-- returns it no rows — the fail-closed state the owner asked for. Same shape and
-- posture as the other predicates (0014): SECURITY DEFINER, STABLE, pinned
-- search_path, revoked from PUBLIC/anon, granted to authenticated.

CREATE OR REPLACE FUNCTION public.has_directory_access()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT public.is_super_admin()
      OR public.is_head_pastor()
      OR public.is_pastor()
      OR public.is_church_leader()
      OR public.is_finance_member()
      OR public.is_secretariat()
      OR public.is_welcome_team()
      OR public.is_small_group_leader()
$$;

COMMENT ON FUNCTION public.has_directory_access() IS
  'Whether the caller has any assigned role or ministry. Gates directory_search(): a scopeless account sees no members. Added by 0028.';

REVOKE ALL ON FUNCTION public.has_directory_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_directory_access() TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. directory_search() — widened with gender, middle name, and journey.
-- ---------------------------------------------------------------------------
-- DROP then CREATE, not CREATE OR REPLACE: the return type gains columns, and
-- Postgres refuses to change a function's result shape in place. Nothing in the
-- schema references this function (it is called only over PostgREST), so a drop is
-- safe; the app is redeployed in lockstep with this migration regardless.
--
-- The gate moves from "has a church" to has_directory_access(). Everything else is
-- the 0026 body: church-scoped, cross-church for SuperAdmin/Head Pastor, correlated
-- subqueries for the two membership arrays (no row multiplication).
--
-- STILL NO PII. The added columns are gender, middle name and the four journey
-- booleans — the owner's ministry-operational set. Birthdate, address, contact,
-- email, marital status, wedding anniversary and facebook are deliberately absent;
-- they remain on the base table behind can_see_member_detail() (0015).

DROP FUNCTION IF EXISTS public.directory_search(text, uuid, integer);

CREATE FUNCTION public.directory_search(
  p_query     text    DEFAULT NULL,
  p_church_id uuid    DEFAULT NULL,
  p_limit     integer DEFAULT 200
)
RETURNS TABLE (
  member_id                      uuid,
  first_name                     text,
  middle_name                    text,
  last_name                      text,
  gender                         text,
  church_id                      uuid,
  ministries                     text[],
  small_groups                   text[],
  is_one_to_one_completed        boolean,
  is_turning_point_completed     boolean,
  is_baptized                    boolean,
  has_submitted_membership_form  boolean
)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  WITH scope AS (
    SELECT (public.is_super_admin() OR public.is_head_pastor()) AS is_global,
           public.get_my_church_id()  AS my_church,
           public.has_directory_access() AS allowed
  )
  SELECT
    m.id,
    m.first_name::text,
    m.middle_name::text,
    m.last_name::text,
    m.gender::text,
    m.member_of,
    coalesce((
      SELECT array_agg(DISTINCT mi.name::text ORDER BY mi.name::text)
      FROM public.ministry_members AS mm
      JOIN public.ministries AS mi ON mi.id = mm.ministry_id
      WHERE mm.member_id = m.id
    ), '{}'::text[]) AS ministries,
    coalesce((
      SELECT array_agg(DISTINCT sg.name::text ORDER BY sg.name::text)
      FROM public.small_group_members AS sgm
      JOIN public.small_groups AS sg ON sg.id = sgm.small_group_id
      WHERE sgm.member_id = m.id
    ), '{}'::text[]) AS small_groups,
    m.is_one_to_one_completed,
    m.is_turning_point_completed,
    m.is_baptized,
    m.has_submitted_membership_form
  FROM public.members AS m
  CROSS JOIN scope AS s
  WHERE s.allowed
    AND m.archived_at IS NULL
    AND (s.is_global OR m.member_of = s.my_church)
    AND (p_church_id IS NULL OR m.member_of = p_church_id)
    AND (
      p_query IS NULL
      OR (m.first_name || ' ' || m.last_name) ILIKE '%' || p_query || '%'
    )
  ORDER BY m.last_name, m.first_name
  LIMIT greatest(1, least(coalesce(p_limit, 200), 1000))
$$;

COMMENT ON FUNCTION public.directory_search(text, uuid, integer) IS
  'The safe member directory: names, gender, group membership and the four journey flags — never birthdate/address/contact/marital PII. Gated by has_directory_access() so a scopeless account sees nothing. Widened by 0028.';

REVOKE ALL ON FUNCTION public.directory_search(text, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.directory_search(text, uuid, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. set_member_journey() — the small-group leader's two-flag write.
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER because the caller (a leader whose account role is usually
-- 'member'/'unassigned') has NO write on the members table under RLS — the base
-- UPDATE policy is can_write_members() (Secretariat/SuperAdmin only, 0015). A
-- column-scoped grant + policy could express "these two columns", but RLS cannot
-- scope columns and per-column GRANTs interact badly with row policies; the
-- established pattern here is a definer function that checks the exact rule and
-- touches exactly the columns it names. It writes ONLY is_one_to_one_completed and
-- is_turning_point_completed — baptism and membership certification are not
-- reachable from here.
--
-- WHO. SuperAdmin (belt, so the same call works from an admin surface), or a
-- small-group leader FOR A MEMBER OF A GROUP THEY LEAD. A leader passing a member
-- outside their groups is refused, not silently ignored — the row scope is the
-- whole security property, so a failure to match is an authorization error.
--
-- Both flags are required (no NULL): the caller is asserting a concrete state for
-- both milestones, which is what the two toggles on the roster send.

CREATE OR REPLACE FUNCTION public.set_member_journey(
  p_member_id      uuid,
  p_one_to_one     boolean,
  p_turning_point  boolean
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_member_id IS NULL OR p_one_to_one IS NULL OR p_turning_point IS NULL THEN
    RAISE EXCEPTION 'member id and both milestones are required' USING ERRCODE = '22023';
  END IF;

  -- An archived member is not someone whose journey is being progressed.
  IF NOT EXISTS (
    SELECT 1 FROM public.members WHERE id = p_member_id AND archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'no such active member' USING ERRCODE = '23503';
  END IF;

  IF NOT (
    public.is_super_admin()
    OR EXISTS (
      -- A leader may write only within the small groups they lead. small_group_leaders
      -- keys on account_id = auth.uid(); the member must be in that same group.
      SELECT 1
      FROM public.small_group_leaders AS sgl
      JOIN public.small_group_members AS sgm ON sgm.small_group_id = sgl.group_id
      WHERE sgl.account_id = auth.uid()
        AND sgm.member_id  = p_member_id
    )
  ) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  UPDATE public.members
     SET is_one_to_one_completed    = p_one_to_one,
         is_turning_point_completed = p_turning_point
   WHERE id = p_member_id;
END
$$;

COMMENT ON FUNCTION public.set_member_journey(uuid, boolean, boolean) IS
  'Records the one-to-one and turning-point milestones for a member. Callable by SuperAdmin, or a small-group leader for a member of a group they lead. Writes only those two columns; baptism/certification stay a Secretariat write. Added by 0028.';

REVOKE ALL ON FUNCTION public.set_member_journey(uuid, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_member_journey(uuid, boolean, boolean) TO authenticated;

COMMIT;

-- PostgREST caches the schema. directory_search() changed shape and the two new
-- functions do not exist to it yet, so calls 404 until the cache reloads:
--   NOTIFY pgrst, 'reload schema';

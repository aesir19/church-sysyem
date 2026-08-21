-- The small-group leader, as two RPCs the browser can actually call: who may be chosen
-- (list_small_group_leader_candidates) and who currently leads (get_small_group_leader).
-- Both exist because the same table — user_accounts — is unreadable from the browser
-- under RLS, so every read that resolves an account to a member has to happen inside a
-- SECURITY DEFINER function or come back empty. The candidate list is documented first;
-- the leader read is at the foot of the file.
--
-- WHY THIS FUNCTION EXISTS AT ALL. The group page needs the candidate list: the people
-- already in a small group who also have a sign-in, because assign_small_group_leader()
-- refuses anyone else ("a leader must already be a member of the group", and an account
-- with no member cannot lead). The obvious read — select from user_accounts filtered to
-- the roster's member ids — cannot be done from the browser: user_accounts has no SELECT
-- policy for ordinary callers, so a direct PostgREST read returns zero rows with no
-- error. That is exactly the bug this replaces: an empty candidate list that looked
-- identical to "nobody here has an account".
--
-- WHY NOT list_church_accounts(). That RPC already returns linked accounts with names,
-- but it is SuperAdmin and Head Pastor only (0024) — a Pastor is deliberately outside
-- it. A Pastor CAN assign a leader within their own church (can_assign_small_group_leader
-- is true for them), so reusing list_church_accounts would leave the one role that most
-- often runs a small group unable to see any candidate. It is also church-scoped, not
-- group-scoped, so the caller would still have to intersect it with the roster.
--
-- THE GUARD IS THE ASSIGNMENT'S OWN GUARD. This returns candidates only to a caller who
-- can_assign_small_group_leader() for this group — the same predicate the write checks —
-- so the list never offers an action that would bounce, and a caller who may not assign
-- learns nothing (zero rows, never an error, matching every other read in admin.js).
--
-- WHAT IT RETURNS. One row per roster member who has a linked account: the account to
-- target, the member behind it (so the page can mark that member's roster row), the
-- name to show, and the role for context. Archived members are excluded — RLS stopped
-- hiding them in 0010, so every read excludes them itself.

BEGIN;

CREATE OR REPLACE FUNCTION public.list_small_group_leader_candidates(p_group uuid)
RETURNS TABLE (
  account_id uuid,
  member_id  uuid,
  full_name  text,
  role       text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    ua.id,
    m.id,
    (m.first_name || ' ' || m.last_name)::text,
    ua.role::text
  FROM public.small_group_members AS sgm
  JOIN public.members       AS m  ON m.id = sgm.member_id
  JOIN public.user_accounts AS ua ON ua.member_id = m.id
  WHERE sgm.small_group_id = p_group
    AND public.can_assign_small_group_leader(p_group)
    AND m.archived_at IS NULL
  ORDER BY m.last_name, m.first_name
$$;

COMMENT ON FUNCTION public.list_small_group_leader_candidates(uuid) IS
  'The accounts eligible to lead one small group: its roster members who have a sign-in. Gated by can_assign_small_group_leader(p_group), so it returns rows only to a caller who could actually make the assignment, and zero rows to everyone else.';

REVOKE ALL ON FUNCTION public.list_small_group_leader_candidates(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_small_group_leader_candidates(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Who currently leads this small group, resolved to a name.
-- ---------------------------------------------------------------------------
-- SAME CLASS OF BUG AS THE CANDIDATE READ, and it hid for the same reason: the leader
-- is stored account-side (small_group_leaders.account_id), and turning that into a name
-- means reading user_accounts and members. The group page did this with a PostgREST
-- embed — small_group_leaders → user_accounts → members — but user_accounts has no
-- SELECT policy for an ordinary caller, so the embedded user_accounts row comes back
-- null and the leader renders as "not linked to a member" no matter who leads it. It
-- was invisible only because no group had a leader until this migration made assigning
-- one work; the first assignment surfaces it immediately.
--
-- TWO GATES, DELIBERATELY DISTINCT.
--   * WHETHER A ROW COMES BACK mirrors the SELECT policy on small_group_leaders exactly
--     (is_super_admin / is_head_pastor / is_group_available_to_my_church). This function
--     must never reveal a leader the table itself would hide, nor hide one it shows —
--     that is what keeps "No leader assigned" from becoming a lie for a caller who could
--     read the row directly.
--   * WHETHER THE NAME IS FILLED IN follows member-detail visibility, plus the Head
--     Pastor — who is outside can_see_member_detail (0015) but is trusted with account
--     holders' names for exactly this kind of assignment work (0024). A caller who may
--     see that a leader exists but not who members are gets the row with a null name,
--     and the page says "Leader assigned" without inventing one. Fail closed (rule 2).
CREATE OR REPLACE FUNCTION public.get_small_group_leader(p_group uuid)
RETURNS TABLE (
  account_id uuid,
  member_id  uuid,
  full_name  text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    sgl.account_id,
    ua.member_id,
    CASE
      WHEN public.can_see_member_detail() OR public.is_head_pastor()
        THEN (m.first_name || ' ' || m.last_name)::text
      ELSE NULL
    END
  FROM public.small_group_leaders AS sgl
  JOIN public.user_accounts AS ua ON ua.id = sgl.account_id
  -- LEFT, not INNER: an account with no member is impossible for a leader today
  -- (assign_small_group_leader refuses it), but a join that vanishes the whole row on
  -- that condition would turn a data anomaly into "no leader", which is the failure
  -- mode this function exists to end. Keep the row; let the name be null.
  LEFT JOIN public.members AS m ON m.id = ua.member_id AND m.archived_at IS NULL
  WHERE sgl.group_id = p_group
    AND (
      public.is_super_admin()
      OR public.is_head_pastor()
      OR public.is_group_available_to_my_church(p_group)
    )
$$;

COMMENT ON FUNCTION public.get_small_group_leader(uuid) IS
  'The current leader of one small group, resolved from account to member name. Row visibility mirrors the SELECT policy on small_group_leaders; the name is filled only for callers who may see member detail (or the Head Pastor). Replaces a PostgREST embed through user_accounts, which RLS silently emptied.';

REVOKE ALL ON FUNCTION public.get_small_group_leader(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_small_group_leader(uuid) TO authenticated;

COMMIT;

-- New function, so PostgREST 404s it until the schema cache reloads:
--   NOTIFY pgrst, 'reload schema';

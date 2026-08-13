-- ============================================================================
-- 0023_admin_access_fixes — three defects found reviewing 0022.
-- ============================================================================
--
-- A separate migration rather than an edit to 0022, which is already applied.
--
--   1. assigned_by made an account undeletable.
--   2. Unlinking an account left it leading a group it was no longer in.
--   3. set_user_role read the current role, then wrote, with a gap in between.
--
-- ROLLBACK: see rollback.sql.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. assigned_by must not pin an account in place.
-- ---------------------------------------------------------------------------
-- The column was NOT NULL with a bare REFERENCES, which defaults to NO ACTION. But
-- user_accounts.id cascades from auth.users, so once an administrator had assigned a
-- single leader, deleting them from Supabase Auth failed on a foreign key violation —
-- and NOT NULL foreclosed the obvious escape. An audit column that prevents erasing
-- the person it names is the wrong trade under rule 2, and it is not what this repo
-- does elsewhere: 0013's created_by and recorded_by are both nullable.
--
-- Nullable with ON DELETE SET NULL keeps the referential guarantee while letting the
-- account go. The row then records that the assignment was made by an account since
-- deleted, which is true and is better than refusing the deletion.

ALTER TABLE public.small_group_leaders
  ALTER COLUMN assigned_by DROP NOT NULL;

ALTER TABLE public.small_group_leaders
  DROP CONSTRAINT small_group_leaders_assigned_by_fkey,
  ADD CONSTRAINT small_group_leaders_assigned_by_fkey
    FOREIGN KEY (assigned_by) REFERENCES public.user_accounts(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.small_group_leaders.assigned_by IS
  'The account that made this assignment, or NULL if that account has since been deleted. Nullable so an audit column cannot prevent erasing the person it names.';

-- ---------------------------------------------------------------------------
-- 2. Relinking must not strand a leader outside their own group.
-- ---------------------------------------------------------------------------
-- 0022 guards one door: a member cannot be removed from the roster of a group they
-- lead. It left another wide open. small_group_leaders keys on account_id, so unlinking
-- the account — or pointing it at a different member — left the leader row untouched:
--
--   * unlink, and is_small_group_leader() stays true for an account with no member
--     record at all, which keeps can_view_attendance() true for someone with no church;
--   * relink elsewhere, and the group has a leader who was never on its roster, which
--     is precisely the state the deferred trigger exists to prevent.
--
-- Refusing is the consistent answer. It matches the roster rule, it is fail-closed, and
-- it says out loud what has to happen first rather than silently deleting an
-- assignment somebody made on purpose. Re-linking to the SAME member is untouched,
-- because nothing moves.

CREATE OR REPLACE FUNCTION public.link_account_to_member(p_account uuid, p_member uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_current uuid;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT member_id INTO v_current FROM public.user_accounts WHERE id = p_account;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such account' USING ERRCODE = '23503';
  END IF;

  IF p_member IS DISTINCT FROM v_current
     AND EXISTS (SELECT 1 FROM public.small_group_leaders WHERE account_id = p_account)
  THEN
    RAISE EXCEPTION 'that account leads a small group — unassign them as leader first'
      USING ERRCODE = '23503';
  END IF;

  IF p_member IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.members WHERE id = p_member AND archived_at IS NULL
    ) THEN
      RAISE EXCEPTION 'no such active member' USING ERRCODE = '23503';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.user_accounts
      WHERE member_id = p_member AND id <> p_account
    ) THEN
      RAISE EXCEPTION 'that member is already linked to another account'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  UPDATE public.user_accounts SET member_id = p_member WHERE id = p_account;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. set_user_role — decide and write in one statement.
-- ---------------------------------------------------------------------------
-- The Head Pastor branch read the target's current role, then updated. Between the two
-- a SuperAdmin can promote that account to head_pastor, and the in-flight demotion
-- lands on it anyway. Folding the condition into the UPDATE's WHERE makes the check
-- and the write the same statement, so there is no gap to lose.

CREATE OR REPLACE FUNCTION public.set_user_role(p_target uuid, p_role text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_updated integer;
BEGIN
  IF p_role NOT IN ('super_admin','head_pastor','pastor','church_leader','member','unassigned') THEN
    RAISE EXCEPTION 'invalid role: %', p_role USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.user_accounts WHERE id = p_target) THEN
    RAISE EXCEPTION 'no such account' USING ERRCODE = '23503';
  END IF;

  IF public.is_super_admin() THEN
    UPDATE public.user_accounts SET role = p_role WHERE id = p_target;
    RETURN;
  END IF;

  IF NOT public.is_head_pastor() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  -- A Head Pastor appoints pastors and demotes them to plain members. Nothing else,
  -- and never against an account that already holds a senior role — otherwise the
  -- appointment power is also the power to remove the people who granted it.
  IF p_role NOT IN ('pastor', 'member') THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  UPDATE public.user_accounts
     SET role = p_role
   WHERE id = p_target
     AND role NOT IN ('super_admin', 'head_pastor');

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
END
$$;

COMMIT;

-- Function bodies changed but no signature did, so PostgREST's cache is still accurate.
-- Reloading is harmless if you would rather be sure:  NOTIFY pgrst, 'reload schema';

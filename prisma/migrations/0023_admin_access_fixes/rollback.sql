-- ROLLBACK for 0023_admin_access_fixes.
--
-- Prisma has no down-migrations. This file is operational only. Paste it into the
-- Supabase SQL editor.
--
-- WARNING: restoring NOT NULL on assigned_by fails if any row has picked up a NULL
-- since — which is exactly what the fix was for. Those rows have to be given an
-- account or deleted first, and either way you are choosing to make administrator
-- accounts undeletable again. Reverting this reintroduces all three defects.
--
-- After running this:
--   npx prisma migrate resolve --rolled-back 0023_admin_access_fixes

BEGIN;

ALTER TABLE public.small_group_leaders
  DROP CONSTRAINT small_group_leaders_assigned_by_fkey,
  ADD CONSTRAINT small_group_leaders_assigned_by_fkey
    FOREIGN KEY (assigned_by) REFERENCES public.user_accounts(id);

ALTER TABLE public.small_group_leaders
  ALTER COLUMN assigned_by SET NOT NULL;

COMMENT ON COLUMN public.small_group_leaders.assigned_by IS NULL;

-- 0022's link_account_to_member, without the leader guard.
CREATE OR REPLACE FUNCTION public.link_account_to_member(p_account uuid, p_member uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.user_accounts WHERE id = p_account) THEN
    RAISE EXCEPTION 'no such account' USING ERRCODE = '23503';
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

-- 0022's set_user_role, with the check-then-act gap.
CREATE OR REPLACE FUNCTION public.set_user_role(p_target uuid, p_role text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_current text;
BEGIN
  IF p_role NOT IN ('super_admin','head_pastor','pastor','church_leader','member','unassigned') THEN
    RAISE EXCEPTION 'invalid role: %', p_role USING ERRCODE = '22023';
  END IF;

  SELECT role INTO v_current FROM public.user_accounts WHERE id = p_target;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such account' USING ERRCODE = '23503';
  END IF;

  IF public.is_super_admin() THEN
    NULL;
  ELSIF public.is_head_pastor() THEN
    IF p_role NOT IN ('pastor', 'member') THEN
      RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
    END IF;
    IF v_current IN ('super_admin', 'head_pastor') THEN
      RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  UPDATE public.user_accounts SET role = p_role WHERE id = p_target;
END
$$;

COMMIT;

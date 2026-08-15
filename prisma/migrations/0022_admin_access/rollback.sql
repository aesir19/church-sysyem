-- ROLLBACK for 0022_admin_access.
--
-- Prisma has no down-migrations. This file is operational only — it is never executed
-- by `prisma migrate deploy`. Paste it into the Supabase SQL editor.
--
-- WHAT THIS DESTROYS
-- Dropping small_group_leaders deletes every leader assignment along with the record of
-- who made it. There is no other copy. If the assignments matter, export the table
-- before running this.
--
-- WHAT THIS DOES NOT UNDO
-- Accounts linked to member records by link_account_to_member(), and roles set by the
-- widened set_user_role(), are data. They stay. That is deliberate: unlinking every
-- account would lock out every real user, which is a far worse outcome than leaving
-- the links in place with the write path removed.
--
-- After running this:
--   npx prisma migrate resolve --rolled-back 0022_admin_access
--   NOTIFY pgrst, 'reload schema';

BEGIN;

DROP TRIGGER IF EXISTS group_members_block_leader_removal ON public.group_members;
DROP FUNCTION IF EXISTS public.group_members_block_leader_removal();

DROP TRIGGER IF EXISTS small_group_leaders_require_small_group ON public.small_group_leaders;
DROP FUNCTION IF EXISTS public.small_group_leaders_require_small_group();

DROP FUNCTION IF EXISTS public.assign_small_group_leader(uuid, uuid);
DROP FUNCTION IF EXISTS public.unassign_small_group_leader(uuid, uuid);
DROP FUNCTION IF EXISTS public.can_assign_small_group_leader(uuid);
DROP FUNCTION IF EXISTS public.my_led_group_ids();
DROP FUNCTION IF EXISTS public.link_account_to_member(uuid, uuid);
DROP FUNCTION IF EXISTS public.list_accounts();

DROP TABLE IF EXISTS public.small_group_leaders;

DROP INDEX IF EXISTS public.user_accounts_member_id_key;

-- Restore can_view_attendance() to its 0016 form (without the leader branch).
--
-- Ordered after the table drop for readability, not necessity: a LANGUAGE sql body in
-- dollar quotes records no dependency on the tables it names, so Postgres would allow
-- either order. Getting that wrong in a comment is worse than leaving it out, because
-- the next person reading this file will believe it.
CREATE OR REPLACE FUNCTION public.can_view_attendance()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT public.is_super_admin()
      OR public.is_head_pastor()
      OR public.is_pastor()
      OR public.is_church_leader()
      OR public.is_welcome_team()
$$;

DROP FUNCTION IF EXISTS public.is_small_group_leader();

-- Restore get_my_permissions() to its 0017 shape (eight columns, no leader flag).
DROP FUNCTION IF EXISTS public.get_my_permissions();

CREATE FUNCTION public.get_my_permissions()
RETURNS TABLE (
  role             text,
  is_super_admin   boolean,
  is_head_pastor   boolean,
  is_pastor        boolean,
  is_church_leader boolean,
  is_finance       boolean,
  is_secretariat   boolean,
  is_welcome       boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    public.my_role(),
    public.is_super_admin(),
    public.is_head_pastor(),
    public.is_pastor(),
    public.is_church_leader(),
    public.is_finance_member(),
    public.is_secretariat(),
    public.is_welcome_team()
$$;

REVOKE ALL ON FUNCTION public.get_my_permissions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_permissions() TO authenticated;

-- Restore set_user_role() to its 0017 form (SuperAdmin only).
CREATE OR REPLACE FUNCTION public.set_user_role(p_target uuid, p_role text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  IF p_role NOT IN ('super_admin','head_pastor','pastor','church_leader','member','unassigned') THEN
    RAISE EXCEPTION 'invalid role: %', p_role USING ERRCODE = '22023';
  END IF;
  UPDATE public.user_accounts SET role = p_role WHERE id = p_target;
END
$$;

COMMIT;

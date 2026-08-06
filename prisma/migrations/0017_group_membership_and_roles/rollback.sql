-- ============================================================================
-- Rollback for 0017_group_membership_and_roles.
-- ============================================================================
-- Restores the 0004 groups / group_members policies and drops the functions this
-- migration added. The bootstrapped SuperAdmin role is DATA and is NOT reverted —
-- reset it by hand with an UPDATE if required.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.get_my_permissions();
DROP FUNCTION IF EXISTS public.list_churches();
DROP FUNCTION IF EXISTS public.set_user_role(uuid, text);

-- groups policies (0004) -------------------------------------------------------
DROP POLICY IF EXISTS groups_select_visible ON public.groups;
CREATE POLICY groups_select_visible ON public.groups
FOR SELECT TO authenticated
USING (
  public.get_my_church_id() IS NOT NULL
  AND (
    (type = 'Ministry' AND church_id IS NULL)
    OR (type = 'Small Group' AND church_id = public.get_my_church_id())
  )
);

DROP POLICY IF EXISTS groups_insert_own_small_group ON public.groups;
CREATE POLICY groups_insert_own_small_group ON public.groups
FOR INSERT TO authenticated
WITH CHECK (type = 'Small Group' AND church_id = public.get_my_church_id());

DROP POLICY IF EXISTS groups_update_own_small_group ON public.groups;
CREATE POLICY groups_update_own_small_group ON public.groups
FOR UPDATE TO authenticated
USING (type = 'Small Group' AND church_id = public.get_my_church_id())
WITH CHECK (type = 'Small Group' AND church_id = public.get_my_church_id());

DROP POLICY IF EXISTS groups_delete_own_small_group ON public.groups;
CREATE POLICY groups_delete_own_small_group ON public.groups
FOR DELETE TO authenticated
USING (type = 'Small Group' AND church_id = public.get_my_church_id());

-- group_members policies (0004) ------------------------------------------------
DROP POLICY IF EXISTS group_members_select_own_church ON public.group_members;
CREATE POLICY group_members_select_own_church ON public.group_members
FOR SELECT TO authenticated
USING (
  public.is_member_in_my_church(member_id)
  AND public.is_group_available_to_my_church(group_id)
);

DROP POLICY IF EXISTS group_members_insert_own_church ON public.group_members;
CREATE POLICY group_members_insert_own_church ON public.group_members
FOR INSERT TO authenticated
WITH CHECK (
  public.is_member_in_my_church(member_id)
  AND public.is_group_available_to_my_church(group_id)
);

DROP POLICY IF EXISTS group_members_delete_own_church ON public.group_members;
CREATE POLICY group_members_delete_own_church ON public.group_members
FOR DELETE TO authenticated
USING (
  public.is_member_in_my_church(member_id)
  AND public.is_group_available_to_my_church(group_id)
);

DROP FUNCTION IF EXISTS public.group_accepts_member(uuid, uuid);

COMMIT;

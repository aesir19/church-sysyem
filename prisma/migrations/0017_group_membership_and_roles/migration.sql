-- ============================================================================
-- 0017_group_membership_and_roles — Gate ministry/small-group membership, open
-- cross-church reads for the top roles, and add role assignment + bootstrap.
-- ============================================================================
--
-- WHY
-- Four remaining pieces of the RBAC model:
--
--   1. MEMBERSHIP MANAGEMENT. 0004 let any linked member of a church add/remove
--      anyone to/from any visible group. RBAC narrows writes to
--      can_manage_group_members(group) — Church Leader everywhere EXCEPT the Finance
--      ministry, which is Pastor-only, and SuperAdmin for all. Small-group ROW
--      management (create/edit/delete) narrows to can_manage_small_groups().
--
--   2. CROSS-CHURCH READ. SuperAdmin and Head Pastor must see groups and membership
--      across all churches for the cross-church console. The groups / group_members
--      SELECT policies gain an is_super_admin()/is_head_pastor() branch; everyone
--      else keeps the 0004 own-church scope.
--
--   3. ROLE ASSIGNMENT. user_accounts has no write policy and no UPDATE grant, so a
--      SECURITY DEFINER set_user_role() gated to is_super_admin() is the only way to
--      change a role. list_churches() feeds the console's church selector, and
--      get_my_permissions() gives the SPA role + ministry flags in one round-trip.
--
--   4. BOOTSTRAP. No SuperAdmin exists yet, so one is seeded here.
--
-- ROLLBACK: see rollback.sql (restores the 0004 policies, drops the new functions).
-- The bootstrapped role is data and is NOT reverted automatically.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Helper: is a (group, member) pair church-consistent? (definer)
-- ---------------------------------------------------------------------------
-- A global ministry accepts any church's member; a small group accepts only a
-- member of its own church. Used on the SuperAdmin insert path, which is not
-- otherwise pinned to a single church by is_group_available_to_my_church.

CREATE OR REPLACE FUNCTION public.group_accepts_member(p_group_id uuid, p_member_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.groups AS g
    JOIN public.members AS m ON m.id = p_member_id
    WHERE g.id = p_group_id
      AND m.archived_at IS NULL
      AND (
        (g.type = 'Ministry'    AND g.church_id IS NULL)
        OR (g.type = 'Small Group' AND g.church_id = m.member_of)
      )
  )
$$;
REVOKE ALL ON FUNCTION public.group_accepts_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.group_accepts_member(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. groups — cross-church SELECT for the top roles; role-gated small-group writes.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS groups_select_visible ON public.groups;
CREATE POLICY groups_select_visible
ON public.groups
FOR SELECT
TO authenticated
USING (
  public.is_super_admin()
  OR public.is_head_pastor()
  OR (
    public.get_my_church_id() IS NOT NULL
    AND (
      (type = 'Ministry' AND church_id IS NULL)
      OR (type = 'Small Group' AND church_id = public.get_my_church_id())
    )
  )
);

-- Small-group rows only (ministries stay admin-managed). can_write_church carries
-- SuperAdmin cross-church; can_manage_small_groups is the capability gate.
DROP POLICY IF EXISTS groups_insert_own_small_group ON public.groups;
CREATE POLICY groups_insert_own_small_group
ON public.groups
FOR INSERT
TO authenticated
WITH CHECK (
  type = 'Small Group'
  AND public.can_write_church(church_id)
  AND public.can_manage_small_groups()
);

DROP POLICY IF EXISTS groups_update_own_small_group ON public.groups;
CREATE POLICY groups_update_own_small_group
ON public.groups
FOR UPDATE
TO authenticated
USING (
  type = 'Small Group'
  AND public.can_write_church(church_id)
  AND public.can_manage_small_groups()
)
WITH CHECK (
  type = 'Small Group'
  AND public.can_write_church(church_id)
  AND public.can_manage_small_groups()
);

DROP POLICY IF EXISTS groups_delete_own_small_group ON public.groups;
CREATE POLICY groups_delete_own_small_group
ON public.groups
FOR DELETE
TO authenticated
USING (
  type = 'Small Group'
  AND public.can_write_church(church_id)
  AND public.can_manage_small_groups()
);

-- ---------------------------------------------------------------------------
-- 3. group_members — cross-church SELECT for the top roles; gated membership writes.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS group_members_select_own_church ON public.group_members;
CREATE POLICY group_members_select_own_church
ON public.group_members
FOR SELECT
TO authenticated
USING (
  public.is_super_admin()
  OR public.is_head_pastor()
  OR (
    public.is_member_in_my_church(member_id)
    AND public.is_group_available_to_my_church(group_id)
  )
);

-- Capability gate (can_manage_group_members — Finance = Pastor-only) AND a scope
-- gate. Non-super callers keep the 0004 own-church scope (which stops adding another
-- church's member to a global ministry); SuperAdmin uses group_accepts_member for
-- church consistency across any church.
DROP POLICY IF EXISTS group_members_insert_own_church ON public.group_members;
CREATE POLICY group_members_insert_own_church
ON public.group_members
FOR INSERT
TO authenticated
WITH CHECK (
  public.can_manage_group_members(group_id)
  AND (
    (public.is_super_admin() AND public.group_accepts_member(group_id, member_id))
    OR (public.is_member_in_my_church(member_id) AND public.is_group_available_to_my_church(group_id))
  )
);

DROP POLICY IF EXISTS group_members_delete_own_church ON public.group_members;
CREATE POLICY group_members_delete_own_church
ON public.group_members
FOR DELETE
TO authenticated
USING (
  public.can_manage_group_members(group_id)
  AND (
    public.is_super_admin()
    OR (public.is_member_in_my_church(member_id) AND public.is_group_available_to_my_church(group_id))
  )
);

-- ---------------------------------------------------------------------------
-- 4. Role assignment, church list, and the SPA permissions bootstrap RPC.
-- ---------------------------------------------------------------------------

-- Only a SuperAdmin may set roles. user_accounts has no client write path, so this
-- SECURITY DEFINER function (running as owner) is the single sanctioned mutation.
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
REVOKE ALL ON FUNCTION public.set_user_role(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_user_role(uuid, text) TO authenticated;

-- Cross-church church selector. Returns rows only to SuperAdmin / Head Pastor;
-- everyone else gets nothing (they use get_my_church()).
CREATE OR REPLACE FUNCTION public.list_churches()
RETURNS TABLE (id uuid, name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT c.id, c.name::text
  FROM public.churches AS c
  WHERE public.is_super_admin() OR public.is_head_pastor()
  ORDER BY c.name
$$;
REVOKE ALL ON FUNCTION public.list_churches() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_churches() TO authenticated;

-- One round-trip role + ministry snapshot for the SPA (useCurrentRole). Replaces the
-- scattered user_accounts/group_members lookups in the router and useFinanceMember.
CREATE OR REPLACE FUNCTION public.get_my_permissions()
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

-- ---------------------------------------------------------------------------
-- 5. Bootstrap the first SuperAdmin.
-- ---------------------------------------------------------------------------
-- No SuperAdmin exists yet, so this is the only way to create one. Defensive: warns
-- rather than fails if the auth user or its user_accounts row is not present yet.

DO $bootstrap$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM auth.users WHERE lower(email) = lower('fjhaze@yahoo.com');
  IF v_id IS NULL THEN
    RAISE WARNING 'RBAC bootstrap: no auth.users row for fjhaze@yahoo.com. No SuperAdmin was set — assign one with set_user_role() once the account exists.';
  ELSE
    UPDATE public.user_accounts SET role = 'super_admin' WHERE id = v_id;
    IF NOT FOUND THEN
      RAISE WARNING 'RBAC bootstrap: auth user fjhaze@yahoo.com exists but has no user_accounts row yet (handle_new_user should have created it).';
    END IF;
  END IF;
END
$bootstrap$;

COMMIT;

-- PostgREST caches the schema. If set_user_role / list_churches / get_my_permissions
-- 404 right after deploy:  NOTIFY pgrst, 'reload schema';

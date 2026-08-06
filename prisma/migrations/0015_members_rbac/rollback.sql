-- ============================================================================
-- Rollback for 0015_members_rbac.
-- ============================================================================
-- Restores the church-only members policies (their 0007 + 0010 state) and drops
-- the directory_search RPC. Safe to run while 0014 is still applied; the restored
-- policies do not call any 0014 predicate.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.directory_search(text, uuid, integer);

-- SELECT — restore the 0010 body (church-scoped, archived filtering left to the app).
DROP POLICY IF EXISTS members_select_own_church ON public.members;
CREATE POLICY members_select_own_church
ON public.members
FOR SELECT
TO authenticated
USING (member_of = public.get_my_church_id());

-- INSERT — restore the 0007 body.
DROP POLICY IF EXISTS members_insert_own_church ON public.members;
CREATE POLICY members_insert_own_church
ON public.members
FOR INSERT
TO authenticated
WITH CHECK (
  member_of = public.get_my_church_id()
  AND archived_at IS NULL
);

-- UPDATE — restore the 0007 body.
DROP POLICY IF EXISTS members_update_own_church ON public.members;
CREATE POLICY members_update_own_church
ON public.members
FOR UPDATE
TO authenticated
USING (member_of = public.get_my_church_id())
WITH CHECK (member_of = public.get_my_church_id());

COMMIT;

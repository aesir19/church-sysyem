-- ============================================================================
-- 0007_members_policy_split — Replace the members FOR ALL policy.
-- ============================================================================
--
-- WHY
-- 0006_baseline_rls captured the deployed members policy as a single FOR ALL
-- policy granted TO public, with USING and no WITH CHECK:
--
--   CREATE POLICY "Only same church members can CRUD data"
--   ON public.members FOR ALL TO public
--   USING (member_of = get_my_church_id() AND archived_at IS NULL);
--
-- Two defects follow from that shape, both documented in docs/SECURITY.md §3.11:
--
--   1. FOR ALL covers DELETE. Combined with the DELETE grant, any authenticated
--      user could permanently delete an active member of their own church. The
--      soft-delete-only guarantee behind docs/ARCHITECTURE.md §6.2.1 and the
--      §3.10 retention model did not actually exist.
--
--   2. With no WITH CHECK, Postgres reuses USING as the write check. Any UPDATE
--      setting archived_at to a non-NULL value therefore failed, which meant
--      DashboardView.handleArchive() could not succeed. The only deletion path
--      that worked was the destructive one.
--
-- This migration splits the policy per command and removes DELETE entirely.
--
-- ROLLBACK: see rollback.sql in this directory.
-- ============================================================================

DROP POLICY IF EXISTS "Only same church members can CRUD data" ON public.members;

-- Active members of the caller's church.
CREATE POLICY members_select_own_church
ON public.members
FOR SELECT
TO authenticated
USING (
  member_of = public.get_my_church_id()
  AND archived_at IS NULL
);

-- New rows must belong to the caller's church and start un-archived.
CREATE POLICY members_insert_own_church
ON public.members
FOR INSERT
TO authenticated
WITH CHECK (
  member_of = public.get_my_church_id()
  AND archived_at IS NULL
);

-- WITH CHECK deliberately omits `archived_at IS NULL` so that archiving — an
-- UPDATE that sets archived_at — is permitted. It still pins member_of, so a
-- row cannot be reassigned to another church.
CREATE POLICY members_update_own_church
ON public.members
FOR UPDATE
TO authenticated
USING (member_of = public.get_my_church_id())
WITH CHECK (member_of = public.get_my_church_id());

-- No DELETE policy is created. That omission is the control: with RLS enabled
-- and no DELETE policy, every delete is denied, which is what makes archiving
-- the only deletion path. Do not add one without revisiting §3.10.
--
-- Note also the shift from TO public to TO authenticated. The previous policy
-- applied to anon as well and failed closed only incidentally, because
-- get_my_church_id() returns NULL without a JWT.

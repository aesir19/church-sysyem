-- ROLLBACK for 0007_members_policy_split.
--
-- Prisma has no down-migrations. This file is operational only — it is never
-- executed by `prisma migrate deploy`. Paste it into the Supabase SQL editor to
-- restore the exact pre-0007 policy captured in 0006_baseline_rls.
--
-- WARNING: restoring this state re-opens both defects in docs/SECURITY.md §3.11
-- — hard DELETE of active members becomes possible again, and archiving breaks
-- again. Use it only to recover from a failed 0007 deploy, not as a resting
-- state.
--
-- After running this, mark the migration rolled back so Prisma's history stays
-- honest:
--   npx prisma migrate resolve --rolled-back 0007_members_policy_split

DROP POLICY IF EXISTS members_select_own_church ON public.members;
DROP POLICY IF EXISTS members_insert_own_church ON public.members;
DROP POLICY IF EXISTS members_update_own_church ON public.members;

CREATE POLICY "Only same church members can CRUD data"
ON public.members
FOR ALL
TO public
USING (
  member_of = public.get_my_church_id()
  AND archived_at IS NULL
);

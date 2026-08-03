-- ROLLBACK for 0010_members_select_allow_archived.
--
-- Prisma has no down-migrations. This file is operational only — it is never
-- executed by `prisma migrate deploy`. Paste it into the Supabase SQL editor.
--
-- WARNING: restoring this policy makes archiving fail again with
-- `42501: new row violates row-level security policy for table "members"`.
-- Archiving has never worked with this condition in place. Roll back only if
-- reading archived rows turns out to be a problem, and pair it with reverting
-- the `.is('archived_at', null)` filters added to the four member reads —
-- otherwise the UI silently double-filters and nothing appears broken until
-- someone tries to archive.
--
-- After running this:
--   npx prisma migrate resolve --rolled-back 0010_members_select_allow_archived

DROP POLICY IF EXISTS members_select_own_church ON public.members;

CREATE POLICY members_select_own_church
ON public.members
FOR SELECT
TO authenticated
USING (
  member_of = public.get_my_church_id()
  AND archived_at IS NULL
);

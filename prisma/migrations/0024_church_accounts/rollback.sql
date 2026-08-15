-- ROLLBACK for 0024_church_accounts.
--
-- Operational only; Prisma has no down-migrations. Paste into the Supabase SQL editor.
--
-- WARNING: dropping this leaves the pastor assignment screen empty for a Head Pastor,
-- who has no other way to see an account. Only roll back together with that screen.
--
-- After running this:
--   npx prisma migrate resolve --rolled-back 0024_church_accounts
--   NOTIFY pgrst, 'reload schema';

DROP FUNCTION IF EXISTS public.list_church_accounts(uuid);

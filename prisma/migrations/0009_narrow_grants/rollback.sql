-- ROLLBACK for 0009_narrow_grants.
--
-- Prisma has no down-migrations. This file is operational only — it is never
-- executed by `prisma migrate deploy`. Paste it into the Supabase SQL editor to
-- restore the pre-0009 privilege set captured in 0006_baseline_rls.
--
-- This is the rollback most likely to be needed, because 0009 is the migration
-- with no compile-time signal: an over-tight grant shows up as a runtime failure
-- on whichever page needs it. Running this restores access immediately; diagnose
-- afterwards rather than under pressure.
--
-- WARNING: this restores the blanket GRANT ALL to anon and authenticated on all
-- five tables and re-opens docs/SECURITY.md §3.3 and §3.12.
--
-- After running this:
--   npx prisma migrate resolve --rolled-back 0009_narrow_grants

-- 1. Restore the Supabase default table privileges.
GRANT ALL ON TABLE public.churches      TO anon, authenticated;
GRANT ALL ON TABLE public.collections   TO anon, authenticated;
GRANT ALL ON TABLE public.expenses      TO anon, authenticated;
GRANT ALL ON TABLE public.members       TO anon, authenticated;
GRANT ALL ON TABLE public.user_accounts TO anon, authenticated;

-- 2. Restore sequence privileges.
GRANT USAGE ON SEQUENCE public.collections_id_seq TO anon, authenticated;
GRANT USAGE ON SEQUENCE public.expenses_id_seq    TO anon, authenticated;

-- 3. Restore the permissive churches policy.
DROP POLICY IF EXISTS churches_select_own_only ON public.churches;

CREATE POLICY "Authenticated users can view churches"
ON public.churches
FOR SELECT
TO authenticated
USING (true);

-- 4. Restore anon EXECUTE on the helper functions.
GRANT EXECUTE ON FUNCTION public.get_my_church()                       TO anon;
GRANT EXECUTE ON FUNCTION public.get_my_church_id()                    TO anon;
GRANT EXECUTE ON FUNCTION public.is_member_in_my_church(uuid)          TO anon;
GRANT EXECUTE ON FUNCTION public.is_group_available_to_my_church(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.is_finance_member()                   TO anon;
GRANT EXECUTE ON FUNCTION public.handle_new_user()                     TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rls_auto_enable()                     TO anon, authenticated;

-- NOTE: the GRANT ALL in step 1 restores table-wide UPDATE on collections, which
-- supersedes the column-scoped `UPDATE (amount)` grant from 0008. If you are
-- rolling back 0009 but KEEPING 0008, re-apply the column scope afterwards or the
-- 3-hour edit window becomes bypassable via created_at:
--
--   REVOKE UPDATE ON TABLE public.collections FROM authenticated;
--   GRANT UPDATE (amount) ON TABLE public.collections TO authenticated;

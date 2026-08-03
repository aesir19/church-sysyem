-- ROLLBACK for 0008_funds_write_policies.
--
-- Prisma has no down-migrations. This file is operational only — it is never
-- executed by `prisma migrate deploy`. Paste it into the Supabase SQL editor to
-- restore the pre-0008 state: expenses policies as created by 0003_expenses, and
-- collections policies as captured by 0006_baseline_rls.
--
-- WARNING: restoring this state re-opens docs/SECURITY.md §3.11 — finance-role
-- authorization returns to being browser-only, and the collections edit/delete
-- actions go back to being denied by RLS. Use it only to recover from a failed
-- 0008 deploy.
--
-- After running this:
--   npx prisma migrate resolve --rolled-back 0008_funds_write_policies

-- Restore the table-wide UPDATE grant that section 4 of the migration narrowed.
REVOKE UPDATE (amount) ON TABLE public.collections FROM authenticated;
GRANT UPDATE ON TABLE public.collections TO authenticated;

-- collections — back to SELECT + INSERT only, with the original singular name.
DROP POLICY IF EXISTS collections_insert_own_church ON public.collections;
DROP POLICY IF EXISTS collections_update_own_church_in_window ON public.collections;
DROP POLICY IF EXISTS collections_delete_own_church_in_window ON public.collections;

CREATE POLICY collection_insert_own_church
ON public.collections
FOR INSERT
TO authenticated
WITH CHECK (from_church = public.get_my_church_id());

-- expenses — back to the church-only checks from 0003_expenses.
DROP POLICY IF EXISTS expenses_insert_own_church ON public.expenses;
DROP POLICY IF EXISTS expenses_update_own_church ON public.expenses;

CREATE POLICY expenses_insert_own_church
ON public.expenses
FOR INSERT
TO authenticated
WITH CHECK (from_church = public.get_my_church_id());

CREATE POLICY expenses_update_own_church
ON public.expenses
FOR UPDATE
TO authenticated
USING (from_church = public.get_my_church_id())
WITH CHECK (from_church = public.get_my_church_id());

-- The helper is left in place: dropping it would break nothing, but keeping it
-- makes re-applying 0008 idempotent. Drop it explicitly if you need a clean slate:
--   DROP FUNCTION IF EXISTS public.is_finance_member();

-- Rollback for 0055 — D-Group dashboard.
-- Drops the read function and the two date columns. The dates recorded since 0055
-- are lost; nothing else is touched.

BEGIN;

DROP FUNCTION IF EXISTS public.d_group_dashboard();
ALTER TABLE public.small_group_members DROP COLUMN IF EXISTS joined_at;
ALTER TABLE public.small_groups DROP COLUMN IF EXISTS started_at;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Undo 0046. Dropping deleted_at forgets which series were deleted (they would reappear as
-- ordinary ended series), so only run this before the feature has been used.
BEGIN;
DROP FUNCTION IF EXISTS public.delete_event_series(uuid);
DROP FUNCTION IF EXISTS public.preview_delete_event_series(uuid);
DROP FUNCTION IF EXISTS public.event_has_recorded_work(uuid);
ALTER TABLE public.event_series DROP COLUMN IF EXISTS deleted_at;
NOTIFY pgrst, 'reload schema';
COMMIT;

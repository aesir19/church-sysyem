-- Undo 0048. The split keys are forgotten (a retry of an old split could then split again), and
-- deleted series become editable again.
BEGIN;
DROP FUNCTION IF EXISTS public.split_event_series(uuid, date, jsonb, jsonb, uuid);
DROP TRIGGER IF EXISTS event_series_guard_deleted ON public.event_series;
DROP FUNCTION IF EXISTS public.event_series_guard_deleted();
DROP INDEX IF EXISTS public.event_series_split_key_uniq;
ALTER TABLE public.event_series DROP COLUMN IF EXISTS split_key;
NOTIFY pgrst, 'reload schema';
COMMIT;

-- Undo 0047. Dropping history_at turns history services back into ordinary ones (their
-- attendance would count as current again), so only run this before the feature is used.
BEGIN;
DROP FUNCTION IF EXISTS public.event_edit_state(uuid, timestamptz);
DROP TRIGGER IF EXISTS attendance_guard_history ON public.attendance;
DROP FUNCTION IF EXISTS public.attendance_guard_history();
DROP TRIGGER IF EXISTS events_guard_move ON public.events;
DROP FUNCTION IF EXISTS public.events_guard_move();
DROP FUNCTION IF EXISTS public.event_attendance_total(uuid);
ALTER TABLE public.services DROP COLUMN IF EXISTS history_at;
NOTIFY pgrst, 'reload schema';
COMMIT;

-- Rollback for 0033_calendar_public_reads. Drops the two calendar read functions; the
-- Calendar's overlays fall back to their fail-closed direct reads (members see neither).

BEGIN;

DROP FUNCTION IF EXISTS public.list_calendar_schedules(uuid);
DROP FUNCTION IF EXISTS public.list_calendar_birthdays(uuid);

COMMIT;

-- NOTIFY pgrst, 'reload schema';

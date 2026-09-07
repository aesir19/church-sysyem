BEGIN;

DROP FUNCTION IF EXISTS public.list_understaffed_events(uuid, timestamptz, timestamptz, boolean);

NOTIFY pgrst, 'reload schema';

COMMIT;

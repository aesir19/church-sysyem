-- Rollback for 0036_services_event_grant.
BEGIN;
REVOKE INSERT (event_id) ON public.services FROM authenticated;
COMMIT;

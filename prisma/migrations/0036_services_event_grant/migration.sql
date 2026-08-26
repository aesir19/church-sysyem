-- 0036_services_event_grant — grant INSERT on services.event_id to authenticated.
--
-- 0035 added services.event_id and the event-scoped INSERT policy that lets Events Team
-- create an ad-hoc attendance service for their own event — but the services INSERT is a
-- COLUMN-level grant (0013/0016 list each writable column), and 0035 did not add event_id
-- to it. Without this grant the closeout's ensureEventService() fails with "permission
-- denied for column event_id" before RLS is even consulted: the policy is correct but
-- unreachable. Caught by the Stage-3 db boundary tests (#87). Column grant only; the SELECT
-- grant already covers event_id (table-level SELECT).

BEGIN;

GRANT INSERT (event_id) ON public.services TO authenticated;

COMMIT;

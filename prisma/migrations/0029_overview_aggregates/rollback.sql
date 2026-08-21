-- Rollback for 0029 — Overview aggregates.
-- Drops the two read functions. The Overview reverts to reading the base tables
-- directly (the pre-0029 behaviour), which means the counts read 0 again for
-- roles without can_see_member_detail(). Nothing here is destructive to data.

BEGIN;

DROP FUNCTION IF EXISTS public.overview_recent_services(uuid, integer);
DROP FUNCTION IF EXISTS public.overview_member_stats(uuid);

COMMIT;

NOTIFY pgrst, 'reload schema';

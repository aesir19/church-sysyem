-- ============================================================================
-- Rollback for 0018_attendance_church_param_rpcs.
-- ============================================================================
-- Drops the three church-parameterized attendance RPCs. The original my_* siblings
-- (0013/0016) are untouched by this migration and remain in place, so single-church
-- attendance keeps working after rollback. Roll back the SPA first — it calls these.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.ensure_open_service(uuid);
DROP FUNCTION IF EXISTS public.rotate_checkin_token(uuid);
DROP FUNCTION IF EXISTS public.get_checkin_link(uuid);

COMMIT;

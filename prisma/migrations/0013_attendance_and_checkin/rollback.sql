-- ROLLBACK for 0013_attendance_and_checkin.
--
-- Prisma has no down-migrations. This file is operational only — it is never
-- executed by `prisma migrate deploy`. Paste it into the Supabase SQL editor.
--
-- ============================================================================
-- THIS ROLLBACK IS NOT CLEAN. IT DESTROYS DATA.
-- ============================================================================
-- Unlike 0012, which dropped a view over data that lived elsewhere, this drops
-- the tables that ARE the data. Every attendance record, every service, and
-- every recurring schedule is deleted and is not recoverable from any other
-- table — nothing else in the system records who attended anything.
--
-- docs/OPERATIONS.md O11 records that no backup has ever been restore-tested.
-- Take and VERIFY an export before running this:
--
--   SELECT * FROM public.attendance;         -- and save the result
--   SELECT * FROM public.services;
--   SELECT * FROM public.service_schedules;
--
-- If the goal is only to stop the public endpoint, DO NOT RUN THIS FILE.
-- Revoking the two anon grants closes the anonymous write path completely and
-- destroys nothing:
--
--   REVOKE EXECUTE ON FUNCTION public.checkin_session_status(text)     FROM anon;
--   REVOKE EXECUTE ON FUNCTION public.submit_checkin(text, text, text) FROM anon;
--
-- After that, staff attendance recording keeps working and only self check-in
-- stops. That is the correct response to abuse of the endpoint; a full rollback
-- is for backing out the feature.
--
-- WHAT BREAKS INSTEAD — the application, immediately.
-- Deploy the SPA revert FIRST, or these break in the browser:
--   src/views/CheckinView.vue      (both anon RPCs 404)
--   src/views/AttendanceView.vue   (every query and RPC 404)
--   src/router/index.js            (/checkin and /dashboard/attendance routes)
--   src/components/AppSidebar.vue  (the Attendance nav item)
--
-- Any QR code already printed and hung on a wall becomes a dead link. The
-- catch-all route added in this release means it renders a real "not found"
-- page rather than the blank white page D13 used to produce — so the printed
-- posters degrade visibly rather than silently. Take them down anyway.
--
-- ORDER MATTERS BELOW. Functions come first because dropping a table that a
-- SECURITY DEFINER function references does not drop the function, and the
-- reverse order would leave callable functions pointing at absent tables.
-- Tables come last, children before parents, so no CASCADE is needed anywhere.
-- Do not add CASCADE: if a DROP fails for dependency reasons, find out what
-- attached itself rather than dropping that too.
--
-- After running this:
--   npx prisma migrate resolve --rolled-back 0013_attendance_and_checkin

BEGIN;

-- 1. Close the public endpoint first, so nothing can write during the teardown.
REVOKE EXECUTE ON FUNCTION public.checkin_session_status(text)     FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.submit_checkin(text, text, text) FROM anon, authenticated;

-- 2. Functions.
DROP FUNCTION IF EXISTS public.close_service_now(uuid);
DROP FUNCTION IF EXISTS public.ensure_my_open_service();
DROP FUNCTION IF EXISTS public.rotate_my_checkin_token();
DROP FUNCTION IF EXISTS public.get_my_checkin_link();
DROP FUNCTION IF EXISTS public.submit_checkin(text, text, text);
DROP FUNCTION IF EXISTS public.checkin_session_status(text);
DROP FUNCTION IF EXISTS public.checkin_ensure_service(uuid);
DROP FUNCTION IF EXISTS public.checkin_open_service(uuid);

-- 3. Triggers, then their functions. Dropping the tables in step 4 would take
--    the triggers with them, but set_created_by() is shared across two tables
--    and must outlive both — so drop explicitly and in a readable order.
DROP TRIGGER IF EXISTS attendance_set_recorder          ON public.attendance;
DROP TRIGGER IF EXISTS services_set_created_by          ON public.services;
DROP TRIGGER IF EXISTS service_schedules_set_created_by ON public.service_schedules;

DROP FUNCTION IF EXISTS public.set_attendance_recorder();
DROP FUNCTION IF EXISTS public.set_created_by();

-- 4. Tables, children first. Their policies, indexes, constraints and the
--    generated columns go with them.
DROP TABLE IF EXISTS public.attendance;
DROP TABLE IF EXISTS public.services;
DROP TABLE IF EXISTS public.service_schedules;

-- 5. The index this migration added to a PRE-EXISTING table. It is not dropped
--    by any of the above and would otherwise survive the rollback as orphaned
--    write overhead on every member insert and update.
DROP INDEX IF EXISTS public.members_church_fullname_idx;

-- 6. The columns this migration added to a PRE-EXISTING table.
--    Dropping checkin_token discards every issued token. If this rollback might
--    be reverted again later, save them first — re-running the migration mints
--    new ones, and every printed QR code would then point at a token that no
--    longer exists:
--      SELECT id, name, checkin_token FROM public.churches;
ALTER TABLE public.churches
  DROP CONSTRAINT IF EXISTS churches_checkin_token_shape,
  DROP CONSTRAINT IF EXISTS churches_checkin_token_key,
  DROP COLUMN IF EXISTS checkin_token_rotated_at,
  DROP COLUMN IF EXISTS checkin_token;

COMMIT;

-- PostgREST caches the schema. If the removed RPCs still appear to resolve:
--   NOTIFY pgrst, 'reload schema';

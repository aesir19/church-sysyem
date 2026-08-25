-- Rollback for 0035_events_stage3.
--
-- Restores the services / attendance / expenses policies to their pre-0035 shape
-- (0016 originals) and drops every Stage-3 object. collections were never touched, so
-- there is nothing to restore there.

BEGIN;

-- 1. Drop the read/self-offer RPCs.
DROP FUNCTION IF EXISTS public.offer_to_serve(uuid);
DROP FUNCTION IF EXISTS public.event_role_fill(uuid);
DROP FUNCTION IF EXISTS public.event_collection_total(uuid);

-- 2. Restore expenses policies to the 0016 originals (drop the event-scoped OR-path).
DROP POLICY IF EXISTS expenses_select_own_church ON public.expenses;
CREATE POLICY expenses_select_own_church ON public.expenses
  FOR SELECT TO authenticated
  USING (public.can_view_finance() AND public.can_read_church(from_church));

DROP POLICY IF EXISTS expenses_insert_own_church ON public.expenses;
CREATE POLICY expenses_insert_own_church ON public.expenses
  FOR INSERT TO authenticated
  WITH CHECK (public.can_write_finance() AND public.can_write_church(from_church));

DROP POLICY IF EXISTS expenses_update_own_church ON public.expenses;
CREATE POLICY expenses_update_own_church ON public.expenses
  FOR UPDATE TO authenticated
  USING (public.can_write_finance() AND public.can_write_church(from_church))
  WITH CHECK (public.can_write_finance() AND public.can_write_church(from_church));

-- 3. Restore attendance / services policies to the 0016 originals.
DROP POLICY IF EXISTS services_select_own_church ON public.services;
CREATE POLICY services_select_own_church ON public.services
  FOR SELECT TO authenticated
  USING (public.can_view_attendance() AND public.can_read_church(church_id));

DROP POLICY IF EXISTS services_insert_own_church ON public.services;
CREATE POLICY services_insert_own_church ON public.services
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_attendance() AND public.can_write_church(church_id));

DROP POLICY IF EXISTS attendance_select_own_church ON public.attendance;
CREATE POLICY attendance_select_own_church ON public.attendance
  FOR SELECT TO authenticated
  USING (public.can_view_attendance() AND public.can_read_church(church_id));

DROP POLICY IF EXISTS attendance_insert_own_church ON public.attendance;
CREATE POLICY attendance_insert_own_church ON public.attendance
  FOR INSERT TO authenticated
  WITH CHECK (
    public.can_manage_attendance()
    AND public.can_write_church(church_id)
    AND (member_id IS NULL OR public.is_member_in_church(member_id, church_id))
  );

DROP POLICY IF EXISTS attendance_delete_own_church ON public.attendance;
CREATE POLICY attendance_delete_own_church ON public.attendance
  FOR DELETE TO authenticated
  USING (public.can_manage_attendance() AND public.can_write_church(church_id));

-- 4. Drop services.event_id and the boundary helpers it used.
DROP INDEX IF EXISTS public.services_event_idx;
ALTER TABLE public.services DROP CONSTRAINT IF EXISTS services_event_fkey;
ALTER TABLE public.services DROP COLUMN IF EXISTS event_id;
DROP FUNCTION IF EXISTS public.is_own_event_expense(uuid);
DROP FUNCTION IF EXISTS public.is_own_event_service(uuid, uuid);

-- 5. Drop the child tables (children before events; the guard before its table).
DROP TRIGGER IF EXISTS event_assignments_guard ON public.event_assignments;
DROP FUNCTION IF EXISTS public.event_assignment_guard();
DROP TABLE IF EXISTS public.event_programme_items;
DROP TABLE IF EXISTS public.event_assignments;
DROP TABLE IF EXISTS public.event_roles;

-- 6. Drop events.room_id (its FK first), then event_rooms.
DROP INDEX IF EXISTS public.events_room_idx;
ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_room_fkey;
DROP TABLE IF EXISTS public.event_rooms;

-- 7. Drop the remaining events columns and the tightened checks; restore NOT NULLs.
ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_publishable_check;
ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_ends_needs_start;
ALTER TABLE public.events DROP COLUMN IF EXISTS attendance_tracked;
ALTER TABLE public.events DROP COLUMN IF EXISTS room_id;
ALTER TABLE public.events DROP COLUMN IF EXISTS closed_at;
ALTER TABLE public.events DROP COLUMN IF EXISTS review_went_well;
ALTER TABLE public.events DROP COLUMN IF EXISTS review_went_wrong;
ALTER TABLE public.events DROP COLUMN IF EXISTS review_followups;
-- Restoring NOT NULL will fail if any dateless/kindless draft was created under 0035;
-- clear those first if you must roll back after such rows exist.
ALTER TABLE public.events ALTER COLUMN starts_at SET NOT NULL;
ALTER TABLE public.events ALTER COLUMN kind      SET NOT NULL;

-- 8. Drop the predicates.
DROP FUNCTION IF EXISTS public.can_manage_rooms();
DROP FUNCTION IF EXISTS public.member_in_ministry(uuid, text);

COMMIT;

-- NOTIFY pgrst, 'reload schema';

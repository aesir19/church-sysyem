-- ============================================================================
-- Rollback for 0019_attendance_guest_link.
-- ============================================================================
-- Removes the only UPDATE path on `attendance`, returning the table to the
-- 0013 grant set (SELECT, DELETE, column-scoped INSERT). Nothing else in the
-- schema depends on it: the helper predicates it calls — can_manage_attendance,
-- can_write_church, is_member_in_church — are 0014/0016 functions used by several
-- other policies and are deliberately left in place.
--
-- Roll back the SPA FIRST. AttendanceView's "Link to member" action issues the
-- UPDATE this policy authorizes; once the policy is gone, RLS filters the write to
-- zero rows and the SPA reports it as blocked rather than failing loudly.
--
-- Already-linked rows are unaffected — they are ordinary member rows and stay
-- correct after rollback. The correction is not undone, only disabled.
-- ============================================================================

BEGIN;

DROP POLICY IF EXISTS attendance_update_link_guest ON public.attendance;

REVOKE UPDATE (member_id, guest_name, guest_contact) ON TABLE public.attendance FROM authenticated;

COMMIT;

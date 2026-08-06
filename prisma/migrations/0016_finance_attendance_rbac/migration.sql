-- ============================================================================
-- 0016_finance_attendance_rbac — Gate church funds and the attendance system by
-- capability, and guard the staff-only attendance RPCs.
-- ============================================================================
--
-- WHY
-- Two subsystems were church-scoped but not role-gated in the way RBAC needs:
--
--   FUNDS (collections, expenses): writes were finance-gated (0008), but READS were
--   only church-scoped — every staff member of a church could read the ledger and
--   the report. RBAC requires church funds HIDDEN from baseline users. So SELECT
--   becomes can_view_finance()-gated (Pastor / Church Leader / Finance / Head Pastor
--   / SuperAdmin), and writes move from is_finance_member() to can_write_finance()
--   (= Finance ministry OR SuperAdmin — Pastor does NOT write funds). Because
--   collectives_service_totals is a security_invoker view over these tables, gating
--   the base-table SELECT flows through to the report automatically — no view change.
--
--   ATTENDANCE (services, service_schedules, attendance): 0013 deliberately left it
--   as "any linked member of a church". RBAC requires it HIDDEN from baseline and
--   managed by the Welcome Team. SELECT becomes can_view_attendance()-gated; writes
--   become can_manage_attendance() (= Welcome Team OR SuperAdmin). The staff RPCs
--   are SECURITY DEFINER and bypass these policies, so each grows an internal guard.
--
-- WHAT IS DELIBERATELY NOT TOUCHED
--   submit_checkin / checkin_session_status (the anonymous QR path) and the internal
--   checkin_open_service / checkin_ensure_service. The public self-check-in must keep
--   working for visitors with no account; its provenance and window controls (0013)
--   are unchanged. Gating it would break the feature with no error at deploy time.
--
-- CROSS-CHURCH: can_read_church / can_write_church carry SuperAdmin everywhere and
-- Head Pastor into every read. can_write_church reduces to own-church for everyone
-- else, so a Finance/Welcome member is still scoped to their own church.
--
-- ROLLBACK: see rollback.sql (restores the 0008/0013 policies and RPC bodies).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Helper: does a member belong to a specific church? (definer, RLS-independent)
-- ---------------------------------------------------------------------------
-- The 0013 attendance INSERT used is_member_in_my_church(), which pins the member
-- to the CALLER's church. Under cross-church SuperAdmin writes that is wrong, and a
-- plain subquery would be evaluated under the caller's (now stricter) members RLS —
-- a Welcome Team member cannot see member detail, so the subquery would find no one
-- and reject legitimate attendance. A SECURITY DEFINER helper ties the member to the
-- attendance row's OWN church and bypasses members RLS, fixing both.

CREATE OR REPLACE FUNCTION public.is_member_in_church(p_member_id uuid, p_church_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.members AS m
    WHERE m.id = p_member_id
      AND m.member_of = p_church_id
      AND m.archived_at IS NULL
  )
$$;
REVOKE ALL ON FUNCTION public.is_member_in_church(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_member_in_church(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. collections — read gated to viewers, writes to can_write_finance().
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS collections_select_own_church ON public.collections;
CREATE POLICY collections_select_own_church
ON public.collections
FOR SELECT
TO authenticated
USING (public.can_view_finance() AND public.can_read_church(from_church));

DROP POLICY IF EXISTS collections_insert_own_church ON public.collections;
CREATE POLICY collections_insert_own_church
ON public.collections
FOR INSERT
TO authenticated
WITH CHECK (public.can_write_finance() AND public.can_write_church(from_church));

-- The 3-hour edit window stays in USING (evaluated against the existing row).
-- WITH CHECK omits it; the GRANT UPDATE (amount) column scope (0008/0009) is what
-- stops a caller resetting created_at to reopen the window.
DROP POLICY IF EXISTS collections_update_own_church_in_window ON public.collections;
CREATE POLICY collections_update_own_church_in_window
ON public.collections
FOR UPDATE
TO authenticated
USING (
  public.can_write_finance()
  AND public.can_write_church(from_church)
  AND created_at > now() - interval '3 hours'
)
WITH CHECK (
  public.can_write_finance()
  AND public.can_write_church(from_church)
);

DROP POLICY IF EXISTS collections_delete_own_church_in_window ON public.collections;
CREATE POLICY collections_delete_own_church_in_window
ON public.collections
FOR DELETE
TO authenticated
USING (
  public.can_write_finance()
  AND public.can_write_church(from_church)
  AND created_at > now() - interval '3 hours'
);

-- ---------------------------------------------------------------------------
-- 3. expenses — read gated to viewers, writes to can_write_finance().
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS expenses_select_own_church ON public.expenses;
CREATE POLICY expenses_select_own_church
ON public.expenses
FOR SELECT
TO authenticated
USING (public.can_view_finance() AND public.can_read_church(from_church));

DROP POLICY IF EXISTS expenses_insert_own_church ON public.expenses;
CREATE POLICY expenses_insert_own_church
ON public.expenses
FOR INSERT
TO authenticated
WITH CHECK (public.can_write_finance() AND public.can_write_church(from_church));

-- Still unreachable in the app (no UPDATE grant per 0009); kept correct so restoring
-- the grant later cannot silently reopen unrestricted writes.
DROP POLICY IF EXISTS expenses_update_own_church ON public.expenses;
CREATE POLICY expenses_update_own_church
ON public.expenses
FOR UPDATE
TO authenticated
USING (public.can_write_finance() AND public.can_write_church(from_church))
WITH CHECK (public.can_write_finance() AND public.can_write_church(from_church));

-- ---------------------------------------------------------------------------
-- 4. Attendance subsystem — view gated to viewers, writes to managers.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS service_schedules_select_own_church ON public.service_schedules;
CREATE POLICY service_schedules_select_own_church ON public.service_schedules
  FOR SELECT TO authenticated
  USING (public.can_view_attendance() AND public.can_read_church(church_id));

DROP POLICY IF EXISTS service_schedules_insert_own_church ON public.service_schedules;
CREATE POLICY service_schedules_insert_own_church ON public.service_schedules
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_attendance() AND public.can_write_church(church_id));

DROP POLICY IF EXISTS service_schedules_update_own_church ON public.service_schedules;
CREATE POLICY service_schedules_update_own_church ON public.service_schedules
  FOR UPDATE TO authenticated
  USING (public.can_manage_attendance() AND public.can_write_church(church_id))
  WITH CHECK (public.can_manage_attendance() AND public.can_write_church(church_id));

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

-- The member-side check now ties the member to the attendance row's OWN church via
-- the definer helper (see section 1) rather than the caller's church.
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

-- ---------------------------------------------------------------------------
-- 5. Staff-only attendance RPCs — internal role guards.
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER bypasses the policies above, so each must self-check. Bodies are
-- otherwise the 0013 originals; search_path is preserved. The anon path is untouched.

-- Returns the link only to attendance managers of their own church.
CREATE OR REPLACE FUNCTION public.get_my_checkin_link()
RETURNS TABLE (token text, church_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT c.checkin_token, c.name::text
  FROM public.churches AS c
  WHERE c.id = public.get_my_church_id()
    AND public.can_manage_attendance()
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.rotate_my_checkin_token()
RETURNS text LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  UPDATE public.churches
     SET checkin_token = translate(gen_random_uuid()::text, '-', ''),
         checkin_token_rotated_at = now()
   WHERE id = public.get_my_church_id()
     AND public.can_manage_attendance()
  RETURNING checkin_token
$$;

CREATE OR REPLACE FUNCTION public.ensure_my_open_service()
RETURNS uuid LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT CASE
           WHEN public.can_manage_attendance()
           THEN public.checkin_ensure_service(public.get_my_church_id())
         END
$$;

-- can_write_church(church_id) instead of church_id = get_my_church_id() so a
-- SuperAdmin can close any church's service; a Welcome Team member is still pinned
-- to their own church.
CREATE OR REPLACE FUNCTION public.close_service_now(p_service_id uuid)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  UPDATE public.services
     SET closes_at = LEAST(closes_at, GREATEST(opens_at, now()))
   WHERE id = p_service_id
     AND public.can_write_church(church_id)
     AND public.can_manage_attendance()
$$;

COMMIT;

-- PostgREST caches the schema. If the updated RPCs misbehave right after deploy:
--   NOTIFY pgrst, 'reload schema';

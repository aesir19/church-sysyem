-- ============================================================================
-- Rollback for 0016_finance_attendance_rbac.
-- ============================================================================
-- Restores the 0008 funds policies and the 0013 attendance policies + RPC bodies,
-- and drops the is_member_in_church helper. Run before rolling back 0014 (these
-- restored policies rely only on is_finance_member/get_my_church_id, which 0014
-- keeps until its own rollback).
-- ============================================================================

BEGIN;

-- collections (0008) -----------------------------------------------------------
DROP POLICY IF EXISTS collections_select_own_church ON public.collections;
CREATE POLICY collections_select_own_church ON public.collections
  FOR SELECT TO authenticated
  USING (from_church = public.get_my_church_id());

DROP POLICY IF EXISTS collections_insert_own_church ON public.collections;
CREATE POLICY collections_insert_own_church ON public.collections
  FOR INSERT TO authenticated
  WITH CHECK (from_church = public.get_my_church_id() AND public.is_finance_member());

DROP POLICY IF EXISTS collections_update_own_church_in_window ON public.collections;
CREATE POLICY collections_update_own_church_in_window ON public.collections
  FOR UPDATE TO authenticated
  USING (
    from_church = public.get_my_church_id()
    AND public.is_finance_member()
    AND created_at > now() - interval '3 hours'
  )
  WITH CHECK (from_church = public.get_my_church_id() AND public.is_finance_member());

DROP POLICY IF EXISTS collections_delete_own_church_in_window ON public.collections;
CREATE POLICY collections_delete_own_church_in_window ON public.collections
  FOR DELETE TO authenticated
  USING (
    from_church = public.get_my_church_id()
    AND public.is_finance_member()
    AND created_at > now() - interval '3 hours'
  );

-- expenses (0003/0008) ---------------------------------------------------------
DROP POLICY IF EXISTS expenses_select_own_church ON public.expenses;
CREATE POLICY expenses_select_own_church ON public.expenses
  FOR SELECT TO authenticated
  USING (from_church = public.get_my_church_id());

DROP POLICY IF EXISTS expenses_insert_own_church ON public.expenses;
CREATE POLICY expenses_insert_own_church ON public.expenses
  FOR INSERT TO authenticated
  WITH CHECK (from_church = public.get_my_church_id() AND public.is_finance_member());

DROP POLICY IF EXISTS expenses_update_own_church ON public.expenses;
CREATE POLICY expenses_update_own_church ON public.expenses
  FOR UPDATE TO authenticated
  USING (from_church = public.get_my_church_id() AND public.is_finance_member())
  WITH CHECK (from_church = public.get_my_church_id() AND public.is_finance_member());

-- attendance subsystem (0013) --------------------------------------------------
DROP POLICY IF EXISTS service_schedules_select_own_church ON public.service_schedules;
CREATE POLICY service_schedules_select_own_church ON public.service_schedules
  FOR SELECT TO authenticated USING (church_id = public.get_my_church_id());

DROP POLICY IF EXISTS service_schedules_insert_own_church ON public.service_schedules;
CREATE POLICY service_schedules_insert_own_church ON public.service_schedules
  FOR INSERT TO authenticated WITH CHECK (church_id = public.get_my_church_id());

DROP POLICY IF EXISTS service_schedules_update_own_church ON public.service_schedules;
CREATE POLICY service_schedules_update_own_church ON public.service_schedules
  FOR UPDATE TO authenticated
  USING (church_id = public.get_my_church_id())
  WITH CHECK (church_id = public.get_my_church_id());

DROP POLICY IF EXISTS services_select_own_church ON public.services;
CREATE POLICY services_select_own_church ON public.services
  FOR SELECT TO authenticated USING (church_id = public.get_my_church_id());

DROP POLICY IF EXISTS services_insert_own_church ON public.services;
CREATE POLICY services_insert_own_church ON public.services
  FOR INSERT TO authenticated WITH CHECK (church_id = public.get_my_church_id());

DROP POLICY IF EXISTS attendance_select_own_church ON public.attendance;
CREATE POLICY attendance_select_own_church ON public.attendance
  FOR SELECT TO authenticated USING (church_id = public.get_my_church_id());

DROP POLICY IF EXISTS attendance_insert_own_church ON public.attendance;
CREATE POLICY attendance_insert_own_church ON public.attendance
  FOR INSERT TO authenticated
  WITH CHECK (
    church_id = public.get_my_church_id()
    AND (member_id IS NULL OR public.is_member_in_my_church(member_id))
  );

DROP POLICY IF EXISTS attendance_delete_own_church ON public.attendance;
CREATE POLICY attendance_delete_own_church ON public.attendance
  FOR DELETE TO authenticated USING (church_id = public.get_my_church_id());

-- Staff RPCs — restore the 0013 bodies (no role guard) -------------------------
CREATE OR REPLACE FUNCTION public.get_my_checkin_link()
RETURNS TABLE (token text, church_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT c.checkin_token, c.name::text
  FROM public.churches AS c
  WHERE c.id = public.get_my_church_id()
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.rotate_my_checkin_token()
RETURNS text LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  UPDATE public.churches
     SET checkin_token = translate(gen_random_uuid()::text, '-', ''),
         checkin_token_rotated_at = now()
   WHERE id = public.get_my_church_id()
  RETURNING checkin_token
$$;

CREATE OR REPLACE FUNCTION public.ensure_my_open_service()
RETURNS uuid LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT public.checkin_ensure_service(public.get_my_church_id())
$$;

CREATE OR REPLACE FUNCTION public.close_service_now(p_service_id uuid)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  UPDATE public.services
     SET closes_at = LEAST(closes_at, GREATEST(opens_at, now()))
   WHERE id = p_service_id
     AND church_id = public.get_my_church_id()
$$;

DROP FUNCTION IF EXISTS public.is_member_in_church(uuid, uuid);

COMMIT;

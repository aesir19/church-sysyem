-- ============================================================================
-- 0018_attendance_church_param_rpcs — Church-parameterized attendance RPCs so a
-- SuperAdmin / Head Pastor can act on a church other than their own.
-- ============================================================================
--
-- WHY
-- The 0013 staff attendance RPCs — get_my_checkin_link, ensure_my_open_service,
-- rotate_my_checkin_token — resolve the caller's church via get_my_church_id()
-- server-side. That is correct for single-church staff, but it means the
-- cross-church church selector (SuperAdmin / Head Pastor) cannot retarget them:
-- selecting "Cogon" would still return Graceville's QR and materialize Graceville's
-- service. This migration adds church-parameterized siblings that take the church
-- explicitly and authorize it with the same gates as everything else:
--
--   can_manage_attendance()  — Welcome Team OR SuperAdmin (0014)
--   can_write_church(p)      — own church, or any church for SuperAdmin (0014)
--
-- so a Welcome Team member is still pinned to their own church (can_write_church
-- reduces to own-church for them) and only a SuperAdmin can reach another church.
--
-- close_service_now(uuid) already derives the church from the service row and gates
-- on can_write_church(church_id) (0016), so it needs no church-param sibling.
--
-- The original my_* functions are LEFT IN PLACE — untouched and still gated. This
-- migration only adds; the SPA switches to the church-param versions.
--
-- ROLLBACK: see rollback.sql (drops the three new functions).
-- ============================================================================

BEGIN;

-- Own-or-any church check-in link, gated to attendance managers.
CREATE OR REPLACE FUNCTION public.get_checkin_link(p_church_id uuid)
RETURNS TABLE (token text, church_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT c.checkin_token, c.name::text
  FROM public.churches AS c
  WHERE c.id = p_church_id
    AND public.can_manage_attendance()
    AND public.can_write_church(p_church_id)
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.rotate_checkin_token(p_church_id uuid)
RETURNS text LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  UPDATE public.churches
     SET checkin_token = translate(gen_random_uuid()::text, '-', ''),
         checkin_token_rotated_at = now()
   WHERE id = p_church_id
     AND public.can_manage_attendance()
     AND public.can_write_church(p_church_id)
  RETURNING checkin_token
$$;

-- Materialize the open service for a specific church. Guards first, then delegates
-- to the internal resolver (0013). plpgsql so the guard can short-circuit to NULL.
CREATE OR REPLACE FUNCTION public.ensure_open_service(p_church_id uuid)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NOT (public.can_manage_attendance() AND public.can_write_church(p_church_id)) THEN
    RETURN NULL;
  END IF;
  RETURN public.checkin_ensure_service(p_church_id);
END
$$;

REVOKE ALL ON FUNCTION public.get_checkin_link(uuid)     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rotate_checkin_token(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ensure_open_service(uuid)  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_checkin_link(uuid)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.rotate_checkin_token(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_open_service(uuid)  TO authenticated;

COMMIT;

-- PostgREST caches the schema. If the new RPCs 404 right after deploy:
--   NOTIFY pgrst, 'reload schema';

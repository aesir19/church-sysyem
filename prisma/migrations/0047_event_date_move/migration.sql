-- 0047_event_date_move — moving one event to another date (#105 rules 3–6). Owner decisions of
-- 2026-10-05, recorded on #105:
--   * a PAST event (start already passed, database clock) with 11 or more attendance records
--     cannot move; 10 or fewer can. The count is current + history, members + guests, so
--     clearing attendance cannot get round the lock
--   * moving to a different calendar day (Asia/Manila) files the old attendance as HISTORY: the
--     old check-in service is kept, marked history and closed. Nothing is copied or deleted.
--     A service with no attendance is removed, so a fresh one is made for the new date
--   * a time-only change on the same day keeps attendance as it is
--   * nobody can add or delete attendance on a history service
--
-- A trigger on events.starts_at does the work, so it runs in the same transaction as the move:
-- every path that moves an event (one-off edit, "this date only", a later series split) gets it,
-- and a failure undoes the move too.

BEGIN;

ALTER TABLE public.services ADD COLUMN history_at timestamptz;

COMMENT ON COLUMN public.services.history_at IS
  'Set when the event this service belongs to moved to another day (#105). The attendance on it '
  'is history for the old date: it still counts toward the 11-record move lock, but no longer '
  'counts as the event''s current attendance, and nothing can be added to or removed from it.';

-- Every attendance record ever taken for an event: current services and history alike.
CREATE OR REPLACE FUNCTION public.event_attendance_total(p_event_id uuid)
RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT count(*)::int
    FROM public.attendance a
    JOIN public.services s ON s.id = a.service_id AND s.church_id = a.church_id
   WHERE s.event_id = p_event_id
$$;

REVOKE ALL ON FUNCTION public.event_attendance_total(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The move guard: lock check, then file attendance as history when the day changes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.events_guard_move()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF OLD.starts_at <= now() AND public.event_attendance_total(OLD.id) >= 11 THEN
    RAISE EXCEPTION 'This event has already happened and has 11 or more attendance records, so it cannot be moved.'
      USING ERRCODE = 'P0001';
  END IF;

  IF (OLD.starts_at AT TIME ZONE 'Asia/Manila')::date
     IS DISTINCT FROM (NEW.starts_at AT TIME ZONE 'Asia/Manila')::date THEN
    -- An empty check-in service has nothing to keep; the new date gets a fresh one.
    DELETE FROM public.services s
     WHERE s.event_id = OLD.id AND s.history_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.attendance a WHERE a.service_id = s.id);
    -- A service with attendance becomes history for the old date, and closes now.
    UPDATE public.services s
       SET history_at = now(),
           closes_at  = LEAST(s.closes_at, GREATEST(s.opens_at, now()))
     WHERE s.event_id = OLD.id AND s.history_at IS NULL;
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER events_guard_move
  BEFORE UPDATE OF starts_at ON public.events
  FOR EACH ROW
  WHEN (OLD.starts_at IS DISTINCT FROM NEW.starts_at)
  EXECUTE FUNCTION public.events_guard_move();

-- ---------------------------------------------------------------------------
-- History attendance is frozen. A cascade (a member or church being removed) still goes
-- through: it arrives from the foreign-key trigger, one level deeper than a direct statement.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.attendance_guard_history()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_service uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() > 1 THEN
      RETURN OLD;
    END IF;
    v_service := OLD.service_id;
  ELSE
    v_service := NEW.service_id;
  END IF;

  IF EXISTS (SELECT 1 FROM public.services WHERE id = v_service AND history_at IS NOT NULL) THEN
    RAISE EXCEPTION 'This attendance is history for an earlier date and cannot be changed.'
      USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER attendance_guard_history
  BEFORE INSERT OR DELETE ON public.attendance
  FOR EACH ROW EXECUTE FUNCTION public.attendance_guard_history();

-- ---------------------------------------------------------------------------
-- What the edit screen asks before offering a change: is it past (database clock), how much
-- attendance does it carry, and is it locked. For a date that has no saved row yet (a worked-out
-- repeat), pass NULL and the slot's start.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_edit_state(p_event_id uuid, p_starts_at timestamptz)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE
AS $$
DECLARE
  v_church  uuid;
  v_start   timestamptz := p_starts_at;
  v_current integer := 0;
  v_total   integer := 0;
  v_past    boolean;
BEGIN
  IF NOT public.can_manage_events() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  IF p_event_id IS NOT NULL THEN
    SELECT church_id, starts_at INTO v_church, v_start FROM public.events WHERE id = p_event_id;
    IF v_church IS NULL OR NOT public.can_write_church(v_church) THEN
      RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
    END IF;
    SELECT count(*)::int INTO v_current
      FROM public.attendance a
      JOIN public.services s ON s.id = a.service_id AND s.church_id = a.church_id
     WHERE s.event_id = p_event_id AND s.history_at IS NULL;
    v_total := public.event_attendance_total(p_event_id);
  END IF;

  v_past := v_start IS NOT NULL AND v_start <= now();
  RETURN jsonb_build_object(
    'is_past', v_past,
    'current_attendance', v_current,
    'total_attendance', v_total,
    'locked', v_past AND v_total >= 11
  );
END
$$;

REVOKE ALL ON FUNCTION public.event_edit_state(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_edit_state(uuid, timestamptz) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

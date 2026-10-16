-- 0056_d_group_meetings — leaders' Group meetings
-- (docs/specs/d-group-leader-view.md, Phase 2).
--
-- A Group meeting belongs to one D-Group. Its leaders create it; they, the Events Team and
-- SuperAdmin edit, cancel and remove it; delete only before it starts. It is seen ONLY by
-- the group's members and leaders, the Events Team and SuperAdmin — meetings are often in
-- a member's home, so the location must not reach the rest of the church, or a pastor.
--
-- 1. events.small_group_id and event_series.small_group_id. Composite FK with church_id,
--    so a meeting can never belong to another church's group. ON DELETE CASCADE: a
--    meeting has no meaning without its group, and SET NULL would turn a private home
--    address into a church-wide event.
-- 2. Checks. A new Group meeting must name its group (NOT VALID: Group meetings made
--    before 0056 have none and stay as they were); only a Group meeting may name one.
-- 3. A saved date of a repeating meeting takes its series' group, always — set by trigger,
--    so a moved date cannot drop out of the group's privacy, or be pointed elsewhere.
-- 4. RLS on both tables. A row WITHOUT a group follows the 0032/0034 rules unchanged; a
--    row WITH one follows the group rules above.
-- 5. The series tools (delete, split, their previews) and event_edit_state, widened from
--    "Events Team / SuperAdmin of this church" to also "a leader of this group" — copied
--    from 0046, 0047 and 0051 with only that check, and the split's carrying of the group
--    to the new schedule, changed.
--
-- Not covered here, deliberately: event roles, programme, rooms, finance and closeout stay
-- Events-Team-only (0035) — a leader's meeting has none of them.
--
-- ROLLBACK: see rollback.sql.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1–2. The group link and its checks.
-- ---------------------------------------------------------------------------
ALTER TABLE public.small_groups
  ADD CONSTRAINT small_groups_id_church_key UNIQUE (id, church_id);

ALTER TABLE public.events
  ADD COLUMN small_group_id uuid,
  ADD CONSTRAINT events_small_group_fkey FOREIGN KEY (small_group_id, church_id)
    REFERENCES public.small_groups (id, church_id) ON DELETE CASCADE ON UPDATE NO ACTION,
  ADD CONSTRAINT events_only_group_meetings_have_group
    CHECK (small_group_id IS NULL OR kind = 'group_meeting'),
  ADD CONSTRAINT events_group_meeting_needs_group
    CHECK (kind <> 'group_meeting' OR small_group_id IS NOT NULL) NOT VALID;
CREATE INDEX events_small_group_idx ON public.events (small_group_id) WHERE small_group_id IS NOT NULL;

ALTER TABLE public.event_series
  ADD COLUMN small_group_id uuid,
  ADD CONSTRAINT event_series_small_group_fkey FOREIGN KEY (small_group_id, church_id)
    REFERENCES public.small_groups (id, church_id) ON DELETE CASCADE ON UPDATE NO ACTION,
  ADD CONSTRAINT event_series_only_group_meetings_have_group
    CHECK (small_group_id IS NULL OR kind = 'group_meeting'),
  ADD CONSTRAINT event_series_group_meeting_needs_group
    CHECK (kind <> 'group_meeting' OR small_group_id IS NOT NULL) NOT VALID;
CREATE INDEX event_series_small_group_idx ON public.event_series (small_group_id) WHERE small_group_id IS NOT NULL;

COMMENT ON COLUMN public.events.small_group_id IS
  'The D-Group a Group meeting belongs to (0056). Decides who may see and change it. NULL for every other event, and for Group meetings made before 0056.';
COMMENT ON COLUMN public.event_series.small_group_id IS
  'The D-Group a repeating Group meeting belongs to (0056). Its saved dates take it by trigger.';

-- ---------------------------------------------------------------------------
-- The group predicates. Definer, so they read leadership and membership whatever the
-- caller's own access to those tables; a disabled account answers false (0052).
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.leads_small_group(p_group uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT p_group IS NOT NULL AND public.archive_account_active() AND EXISTS (
    SELECT 1 FROM public.small_group_leaders l
     WHERE l.group_id = p_group AND l.account_id = auth.uid())
$$;

CREATE FUNCTION public.in_small_group(p_group uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT p_group IS NOT NULL AND public.archive_account_active() AND EXISTS (
    SELECT 1 FROM public.small_group_members sgm
      JOIN public.user_accounts ua ON ua.member_id = sgm.member_id
     WHERE sgm.small_group_id = p_group AND ua.id = auth.uid())
$$;

-- Who sees a Group meeting: its group, its leaders, the Events Team and SuperAdmin.
CREATE FUNCTION public.can_see_group_meeting(p_group uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.can_manage_events() OR public.leads_small_group(p_group) OR public.in_small_group(p_group)
$$;

-- Who changes an event or series row. Without a group: Events Team / SuperAdmin of the
-- church, exactly as 0032. With one: also a leader of that group.
CREATE FUNCTION public.can_edit_group_event(p_church uuid, p_group uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT (public.can_manage_events() AND public.can_write_church(p_church))
      OR (p_group IS NOT NULL AND public.leads_small_group(p_group))
$$;

-- ---------------------------------------------------------------------------
-- 3. A saved date of a repeating meeting takes its series' group.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.events_take_series_group()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.series_id IS NOT NULL THEN
    SELECT s.small_group_id INTO NEW.small_group_id FROM public.event_series s WHERE s.id = NEW.series_id;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER events_take_series_group
  BEFORE INSERT OR UPDATE OF series_id, small_group_id ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.events_take_series_group();

-- ---------------------------------------------------------------------------
-- 4. RLS. Each policy keeps its 0032/0034 rule for rows without a group.
-- ---------------------------------------------------------------------------
DROP POLICY events_select_visible ON public.events;
CREATE POLICY events_select_visible
ON public.events FOR SELECT TO authenticated
USING (
  public.can_read_church(church_id)
  AND CASE WHEN small_group_id IS NULL
        THEN public.can_view_events() OR status = 'published'
        ELSE public.can_see_group_meeting(small_group_id)
             AND (status <> 'draft' OR public.can_edit_group_event(church_id, small_group_id))
      END
);

-- Creating a meeting is the group's leaders'. The Events Team writes a group row only as a
-- saved date of an existing repeating meeting (series_id set), never a new meeting.
DROP POLICY events_insert_own_church ON public.events;
CREATE POLICY events_insert_own_church
ON public.events FOR INSERT TO authenticated
WITH CHECK (
  CASE WHEN small_group_id IS NULL
    THEN public.can_manage_events() AND public.can_write_church(church_id)
    ELSE public.leads_small_group(small_group_id)
         OR (series_id IS NOT NULL AND public.can_manage_events() AND public.can_write_church(church_id))
  END
);

DROP POLICY events_update_own_church ON public.events;
CREATE POLICY events_update_own_church
ON public.events FOR UPDATE TO authenticated
USING (public.can_edit_group_event(church_id, small_group_id))
WITH CHECK (public.can_edit_group_event(church_id, small_group_id));

DROP POLICY events_delete_own_church ON public.events;
CREATE POLICY events_delete_own_church
ON public.events FOR DELETE TO authenticated
USING (
  public.can_edit_group_event(church_id, small_group_id)
  AND (small_group_id IS NULL OR starts_at > now())
);

DROP POLICY event_series_select_visible ON public.event_series;
CREATE POLICY event_series_select_visible
ON public.event_series FOR SELECT TO authenticated
USING (
  public.can_read_church(church_id)
  AND CASE WHEN small_group_id IS NULL
        THEN public.can_view_events() OR status = 'published'
        ELSE public.can_see_group_meeting(small_group_id)
             AND (status <> 'draft' OR public.can_edit_group_event(church_id, small_group_id))
      END
);

DROP POLICY event_series_insert_own_church ON public.event_series;
CREATE POLICY event_series_insert_own_church
ON public.event_series FOR INSERT TO authenticated
WITH CHECK (
  CASE WHEN small_group_id IS NULL
    THEN public.can_manage_events() AND public.can_write_church(church_id)
    ELSE public.leads_small_group(small_group_id)
  END
);

DROP POLICY event_series_update_own_church ON public.event_series;
CREATE POLICY event_series_update_own_church
ON public.event_series FOR UPDATE TO authenticated
USING (public.can_edit_group_event(church_id, small_group_id))
WITH CHECK (public.can_edit_group_event(church_id, small_group_id));

-- A repeating meeting is removed through delete_event_series(), which keeps its past. A
-- direct delete only of one that has not started yet.
DROP POLICY event_series_delete_own_church ON public.event_series;
CREATE POLICY event_series_delete_own_church
ON public.event_series FOR DELETE TO authenticated
USING (
  public.can_edit_group_event(church_id, small_group_id)
  AND (small_group_id IS NULL OR starts_on > (now() AT TIME ZONE 'Asia/Manila')::date)
);

-- ---------------------------------------------------------------------------
-- 5. The series tools and the edit-state read, widened to the group's leaders.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.preview_delete_event_series(p_series uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE
AS $$
DECLARE
  v_church uuid;
  v_group  uuid;
  v_kept   integer;
  v_removed integer;
BEGIN
  SELECT church_id, small_group_id INTO v_church, v_group FROM public.event_series WHERE id = p_series;
  IF v_church IS NULL OR NOT public.can_edit_group_event(v_church, v_group) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) FILTER (WHERE public.event_has_recorded_work(e.id)),
         count(*) FILTER (WHERE NOT public.event_has_recorded_work(e.id))
    INTO v_kept, v_removed
    FROM public.events e
   WHERE e.series_id = p_series AND e.starts_at > now();

  RETURN jsonb_build_object('kept', v_kept, 'removed', v_removed);
END
$$;

CREATE OR REPLACE FUNCTION public.delete_event_series(p_series uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  s         public.event_series%ROWTYPE;
  v_now     timestamptz := now();
  v_today   date        := (now() AT TIME ZONE 'Asia/Manila')::date;
  v_last    date;
  v_kept    integer;
  v_removed integer;
BEGIN
  -- Lock the row so two deletes cannot interleave. Not-found and not-allowed look the same.
  SELECT * INTO s FROM public.event_series WHERE id = p_series FOR UPDATE;
  IF NOT FOUND OR NOT public.can_edit_group_event(s.church_id, s.small_group_id) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  -- Safe to repeat: a retry after a lost reply finds it already done and changes nothing.
  IF s.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('already_deleted', true, 'kept', 0, 'removed', 0);
  END IF;

  -- Upcoming dates with recorded work stand on their own, links untouched.
  UPDATE public.events e
     SET series_id = NULL, occurrence_date = NULL, updated_at = v_now
   WHERE e.series_id = p_series AND e.starts_at > v_now
     AND public.event_has_recorded_work(e.id);
  GET DIAGNOSTICS v_kept = ROW_COUNT;

  -- The rest of the upcoming dates belong to a schedule that is going away.
  DELETE FROM public.events e WHERE e.series_id = p_series AND e.starts_at > v_now;
  GET DIAGNOSTICS v_removed = ROW_COUNT;

  -- The last date that still counts as past: today's slot if it has already started, else
  -- yesterday's. Dates up to here keep being worked out from the rule, so they stay visible.
  v_last := CASE WHEN ((v_today + s.time_start) AT TIME ZONE 'Asia/Manila') <= v_now
                 THEN v_today ELSE v_today - 1 END;

  IF v_last < s.starts_on THEN
    -- Nothing has happened yet, so there is no past to keep: remove the series itself.
    UPDATE public.events SET series_id = NULL, occurrence_date = NULL WHERE series_id = p_series;
    DELETE FROM public.event_series WHERE id = p_series;
  ELSE
    UPDATE public.event_series
       SET deleted_at = v_now,
           ends_on    = LEAST(coalesce(ends_on, v_last), v_last),
           updated_at = v_now
     WHERE id = p_series;
  END IF;

  RETURN jsonb_build_object('already_deleted', false, 'kept', v_kept, 'removed', v_removed);
END
$$;

CREATE OR REPLACE FUNCTION public.preview_split_event_series(p_series uuid, p_from date)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE
AS $$
DECLARE
  s public.event_series%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.event_series WHERE id = p_series;
  IF s.id IS NULL OR NOT public.can_edit_group_event(s.church_id, s.small_group_id) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  IF s.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'This repeating event was deleted and can''t be changed.' USING ERRCODE = 'ES001';
  END IF;
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(p)) FROM public.event_series_planned(p_series, p_from) p), '[]');
END
$$;

CREATE OR REPLACE FUNCTION public.split_event_series(
  p_series uuid, p_occurrence date, p_starts date, p_new jsonb, p_moves jsonb, p_key uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  s            public.event_series%ROWTYPE;
  n            public.event_series%ROWTYPE;
  v_prior      public.event_series%ROWTYPE;
  v_now        timestamptz := now();
  v_split      date;
  v_selected   uuid;
  v_sel_start  timestamptz;
  v_sel_day    date;
  v_new        uuid;
  v_planned    uuid[];
  v_actuals    jsonb;
  v_taken      date[] := '{}';
  v_moved      integer := 0;
  v_standalone integer := 0;
  v_count      integer;
  v_actual     date;
  m            record;
BEGIN
  IF p_series IS NULL OR p_occurrence IS NULL OR p_starts IS NULL OR p_new IS NULL OR p_key IS NULL THEN
    RAISE EXCEPTION 'A split needs the series, the dates, the new schedule and a key.' USING ERRCODE = '22023';
  END IF;

  n := jsonb_populate_record(NULL::public.event_series, p_new);
  IF n.title IS NULL OR n.time_start IS NULL OR n.cadence IS NULL THEN
    RAISE EXCEPTION 'The new schedule needs a name, a start time and a repeat.' USING ERRCODE = '22023';
  END IF;

  -- Lock the old series first, so a concurrent retry waits here and then finds the key below.
  SELECT * INTO s FROM public.event_series WHERE id = p_series FOR UPDATE;

  -- Safe to repeat: the key's series already exists, so hand back the first result — unless any
  -- part of the change differs, which must not be dropped silently.
  SELECT * INTO v_prior FROM public.event_series WHERE split_key = p_key;
  IF FOUND THEN
    IF NOT public.can_edit_group_event(v_prior.church_id, v_prior.small_group_id) THEN
      RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
    END IF;
    IF (v_prior.starts_on, v_prior.title, v_prior.kind, v_prior.location, v_prior.description, v_prior.run_by,
        v_prior.projected_budget, v_prior.cadence, v_prior.interval_n, v_prior.anchor, v_prior.weekday,
        v_prior.week_of_month, v_prior.day_of_month, v_prior.weekday2, v_prior.week_of_month2,
        v_prior.day_of_month2, v_prior.time_start, v_prior.time_end, v_prior.ends_on, v_prior.count_n)
       IS DISTINCT FROM
       (p_starts, n.title, n.kind, n.location, n.description, n.run_by,
        n.projected_budget, n.cadence, coalesce(n.interval_n, 1), n.anchor, n.weekday,
        n.week_of_month, n.day_of_month, n.weekday2, n.week_of_month2,
        n.day_of_month2, n.time_start, n.time_end, n.ends_on, n.count_n) THEN
      RAISE EXCEPTION 'This change was already saved. Please reload the page to make another.' USING ERRCODE = 'ES007';
    END IF;
    RETURN jsonb_build_object('already_done', true, 'new_series_id', v_prior.id, 'moved', 0, 'standalone', 0);
  END IF;

  -- Not-found and not-allowed look the same.
  IF s.id IS NULL OR NOT public.can_edit_group_event(s.church_id, s.small_group_id) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  IF s.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'This repeating event was deleted and can''t be changed.' USING ERRCODE = 'ES001';
  END IF;

  IF p_occurrence < s.starts_on OR (s.ends_on IS NOT NULL AND p_occurrence > s.ends_on) THEN
    RAISE EXCEPTION 'That date is not part of this repeating event.' USING ERRCODE = '22023';
  END IF;

  -- The date being changed, where it actually sits. Neither it nor its new day may have started.
  SELECT id, starts_at INTO v_selected, v_sel_start
    FROM public.events WHERE series_id = p_series AND occurrence_date = p_occurrence;
  v_sel_start := coalesce(v_sel_start, (p_occurrence + s.time_start) AT TIME ZONE 'Asia/Manila');
  v_sel_day := (v_sel_start AT TIME ZONE 'Asia/Manila')::date;
  IF v_sel_start <= v_now OR ((p_starts + n.time_start) AT TIME ZONE 'Asia/Manila') <= v_now THEN
    RAISE EXCEPTION 'That date has already happened, so it can only be changed on its own.' USING ERRCODE = 'ES002';
  END IF;

  -- Dates cannot pass each other: no other saved date may sit between where the date is now and
  -- its new day, judged on actual days, earlier or later.
  IF EXISTS (
       SELECT 1 FROM public.events e
        WHERE e.series_id = p_series AND e.id IS DISTINCT FROM v_selected
          AND coalesce((e.starts_at AT TIME ZONE 'Asia/Manila')::date, e.occurrence_date)
              BETWEEN LEAST(v_sel_day, p_starts) AND GREATEST(v_sel_day, p_starts)
          AND coalesce((e.starts_at AT TIME ZONE 'Asia/Manila')::date, e.occurrence_date) <> v_sel_day) THEN
    RAISE EXCEPTION 'The new date can''t move past another date of this repeating event. Change this date on its own instead.'
      USING ERRCODE = 'ES003';
  END IF;

  v_split := LEAST(p_occurrence, v_sel_day, p_starts);

  -- The new schedule. Church, start date, author and key come from here, not the browser.
  INSERT INTO public.event_series (
    church_id, title, kind, status, location, description, run_by, projected_budget,
    cadence, interval_n, anchor, weekday, week_of_month, day_of_month,
    weekday2, week_of_month2, day_of_month2, time_start, time_end, starts_on, ends_on, count_n,
    created_by, published_at, split_key, small_group_id)
  VALUES (
    s.church_id, n.title, n.kind, coalesce(n.status, 'draft'), n.location, n.description, n.run_by, n.projected_budget,
    n.cadence, coalesce(n.interval_n, 1), n.anchor, n.weekday, n.week_of_month, n.day_of_month,
    n.weekday2, n.week_of_month2, n.day_of_month2, n.time_start, n.time_end, p_starts, n.ends_on, n.count_n,
    auth.uid(),
    CASE WHEN n.status = 'published' THEN coalesce(s.published_at, v_now) END,
    p_key, s.small_group_id)
  RETURNING id INTO v_new;
  SELECT * INTO n FROM public.event_series WHERE id = v_new;

  SELECT coalesce(array_agg(p.id), '{}'), coalesce(jsonb_object_agg(p.id, p.actual_date), '{}')
    INTO v_planned, v_actuals
    FROM public.event_series_planned(p_series, v_split) p;

  -- The date being changed always takes the change, on exactly the day picked.
  IF v_selected IS NOT NULL THEN
    PERFORM public.event_take_series_date(v_selected, v_new, p_starts, n);
    v_taken := v_taken || p_starts;
  END IF;

  IF p_moves IS NOT NULL THEN
    -- Every listed date must be another planned date of this series, once, each to its own day.
    IF jsonb_typeof(p_moves) <> 'array'
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_moves) x
                   WHERE NOT ((x->>'event_id')::uuid = ANY (v_planned))
                      OR (x->>'event_id')::uuid IS NOT DISTINCT FROM v_selected)
       OR (SELECT count(*) <> count(DISTINCT x->>'event_id') FROM jsonb_array_elements(p_moves) x) THEN
      RAISE EXCEPTION 'The planned dates have changed since this page was opened. Please reload and try again.'
        USING ERRCODE = 'ES004';
    END IF;

    IF (SELECT count(x->>'to_date') <> count(DISTINCT x->>'to_date') FROM jsonb_array_elements(p_moves) x)
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_moves) x WHERE (x->>'to_date')::date = ANY (v_taken)) THEN
      RAISE EXCEPTION 'Two planned dates cannot move to the same day.' USING ERRCODE = 'ES005';
    END IF;

    FOR m IN SELECT * FROM jsonb_to_recordset(p_moves) AS x(event_id uuid, to_date date) LOOP
      IF m.to_date IS NULL THEN
        -- No new date that week: it stays where it is, on its own.
        UPDATE public.events
           SET series_id = NULL, occurrence_date = NULL, updated_at = v_now
         WHERE id = m.event_id;
        v_standalone := v_standalone + 1;
      ELSE
        -- Within the Sunday-first week the date ACTUALLY sits in, on the new schedule.
        v_actual := (v_actuals->>m.event_id::text)::date;
        IF m.to_date < p_starts
           OR m.to_date - extract(dow FROM m.to_date)::int <> v_actual - extract(dow FROM v_actual)::int THEN
          RAISE EXCEPTION 'A planned date can only move within the same week.' USING ERRCODE = 'ES006';
        END IF;
        PERFORM public.event_take_series_date(m.event_id, v_new, m.to_date, n);
        v_taken := v_taken || m.to_date;
        v_moved := v_moved + 1;
      END IF;
    END LOOP;
  END IF;

  -- Planned dates left where they are: same date, own details, now on the new schedule — or on
  -- their own when a moved date already took that slot.
  UPDATE public.events
     SET series_id = NULL, occurrence_date = NULL, updated_at = v_now
   WHERE id = ANY (v_planned) AND series_id = p_series AND occurrence_date = ANY (v_taken);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_standalone := v_standalone + v_count;
  UPDATE public.events SET series_id = v_new, updated_at = v_now
   WHERE id = ANY (v_planned) AND series_id = p_series;

  IF v_split <= s.starts_on THEN
    -- The change starts on (or before) the very first date: nothing has happened on the old
    -- schedule yet, so it goes. Anything still pointing at it stands on its own.
    UPDATE public.events SET series_id = NULL, occurrence_date = NULL, updated_at = v_now
     WHERE series_id = p_series;
    DELETE FROM public.event_series WHERE id = p_series;
  ELSE
    UPDATE public.event_series SET ends_on = v_split - 1, updated_at = v_now WHERE id = p_series;
  END IF;

  -- The counts are what the database tests check the outcome against.
  RETURN jsonb_build_object('already_done', false, 'new_series_id', v_new,
                            'moved', v_moved, 'standalone', v_standalone);
END
$$;

CREATE OR REPLACE FUNCTION public.event_edit_state(p_event_id uuid, p_starts_at timestamptz)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE
AS $$
DECLARE
  v_church  uuid;
  v_group   uuid;
  v_start   timestamptz := p_starts_at;
  v_current integer := 0;
  v_total   integer := 0;
  v_past    boolean;
BEGIN
  -- A worked-out date with no saved row: only the clock is read, for the same people who
  -- may change dates at all.
  IF p_event_id IS NULL AND NOT (public.can_manage_events() OR public.is_small_group_leader()) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  IF p_event_id IS NOT NULL THEN
    SELECT church_id, starts_at, small_group_id INTO v_church, v_start, v_group FROM public.events WHERE id = p_event_id;
    IF v_church IS NULL OR NOT public.can_edit_group_event(v_church, v_group) THEN
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

REVOKE ALL ON FUNCTION public.leads_small_group(uuid)           FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.in_small_group(uuid)              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_see_group_meeting(uuid)       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_edit_group_event(uuid, uuid)  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.events_take_series_group()        FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.leads_small_group(uuid)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.in_small_group(uuid)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_see_group_meeting(uuid)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_edit_group_event(uuid, uuid) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

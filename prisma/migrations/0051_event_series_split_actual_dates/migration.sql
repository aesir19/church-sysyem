-- 0051_event_series_split_actual_dates — the split (0050) after its second code review, agreed
-- with the owner on 2026-10-05:
--   * dates cannot pass each other in EITHER direction: moving the date being changed earlier OR
--     later may not cross another saved date of the schedule, judged on each date's ACTUAL day
--     (#105 rule 3). The browser refuses crossing a worked-out date the same way
--   * the planned dates a split touches are the upcoming ones whose slot OR actual day is on/after
--     the split, so a date already moved past the split is offered too
--   * a reused key is refused when ANY part of the change differs, not only the start date
--   * a missing title or start time is refused plainly instead of failing on a constraint
--   * the planned-dates preview refuses a deleted series, as the split does
--   * refusals carry their own SQLSTATE (ES001–ES007). The app maps each code to its sentence, so
--     no database text is ever shown (docs/SECURITY.md §3.5); the text here is for logs only
--   * "the date takes the new schedule's details" is one internal helper, not two copies
--
-- Same signatures as 0050, so grants carry over.

BEGIN;

-- ---------------------------------------------------------------------------
-- The planned dates from a day on — by slot OR actual day, upcoming by actual start.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_series_planned(p_series uuid, p_from date)
RETURNS TABLE (id uuid, occurrence_date date, actual_date date, status text)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT e.id, e.occurrence_date, a.actual_date, e.status
    FROM public.events e
   CROSS JOIN LATERAL (SELECT coalesce((e.starts_at AT TIME ZONE 'Asia/Manila')::date, e.occurrence_date) AS actual_date) a
   WHERE e.series_id = p_series
     AND (e.occurrence_date >= p_from OR a.actual_date >= p_from)
     AND (e.starts_at IS NULL OR e.starts_at > now())
   ORDER BY a.actual_date
$$;

REVOKE ALL ON FUNCTION public.event_series_planned(uuid, date) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- One date takes a new schedule's day and details. Status is kept, so a cancelled date stays
-- cancelled; links stay. Internal helper, not callable from the app.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_take_series_date(
  p_event uuid, p_series uuid, p_day date, p_new public.event_series)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  UPDATE public.events
     SET series_id = p_series,
         occurrence_date = p_day,
         starts_at = (p_day + p_new.time_start) AT TIME ZONE 'Asia/Manila',
         ends_at = CASE WHEN p_new.time_end IS NULL THEN NULL
                        ELSE (p_day + p_new.time_end) AT TIME ZONE 'Asia/Manila' END,
         title = p_new.title, kind = p_new.kind, location = p_new.location,
         description = p_new.description, run_by = p_new.run_by,
         projected_budget = p_new.projected_budget,
         updated_at = now()
   WHERE id = p_event
$$;

REVOKE ALL ON FUNCTION public.event_take_series_date(uuid, uuid, date, public.event_series) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The split screen's planned-dates list. Same authority as the split.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.preview_split_event_series(p_series uuid, p_from date)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE
AS $$
DECLARE
  s public.event_series%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.event_series WHERE id = p_series;
  IF s.id IS NULL OR NOT (public.can_manage_events() AND public.can_write_church(s.church_id)) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  IF s.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'This repeating event was deleted and can''t be changed.' USING ERRCODE = 'ES001';
  END IF;
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(p)) FROM public.event_series_planned(p_series, p_from) p), '[]');
END
$$;

-- ---------------------------------------------------------------------------
-- The split. One function = one transaction: it all happens or none of it does.
-- Parameters as in 0050. Refusals (SQLSTATE → meaning, mapped to words in eventSeries.js):
--   ES001 deleted · ES002 already happened · ES003 crosses another date · ES004 planned dates
--   changed · ES005 two dates on one day · ES006 not the same week · ES007 key already used
-- Returns {already_done, new_series_id, moved, standalone}.
-- ---------------------------------------------------------------------------
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
    IF NOT (public.can_manage_events() AND public.can_write_church(v_prior.church_id)) THEN
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
  IF s.id IS NULL OR NOT (public.can_manage_events() AND public.can_write_church(s.church_id)) THEN
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
    created_by, published_at, split_key)
  VALUES (
    s.church_id, n.title, n.kind, coalesce(n.status, 'draft'), n.location, n.description, n.run_by, n.projected_budget,
    n.cadence, coalesce(n.interval_n, 1), n.anchor, n.weekday, n.week_of_month, n.day_of_month,
    n.weekday2, n.week_of_month2, n.day_of_month2, n.time_start, n.time_end, p_starts, n.ends_on, n.count_n,
    auth.uid(),
    CASE WHEN n.status = 'published' THEN coalesce(s.published_at, v_now) END,
    p_key)
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

NOTIFY pgrst, 'reload schema';

COMMIT;

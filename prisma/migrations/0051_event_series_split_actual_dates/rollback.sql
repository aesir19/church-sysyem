-- Undo 0051: put back the 0050 split, preview and planned-dates helper.
BEGIN;

CREATE OR REPLACE FUNCTION public.event_series_planned(p_series uuid, p_from date)
RETURNS TABLE (id uuid, occurrence_date date, actual_date date, status text)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT e.id, e.occurrence_date,
         coalesce((e.starts_at AT TIME ZONE 'Asia/Manila')::date, e.occurrence_date),
         e.status
    FROM public.events e
   WHERE e.series_id = p_series AND e.occurrence_date >= p_from
     AND (e.starts_at IS NULL OR e.starts_at > now())
   ORDER BY e.occurrence_date
$$;

CREATE OR REPLACE FUNCTION public.preview_split_event_series(p_series uuid, p_from date)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE
AS $$
DECLARE
  v_church uuid;
BEGIN
  SELECT church_id INTO v_church FROM public.event_series WHERE id = p_series;
  IF v_church IS NULL OR NOT (public.can_manage_events() AND public.can_write_church(v_church)) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
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
  v_new        uuid;
  v_planned    uuid[];
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

  -- Lock the old series first, so a concurrent retry waits here and then finds the key below.
  SELECT * INTO s FROM public.event_series WHERE id = p_series FOR UPDATE;

  -- Safe to repeat: the key's series already exists, so hand back the first result — unless this
  -- is a different change reusing the key, which must not be dropped silently.
  SELECT * INTO v_prior FROM public.event_series WHERE split_key = p_key;
  IF FOUND THEN
    IF NOT (public.can_manage_events() AND public.can_write_church(v_prior.church_id)) THEN
      RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
    END IF;
    IF v_prior.starts_on <> p_starts THEN
      RAISE EXCEPTION 'This change was already saved. Please reload the page to make another.' USING ERRCODE = 'P0001';
    END IF;
    RETURN jsonb_build_object('already_done', true, 'new_series_id', v_prior.id, 'moved', 0, 'standalone', 0);
  END IF;

  -- Not-found and not-allowed look the same.
  IF s.id IS NULL OR NOT (public.can_manage_events() AND public.can_write_church(s.church_id)) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  IF s.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'This repeating event was deleted and can''t be changed.' USING ERRCODE = 'P0001';
  END IF;

  IF p_occurrence < s.starts_on OR (s.ends_on IS NOT NULL AND p_occurrence > s.ends_on) THEN
    RAISE EXCEPTION 'That date is not part of this repeating event.' USING ERRCODE = '22023';
  END IF;

  n := jsonb_populate_record(NULL::public.event_series, p_new);
  v_split := LEAST(p_occurrence, p_starts);

  -- Neither the date being changed (where it actually sits) nor its new day may have started.
  SELECT id, starts_at INTO v_selected, v_sel_start
    FROM public.events WHERE series_id = p_series AND occurrence_date = p_occurrence;
  v_sel_start := coalesce(v_sel_start, (p_occurrence + s.time_start) AT TIME ZONE 'Asia/Manila');
  IF v_sel_start <= v_now OR ((p_starts + n.time_start) AT TIME ZONE 'Asia/Manila') <= v_now THEN
    RAISE EXCEPTION 'That date has already happened, so it can only be changed on its own.' USING ERRCODE = 'P0001';
  END IF;

  -- Dates cannot swap order: moving earlier may not jump back over a saved date of the schedule.
  IF p_starts < p_occurrence AND EXISTS (
       SELECT 1 FROM public.events
        WHERE series_id = p_series AND occurrence_date >= p_starts AND occurrence_date < p_occurrence) THEN
    RAISE EXCEPTION 'The new date can''t be on or before an earlier date of this repeating event. Change this date on its own instead.'
      USING ERRCODE = 'P0001';
  END IF;

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

  SELECT coalesce(array_agg(p.id), '{}') INTO v_planned FROM public.event_series_planned(p_series, v_split) p;

  -- The date being changed always takes the change, on exactly the day picked.
  IF v_selected IS NOT NULL THEN
    UPDATE public.events
       SET series_id = v_new,
           occurrence_date = p_starts,
           starts_at = (p_starts + n.time_start) AT TIME ZONE 'Asia/Manila',
           ends_at = CASE WHEN n.time_end IS NULL THEN NULL
                          ELSE (p_starts + n.time_end) AT TIME ZONE 'Asia/Manila' END,
           title = n.title, kind = n.kind, location = n.location, description = n.description,
           run_by = n.run_by, projected_budget = n.projected_budget,
           updated_at = v_now
     WHERE id = v_selected;
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
        USING ERRCODE = 'P0001';
    END IF;

    IF (SELECT count(x->>'to_date') <> count(DISTINCT x->>'to_date') FROM jsonb_array_elements(p_moves) x)
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_moves) x WHERE (x->>'to_date')::date = ANY (v_taken)) THEN
      RAISE EXCEPTION 'Two planned dates cannot move to the same day.' USING ERRCODE = 'P0001';
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
        SELECT p.actual_date INTO v_actual FROM public.event_series_planned(p_series, v_split) p WHERE p.id = m.event_id;
        IF m.to_date < p_starts
           OR m.to_date - extract(dow FROM m.to_date)::int <> v_actual - extract(dow FROM v_actual)::int THEN
          RAISE EXCEPTION 'A planned date can only move within the same week.' USING ERRCODE = 'P0001';
        END IF;
        -- New day, new details. Status is kept, so a cancelled date stays cancelled.
        UPDATE public.events
           SET series_id = v_new,
               occurrence_date = m.to_date,
               starts_at = (m.to_date + n.time_start) AT TIME ZONE 'Asia/Manila',
               ends_at = CASE WHEN n.time_end IS NULL THEN NULL
                              ELSE (m.to_date + n.time_end) AT TIME ZONE 'Asia/Manila' END,
               title = n.title, kind = n.kind, location = n.location, description = n.description,
               run_by = n.run_by, projected_budget = n.projected_budget,
               updated_at = v_now
         WHERE id = m.event_id;
        v_taken := v_taken || m.to_date;
        v_moved := v_moved + 1;
      END IF;
    END LOOP;
  END IF;

  -- Planned dates left where they are: same date, own details, now on the new schedule — or on
  -- their own when a moved date already took that day.
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

  RETURN jsonb_build_object('already_done', false, 'new_series_id', v_new,
                            'moved', v_moved, 'standalone', v_standalone);
END
$$;

DROP FUNCTION IF EXISTS public.event_take_series_date(uuid, uuid, date, public.event_series);

NOTIFY pgrst, 'reload schema';

COMMIT;

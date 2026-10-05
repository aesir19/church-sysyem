-- Undo 0050: put back the 0049 split and drop the planned-dates helpers.
BEGIN;

DROP FUNCTION IF EXISTS public.split_event_series(uuid, date, date, jsonb, jsonb, uuid);
DROP FUNCTION IF EXISTS public.preview_split_event_series(uuid, date);
DROP FUNCTION IF EXISTS public.event_series_planned(uuid, date);

CREATE OR REPLACE FUNCTION public.split_event_series(
  p_series uuid, p_from date, p_new jsonb, p_moves jsonb, p_key uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  s            public.event_series%ROWTYPE;
  n            public.event_series%ROWTYPE;
  v_prior      public.event_series%ROWTYPE;
  v_now        timestamptz := now();
  v_from_start timestamptz;
  v_new        uuid;
  v_planned    uuid[];
  v_moved      integer := 0;
  v_standalone integer := 0;
  v_occ        date;
  v_first      date;
  m            record;
BEGIN
  IF p_series IS NULL OR p_from IS NULL OR p_new IS NULL OR p_key IS NULL THEN
    RAISE EXCEPTION 'A split needs the series, the date, the new schedule and a key.' USING ERRCODE = '22023';
  END IF;

  -- Lock the old series first, so a concurrent retry waits here and then finds the key below.
  SELECT * INTO s FROM public.event_series WHERE id = p_series FOR UPDATE;

  -- Safe to repeat: the key's series already exists, so hand back the first result.
  SELECT * INTO v_prior FROM public.event_series WHERE split_key = p_key;
  IF FOUND THEN
    IF NOT (public.can_manage_events() AND public.can_write_church(v_prior.church_id)) THEN
      RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
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

  IF s.ends_on IS NOT NULL AND p_from > s.ends_on THEN
    RAISE EXCEPTION 'That date is not part of this repeating event.' USING ERRCODE = '22023';
  END IF;

  -- The chosen date, judged where it actually sits (a moved date by its saved start).
  SELECT starts_at INTO v_from_start
    FROM public.events WHERE series_id = p_series AND occurrence_date = p_from;
  v_from_start := coalesce(v_from_start, (p_from + s.time_start) AT TIME ZONE 'Asia/Manila');
  IF v_from_start <= v_now THEN
    RAISE EXCEPTION 'That date has already happened, so it can only be changed on its own.' USING ERRCODE = 'P0001';
  END IF;

  -- The new schedule. Church, start date, author and key come from here, not the browser.
  n := jsonb_populate_record(NULL::public.event_series, p_new);
  INSERT INTO public.event_series (
    church_id, title, kind, status, location, description, run_by, projected_budget,
    cadence, interval_n, anchor, weekday, week_of_month, day_of_month,
    weekday2, week_of_month2, day_of_month2, time_start, time_end, starts_on, ends_on, count_n,
    created_by, published_at, split_key)
  VALUES (
    s.church_id, n.title, n.kind, coalesce(n.status, 'draft'), n.location, n.description, n.run_by, n.projected_budget,
    n.cadence, coalesce(n.interval_n, 1), n.anchor, n.weekday, n.week_of_month, n.day_of_month,
    n.weekday2, n.week_of_month2, n.day_of_month2, n.time_start, n.time_end, p_from, n.ends_on, n.count_n,
    auth.uid(),
    CASE WHEN n.status = 'published' THEN coalesce(s.published_at, v_now) END,
    p_key)
  RETURNING id INTO v_new;

  -- The planned dates: saved rows from the split date on that have not happened yet.
  SELECT coalesce(array_agg(e.id), '{}') INTO v_planned
    FROM public.events e
   WHERE e.series_id = p_series AND e.occurrence_date >= p_from
     AND (e.starts_at IS NULL OR e.starts_at > v_now);

  IF p_moves IS NOT NULL THEN
    -- Every listed date must be a planned date of this series, once. Dates not listed stay.
    IF jsonb_typeof(p_moves) <> 'array'
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_moves) x
                   WHERE NOT ((x->>'event_id')::uuid = ANY (v_planned)))
       OR (SELECT count(*) <> count(DISTINCT x->>'event_id') FROM jsonb_array_elements(p_moves) x) THEN
      RAISE EXCEPTION 'The planned dates have changed since this page was opened. Please reload and try again.'
        USING ERRCODE = 'P0001';
    END IF;

    IF (SELECT count(x->>'to_date') <> count(DISTINCT x->>'to_date') FROM jsonb_array_elements(p_moves) x) THEN
      RAISE EXCEPTION 'Two planned dates cannot move to the same day.' USING ERRCODE = 'P0001';
    END IF;

    -- The date being edited ("selected") always takes the change. It is the first planned date,
    -- and it moves to the new schedule's date even across a week boundary — but never before
    -- the new schedule starts.
    SELECT min(e.occurrence_date) INTO v_first FROM public.events e WHERE e.id = ANY (v_planned);
    IF (SELECT count(*) FROM jsonb_array_elements(p_moves) x WHERE (x->>'selected')::boolean) > 1
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_moves) x
                    JOIN public.events e ON e.id = (x->>'event_id')::uuid
                   WHERE (x->>'selected')::boolean
                     AND (x->>'to_date' IS NULL OR (x->>'to_date')::date < p_from
                          OR e.occurrence_date <> v_first)) THEN
      RAISE EXCEPTION 'Only the date being changed can move to the new schedule''s first date.' USING ERRCODE = 'P0001';
    END IF;

    FOR m IN SELECT * FROM jsonb_to_recordset(p_moves) AS x(event_id uuid, to_date date, selected boolean) LOOP
      IF m.to_date IS NULL THEN
        -- No new date that week: it stays where it is, on its own.
        UPDATE public.events
           SET series_id = NULL, occurrence_date = NULL, updated_at = v_now
         WHERE id = m.event_id;
        v_standalone := v_standalone + 1;
      ELSE
        SELECT occurrence_date INTO v_occ FROM public.events WHERE id = m.event_id;
        IF NOT coalesce(m.selected, false) AND (m.to_date < p_from
           OR m.to_date - extract(dow FROM m.to_date)::int <> v_occ - extract(dow FROM v_occ)::int) THEN
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
        v_moved := v_moved + 1;
      END IF;
    END LOOP;
  END IF;

  -- Planned dates not listed stay as they are: same date, own details, now on the new schedule.
  UPDATE public.events SET series_id = v_new, updated_at = v_now
   WHERE id = ANY (v_planned) AND series_id = p_series;

  IF p_from <= s.starts_on THEN
    -- The change starts on (or moves before) the very first date: the old schedule has no dates
    -- left, so it goes.
    -- Anything still pointing at it (a date moved into the past) stands on its own.
    UPDATE public.events SET series_id = NULL, occurrence_date = NULL, updated_at = v_now
     WHERE series_id = p_series;
    DELETE FROM public.event_series WHERE id = p_series;
  ELSE
    UPDATE public.event_series
       SET ends_on = p_from - 1, updated_at = v_now
     WHERE id = p_series;
  END IF;

  RETURN jsonb_build_object('already_done', false, 'new_series_id', v_new,
                            'moved', v_moved, 'standalone', v_standalone);
END
$$;

REVOKE ALL ON FUNCTION public.split_event_series(uuid, date, jsonb, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.split_event_series(uuid, date, jsonb, jsonb, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

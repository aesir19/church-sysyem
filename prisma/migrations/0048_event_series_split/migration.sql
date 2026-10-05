-- 0048_event_series_split — "this date and the ones after it" as ONE all-or-nothing operation
-- (#103 bug 2, #105). Owner decisions of 2026-10-05, recorded on #105:
--   * the old schedule ends the day before the chosen date and a new one starts on it; earlier
--     dates are never touched. A date that has already started (exact time, database clock) is
--     not a split point — a past date is only ever changed on its own (0047)
--   * already-planned later dates (saved rows) STAY where they are by default and keep their own
--     details; they just belong to the new schedule. Only when the owner ticks "Also move
--     already-planned future dates" does each one move to the new schedule's date in the same
--     Sunday-first week and take the new details. With no new date that week it stays put as a
--     standalone event. This changes #105 rule 7 (moving was the default)
--   * cancelled dates stay cancelled; people, programme, money and attendance stay attached. A
--     date that changes day files its attendance as history through the 0047 trigger
--   * a one-time key from the browser: a retry after a lost reply returns the first result
--   * Events Team / SuperAdmin of the series' own church only; a deleted series cannot change
--
-- WHO WORKS OUT "THE SAME WEEK". The schedule maths lives in the browser (src/lib/recurrence.js),
-- so the browser sends each planned date's new day. This function does not trust that list: every
-- planned date must be in it exactly once, each new day must sit in the same week and on or after
-- the split, and no two may land on one day. The worst a forged list can do is move the church's
-- own dates within their own week — something Events Team can already do one date at a time.
--
-- Before this, the browser made three separate calls (end the old rule, create the new one, then
-- move or DELETE the later saved dates), so a failure part-way left a half-split schedule, a
-- retry split twice, and "overwrite" deleted planned dates with their people and programme.

BEGIN;

ALTER TABLE public.event_series ADD COLUMN split_key uuid;

CREATE UNIQUE INDEX event_series_split_key_uniq
  ON public.event_series (split_key) WHERE split_key IS NOT NULL;

COMMENT ON COLUMN public.event_series.split_key IS
  'The one-time key of the split that created this series (#103). A retry with the same key '
  'returns this series instead of splitting again.';

-- ---------------------------------------------------------------------------
-- A deleted series is finished: nothing about it can change, however the request arrives.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_series_guard_deleted()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'This repeating event was deleted and can''t be changed.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.event_series_guard_deleted() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER event_series_guard_deleted
BEFORE UPDATE ON public.event_series
FOR EACH ROW EXECUTE FUNCTION public.event_series_guard_deleted();

-- ---------------------------------------------------------------------------
-- The split. One function = one transaction: it all happens or none of it does.
--   p_new   — the new schedule's columns (rule + shared fields), as the composer builds them
--   p_moves — NULL: leave planned dates alone. Otherwise [{event_id, to_date}] covering every
--             planned date; to_date NULL keeps that date where it is, as a standalone event
--   p_key   — the browser's one-time key for this split
-- Returns {already_done, new_series_id, moved, standalone}.
-- ---------------------------------------------------------------------------
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

  IF p_from < s.starts_on OR (s.ends_on IS NOT NULL AND p_from > s.ends_on) THEN
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

  IF p_moves IS NULL THEN
    -- Left alone: same date, own details, now part of the new schedule.
    UPDATE public.events SET series_id = v_new, updated_at = v_now WHERE id = ANY (v_planned);
  ELSE
    -- The list must be exactly the planned dates, each once — nothing moved or left unseen.
    IF jsonb_typeof(p_moves) <> 'array'
       OR (SELECT count(*) FROM jsonb_array_elements(p_moves)) <> cardinality(v_planned)
       OR (SELECT count(DISTINCT (x->>'event_id')::uuid) FROM jsonb_array_elements(p_moves) x
            WHERE (x->>'event_id')::uuid = ANY (v_planned)) <> cardinality(v_planned) THEN
      RAISE EXCEPTION 'The planned dates have changed since this page was opened. Please reload and try again.'
        USING ERRCODE = 'P0001';
    END IF;

    IF (SELECT count(x->>'to_date') <> count(DISTINCT x->>'to_date') FROM jsonb_array_elements(p_moves) x) THEN
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
        SELECT occurrence_date INTO v_occ FROM public.events WHERE id = m.event_id;
        IF m.to_date < p_from
           OR m.to_date - extract(dow FROM m.to_date)::int <> v_occ - extract(dow FROM v_occ)::int THEN
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

  IF p_from = s.starts_on THEN
    -- The change starts on the very first date: the old schedule has no dates left, so it goes.
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

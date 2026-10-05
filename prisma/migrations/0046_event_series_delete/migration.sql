-- 0046_event_series_delete — deleting a repeating event as ONE all-or-nothing operation
-- (#103 bug 2, #105). Owner decisions of 2026-10-05, recorded on #105:
--   * soft delete: the series ends and is marked deleted; its past dates keep showing; no restore
--   * an upcoming date WITH recorded work (attendance, finance, assigned people, a programme)
--     survives as a standalone event with every link intact; one without is removed
--   * "past" is the exact start time against the database clock, in Asia/Manila, judged on the
--     event's ACTUAL start (a moved date is judged where it now sits, not by its original slot)
--   * Events Team / SuperAdmin of the series' own church only; a repeat call changes nothing
--
-- Before this, the browser made three separate calls (detach past, delete future, delete the
-- series), so a failure part-way left a half-deleted series, and it removed past dates that never
-- had a saved row.

BEGIN;

ALTER TABLE public.event_series ADD COLUMN deleted_at timestamptz;

COMMENT ON COLUMN public.event_series.deleted_at IS
  'Set when the owner deletes the series (#105). The row stays so past dates keep showing; '
  'ends_on is cut back so no new dates are produced. Never cleared — there is no restore.';

-- ---------------------------------------------------------------------------
-- "Recorded work": the test for keeping an upcoming date when its series is deleted.
-- Unfilled roles alone are NOT recorded work — nobody has done anything yet.
-- Internal helper, not callable from the app.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_has_recorded_work(p_event_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT EXISTS (SELECT 1 FROM public.attendance a
                   JOIN public.services s ON s.id = a.service_id AND s.church_id = a.church_id
                  WHERE s.event_id = p_event_id)
      OR EXISTS (SELECT 1 FROM public.expenses WHERE event_id = p_event_id)
      OR EXISTS (SELECT 1 FROM public.collections WHERE event_id = p_event_id)
      OR EXISTS (SELECT 1 FROM public.event_assignments WHERE event_id = p_event_id)
      OR EXISTS (SELECT 1 FROM public.event_programme_items WHERE event_id = p_event_id)
$$;

REVOKE ALL ON FUNCTION public.event_has_recorded_work(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- How many upcoming dates a delete would keep / remove — the numbers in the confirm dialog.
-- Read-only; same authority as the delete itself.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.preview_delete_event_series(p_series uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE
AS $$
DECLARE
  v_church uuid;
  v_kept   integer;
  v_removed integer;
BEGIN
  SELECT church_id INTO v_church FROM public.event_series WHERE id = p_series;
  IF v_church IS NULL OR NOT (public.can_manage_events() AND public.can_write_church(v_church)) THEN
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

-- ---------------------------------------------------------------------------
-- The delete. One function = one transaction: it all happens or none of it does.
-- ---------------------------------------------------------------------------
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
  IF NOT FOUND OR NOT (public.can_manage_events() AND public.can_write_church(s.church_id)) THEN
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

REVOKE ALL ON FUNCTION public.preview_delete_event_series(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_event_series(uuid)         FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_delete_event_series(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_event_series(uuid)         TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

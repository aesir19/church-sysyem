-- 0033_calendar_public_reads — let ordinary members see service times and birthdays on the
-- Calendar, without widening the tables those come from.
--
-- THE PROBLEM. service_schedules and members are gated (attendance / member-detail RLS), so
-- a plain member reading them directly gets nothing — the Calendar's service overlay and
-- birthday overlay were fail-closed for exactly the audience the Calendar is for. The owner
-- has decided members should see both.
--
-- THE APPROACH (rule 2). Not by opening those tables — by two SECURITY DEFINER functions
-- that return ONLY the minimum the calendar needs, church-scoped:
--   * list_calendar_schedules — the recurring service RULE (label + weekday + times). This
--     is bulletin-level information, never attendance.
--   * list_calendar_birthdays — each member's NAME and birth MONTH/DAY. The birth YEAR (and
--     therefore age) is computed away inside the function and never leaves it, even though
--     the function reads the full birthdate column. The definer boundary is what guarantees
--     that: a member calling this cannot select the year, only receive month and day.
-- Both are scoped by can_read_church(p_church_id), so a member sees their own church only
-- (SuperAdmin / Head Pastor may pass any church they can read). Granted to authenticated.

BEGIN;

-- The recurring service times for a church, for the Calendar overlay. Returns the schedule
-- rule; occurrences are expanded client-side over the visible window.
CREATE OR REPLACE FUNCTION public.list_calendar_schedules(p_church_id uuid)
RETURNS TABLE (
  id        uuid,
  label     text,
  weekday   smallint,
  starts_at time,
  ends_at   time
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT s.id, s.label, s.weekday, s.starts_at, s.ends_at
  FROM public.service_schedules AS s
  WHERE s.church_id = p_church_id
    AND s.is_active = true
    AND public.can_read_church(p_church_id)
$$;

-- Member birthdays for a church, for the Calendar overlay. Name + month + day only — the
-- year is dropped here, inside the definer, so no caller can widen it back to a full DOB or
-- an age. Archived members are excluded, as everywhere else.
CREATE OR REPLACE FUNCTION public.list_calendar_birthdays(p_church_id uuid)
RETURNS TABLE (
  member_id    uuid,
  display_name text,
  birth_month  smallint,
  birth_day    smallint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    m.id,
    btrim(m.first_name || ' ' || m.last_name),
    extract(month FROM m.birthdate)::smallint,
    extract(day   FROM m.birthdate)::smallint
  FROM public.members AS m
  WHERE m.member_of = p_church_id
    AND m.archived_at IS NULL
    AND m.birthdate IS NOT NULL
    AND public.can_read_church(p_church_id)
$$;

REVOKE ALL ON FUNCTION public.list_calendar_schedules(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_calendar_birthdays(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_calendar_schedules(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_calendar_birthdays(uuid) TO authenticated;

COMMIT;

-- NOTIFY pgrst, 'reload schema';

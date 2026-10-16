-- 0058_group_meetings_out_of_summaries — keep Group meetings out of two definer reads.
--
-- 0056 limits who may read a Group meeting. Two existing summaries read events with
-- definer rights and so go around those rules:
--   list_understaffed_events (0042) — the "needs people" list, open to every member
--   d_group_dashboard (0055)        — "serving this week" and "served in the last 3 months"
-- Both only report events with serving roles, and only the Events team can add roles (0035),
-- so a Group meeting reached them only if the Events team gave one roles in the full
-- composer — but then a pastor, or another group's leader, would see where it is held.
-- A leader's meeting has no serving roles, so both now leave Group meetings out
-- (e.small_group_id IS NULL). Each function is its latest definition with that one line
-- added; signatures, and so their grants, are unchanged.
--
-- A NOTE ON 0056, which is applied and so not edited: its event_edit_state also answers any
-- group leader for a date with no saved row (p_event_id IS NULL). That branch only reads the
-- clock — is the date past — so it reveals nothing about any event.
--
-- ROLLBACK: see rollback.sql.

BEGIN;

CREATE OR REPLACE FUNCTION public.list_understaffed_events(
  p_church_id     uuid,
  p_from          timestamptz,
  p_to            timestamptz DEFAULT NULL,
  p_include_drafts boolean DEFAULT false
)
RETURNS TABLE (
  id        uuid,
  title     text,
  starts_at timestamptz,
  status    text,
  needed    integer,
  filled    integer,
  gap       integer
)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  WITH role_fill AS (
    SELECT
      e.id AS event_id,
      e.title,
      e.starts_at,
      e.status,
      r.id AS role_id,
      r.count_required,
      LEAST(count(a.id)::integer, r.count_required) AS filled
    FROM public.events e
    JOIN public.event_roles r ON r.event_id = e.id
    LEFT JOIN public.event_assignments a ON a.role_id = r.id
    WHERE e.church_id = p_church_id
      AND e.small_group_id IS NULL
      AND public.can_read_church(e.church_id)
      AND e.starts_at >= p_from
      AND (p_to IS NULL OR e.starts_at < p_to)
      AND (
        e.status = 'published'
        OR (p_include_drafts AND e.status = 'draft' AND public.can_view_events())
      )
    GROUP BY e.id, e.title, e.starts_at, e.status, r.id, r.count_required
  ), event_fill AS (
    SELECT
      role_fill.event_id AS id,
      role_fill.title,
      role_fill.starts_at,
      role_fill.status,
      sum(role_fill.count_required)::integer AS needed,
      sum(role_fill.filled)::integer AS filled
    FROM role_fill
    GROUP BY role_fill.event_id, role_fill.title, role_fill.starts_at, role_fill.status
  )
  SELECT
    event_fill.id,
    event_fill.title,
    event_fill.starts_at,
    event_fill.status,
    event_fill.needed,
    event_fill.filled,
    event_fill.needed - event_fill.filled AS gap
  FROM event_fill
  WHERE event_fill.filled < event_fill.needed
  ORDER BY event_fill.starts_at
$$;

CREATE OR REPLACE FUNCTION public.d_group_dashboard()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH led AS (
    SELECT g.id, g.name, g.church_id, g.started_at
    FROM public.small_groups g
    WHERE public.archive_account_active()
      AND EXISTS (SELECT 1 FROM public.small_group_leaders l
                  WHERE l.group_id = g.id AND l.account_id = auth.uid())
  ),
  week AS (
    SELECT date_trunc('week', now() AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'Asia/Manila' AS starts,
           (date_trunc('week', now() AT TIME ZONE 'Asia/Manila') + interval '7 days') AT TIME ZONE 'Asia/Manila' AS ends
  ),
  last4 AS (
    SELECT * FROM (
      SELECT s.id, s.church_id, s.label, s.service_date, s.opens_at,
             row_number() OVER (PARTITION BY s.church_id ORDER BY s.opens_at DESC) AS rn
      FROM public.services s
      WHERE s.church_id IN (SELECT church_id FROM led)
        AND extract(dow FROM s.service_date) = 0
        AND s.closes_at <= now()
        AND s.closes_at > s.opens_at
    ) ranked
    WHERE rn <= 4
  ),
  roster AS (
    SELECT sgm.member_id, sgm.small_group_id AS group_id, sgm.joined_at, led.church_id,
           m.first_name, m.last_name, m.birthdate,
           m.is_baptized, m.is_one_to_one_completed, m.is_turning_point_completed
    FROM public.small_group_members sgm
    JOIN led ON led.id = sgm.small_group_id
    JOIN public.members m ON m.id = sgm.member_id
    WHERE m.archived_at IS NULL
  )
  SELECT jsonb_build_object(
    'groups', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'church_id', church_id, 'started_at', started_at) ORDER BY name)
      FROM led), '[]'::jsonb),
    'services', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'church_id', church_id, 'label', label, 'service_date', service_date) ORDER BY opens_at)
      FROM last4), '[]'::jsonb),
    'members', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'member_id', r.member_id,
        'group_id', r.group_id,
        'name', btrim(r.first_name || ' ' || r.last_name),
        'joined_at', r.joined_at,
        'birth_month', extract(month FROM r.birthdate)::int,
        'birth_day', extract(day FROM r.birthdate)::int,
        'is_baptized', r.is_baptized,
        'is_one_to_one_completed', r.is_one_to_one_completed,
        'is_turning_point_completed', r.is_turning_point_completed,
        'attendance', coalesce((
          SELECT jsonb_agg(jsonb_build_object('service_id', s.id, 'status',
            CASE
              WHEN EXISTS (SELECT 1 FROM public.attendance a
                           WHERE a.service_id = s.id AND a.member_id = r.member_id) THEN 'present'
              WHEN r.joined_at IS NOT NULL AND r.joined_at > s.opens_at THEN 'not_in_group'
              ELSE 'missed'
            END) ORDER BY s.opens_at)
          FROM last4 s WHERE s.church_id = r.church_id), '[]'::jsonb),
        'served_recent', (
          SELECT count(*)::int
          FROM public.event_assignments ea
          JOIN public.events e ON e.id = ea.event_id
          WHERE ea.member_id = r.member_id AND ea.status = 'confirmed' AND e.status = 'published'
            AND e.small_group_id IS NULL
            AND e.starts_at > now() - interval '90 days' AND e.starts_at <= now()),
        'serving_this_week', coalesce((
          SELECT jsonb_agg(jsonb_build_object(
            'role', er.label, 'event_title', e.title, 'starts_at', e.starts_at) ORDER BY e.starts_at)
          FROM public.event_assignments ea
          JOIN public.events e ON e.id = ea.event_id
          JOIN public.event_roles er ON er.id = ea.role_id
          CROSS JOIN week w
          WHERE ea.member_id = r.member_id AND ea.status = 'confirmed' AND e.status = 'published'
            AND e.small_group_id IS NULL
            AND e.starts_at >= w.starts AND e.starts_at < w.ends), '[]'::jsonb)
      ) ORDER BY r.first_name, r.last_name)
      FROM roster r), '[]'::jsonb)
  )
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';

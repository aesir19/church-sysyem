-- 0055_d_group_dashboard — the D-Group leader view's one read
-- (docs/specs/d-group-leader-view.md, Phase 1).
--
-- 1. DATES. Group membership gains joined_at and groups gain started_at, so "Check on"
--    can count only the Sunday services held after a member joined. Both are added
--    WITHOUT a default and the default set afterwards: ADD COLUMN ... DEFAULT now()
--    would stamp every existing row with today and invent join dates. Existing rows
--    stay NULL, read as "here since before the window". Neither column is in the
--    authenticated column grants (0026), so no client can set or change them.
--
-- 2. d_group_dashboard(). SECURITY DEFINER, scoped to the groups the caller leads
--    (small_group_leaders.account_id = auth.uid()) and to an active account; anyone
--    else gets empty lists. It widens exactly one read for a leader: their own
--    members' confirmed serving on published events (role label and event title),
--    which event_assignments' policy otherwise keeps to the events roles (0035).
--    No address, contact detail or birth year leaves the function.
--
-- "Sunday service" = a services row on a Sunday (Manila date) whose check-in has closed
-- (an open one would mark everyone "missed" mid-service), and
-- not cancelled (closes_at = opens_at is the cancelled state, 0013).
--
-- ROLLBACK: see rollback.sql.

BEGIN;

ALTER TABLE public.small_group_members ADD COLUMN joined_at timestamptz;
ALTER TABLE public.small_group_members ALTER COLUMN joined_at SET DEFAULT now();
COMMENT ON COLUMN public.small_group_members.joined_at IS
  'When the member was added to the D-Group. NULL for memberships older than 0055 (unknown). Set by default only.';

ALTER TABLE public.small_groups ADD COLUMN started_at timestamptz;
ALTER TABLE public.small_groups ALTER COLUMN started_at SET DEFAULT now();
COMMENT ON COLUMN public.small_groups.started_at IS
  'When the D-Group was created. NULL for groups older than 0055 (unknown). Set by default only.';

CREATE FUNCTION public.d_group_dashboard()
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
            AND e.starts_at > now() - interval '90 days' AND e.starts_at <= now()),
        'serving_this_week', coalesce((
          SELECT jsonb_agg(jsonb_build_object(
            'role', er.label, 'event_title', e.title, 'starts_at', e.starts_at) ORDER BY e.starts_at)
          FROM public.event_assignments ea
          JOIN public.events e ON e.id = ea.event_id
          JOIN public.event_roles er ON er.id = ea.role_id
          CROSS JOIN week w
          WHERE ea.member_id = r.member_id AND ea.status = 'confirmed' AND e.status = 'published'
            AND e.starts_at >= w.starts AND e.starts_at < w.ends), '[]'::jsonb)
      ) ORDER BY r.first_name, r.last_name)
      FROM roster r), '[]'::jsonb)
  )
$$;

COMMENT ON FUNCTION public.d_group_dashboard() IS
  'The D-Group leader view: the caller''s led groups, their last four Sunday services, and per-member attendance, serving and journey. Empty for non-leaders and disabled accounts. Added by 0055.';

REVOKE ALL ON FUNCTION public.d_group_dashboard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.d_group_dashboard() TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

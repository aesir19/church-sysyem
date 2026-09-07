-- Return every upcoming event with unfilled volunteer roles in one round trip.
-- The function exposes aggregate counts only; assignment identities remain behind RLS.

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

COMMENT ON FUNCTION public.list_understaffed_events(uuid, timestamptz, timestamptz, boolean) IS
  'Lists upcoming events with aggregate volunteer gaps. Drafts are returned only to event viewers; no assignment identities are exposed.';

REVOKE ALL ON FUNCTION public.list_understaffed_events(uuid, timestamptz, timestamptz, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_understaffed_events(uuid, timestamptz, timestamptz, boolean)
  TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

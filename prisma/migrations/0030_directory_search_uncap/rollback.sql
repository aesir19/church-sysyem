-- Rollback for 0030 — restore the 0028 LIMIT expression (default 200, ceiling
-- 1000). The Members directory reverts to a 200-row cap. No data is touched.

BEGIN;

CREATE OR REPLACE FUNCTION public.directory_search(
  p_query     text    DEFAULT NULL,
  p_church_id uuid    DEFAULT NULL,
  p_limit     integer DEFAULT 200
)
RETURNS TABLE (
  member_id                      uuid,
  first_name                     text,
  middle_name                    text,
  last_name                      text,
  gender                         text,
  church_id                      uuid,
  ministries                     text[],
  small_groups                   text[],
  is_one_to_one_completed        boolean,
  is_turning_point_completed     boolean,
  is_baptized                    boolean,
  has_submitted_membership_form  boolean
)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  WITH scope AS (
    SELECT (public.is_super_admin() OR public.is_head_pastor()) AS is_global,
           public.get_my_church_id()  AS my_church,
           public.has_directory_access() AS allowed
  )
  SELECT
    m.id,
    m.first_name::text,
    m.middle_name::text,
    m.last_name::text,
    m.gender::text,
    m.member_of,
    coalesce((
      SELECT array_agg(DISTINCT mi.name::text ORDER BY mi.name::text)
      FROM public.ministry_members AS mm
      JOIN public.ministries AS mi ON mi.id = mm.ministry_id
      WHERE mm.member_id = m.id
    ), '{}'::text[]) AS ministries,
    coalesce((
      SELECT array_agg(DISTINCT sg.name::text ORDER BY sg.name::text)
      FROM public.small_group_members AS sgm
      JOIN public.small_groups AS sg ON sg.id = sgm.small_group_id
      WHERE sgm.member_id = m.id
    ), '{}'::text[]) AS small_groups,
    m.is_one_to_one_completed,
    m.is_turning_point_completed,
    m.is_baptized,
    m.has_submitted_membership_form
  FROM public.members AS m
  CROSS JOIN scope AS s
  WHERE s.allowed
    AND m.archived_at IS NULL
    AND (s.is_global OR m.member_of = s.my_church)
    AND (p_church_id IS NULL OR m.member_of = p_church_id)
    AND (
      p_query IS NULL
      OR (m.first_name || ' ' || m.last_name) ILIKE '%' || p_query || '%'
    )
  ORDER BY m.last_name, m.first_name
  LIMIT greatest(1, least(coalesce(p_limit, 200), 1000))
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';

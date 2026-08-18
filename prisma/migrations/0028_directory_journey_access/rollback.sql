-- Rollback for 0028_directory_journey_access.
--
-- Restores directory_search() to its 0026 body (names + group only, gated on
-- having a church), and drops the two functions 0028 introduced. Run inside a
-- transaction; reload the PostgREST schema cache afterwards.

BEGIN;

-- directory_search() is dropped and recreated in its 0026 shape. Dropping first is
-- required because 0028 changed its return type; recreating restores the six-column
-- directory the app consumed before this migration.
DROP FUNCTION IF EXISTS public.directory_search(text, uuid, integer);

CREATE FUNCTION public.directory_search(
  p_query text DEFAULT NULL,
  p_church_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 200
)
RETURNS TABLE(
  member_id uuid, first_name text, last_name text, church_id uuid,
  ministries text[], small_groups text[]
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH scope AS (
    SELECT (public.is_super_admin() OR public.is_head_pastor()) AS is_global,
           public.get_my_church_id() AS my_church
  )
  SELECT
    m.id,
    m.first_name::text,
    m.last_name::text,
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
    ), '{}'::text[]) AS small_groups
  FROM public.members AS m
  CROSS JOIN scope AS s
  WHERE m.archived_at IS NULL
    AND (s.is_global OR m.member_of = s.my_church)
    AND (p_church_id IS NULL OR m.member_of = p_church_id)
    AND (
      p_query IS NULL
      OR (m.first_name || ' ' || m.last_name) ILIKE '%' || p_query || '%'
    )
  ORDER BY m.last_name, m.first_name
  LIMIT greatest(1, least(coalesce(p_limit, 200), 1000))
$$;

REVOKE ALL ON FUNCTION public.directory_search(text, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.directory_search(text, uuid, integer) TO authenticated;

DROP FUNCTION IF EXISTS public.set_member_journey(uuid, boolean, boolean);
DROP FUNCTION IF EXISTS public.has_directory_access();

COMMIT;

-- NOTIFY pgrst, 'reload schema';

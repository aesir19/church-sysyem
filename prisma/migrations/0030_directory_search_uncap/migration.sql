-- ============================================================================
-- 0030 — directory_search: NULL p_limit means "no limit".
-- ============================================================================
-- WHY. The Members directory (listDirectory) asked directory_search for at most
-- 200 rows and had no offset to page past them, so a church with 255 active
-- members showed a directory-mode role (Welcome Team, Finance, Head Pastor...)
-- only 200 of them AND printed "200 active records" as if that were the whole
-- roll — while the Overview (0029) correctly reports 255. The owner's call: the
-- directory shows the actual roster, not a capped slice.
--
-- The function already ceilinged every request at 1000 and defaulted an unsent
-- p_limit to 200. This keeps BOTH of those for the explicit-limit callers that
-- rely on them (AttendanceView / group roster pass 1000; CollectionsInput omits
-- it and wants the 200 default) and adds one case: a caller that passes p_limit
-- => NULL gets NO limit. Per-church and safe-fields-only, so an unbounded read is
-- bounded by the church's own membership.
--
-- Body is otherwise byte-identical to 0028 — only the LIMIT expression changes.
-- CREATE OR REPLACE preserves the existing grants; the signature is unchanged.
--
-- ROLLBACK: see rollback.sql (restores the 0028 LIMIT expression).
-- ============================================================================

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
  -- NULL (or a non-positive) p_limit => LIMIT NULL, which Postgres reads as "all
  -- rows". An explicit positive p_limit is honoured as-is; an unsent one still
  -- defaults to 200 via the signature.
  LIMIT (CASE WHEN p_limit IS NULL OR p_limit < 1 THEN NULL ELSE p_limit END)
$$;

COMMENT ON FUNCTION public.directory_search(text, uuid, integer) IS
  'The safe member directory: names, gender, group membership and the four journey flags — never birthdate/address/contact/marital PII. Gated by has_directory_access() so a scopeless account sees nothing. p_limit NULL means no limit (0030); unsent defaults to 200.';

COMMIT;

-- PostgREST caches the schema; nudge it so the replaced body is picked up.
NOTIFY pgrst, 'reload schema';

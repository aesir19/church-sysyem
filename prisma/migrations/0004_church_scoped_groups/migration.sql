-- Church-scoped small groups with a shared global ministry catalog.
-- Existing rows are expected to be ministries. The migration intentionally aborts
-- rather than guessing a tenant for any legacy small-group or unknown-type row.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.groups
    WHERE type IS DISTINCT FROM 'Ministry'
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = '0004_church_scoped_groups aborted: existing groups contain Small Group or unknown type rows.',
      HINT = 'No legacy small groups were expected. Export/remove them or add a reviewed church-specific backfill to this migration before retrying.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.groups
    GROUP BY lower(name)
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = '0004_church_scoped_groups aborted: duplicate case-insensitive ministry names exist.',
      HINT = 'Rename or merge duplicate ministry definitions before rerunning this migration.';
  END IF;
END
$$;

ALTER TABLE public.groups
  ADD COLUMN church_id UUID,
  ADD COLUMN color VARCHAR;

-- Stable assignment: the same existing catalog receives the same palette sequence.
WITH ranked AS (
  SELECT
    id,
    (row_number() OVER (ORDER BY lower(name), id) - 1) % 8 AS palette_index
  FROM public.groups
)
UPDATE public.groups AS g
SET color = CASE ranked.palette_index
  WHEN 0 THEN 'blue'
  WHEN 1 THEN 'teal'
  WHEN 2 THEN 'green'
  WHEN 3 THEN 'amber'
  WHEN 4 THEN 'orange'
  WHEN 5 THEN 'red'
  WHEN 6 THEN 'purple'
  ELSE 'slate'
END
FROM ranked
WHERE ranked.id = g.id;

ALTER TABLE public.groups
  ALTER COLUMN color SET DEFAULT 'blue',
  ALTER COLUMN color SET NOT NULL,
  ADD CONSTRAINT groups_church_id_fkey
    FOREIGN KEY (church_id) REFERENCES public.churches(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  ADD CONSTRAINT groups_type_church_check CHECK (
    (type = 'Ministry' AND church_id IS NULL)
    OR (type = 'Small Group' AND church_id IS NOT NULL)
  ),
  ADD CONSTRAINT groups_color_check CHECK (
    color IN ('blue', 'teal', 'green', 'amber', 'orange', 'red', 'purple', 'slate')
  );

-- Remove accidental duplicate associations before enforcing set semantics.
WITH duplicates AS (
  SELECT id, row_number() OVER (
    PARTITION BY group_id, member_id
    ORDER BY id
  ) AS duplicate_number
  FROM public.group_members
)
DELETE FROM public.group_members AS gm
USING duplicates
WHERE gm.id = duplicates.id
  AND duplicates.duplicate_number > 1;

CREATE UNIQUE INDEX groups_global_ministry_name_ci_key
  ON public.groups (lower(name))
  WHERE type = 'Ministry' AND church_id IS NULL;

CREATE UNIQUE INDEX groups_small_group_church_name_ci_key
  ON public.groups (church_id, lower(name))
  WHERE type = 'Small Group' AND church_id IS NOT NULL;

CREATE INDEX groups_church_type_idx
  ON public.groups (church_id, type);

CREATE UNIQUE INDEX group_members_group_id_member_id_key
  ON public.group_members (group_id, member_id);

CREATE INDEX group_members_member_id_idx
  ON public.group_members (member_id);

-- Baseline snapshots can omit remotely-created helpers. Create the canonical helper
-- only when absent; never overwrite a deployed implementation.
DO $migration$
BEGIN
  IF to_regprocedure('public.get_my_church_id()') IS NULL THEN
    EXECUTE $function$
      CREATE FUNCTION public.get_my_church_id()
      RETURNS UUID
      LANGUAGE sql
      SECURITY DEFINER
      SET search_path = public
      STABLE
      AS $$
        SELECT m.member_of
        FROM public.user_accounts AS ua
        JOIN public.members AS m ON m.id = ua.member_id
        WHERE ua.id = auth.uid()
        LIMIT 1
      $$
    $function$;
  END IF;
END
$migration$;

-- SECURITY DEFINER predicates keep policy evaluation independent of members/groups
-- RLS and avoid recursion during nested PostgREST relationship reads.
CREATE OR REPLACE FUNCTION public.is_member_in_my_church(candidate_member_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.members AS m
    WHERE m.id = candidate_member_id
      AND m.member_of = public.get_my_church_id()
      AND m.archived_at IS NULL
  )
$$;

CREATE OR REPLACE FUNCTION public.is_group_available_to_my_church(candidate_group_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.groups AS g
    WHERE g.id = candidate_group_id
      AND public.get_my_church_id() IS NOT NULL
      AND (
        (g.type = 'Ministry' AND g.church_id IS NULL)
        OR (g.type = 'Small Group' AND g.church_id = public.get_my_church_id())
      )
  )
$$;

REVOKE ALL ON FUNCTION public.is_member_in_my_church(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_group_available_to_my_church(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_church_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_member_in_my_church(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_group_available_to_my_church(UUID) TO authenticated;

REVOKE ALL ON TABLE public.groups FROM anon, authenticated;
REVOKE ALL ON TABLE public.group_members FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.groups TO authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.group_members TO authenticated;

ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;

-- Remove every legacy policy so no permissive remote-only policy survives rollout.
DO $policies$
DECLARE
  policy_record RECORD;
BEGIN
  FOR policy_record IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('groups', 'group_members')
  LOOP
    EXECUTE format(
      'DROP POLICY %I ON %I.%I',
      policy_record.policyname,
      policy_record.schemaname,
      policy_record.tablename
    );
  END LOOP;
END
$policies$;

CREATE POLICY groups_select_visible
ON public.groups
FOR SELECT
TO authenticated
USING (
  public.get_my_church_id() IS NOT NULL
  AND (
    (type = 'Ministry' AND church_id IS NULL)
    OR (type = 'Small Group' AND church_id = public.get_my_church_id())
  )
);

CREATE POLICY groups_insert_own_small_group
ON public.groups
FOR INSERT
TO authenticated
WITH CHECK (
  type = 'Small Group'
  AND church_id = public.get_my_church_id()
);

CREATE POLICY groups_update_own_small_group
ON public.groups
FOR UPDATE
TO authenticated
USING (
  type = 'Small Group'
  AND church_id = public.get_my_church_id()
)
WITH CHECK (
  type = 'Small Group'
  AND church_id = public.get_my_church_id()
);

CREATE POLICY groups_delete_own_small_group
ON public.groups
FOR DELETE
TO authenticated
USING (
  type = 'Small Group'
  AND church_id = public.get_my_church_id()
);

CREATE POLICY group_members_select_own_church
ON public.group_members
FOR SELECT
TO authenticated
USING (
  public.is_member_in_my_church(member_id)
  AND public.is_group_available_to_my_church(group_id)
);

CREATE POLICY group_members_insert_own_church
ON public.group_members
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_member_in_my_church(member_id)
  AND public.is_group_available_to_my_church(group_id)
);

CREATE POLICY group_members_delete_own_church
ON public.group_members
FOR DELETE
TO authenticated
USING (
  public.is_member_in_my_church(member_id)
  AND public.is_group_available_to_my_church(group_id)
);

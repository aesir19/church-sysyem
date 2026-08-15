-- ROLLBACK for 0026_split_groups.
--
-- Prisma has no down-migrations. This file is operational only. Paste it into the
-- Supabase SQL editor.
--
-- READ THIS BEFORE RUNNING IT.
--
-- This reverses the split: it rebuilds `groups` and `group_members` as tables, moves
-- every row back with its id intact, restores the old policies, grants, indexes and
-- the CHECK constraint, re-points the predicate functions at `groups`, and puts the
-- small_group_leaders trigger back.
--
-- WHAT IT CANNOT GIVE BACK: color_slot. 0025 dropped it and this file does not restore
-- it — if you need the column too, run 0025's rollback AFTER this one, in that order,
-- because it operates on `groups` as a table.
--
-- THE FRONTEND MUST GO BACK TOO. After the split, the application reads `ministries`
-- and `small_groups`. Running this without also reverting the build leaves every group
-- query 404ing on a table that no longer exists. Revert the deploy first, then run this.
--
-- After running this:
--   NOTIFY pgrst, 'reload schema';
--   npx prisma migrate resolve --rolled-back 0026_split_groups

BEGIN;

LOCK TABLE public.ministries, public.small_groups,
           public.ministry_members, public.small_group_members,
           public.small_group_leaders
  IN ACCESS EXCLUSIVE MODE;

CREATE TEMP TABLE unsplit_before ON COMMIT DROP AS
SELECT
  (SELECT count(*) FROM public.ministries)          AS ministries,
  (SELECT count(*) FROM public.small_groups)        AS small_groups,
  (SELECT count(*) FROM public.ministry_members)    AS ministry_members,
  (SELECT count(*) FROM public.small_group_members) AS small_group_members;

-- ---- 1. Rebuild the old tables ------------------------------------------
CREATE TABLE public.groups (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         varchar NOT NULL,
  type         varchar NOT NULL,
  church_id    uuid REFERENCES public.churches(id) ON DELETE CASCADE,
  ministry_key text,
  CONSTRAINT groups_type_church_check CHECK (
    (type = 'Ministry' AND church_id IS NULL)
    OR (type = 'Small Group' AND church_id IS NOT NULL)
  )
);

CREATE TABLE public.group_members (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.members(id) ON UPDATE CASCADE ON DELETE CASCADE,
  group_id  uuid NOT NULL REFERENCES public.groups(id)  ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT group_members_group_id_member_id_key UNIQUE (group_id, member_id)
);

CREATE UNIQUE INDEX groups_global_ministry_name_ci_key
  ON public.groups (lower(name::text)) WHERE (type = 'Ministry' AND church_id IS NULL);
CREATE UNIQUE INDEX groups_small_group_church_name_ci_key
  ON public.groups (church_id, lower(name::text)) WHERE (type = 'Small Group' AND church_id IS NOT NULL);
CREATE UNIQUE INDEX groups_ministry_key_key
  ON public.groups (ministry_key) WHERE ministry_key IS NOT NULL;
CREATE INDEX groups_church_type_idx      ON public.groups (church_id, type);
CREATE INDEX group_members_member_id_idx ON public.group_members (member_id);

-- ---- 2. Move the rows back ----------------------------------------------
INSERT INTO public.groups (id, name, type, church_id, ministry_key)
SELECT id, name, 'Ministry', NULL, ministry_key FROM public.ministries;

INSERT INTO public.groups (id, name, type, church_id, ministry_key)
SELECT id, name, 'Small Group', church_id, NULL FROM public.small_groups;

INSERT INTO public.group_members (id, group_id, member_id)
SELECT id, ministry_id, member_id FROM public.ministry_members;

INSERT INTO public.group_members (id, group_id, member_id)
SELECT id, small_group_id, member_id FROM public.small_group_members;

DO $$
DECLARE
  b RECORD;
BEGIN
  SELECT * INTO b FROM unsplit_before;

  IF (SELECT count(*) FROM public.groups) <> b.ministries + b.small_groups THEN
    RAISE EXCEPTION '0026 rollback aborted: group row count does not match.';
  END IF;

  IF (SELECT count(*) FROM public.group_members) <> b.ministry_members + b.small_group_members THEN
    RAISE EXCEPTION '0026 rollback aborted: membership row count does not match.';
  END IF;
END
$$;

-- ---- 3. small_group_leaders back onto groups ----------------------------
ALTER TABLE public.small_group_leaders
  DROP CONSTRAINT small_group_leaders_group_id_fkey,
  ADD CONSTRAINT small_group_leaders_group_id_fkey
    FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE CASCADE;

COMMENT ON COLUMN public.small_group_leaders.group_id IS NULL;

CREATE OR REPLACE FUNCTION public.small_group_leaders_require_small_group()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.groups AS g
    WHERE g.id = NEW.group_id AND g.type = 'Small Group'
  ) THEN
    RAISE EXCEPTION 'only a small group can have a leader' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER small_group_leaders_require_small_group
BEFORE INSERT OR UPDATE ON public.small_group_leaders
FOR EACH ROW EXECUTE FUNCTION public.small_group_leaders_require_small_group();

-- ---- 4. The leader-removal guard, back on group_members ----------------
CREATE OR REPLACE FUNCTION public.group_members_block_leader_removal()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.small_group_leaders AS sgl
    JOIN public.user_accounts       AS ua ON ua.id = sgl.account_id
    WHERE sgl.group_id = OLD.group_id
      AND ua.member_id = OLD.member_id
  ) THEN
    RAISE EXCEPTION 'that person leads this group — unassign them as leader first'
      USING ERRCODE = '23503';
  END IF;
  RETURN NULL;
END
$$;

REVOKE ALL ON FUNCTION public.group_members_block_leader_removal() FROM PUBLIC;

CREATE CONSTRAINT TRIGGER group_members_block_leader_removal
AFTER DELETE ON public.group_members
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.group_members_block_leader_removal();

-- ---- 5. Predicate functions, back onto groups ---------------------------
CREATE OR REPLACE FUNCTION public.is_group_available_to_my_church(candidate_group_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
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

CREATE OR REPLACE FUNCTION public.group_accepts_member(p_group_id uuid, p_member_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.groups AS g
    JOIN public.members AS m ON m.id = p_member_id
    WHERE g.id = p_group_id
      AND m.archived_at IS NULL
      AND (
        (g.type = 'Ministry'    AND g.church_id IS NULL)
        OR (g.type = 'Small Group' AND g.church_id = m.member_of)
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.is_finance_group(p_group_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.groups AS g
    WHERE g.id = p_group_id
      AND g.ministry_key = 'finance'
      AND g.type = 'Ministry'
      AND g.church_id IS NULL
  )
$$;

CREATE OR REPLACE FUNCTION public.is_in_ministry(p_key text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_accounts AS ua
    JOIN public.group_members AS gm ON gm.member_id = ua.member_id
    JOIN public.groups        AS g  ON g.id = gm.group_id
    WHERE ua.id = auth.uid()
      AND g.ministry_key = p_key
      AND g.type = 'Ministry'
      AND g.church_id IS NULL
  )
$$;

CREATE OR REPLACE FUNCTION public.can_assign_small_group_leader(p_group_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.is_super_admin()
      OR public.is_head_pastor()
      OR (
        public.is_pastor()
        AND EXISTS (
          SELECT 1 FROM public.groups AS g
          WHERE g.id = p_group_id
            AND g.type = 'Small Group'
            AND g.church_id = public.get_my_church_id()
        )
      )
$$;

CREATE OR REPLACE FUNCTION public.assign_small_group_leader(p_account uuid, p_group uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_member uuid;
BEGIN
  IF NOT public.can_assign_small_group_leader(p_group) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT member_id INTO v_member FROM public.user_accounts WHERE id = p_account;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such account' USING ERRCODE = '23503';
  END IF;

  IF v_member IS NULL THEN
    RAISE EXCEPTION 'that account is not linked to a member record yet'
      USING ERRCODE = '23503';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.group_members AS gm
    WHERE gm.group_id = p_group AND gm.member_id = v_member
  ) THEN
    RAISE EXCEPTION 'a leader must already be a member of the group'
      USING ERRCODE = '23503';
  END IF;

  INSERT INTO public.small_group_leaders (account_id, group_id, assigned_by)
  VALUES (p_account, p_group, auth.uid())
  ON CONFLICT (account_id, group_id) DO NOTHING;
END
$$;

CREATE OR REPLACE FUNCTION public.directory_search(
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
    coalesce(array_agg(DISTINCT g.name) FILTER (WHERE g.type = 'Ministry'), '{}') AS ministries,
    coalesce(array_agg(DISTINCT g.name) FILTER (WHERE g.type = 'Small Group'), '{}') AS small_groups
  FROM public.members AS m
  CROSS JOIN scope AS s
  LEFT JOIN public.group_members AS gm ON gm.member_id = m.id
  LEFT JOIN public.groups        AS g  ON g.id = gm.group_id
  WHERE m.archived_at IS NULL
    AND (s.is_global OR m.member_of = s.my_church)
    AND (p_church_id IS NULL OR m.member_of = p_church_id)
    AND (
      p_query IS NULL
      OR (m.first_name || ' ' || m.last_name) ILIKE '%' || p_query || '%'
    )
  GROUP BY m.id, m.first_name, m.last_name, m.member_of
  ORDER BY m.last_name, m.first_name
  LIMIT greatest(1, least(coalesce(p_limit, 200), 1000))
$$;

-- ---- 6. RLS and grants, as 0006/0009/0014/0017 left them ---------------
ALTER TABLE public.groups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY groups_select_visible ON public.groups
FOR SELECT TO authenticated
USING (
  public.is_super_admin() OR public.is_head_pastor()
  OR (
    public.get_my_church_id() IS NOT NULL
    AND (
      (type = 'Ministry' AND church_id IS NULL)
      OR (type = 'Small Group' AND church_id = public.get_my_church_id())
    )
  )
);

CREATE POLICY groups_insert_own_small_group ON public.groups
FOR INSERT TO authenticated
WITH CHECK (type = 'Small Group' AND public.can_write_church(church_id) AND public.can_manage_small_groups());

CREATE POLICY groups_update_own_small_group ON public.groups
FOR UPDATE TO authenticated
USING      (type = 'Small Group' AND public.can_write_church(church_id) AND public.can_manage_small_groups())
WITH CHECK (type = 'Small Group' AND public.can_write_church(church_id) AND public.can_manage_small_groups());

CREATE POLICY groups_delete_own_small_group ON public.groups
FOR DELETE TO authenticated
USING (type = 'Small Group' AND public.can_write_church(church_id) AND public.can_manage_small_groups());

CREATE POLICY group_members_select_own_church ON public.group_members
FOR SELECT TO authenticated
USING (
  public.is_super_admin() OR public.is_head_pastor()
  OR (public.is_member_in_my_church(member_id) AND public.is_group_available_to_my_church(group_id))
);

CREATE POLICY group_members_insert_own_church ON public.group_members
FOR INSERT TO authenticated
WITH CHECK (
  public.can_manage_group_members(group_id)
  AND (
    (public.is_super_admin() AND public.group_accepts_member(group_id, member_id))
    OR (public.is_member_in_my_church(member_id) AND public.is_group_available_to_my_church(group_id))
  )
);

CREATE POLICY group_members_delete_own_church ON public.group_members
FOR DELETE TO authenticated
USING (
  public.can_manage_group_members(group_id)
  AND (
    public.is_super_admin()
    OR (public.is_member_in_my_church(member_id) AND public.is_group_available_to_my_church(group_id))
  )
);

REVOKE ALL ON TABLE public.groups        FROM anon, authenticated;
REVOKE ALL ON TABLE public.group_members FROM anon, authenticated;

GRANT SELECT                            ON TABLE public.groups TO authenticated;
GRANT INSERT (name, type, church_id)    ON TABLE public.groups TO authenticated;
GRANT UPDATE (name)                     ON TABLE public.groups TO authenticated;
GRANT DELETE                            ON TABLE public.groups TO authenticated;

GRANT SELECT                            ON TABLE public.group_members TO authenticated;
GRANT INSERT (group_id, member_id)      ON TABLE public.group_members TO authenticated;
GRANT DELETE                            ON TABLE public.group_members TO authenticated;

-- ---- 7. Drop the split tables ------------------------------------------
DROP TRIGGER IF EXISTS small_group_members_block_leader_removal ON public.small_group_members;
DROP FUNCTION IF EXISTS public.small_group_members_block_leader_removal();

DROP TABLE public.ministry_members;
DROP TABLE public.small_group_members;
DROP TABLE public.ministries;
DROP TABLE public.small_groups;

COMMIT;

-- NOTIFY pgrst, 'reload schema';

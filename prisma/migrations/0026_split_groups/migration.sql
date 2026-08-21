-- Split `groups` into `ministries` + `small_groups`, and `group_members` into
-- `ministry_members` + `small_group_members`. Issue #74.
--
-- ============================================================================
-- WHY THERE IS NO COMPATIBILITY VIEW, WHICH IS WHAT #74 ASKED FOR
-- ============================================================================
-- The spec's central decision was a pair of `security_invoker` union views named
-- `groups` and `group_members`, so that no application code had to change. That
-- design was tried and it does not work. PostgREST resolves resource embedding
-- through foreign keys, and a UNION view participates in none, so every embed the
-- app depends on fails with PGRST200:
--
--   group_members?select=...,members!inner(...)          the card grid, the roster
--   members?select=...,group_members(groups(id,name,type))  the members table
--
-- Direct SQL against those same views works perfectly, which is why the finding is
-- recorded in tests/db/postgrest-contract.test.js rather than in a SQL suite — the
-- mocked vitest suites cannot see it either. See that file's header.
--
-- So this migration does the split for real: the policies, the predicate functions
-- and the application queries are all re-pointed at the new tables. That is the
-- alternative #74 weighed and rejected as too risky; the risk is real, and the
-- mitigation is the per-role database test suite that now exists (tests/db), which
-- did not when the spec was written. Every permission below was read off the live
-- database rather than reconstructed from the migration history.
--
-- ============================================================================
-- WHAT BECOMES STRUCTURAL
-- ============================================================================
--   groups_type_church_check            deleted. Two tables encode it.
--   groups_global_ministry_name_ci_key  a plain unique index on lower(ministries.name).
--   groups_small_group_church_name_ci_key  a plain unique index per church.
--   groups_church_type_idx              meaningless; each table is one type.
--   small_group_leaders_require_small_group  deleted. The foreign key now says it.
--
-- The last one is the payoff #74 predicted: "a leader cannot lead a ministry" was a
-- trigger with a subquery, because the old schema could not state it. It is now a
-- foreign key to a table that contains only small groups.
--
-- ============================================================================
-- ROW COUNTS AT AUTHORING TIME (staging)
-- ============================================================================
--   groups 28 = 15 Ministry + 13 Small Group,  3 carrying ministry_key
--   group_members 351,  small_group_leaders 0
--   Integrity probes all clean: no ministry with a church, no small group without
--   one, no unknown type, no orphan membership, no leader of a ministry.
-- The assertions below do not hardcode these; they compare before and after.

BEGIN;

-- Both tables are read by every predicate function, so nothing may move underneath
-- this migration while it runs. Same posture as 0005.
LOCK TABLE public.groups, public.group_members, public.small_group_leaders
  IN ACCESS EXCLUSIVE MODE;

-- Remember what we started with. A temp table rather than variables, because the
-- assertions run near the end and this transaction drops the source tables first.
CREATE TEMP TABLE split_before ON COMMIT DROP AS
SELECT
  (SELECT count(*) FROM public.groups WHERE type = 'Ministry')    AS ministries,
  (SELECT count(*) FROM public.groups WHERE type = 'Small Group') AS small_groups,
  (SELECT count(*) FROM public.groups)                            AS groups_all,
  (SELECT count(*) FROM public.group_members)                     AS memberships,
  (SELECT count(*) FROM public.small_group_leaders)               AS leaders;

-- Refuse to run against data the split cannot represent, rather than silently
-- dropping it. A ministry with a church or a small group without one would vanish
-- in the copy below; the old CHECK should make both impossible, so this is a guard
-- against the CHECK having been dropped, not against normal data.
DO $$
DECLARE
  bad_ministry   BIGINT;
  bad_smallgroup BIGINT;
  bad_type       BIGINT;
BEGIN
  SELECT count(*) INTO bad_ministry
    FROM public.groups WHERE type = 'Ministry' AND church_id IS NOT NULL;
  SELECT count(*) INTO bad_smallgroup
    FROM public.groups WHERE type = 'Small Group' AND church_id IS NULL;
  SELECT count(*) INTO bad_type
    FROM public.groups WHERE type NOT IN ('Ministry', 'Small Group');

  IF bad_ministry > 0 OR bad_smallgroup > 0 OR bad_type > 0 THEN
    RAISE EXCEPTION USING
      MESSAGE = format(
        '0026 aborted: %s ministries carry a church, %s small groups carry none, %s rows have an unknown type.',
        bad_ministry, bad_smallgroup, bad_type
      ),
      HINT = 'These rows cannot be represented by the split. Fix them and retry; no rows were changed.';
  END IF;
END
$$;

-- ============================================================================
-- 1. The four real tables
-- ============================================================================

-- Global. No church_id column at all, so a ministry cannot be church-scoped by
-- accident — which is the whole point of the split.
CREATE TABLE public.ministries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         varchar NOT NULL,
  -- The immutable authz slug: finance | secretariat | welcome. Lives here because it
  -- is meaningful only on a ministry. Keyed on rather than name so a rename cannot
  -- grant or revoke access — defect D4, and it stays closed.
  ministry_key text
);

COMMENT ON TABLE public.ministries IS
  'Church-wide ministries. Global by construction: there is no church_id. Split out of `groups` by 0026 (#74).';

-- Church-scoped. church_id is NOT NULL, so a small group cannot be global by accident.
CREATE TABLE public.small_groups (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name      varchar NOT NULL,
  church_id uuid NOT NULL REFERENCES public.churches(id) ON DELETE CASCADE
);

COMMENT ON TABLE public.small_groups IS
  'Small groups, each belonging to exactly one church. Split out of `groups` by 0026 (#74).';

-- The membership tables each get a real foreign key to their own parent, so an
-- orphaned membership row cannot exist. The old group_members carried a
-- gen_random_uuid() DEFAULT on member_id and group_id — nonsense inherited from the
-- baseline, since a random uuid would fail the foreign key anyway. Not reproduced.
CREATE TABLE public.ministry_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ministry_id uuid NOT NULL REFERENCES public.ministries(id) ON UPDATE CASCADE ON DELETE CASCADE,
  member_id   uuid NOT NULL REFERENCES public.members(id)    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT ministry_members_ministry_id_member_id_key UNIQUE (ministry_id, member_id)
);

CREATE TABLE public.small_group_members (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  small_group_id uuid NOT NULL REFERENCES public.small_groups(id) ON UPDATE CASCADE ON DELETE CASCADE,
  member_id      uuid NOT NULL REFERENCES public.members(id)      ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT small_group_members_group_id_member_id_key UNIQUE (small_group_id, member_id)
);

-- One plain unique index per table replaces the two partial ones.
CREATE UNIQUE INDEX ministries_name_ci_key
  ON public.ministries (lower(name::text));

CREATE UNIQUE INDEX ministries_ministry_key_key
  ON public.ministries (ministry_key) WHERE ministry_key IS NOT NULL;

CREATE UNIQUE INDEX small_groups_church_name_ci_key
  ON public.small_groups (church_id, lower(name::text));

CREATE INDEX small_groups_church_idx        ON public.small_groups (church_id);
CREATE INDEX ministry_members_member_idx    ON public.ministry_members (member_id);
CREATE INDEX small_group_members_member_idx ON public.small_group_members (member_id);

-- ============================================================================
-- 2. Move the rows, preserving every id
-- ============================================================================
-- Ids are preserved so every existing reference and every bookmarked url resolves.

INSERT INTO public.ministries (id, name, ministry_key)
SELECT id, name, ministry_key FROM public.groups WHERE type = 'Ministry';

INSERT INTO public.small_groups (id, name, church_id)
SELECT id, name, church_id FROM public.groups WHERE type = 'Small Group';

INSERT INTO public.ministry_members (id, ministry_id, member_id)
SELECT gm.id, gm.group_id, gm.member_id
FROM public.group_members AS gm
JOIN public.ministries AS m ON m.id = gm.group_id;

INSERT INTO public.small_group_members (id, small_group_id, member_id)
SELECT gm.id, gm.group_id, gm.member_id
FROM public.group_members AS gm
JOIN public.small_groups AS sg ON sg.id = gm.group_id;

-- Nothing may be lost. A mismatch aborts the transaction rather than committing a
-- partial split — this is the assertion that makes the migration safe to run at all.
DO $$
DECLARE
  b RECORD;
  new_groups      BIGINT;
  new_memberships BIGINT;
BEGIN
  SELECT * INTO b FROM split_before;

  SELECT (SELECT count(*) FROM public.ministries) + (SELECT count(*) FROM public.small_groups)
    INTO new_groups;
  SELECT (SELECT count(*) FROM public.ministry_members) + (SELECT count(*) FROM public.small_group_members)
    INTO new_memberships;

  IF new_groups <> b.groups_all THEN
    RAISE EXCEPTION USING MESSAGE = format(
      '0026 aborted: %s groups went in, %s came out (%s ministries + %s small groups expected).',
      b.groups_all, new_groups, b.ministries, b.small_groups);
  END IF;

  IF new_memberships <> b.memberships THEN
    RAISE EXCEPTION USING MESSAGE = format(
      '0026 aborted: %s memberships went in, %s came out.', b.memberships, new_memberships);
  END IF;
END
$$;

-- ============================================================================
-- 3. small_group_leaders: a real foreign key instead of a trigger
-- ============================================================================
-- group_id keeps its name. It could be small_group_id now that it provably points at
-- one, but renaming it reaches into 0022's RPCs and #75's screens, which have already
-- been reviewed. The foreign key is what carries the meaning; the rename is a tidy-up
-- for whoever next touches that table.

ALTER TABLE public.small_group_leaders
  DROP CONSTRAINT small_group_leaders_group_id_fkey,
  ADD CONSTRAINT small_group_leaders_group_id_fkey
    FOREIGN KEY (group_id) REFERENCES public.small_groups(id) ON DELETE CASCADE;

COMMENT ON COLUMN public.small_group_leaders.group_id IS
  'The small group led. References small_groups directly as of 0026, so "a ministry has no leader" is a foreign key rather than a trigger.';

-- Now redundant: the foreign key above cannot be satisfied by a ministry.
DROP TRIGGER IF EXISTS small_group_leaders_require_small_group ON public.small_group_leaders;
DROP FUNCTION IF EXISTS public.small_group_leaders_require_small_group();

-- ============================================================================
-- 4. Drop the old tables
-- ============================================================================
-- CASCADE would take the small_group_leaders foreign key with it, which is why that
-- was re-pointed above first. No view depends on either table (verified against the
-- live catalog), so a plain DROP is correct and will fail loudly if that ever changes.

DROP TRIGGER IF EXISTS group_members_block_leader_removal ON public.group_members;
DROP TABLE public.group_members;
DROP TABLE public.groups;

-- ============================================================================
-- 5. The leader-removal guard, re-pointed
-- ============================================================================
-- Only small groups have leaders, so this now belongs on small_group_members alone —
-- a narrowing that changes no behaviour and removes a pointless check on every
-- ministry membership delete.
--
-- STILL DEFERRABLE INITIALLY DEFERRED, and that is load-bearing. Deleting a small
-- group cascades to both its memberships and its leader rows; if this fired
-- immediately it would see the leader row that the same statement is about to remove
-- and refuse to let anyone delete a led group. Deferring to commit means it sees the
-- settled state.
CREATE OR REPLACE FUNCTION public.small_group_members_block_leader_removal()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.small_group_leaders AS sgl
    JOIN public.user_accounts       AS ua ON ua.id = sgl.account_id
    WHERE sgl.group_id = OLD.small_group_id
      AND ua.member_id = OLD.member_id
  ) THEN
    RAISE EXCEPTION 'that person leads this group — unassign them as leader first'
      USING ERRCODE = '23503';
  END IF;
  RETURN NULL;
END
$$;

REVOKE ALL ON FUNCTION public.small_group_members_block_leader_removal() FROM PUBLIC;

CREATE CONSTRAINT TRIGGER small_group_members_block_leader_removal
AFTER DELETE ON public.small_group_members
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.small_group_members_block_leader_removal();

DROP FUNCTION IF EXISTS public.group_members_block_leader_removal();

-- ============================================================================
-- 6. Predicate functions, re-pointed
-- ============================================================================
-- Same names, same signatures, same meanings. Only the tables they read change.
-- Every one is SECURITY DEFINER and keeps `SET search_path` — a definer function
-- without it is a privilege-escalation waiting for a hostile search_path.

-- A ministry is global, so it is available to anybody who has a church at all. A
-- small group is available only to its own church. Same truth as before, now two
-- lookups instead of one union.
CREATE OR REPLACE FUNCTION public.is_group_available_to_my_church(candidate_group_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.get_my_church_id() IS NOT NULL
    AND (
      EXISTS (SELECT 1 FROM public.ministries AS m WHERE m.id = candidate_group_id)
      OR EXISTS (
        SELECT 1 FROM public.small_groups AS sg
        WHERE sg.id = candidate_group_id
          AND sg.church_id = public.get_my_church_id()
      )
    )
$$;

-- A ministry accepts a member from any church; a small group only its own. The
-- archived check stays: an archived member joins nothing.
CREATE OR REPLACE FUNCTION public.group_accepts_member(p_group_id uuid, p_member_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.members AS m
    WHERE m.id = p_member_id
      AND m.archived_at IS NULL
      AND (
        EXISTS (SELECT 1 FROM public.ministries AS mi WHERE mi.id = p_group_id)
        OR EXISTS (
          SELECT 1 FROM public.small_groups AS sg
          WHERE sg.id = p_group_id AND sg.church_id = m.member_of
        )
      )
  )
$$;

-- Stricter than before by construction: a small group can no longer be mistaken for
-- the Finance ministry even in principle, because it is not in this table.
CREATE OR REPLACE FUNCTION public.is_finance_group(p_group_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.ministries AS m
    WHERE m.id = p_group_id AND m.ministry_key = 'finance'
  )
$$;

-- Keys on ministry_key, never on name. D4 stays closed.
CREATE OR REPLACE FUNCTION public.is_in_ministry(p_key text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_accounts   AS ua
    JOIN public.ministry_members AS mm ON mm.member_id = ua.member_id
    JOIN public.ministries       AS mi ON mi.id = mm.ministry_id
    WHERE ua.id = auth.uid()
      AND mi.ministry_key = p_key
  )
$$;

-- Now reads small_groups, so "is this a small group in my church" is one lookup with
-- no type column to trust.
CREATE OR REPLACE FUNCTION public.can_assign_small_group_leader(p_group_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.is_super_admin()
      OR public.is_head_pastor()
      OR (
        public.is_pastor()
        AND EXISTS (
          SELECT 1 FROM public.small_groups AS sg
          WHERE sg.id = p_group_id
            AND sg.church_id = public.get_my_church_id()
        )
      )
$$;

-- The membership check moves to small_group_members. A leader must already be in the
-- group, and only a small group can have one — the latter is now also enforced by the
-- foreign key on the INSERT below, so this function is belt to that braces.
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

  -- An account with no member record has no church and no place in any roster, so it
  -- cannot lead. This is the dependency that makes linking the first slice.
  IF v_member IS NULL THEN
    RAISE EXCEPTION 'that account is not linked to a member record yet'
      USING ERRCODE = '23503';
  END IF;

  -- ORDER MATTERS, AND THIS GUARD MUST COME FIRST. The foreign key below already
  -- makes leading a ministry impossible, but reaching it by way of the membership
  -- check would report 'a leader must already be a member of the group' about a
  -- person who genuinely is a member of that ministry — a true sentence that
  -- describes the wrong problem. The kind of group is the actual objection, so it
  -- is the one raised. This message is rendered to the user by the pastor
  -- assignment screen, so it has to be the honest one.
  IF NOT EXISTS (SELECT 1 FROM public.small_groups WHERE id = p_group) THEN
    RAISE EXCEPTION 'only a small group can have a leader'
      USING ERRCODE = '23503';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.small_group_members AS sgm
    WHERE sgm.small_group_id = p_group AND sgm.member_id = v_member
  ) THEN
    RAISE EXCEPTION 'a leader must already be a member of the group'
      USING ERRCODE = '23503';
  END IF;

  INSERT INTO public.small_group_leaders (account_id, group_id, assigned_by)
  VALUES (p_account, p_group, auth.uid())
  ON CONFLICT (account_id, group_id) DO NOTHING;
END
$$;

-- Two aggregates over two tables instead of one FILTERed aggregate over a union. The
-- subqueries are correlated per member rather than joined, so a member in six groups
-- no longer multiplies rows before the array_agg de-duplicates them.
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
    -- Cast to text explicitly. `name` is varchar, the declared return column is
    -- text[], and relying on Postgres to coerce varchar[] to text[] in a function
    -- result is how you get "structure of query does not match function result type"
    -- at call time rather than at CREATE time.
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

-- ============================================================================
-- 7. RLS
-- ============================================================================
-- Enabled on all four tables. Supabase leaves RLS off on a new table, so forgetting
-- one of these lines would expose member PII to every signed-in user — this is the
-- single most consequential block in the file.

ALTER TABLE public.ministries          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.small_groups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ministry_members    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.small_group_members ENABLE ROW LEVEL SECURITY;

-- ---- ministries: readable, never client-writable -------------------------
-- The old policies allowed INSERT/UPDATE/DELETE only where type = 'Small Group', so
-- no client could ever write a ministry row. That absence is reproduced as an absence
-- of policies, and reinforced by withholding the grants in section 8.
CREATE POLICY ministries_select_visible ON public.ministries
FOR SELECT TO authenticated
USING (
  public.is_super_admin()
  OR public.is_head_pastor()
  OR public.get_my_church_id() IS NOT NULL
);

-- ---- small_groups --------------------------------------------------------
CREATE POLICY small_groups_select_visible ON public.small_groups
FOR SELECT TO authenticated
USING (
  public.is_super_admin()
  OR public.is_head_pastor()
  OR (public.get_my_church_id() IS NOT NULL AND church_id = public.get_my_church_id())
);

CREATE POLICY small_groups_insert_own ON public.small_groups
FOR INSERT TO authenticated
WITH CHECK (public.can_write_church(church_id) AND public.can_manage_small_groups());

CREATE POLICY small_groups_update_own ON public.small_groups
FOR UPDATE TO authenticated
USING      (public.can_write_church(church_id) AND public.can_manage_small_groups())
WITH CHECK (public.can_write_church(church_id) AND public.can_manage_small_groups());

CREATE POLICY small_groups_delete_own ON public.small_groups
FOR DELETE TO authenticated
USING (public.can_write_church(church_id) AND public.can_manage_small_groups());

-- ---- ministry_members ----------------------------------------------------
-- The old group_members policies are reproduced branch for branch. A ministry is
-- always "available to my church" provided I have one, so that half of
-- is_group_available_to_my_church() collapses to the church check.
CREATE POLICY ministry_members_select_own_church ON public.ministry_members
FOR SELECT TO authenticated
USING (
  public.is_super_admin()
  OR public.is_head_pastor()
  OR (public.is_member_in_my_church(member_id) AND public.get_my_church_id() IS NOT NULL)
);

CREATE POLICY ministry_members_insert_own_church ON public.ministry_members
FOR INSERT TO authenticated
WITH CHECK (
  public.can_manage_group_members(ministry_id)
  AND (
    (public.is_super_admin() AND public.group_accepts_member(ministry_id, member_id))
    OR (public.is_member_in_my_church(member_id) AND public.get_my_church_id() IS NOT NULL)
  )
);

CREATE POLICY ministry_members_delete_own_church ON public.ministry_members
FOR DELETE TO authenticated
USING (
  public.can_manage_group_members(ministry_id)
  AND (
    public.is_super_admin()
    OR (public.is_member_in_my_church(member_id) AND public.get_my_church_id() IS NOT NULL)
  )
);

-- ---- small_group_members ------------------------------------------------
CREATE POLICY small_group_members_select_own_church ON public.small_group_members
FOR SELECT TO authenticated
USING (
  public.is_super_admin()
  OR public.is_head_pastor()
  OR (
    public.is_member_in_my_church(member_id)
    AND public.is_group_available_to_my_church(small_group_id)
  )
);

CREATE POLICY small_group_members_insert_own_church ON public.small_group_members
FOR INSERT TO authenticated
WITH CHECK (
  public.can_manage_group_members(small_group_id)
  AND (
    (public.is_super_admin() AND public.group_accepts_member(small_group_id, member_id))
    OR (
      public.is_member_in_my_church(member_id)
      AND public.is_group_available_to_my_church(small_group_id)
    )
  )
);

CREATE POLICY small_group_members_delete_own_church ON public.small_group_members
FOR DELETE TO authenticated
USING (
  public.can_manage_group_members(small_group_id)
  AND (
    public.is_super_admin()
    OR (
      public.is_member_in_my_church(member_id)
      AND public.is_group_available_to_my_church(small_group_id)
    )
  )
);

-- ============================================================================
-- 8. Grants
-- ============================================================================
-- REVOKE FIRST, AND THIS IS NOT DEFENSIVE PADDING. Supabase ships ALTER DEFAULT
-- PRIVILEGES granting anon, authenticated and service_role full access to every new
-- table in `public`. A CREATE TABLE here is therefore world-writable to any signed-in
-- user the instant it exists, and RLS only filters rows for roles that hold a grant.
-- 0009 exists because this project has already been bitten by an inherited default.
REVOKE ALL ON TABLE public.ministries          FROM anon, authenticated;
REVOKE ALL ON TABLE public.small_groups        FROM anon, authenticated;
REVOKE ALL ON TABLE public.ministry_members    FROM anon, authenticated;
REVOKE ALL ON TABLE public.small_group_members FROM anon, authenticated;

-- anon gets nothing anywhere. The public surface does not grow.

-- Read-only: no client creates, renames or deletes a ministry.
GRANT SELECT ON TABLE public.ministries TO authenticated;

-- Small groups are client-managed, with the same column narrowing 0005 established:
-- name on insert and update, never a system column. church_id is insertable because
-- the row must name its church; can_write_church() in the policy decides which.
GRANT SELECT                     ON TABLE public.small_groups TO authenticated;
GRANT INSERT (name, church_id)   ON TABLE public.small_groups TO authenticated;
GRANT UPDATE (name)              ON TABLE public.small_groups TO authenticated;
GRANT DELETE                     ON TABLE public.small_groups TO authenticated;

-- Memberships: insert and delete, never update — moving a membership between groups
-- is add-then-remove, each of which is policed. `id` is deliberately NOT insertable,
-- narrower than the old group_members grant: the app sends {group_id, member_id} and
-- has no business choosing a primary key.
GRANT SELECT                          ON TABLE public.ministry_members TO authenticated;
GRANT INSERT (ministry_id, member_id) ON TABLE public.ministry_members TO authenticated;
GRANT DELETE                          ON TABLE public.ministry_members TO authenticated;

GRANT SELECT                             ON TABLE public.small_group_members TO authenticated;
GRANT INSERT (small_group_id, member_id) ON TABLE public.small_group_members TO authenticated;
GRANT DELETE                             ON TABLE public.small_group_members TO authenticated;

COMMIT;

-- ============================================================================
-- AFTER DEPLOY
-- ============================================================================
-- Two tables vanished and four appeared, so PostgREST's cached schema is wrong in
-- both directions and every query against the new names will 404 until:
--   NOTIFY pgrst, 'reload schema';
--
-- DEPLOY ORDER IS THE OPPOSITE OF 0025's. The frontend that reads `groups` cannot
-- work after this migration, and the frontend that reads `ministries` cannot work
-- before it, so there is no safe interleaving: this is a lockstep deploy. Apply the
-- migration, reload the cache, ship the build. Expect a window of seconds where the
-- Groups, Members and Overview pages error for anyone mid-session.
--
-- Then refresh the checked-in Prisma model, per docs/prisma-migration.md:
--   npm run prisma:pull && npm run prisma:generate

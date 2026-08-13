-- ============================================================================
-- 0022_admin_access — Make an account reachable, and introduce the Small Group
-- Leader role.
-- ============================================================================
--
-- WHY
-- handle_new_user() (0006) inserts a user_accounts row carrying an id and nothing
-- else. member_id stays NULL because no code path in the application has ever set
-- it, and role stays 'unassigned'. Every permission in the system hangs off those
-- two columns — get_my_church_id() reads user_accounts.member_id -> members.member_of,
-- and every predicate in 0014 reads user_accounts.role. So a new account signs in,
-- lands on the "Account setup in progress" screen, and stays there permanently. The
-- only person who can change that is the SuperAdmin seeded by 0017, from SQL, by uuid.
--
-- This migration supplies the missing writes, and adds the role the small groups have
-- always lacked. Four parts:
--
--   1. ACCOUNT LINKING. list_accounts() is the only thing in this codebase that reads
--      auth.users, and link_account_to_member() is the only sanctioned way to set
--      user_accounts.member_id. Both are SuperAdmin-only.
--
--   2. PASTOR ASSIGNMENT. set_user_role() (0017) is widened so a Head Pastor may
--      appoint a pastor. Nothing else about it moves.
--
--   3. SMALL GROUP LEADERS. A new table linking an ACCOUNT to a small group —
--      account-targeted, not member-targeted, so the powers follow the login. One
--      person may lead several groups.
--
--   4. WHAT A LEADER MAY SEE. One capability widens: attendance. That is the whole
--      permission footprint of the new role; everything else it does is the app
--      narrowing what it displays, not the database granting anything.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
-- No church_id on user_accounts. A pastor is a member of the church he pastors and
-- the church is derived, exactly as it has been since 0004. Assigning the role writes
-- the role and nothing else. No audit table either — assigned_by/assigned_at on the
-- one new table is the whole of the record-keeping.
--
-- ROLLBACK: see rollback.sql.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. small_group_leaders — the new role's storage.
-- ---------------------------------------------------------------------------
-- ACCOUNT-TARGETED. The row points at user_accounts, not members, because leading is
-- a thing a login does. A member with no account cannot lead, which is correct: there
-- would be nobody to sign in and use the powers.
--
-- The group_id foreign key points at `groups` because that is still one table today.
-- When #74 splits it, this becomes a reference to small_groups and the CHECK below
-- disappears — the type constraint becomes structural, which is one of the reasons
-- the split is worth doing.

CREATE TABLE public.small_group_leaders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES public.user_accounts(id) ON DELETE CASCADE,
  group_id    uuid NOT NULL REFERENCES public.groups(id)        ON DELETE CASCADE,
  -- Who did it and when. 0033 asked for no audit table; these two columns are the
  -- whole of the answer. Not nullable: an assignment always has an author.
  assigned_by uuid NOT NULL REFERENCES public.user_accounts(id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT small_group_leaders_account_group_key UNIQUE (account_id, group_id)
);

CREATE INDEX small_group_leaders_group_idx   ON public.small_group_leaders (group_id);
CREATE INDEX small_group_leaders_account_idx ON public.small_group_leaders (account_id);

COMMENT ON TABLE public.small_group_leaders IS
  'Which login leads which small group. Account-targeted so the powers follow the sign-in. Written only through assign_small_group_leader(); there is no INSERT/UPDATE/DELETE policy.';

-- A ministry has no leader. Enforced by trigger rather than CHECK because the test
-- needs a subquery. Belt and braces: the assign RPC refuses this too, but the table
-- should not be able to hold a nonsense row even if something else writes to it.
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

-- A leader must be in the group they lead. The other half of that rule is that they
-- cannot be removed from the roster while they still lead it — otherwise the roster
-- and the leader line disagree and neither is wrong.
-- DEFERRED, AND THAT IS THE WHOLE DESIGN. As an immediate BEFORE DELETE trigger this
-- would make deleting a led small group impossible: the group's deletion cascades to
-- group_members and to small_group_leaders in an order Postgres does not promise, so
-- the membership rows can reach the trigger while the leader row is still present, and
-- a legitimate delete would fail with a message about unassigning a leader from a group
-- that is being destroyed anyway.
--
-- Deferring the check to commit removes the ordering question entirely. By then either
-- the leader row went with the group — nothing to complain about — or only the
-- membership was removed and the leader row is still there, which is exactly the case
-- this rule exists to catch.
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

CREATE CONSTRAINT TRIGGER group_members_block_leader_removal
AFTER DELETE ON public.group_members
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.group_members_block_leader_removal();

-- RLS: readable alongside the group it belongs to, writable only through the RPCs
-- below. No INSERT/UPDATE/DELETE policy exists, so those are denied to every client
-- outright — the definer functions are the single door.
ALTER TABLE public.small_group_leaders ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.small_group_leaders FROM anon, authenticated;
GRANT SELECT ON TABLE public.small_group_leaders TO authenticated;

CREATE POLICY small_group_leaders_select_visible
ON public.small_group_leaders
FOR SELECT
TO authenticated
USING (
  public.is_super_admin()
  OR public.is_head_pastor()
  OR public.is_group_available_to_my_church(group_id)
);

-- ---------------------------------------------------------------------------
-- 2. The new predicates.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_small_group_leader()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.small_group_leaders AS sgl WHERE sgl.account_id = auth.uid()
  )
$$;

-- The groups this caller leads. The app narrows Members and Attendance to these; it is
-- a convenience for the client, not a permission — the database still returns the whole
-- church and the screen shows less. Keeping the narrowing app-side means the day the
-- rule tightens, it tightens here and no UI changes.
CREATE OR REPLACE FUNCTION public.my_led_group_ids()
RETURNS uuid[]
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT coalesce(array_agg(sgl.group_id), '{}')
  FROM public.small_group_leaders AS sgl
  WHERE sgl.account_id = auth.uid()
$$;

-- Can this caller appoint or remove a leader for this group? SuperAdmin and Head
-- Pastor anywhere; a Pastor only within their own church.
CREATE OR REPLACE FUNCTION public.can_assign_small_group_leader(p_group_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
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

-- ---------------------------------------------------------------------------
-- 3. Attendance widens for the new role. The ONLY capability change here.
-- ---------------------------------------------------------------------------
-- A copy of the Church Leader branch. The leader sees their own group's attendance;
-- the narrowing to their group is done by the screen, per the rule above.

CREATE OR REPLACE FUNCTION public.can_view_attendance()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT public.is_super_admin()
      OR public.is_head_pastor()
      OR public.is_pastor()
      OR public.is_church_leader()
      OR public.is_welcome_team()
      OR public.is_small_group_leader()
$$;

-- ---------------------------------------------------------------------------
-- 4. get_my_permissions() gains the new flag.
-- ---------------------------------------------------------------------------
-- DROP first: CREATE OR REPLACE cannot change a function's return type, and this one
-- gains a column.

DROP FUNCTION IF EXISTS public.get_my_permissions();

CREATE FUNCTION public.get_my_permissions()
RETURNS TABLE (
  role                   text,
  is_super_admin         boolean,
  is_head_pastor         boolean,
  is_pastor              boolean,
  is_church_leader       boolean,
  is_finance             boolean,
  is_secretariat         boolean,
  is_welcome             boolean,
  is_small_group_leader  boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    public.my_role(),
    public.is_super_admin(),
    public.is_head_pastor(),
    public.is_pastor(),
    public.is_church_leader(),
    public.is_finance_member(),
    public.is_secretariat(),
    public.is_welcome_team(),
    public.is_small_group_leader()
$$;

-- ---------------------------------------------------------------------------
-- 5. Account linking — the keystone, and the most sensitive surface here.
-- ---------------------------------------------------------------------------
-- list_accounts() returns every e-mail address in the system. It is the first and only
-- function in this schema that reads auth.users. Gated to SuperAdmin, and it returns
-- ZERO ROWS rather than raising to everyone else, so a probe learns nothing about
-- whether it guessed a real capability.

-- One member, one login. Enforced structurally as well as in the function below,
-- because "the RPC is the only writer" is the kind of thing that stays true right up
-- until it does not. Two accounts pointing at one member record would give two people
-- the same church, the same identity in the audit columns, and the same access.
-- Partial, because an unlinked account is the normal state and there are many of them.
CREATE UNIQUE INDEX user_accounts_member_id_key
  ON public.user_accounts (member_id)
  WHERE member_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.list_accounts()
RETURNS TABLE (
  account_id    uuid,
  email         text,
  signed_up_at  timestamptz,
  provider      text,
  signup_name   text,
  member_id     uuid,
  member_name   text,
  church_id     uuid,
  role          text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    ua.id,
    u.email::text,
    u.created_at,
    coalesce(u.raw_app_meta_data ->> 'provider', 'email')::text,
    nullif(btrim(coalesce(
      u.raw_user_meta_data ->> 'full_name',
      u.raw_user_meta_data ->> 'name',
      ''
    )), '')::text,
    ua.member_id,
    CASE WHEN m.id IS NULL THEN NULL
         ELSE (m.first_name || ' ' || m.last_name)::text END,
    m.member_of,
    ua.role::text
  FROM public.user_accounts AS ua
  JOIN auth.users           AS u ON u.id = ua.id
  LEFT JOIN public.members  AS m ON m.id = ua.member_id
  WHERE public.is_super_admin()
  ORDER BY (ua.member_id IS NOT NULL), u.created_at DESC
$$;

COMMENT ON FUNCTION public.list_accounts() IS
  'Every account with its e-mail address. SuperAdmin only; returns zero rows to everyone else rather than raising. The only reader of auth.users in this schema.';

-- The single sanctioned writer of user_accounts.member_id. Passing NULL unlinks.
CREATE OR REPLACE FUNCTION public.link_account_to_member(p_account uuid, p_member uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.user_accounts WHERE id = p_account) THEN
    RAISE EXCEPTION 'no such account' USING ERRCODE = '23503';
  END IF;

  IF p_member IS NOT NULL THEN
    -- An archived member is not a person who should be gaining access.
    IF NOT EXISTS (
      SELECT 1 FROM public.members WHERE id = p_member AND archived_at IS NULL
    ) THEN
      RAISE EXCEPTION 'no such active member' USING ERRCODE = '23503';
    END IF;

    -- One member, one login. Two accounts pointing at the same member record would
    -- give two people the same church and the same identity in the audit columns.
    IF EXISTS (
      SELECT 1 FROM public.user_accounts
      WHERE member_id = p_member AND id <> p_account
    ) THEN
      RAISE EXCEPTION 'that member is already linked to another account'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  UPDATE public.user_accounts SET member_id = p_member WHERE id = p_account;
END
$$;

-- ---------------------------------------------------------------------------
-- 6. set_user_role — widened for the Head Pastor, and no further.
-- ---------------------------------------------------------------------------
-- A Head Pastor appoints pastors. That is the whole of the widening: two values, and
-- never against an account that already holds a senior role, so the role cannot be
-- used to demote the people who granted it.

CREATE OR REPLACE FUNCTION public.set_user_role(p_target uuid, p_role text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_current text;
BEGIN
  IF p_role NOT IN ('super_admin','head_pastor','pastor','church_leader','member','unassigned') THEN
    RAISE EXCEPTION 'invalid role: %', p_role USING ERRCODE = '22023';
  END IF;

  SELECT role INTO v_current FROM public.user_accounts WHERE id = p_target;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such account' USING ERRCODE = '23503';
  END IF;

  IF public.is_super_admin() THEN
    NULL;                                   -- may set anything, on anyone
  ELSIF public.is_head_pastor() THEN
    IF p_role NOT IN ('pastor', 'member') THEN
      RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
    END IF;
    IF v_current IN ('super_admin', 'head_pastor') THEN
      RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  UPDATE public.user_accounts SET role = p_role WHERE id = p_target;
END
$$;

-- ---------------------------------------------------------------------------
-- 7. Assigning and removing a small group leader.
-- ---------------------------------------------------------------------------

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

CREATE OR REPLACE FUNCTION public.unassign_small_group_leader(p_account uuid, p_group uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.can_assign_small_group_leader(p_group) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.small_group_leaders
  WHERE account_id = p_account AND group_id = p_group;
END
$$;

-- ---------------------------------------------------------------------------
-- 8. Grants. Revoke from PUBLIC and anon explicitly — 0009's lesson is that PUBLIC
-- alone does not remove anon's default EXECUTE — then grant to authenticated only.
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.is_small_group_leader()                      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_led_group_ids()                           FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_assign_small_group_leader(uuid)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_view_attendance()                        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_permissions()                         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_accounts()                              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.link_account_to_member(uuid, uuid)           FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_user_role(uuid, text)                    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.assign_small_group_leader(uuid, uuid)        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.unassign_small_group_leader(uuid, uuid)      FROM PUBLIC, anon;

-- The two trigger functions are invoked by the triggers, never called directly.
REVOKE ALL ON FUNCTION public.small_group_leaders_require_small_group()    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.group_members_block_leader_removal()         FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.is_small_group_leader()                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_led_group_ids()                        TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_assign_small_group_leader(uuid)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_attendance()                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_permissions()                      TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_accounts()                           TO authenticated;
GRANT EXECUTE ON FUNCTION public.link_account_to_member(uuid, uuid)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_role(uuid, text)                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_small_group_leader(uuid, uuid)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.unassign_small_group_leader(uuid, uuid)   TO authenticated;

COMMIT;

-- PostgREST caches the schema. get_my_permissions() changed shape and the rest are new,
-- so they will 404 until the cache is reloaded:  NOTIFY pgrst, 'reload schema';

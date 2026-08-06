-- ============================================================================
-- 0014_rbac_predicates — The RBAC substrate: a stable ministry slug and the
-- role/capability predicates every later policy is built on.
-- ============================================================================
--
-- WHY
-- Until now the system had one effective privilege level: any linked member of a
-- church got near-full access to that church, and none to any other. The only
-- role-like gate was is_finance_member() (0008), and it keys on the mutable
-- display string groups.name = 'Finance Team' — docs/DEFECTS.md D4. This migration
-- introduces two orthogonal role sources and closes D4:
--
--   1. Account role — user_accounts.role: 'super_admin', 'head_pastor', 'pastor',
--      'church_leader', and a restrictive baseline ('unassigned'/'member'). The
--      column has existed since 0001 but was read by nothing; it becomes live here.
--   2. Ministry role — membership of a global system Ministry, matched on a NEW
--      stable slug groups.ministry_key ('finance', 'secretariat', 'welcome') rather
--      than on the display name. Renaming a ministry in the UI can no longer grant
--      or revoke access.
--
-- Effective permission is the union of what the account role grants and what each
-- ministry grants. The default for every role/ministry not named here is
-- restrictive (fail closed).
--
-- THE ROLE MODEL (confirmed with the owner):
--   * SuperAdmin  — all churches, all operations.
--   * Head Pastor — all churches, READ-ONLY. Sees finance, attendance, and the
--                   name/group directory across churches, but NOT member PII detail.
--   * Pastor      — own church, SEE-ONLY. Its one write power is managing Finance-
--                   ministry membership. Everything else (member CRUD, finance,
--                   attendance) is governed by the ministries below.
--   * Church Leader — own church; operates on ministry/small-group membership and
--                   small-group rows, EXCEPT the Finance ministry (Pastor-only).
--   * Secretariat ministry — member-record CRUD + PII detail.
--   * Finance ministry     — all finance-ledger operations.
--   * Welcome Team ministry — attendance management.
--
-- WHAT THIS MIGRATION DOES NOT DO
--   It defines predicates only. It changes no table's policies — 0015/0016/0017
--   apply these predicates to members, funds, attendance, and group membership.
--   Deploying 0014 alone is inert and safe: nothing calls these functions yet.
--
-- PATTERN
--   Every predicate mirrors is_finance_member() (0008): SECURITY DEFINER, STABLE,
--   SET search_path = public, so policy evaluation does not recurse through the
--   RLS-protected tables (user_accounts, members, groups, group_members) it reads.
--   Each is revoked from PUBLIC and anon and granted to authenticated only.
--
-- ROLLBACK: see rollback.sql. It restores is_finance_member() to its 0008 name-
-- based body and drops everything else; seeded ministry rows are left in place.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. groups.ministry_key — the stable authorization slug (closes D4).
-- ---------------------------------------------------------------------------
-- Nullable and set only on the three global system Ministry rows. It is NOT added
-- to the authenticated INSERT/UPDATE column grants on groups (0005), so no client
-- can set or change it — it is system-managed, which is the whole point of keying
-- authorization on it rather than on the editable name.

ALTER TABLE public.groups ADD COLUMN ministry_key text;

COMMENT ON COLUMN public.groups.ministry_key IS
  'Stable slug for the system ministries authorization keys on (finance/secretariat/welcome). System-managed: absent from the authenticated column grants. Keyed on instead of name so a rename cannot grant/revoke access — D4.';

-- Adopt the existing 'Finance Team' ministry as the canonical finance ministry.
UPDATE public.groups
   SET ministry_key = 'finance'
 WHERE type = 'Ministry' AND church_id IS NULL AND lower(name) = 'finance team'
   AND ministry_key IS DISTINCT FROM 'finance';

-- Seed the two ministries that do not exist yet. Idempotent: inserts only when a
-- global ministry of that name is absent. color_slot is assigned by the 0005
-- BEFORE INSERT trigger, so it is deliberately not supplied here.
INSERT INTO public.groups (name, type, ministry_key)
SELECT v.name, 'Ministry', v.key
FROM (VALUES ('Secretariat', 'secretariat'), ('Welcome Team', 'welcome')) AS v(name, key)
WHERE NOT EXISTS (
  SELECT 1 FROM public.groups g
  WHERE g.type = 'Ministry' AND g.church_id IS NULL AND lower(g.name) = lower(v.name)
);

-- If those rows already existed (created out-of-band) they may lack the slug; set it.
UPDATE public.groups
   SET ministry_key = CASE lower(name)
                        WHEN 'secretariat'  THEN 'secretariat'
                        WHEN 'welcome team' THEN 'welcome'
                      END
 WHERE type = 'Ministry' AND church_id IS NULL
   AND lower(name) IN ('secretariat', 'welcome team')
   AND ministry_key IS NULL;

-- One row per slug, globally. Partial so every small group (ministry_key NULL)
-- is exempt. Created after the backfill so any accidental duplicate surfaces here.
CREATE UNIQUE INDEX groups_ministry_key_key
  ON public.groups (ministry_key)
  WHERE ministry_key IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Account-role predicates.
-- ---------------------------------------------------------------------------
-- my_role() is the single reader of user_accounts.role; the four booleans wrap it.
-- IS NOT DISTINCT FROM (not =) so a NULL role yields false, never NULL.

CREATE OR REPLACE FUNCTION public.my_role()
RETURNS text
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT ua.role FROM public.user_accounts AS ua WHERE ua.id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$ SELECT public.my_role() IS NOT DISTINCT FROM 'super_admin' $$;

CREATE OR REPLACE FUNCTION public.is_head_pastor()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$ SELECT public.my_role() IS NOT DISTINCT FROM 'head_pastor' $$;

CREATE OR REPLACE FUNCTION public.is_pastor()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$ SELECT public.my_role() IS NOT DISTINCT FROM 'pastor' $$;

CREATE OR REPLACE FUNCTION public.is_church_leader()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$ SELECT public.my_role() IS NOT DISTINCT FROM 'church_leader' $$;

-- ---------------------------------------------------------------------------
-- 3. Ministry-role predicates (keyed on ministry_key, not name).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_in_ministry(p_key text)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
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

-- Redefined from its 0008 name-based body onto the slug. Signature is unchanged,
-- so the existing collections/expenses policies that call it keep working, now
-- keyed on the immutable slug. is_secretariat/is_welcome_team follow the same shape.
CREATE OR REPLACE FUNCTION public.is_finance_member()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$ SELECT public.is_in_ministry('finance') $$;

CREATE OR REPLACE FUNCTION public.is_secretariat()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$ SELECT public.is_in_ministry('secretariat') $$;

CREATE OR REPLACE FUNCTION public.is_welcome_team()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$ SELECT public.is_in_ministry('welcome') $$;

-- Is a given group THE finance ministry? Used by can_manage_group_members to make
-- Finance-ministry membership Pastor-only.
CREATE OR REPLACE FUNCTION public.is_finance_group(p_group_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.groups AS g
    WHERE g.id = p_group_id
      AND g.ministry_key = 'finance'
      AND g.type = 'Ministry'
      AND g.church_id IS NULL
  )
$$;

-- ---------------------------------------------------------------------------
-- 4. Cross-church scoping — the axis the single-church model lacked.
-- ---------------------------------------------------------------------------
-- SuperAdmin and Head Pastor are not bound to one church. Everyone else is scoped
-- to get_my_church_id() (0004). Head Pastor can read anywhere but never writes,
-- so it appears in can_read_church and not in can_write_church.

CREATE OR REPLACE FUNCTION public.can_read_church(p_church_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT public.is_super_admin()
      OR public.is_head_pastor()
      OR coalesce(p_church_id = public.get_my_church_id(), false)
$$;

CREATE OR REPLACE FUNCTION public.can_write_church(p_church_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT public.is_super_admin()
      OR coalesce(p_church_id = public.get_my_church_id(), false)
$$;

-- ---------------------------------------------------------------------------
-- 5. Capability composites — the union rules, centralized so policies stay flat.
-- ---------------------------------------------------------------------------
-- VIEW capabilities: Pastor and Church Leader are full viewers. Head Pastor is a
-- cross-church viewer of finance and attendance, but is deliberately EXCLUDED from
-- member detail — it sees only the name/group directory (0015).

CREATE OR REPLACE FUNCTION public.can_see_member_detail()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT public.is_super_admin()
      OR public.is_pastor()
      OR public.is_church_leader()
      OR public.is_secretariat()
$$;

CREATE OR REPLACE FUNCTION public.can_view_finance()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT public.is_super_admin()
      OR public.is_head_pastor()
      OR public.is_pastor()
      OR public.is_church_leader()
      OR public.is_finance_member()
$$;

CREATE OR REPLACE FUNCTION public.can_view_attendance()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT public.is_super_admin()
      OR public.is_head_pastor()
      OR public.is_pastor()
      OR public.is_church_leader()
      OR public.is_welcome_team()
$$;

-- WRITE capabilities: ministry-governed (+ SuperAdmin). Pastor/Church Leader do NOT
-- write member records, finance, or attendance — that is the confirmed model.

CREATE OR REPLACE FUNCTION public.can_write_members()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$ SELECT public.is_super_admin() OR public.is_secretariat() $$;

CREATE OR REPLACE FUNCTION public.can_write_finance()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$ SELECT public.is_super_admin() OR public.is_finance_member() $$;

CREATE OR REPLACE FUNCTION public.can_manage_attendance()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$ SELECT public.is_super_admin() OR public.is_welcome_team() $$;

-- Membership management: Church Leader operates everywhere EXCEPT the Finance
-- ministry, which is Pastor-only. SuperAdmin does all.
CREATE OR REPLACE FUNCTION public.can_manage_group_members(p_group_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT public.is_super_admin()
      OR (public.is_finance_group(p_group_id) AND public.is_pastor())
      OR ((NOT public.is_finance_group(p_group_id)) AND public.is_church_leader())
$$;

-- Creating/editing/deleting small-group rows (ministries stay admin-managed).
CREATE OR REPLACE FUNCTION public.can_manage_small_groups()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$ SELECT public.is_super_admin() OR public.is_church_leader() $$;

-- ---------------------------------------------------------------------------
-- 6. Grants. Revoke from PUBLIC and anon explicitly (0009's lesson: PUBLIC alone
-- does not remove anon's default EXECUTE), grant to authenticated only.
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.my_role()                         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_super_admin()                  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_head_pastor()                  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_pastor()                       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_church_leader()                FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_in_ministry(text)              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_secretariat()                  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_welcome_team()                 FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_finance_group(uuid)            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_read_church(uuid)             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_write_church(uuid)            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_see_member_detail()           FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_view_finance()                FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_view_attendance()             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_write_members()               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_write_finance()               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_manage_attendance()           FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_manage_group_members(uuid)    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_manage_small_groups()         FROM PUBLIC, anon;
-- is_finance_member() keeps its 0008 grant (authenticated); re-assert to be safe.
REVOKE ALL ON FUNCTION public.is_finance_member()               FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.my_role()                      TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin()               TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_head_pastor()               TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_pastor()                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_church_leader()             TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_in_ministry(text)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_finance_member()            TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_secretariat()               TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_welcome_team()              TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_finance_group(uuid)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_church(uuid)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_write_church(uuid)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_see_member_detail()        TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_finance()             TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_attendance()          TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_write_members()            TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_write_finance()            TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_attendance()        TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_group_members(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_small_groups()      TO authenticated;

COMMIT;

-- PostgREST caches the schema; Supabase reloads it after DDL. If the new column or
-- functions 404 right after deploy, run:  NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- 0006_baseline_rls — Baseline of the previously untracked security surface.
-- ============================================================================
--
-- WHAT THIS IS
-- 0001_baseline was produced by `prisma migrate diff --from-empty` and captures
-- structure only: it contains no GRANT, no REVOKE, no CREATE FUNCTION, and no
-- policy. Policies for `members`, `churches`, `user_accounts` and `collections`,
-- the `get_my_church()` RPC that four views depend on, and the auth-linking and
-- RLS-auto-enable helpers therefore existed ONLY as hand-applied state in the
-- Supabase dashboard. This migration transcribes that live state into source
-- control so future policy changes are reviewable diffs.
--
-- Captured with scripts/sql/capture-security-state.sql.
--
-- HOW THIS WAS APPLIED
-- It was NOT applied. There is one Supabase project and it is production, so
-- this migration was registered with `prisma migrate resolve --applied
-- 0006_baseline_rls`, which writes only to `_prisma_migrations`. No statement
-- below has been executed against the production database. Its first real
-- execution will be a rebuild, which is why every statement is idempotent.
--
-- THIS IS A CAPTURE, NOT AN ENDORSEMENT
-- Several objects below are known-flawed. They are transcribed unchanged so
-- that this file is a truthful record. Each is annotated inline and tracked in
-- docs/SECURITY.md. Do not read the presence of a policy here as approval of it.
--
-- ALREADY TRACKED ELSEWHERE — deliberately not repeated here:
--   * expenses policies/grants ................. 0003_expenses
--   * groups, group_members policies/grants .... 0004_church_scoped_groups
--   * get_my_church_id, is_member_in_my_church,
--     is_group_available_to_my_church .......... 0004_church_scoped_groups
--   * assign_group_color_slot + its trigger .... 0005_group_color_slots
--
-- NOT CAPTURED — these live outside `public` and must be recreated by hand on a
-- rebuild. Both are load-bearing; see docs/SECURITY.md for the open item.
--   * the trigger on `auth.users` that calls public.handle_new_user()
--   * the event trigger that calls public.rls_auto_enable()
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Functions
-- ----------------------------------------------------------------------------

-- Single-round-trip church identity lookup. Called by DashboardView,
-- CollectionsInputView, ExpensesInputView and MinistrySmallGroupView via
-- supabase.rpc('get_my_church'). SECURITY DEFINER so it can read `churches`
-- regardless of that table's policy.
CREATE OR REPLACE FUNCTION public.get_my_church()
RETURNS TABLE(id uuid, name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select c.id, c.name
  from public.user_accounts ua
  join public.members m on m.id = ua.member_id
  join public.churches c on c.id = m.member_of
  where ua.id = auth.uid()
  limit 1;
$function$;

-- Creates the public.user_accounts row for a new auth user. The trigger that
-- invokes this lives on auth.users and is NOT captured by this migration.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
begin
  begin
    insert into public.user_accounts (id) values (new.id);
  exception when others then
    raise warning 'handle_new_user failed: % (%)', sqlerrm, sqlstate;
    raise;  -- re-raise so you still see it, but now logged with detail
  end;
  return new;
end;
$function$;

-- Defence in depth: auto-enables RLS on any newly created table in `public` so a
-- table added via the dashboard cannot ship without RLS. Driven by an event
-- trigger that is NOT captured by this migration.
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;


-- ----------------------------------------------------------------------------
-- 2. Function EXECUTE grants
-- ----------------------------------------------------------------------------
-- Transcribed from live state. NOTE: `anon` holds EXECUTE on all three. For
-- get_my_church() this is harmless — auth.uid() is NULL for an anonymous caller
-- so the function returns no row — but it is broader than necessary and is
-- tracked as a follow-up. It is recorded rather than silently tightened because
-- this migration must not change behaviour.

GRANT EXECUTE ON FUNCTION public.get_my_church() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rls_auto_enable() TO anon, authenticated, service_role;


-- ----------------------------------------------------------------------------
-- 3. Table and sequence grants
-- ----------------------------------------------------------------------------
-- These are Supabase's default table privileges, never narrowed for these four
-- tables. `GRANT ALL` here expands to SELECT, INSERT, UPDATE, DELETE, TRUNCATE,
-- REFERENCES and TRIGGER — matching the live capture exactly.
--
-- This is far broader than the app needs, and notably broader than the narrowed
-- grants 0003/0004 install for expenses/groups/group_members. RLS is what makes
-- it safe in practice, with one caveat worth recording: TRUNCATE is NOT subject
-- to RLS. It is not reachable through PostgREST, so this is not exploitable via
-- the anon key today, but it is the reason these grants should be narrowed.
-- Tracked as a follow-up; transcribed unchanged here.

GRANT ALL ON TABLE public.churches      TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.collections   TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.members       TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.user_accounts TO anon, authenticated, service_role;

-- collections.id is bigserial; INSERT needs USAGE on its sequence.
GRANT USAGE ON SEQUENCE public.collections_id_seq TO anon, authenticated, service_role;


-- ----------------------------------------------------------------------------
-- 4. Enable RLS
-- ----------------------------------------------------------------------------
-- All four are relrowsecurity = true, relforcerowsecurity = false in live state.

ALTER TABLE public.churches      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collections   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.members       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_accounts ENABLE ROW LEVEL SECURITY;


-- ----------------------------------------------------------------------------
-- 5. Drop any pre-existing policy on these tables
-- ----------------------------------------------------------------------------
-- Same sweep 0004 uses: on a rebuild this guarantees no stale or permissive
-- policy survives alongside the ones defined below.

DO $policies$
DECLARE
  policy_record RECORD;
BEGIN
  FOR policy_record IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('churches', 'collections', 'members', 'user_accounts')
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


-- ----------------------------------------------------------------------------
-- 6. Policies — transcribed verbatim, including known flaws
-- ----------------------------------------------------------------------------

-- churches --------------------------------------------------------------------
-- KNOWN GAP (docs/SECURITY.md §3.3, High): `using (true)` exposes every church's
-- id, name and address to every authenticated user of every church. It was added
-- for a `select('*, churches(name)')` join that no longer exists — the app now
-- uses get_my_church(). It is preserved here only because this migration is a
-- faithful capture. The corrective migration is tracked separately.
CREATE POLICY "Authenticated users can view churches"
ON public.churches
FOR SELECT
TO authenticated
USING (true);


-- collections -----------------------------------------------------------------
-- Only SELECT and INSERT policies exist. There is no UPDATE and no DELETE
-- policy, so with RLS enabled both operations are denied for every caller.
-- CollectionsInputView.vue calls .update() and .delete() inside its 3-hour edit
-- window — those calls cannot succeed against this policy set. Recorded as-is;
-- see docs/SECURITY.md for the open item.
--
-- The singular `collection_insert_own_church` name is the live name, kept so this
-- file round-trips exactly against pg_policies.
CREATE POLICY collection_insert_own_church
ON public.collections
FOR INSERT
TO authenticated
WITH CHECK (from_church = public.get_my_church_id());

CREATE POLICY collections_select_own_church
ON public.collections
FOR SELECT
TO authenticated
USING (from_church = public.get_my_church_id());


-- members ---------------------------------------------------------------------
-- The PII table. One FOR ALL policy granted TO public, with USING and no
-- WITH CHECK. Two consequences follow from Postgres semantics and both differ
-- from what docs/ARCHITECTURE.md §6.2 describes:
--
--   1. FOR ALL includes DELETE. Combined with the DELETE grant above, an
--      authenticated user CAN hard-delete active members of their own church.
--      §6.2's "No DELETE policy ... hard deletes are not permitted" does not
--      hold against this policy.
--
--   2. With no WITH CHECK, Postgres reuses USING as the write check. Any UPDATE
--      that sets archived_at to a non-NULL value therefore fails the check, so
--      the archive flow in DashboardView.handleArchive() is rejected by RLS.
--
--   3. TO public applies the policy to `anon` as well as `authenticated`. It
--      fails closed there (get_my_church_id() is NULL without a JWT, so the
--      comparison is never true), but relying on that is fragile.
--
-- All three are transcribed unchanged. See docs/SECURITY.md for the open items.
CREATE POLICY "Only same church members can CRUD data"
ON public.members
FOR ALL
TO public
USING (
  member_of = public.get_my_church_id()
  AND archived_at IS NULL
);


-- user_accounts ---------------------------------------------------------------
-- Self-read only. No INSERT/UPDATE/DELETE policy exists, so despite the broad
-- grants above, RLS denies all writes — rows are created by handle_new_user(),
-- which is SECURITY DEFINER and therefore bypasses this policy. This resolves
-- the verification item left open in docs/SECURITY.md §3.2.
CREATE POLICY "Users can read their own account"
ON public.user_accounts
FOR SELECT
TO authenticated
USING (id = auth.uid());

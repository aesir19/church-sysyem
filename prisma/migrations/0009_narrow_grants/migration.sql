-- ============================================================================
-- 0009_narrow_grants — Revoke Supabase's default GRANT ALL; close §3.3.
-- ============================================================================
--
-- WHY
-- Table privileges are the gate in front of RLS. 0004_church_scoped_groups
-- revokes Supabase's defaults before re-granting narrowly, which is why `groups`
-- and `group_members` are genuinely limited. No such revoke existed for the
-- other five tables: `churches`, `collections`, `expenses`, `members` and
-- `user_accounts` all still carried the default GRANT ALL (SELECT, INSERT,
-- UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER) to BOTH `anon` and
-- `authenticated`. RLS was the only gate. See docs/SECURITY.md §3.12.
--
-- Note that 0003_expenses' `GRANT SELECT, INSERT, UPDATE ... TO authenticated`
-- reads as though it scopes access, but GRANT is additive and 0003 never
-- revoked — so it changed nothing about the effective privilege set.
--
-- HOW THE GRANT SET WAS DERIVED
-- By enumerating every supabase.from(...) call in src/. It is not a guess:
--
--   churches ........ nothing. Never queried directly; the SPA reads it only
--                     through get_my_church(), which is SECURITY DEFINER.
--   members ......... SELECT, INSERT, UPDATE   (DashboardView, and SELECT from
--                     CollectionsInputView + MinistrySmallGroupView)
--   collections ..... SELECT, INSERT, UPDATE (amount), DELETE
--   expenses ........ SELECT, INSERT          (ChurchFundsView reads; only
--                     ExpensesInputView writes, and it never updates)
--   user_accounts ... SELECT                  (router guard, DashboardLayout,
--                     useFinanceMember)
--
-- `anon` needs no table access at all: LoginView, SetPasswordView and
-- AccountPendingView use only supabase.auth.*, which talks to GoTrue rather than
-- PostgREST.
--
-- `service_role` grants are deliberately untouched throughout. It bypasses RLS
-- by design and is never used by the frontend.
--
-- RISK
-- This migration has no compile-time signal. A missing grant surfaces only as a
-- runtime failure on the affected page. Exercise every view after deploying.
--
-- ROLLBACK: see rollback.sql in this directory.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Reset table privileges
-- ----------------------------------------------------------------------------

REVOKE ALL ON TABLE public.churches      FROM anon, authenticated;
REVOKE ALL ON TABLE public.collections   FROM anon, authenticated;
REVOKE ALL ON TABLE public.expenses      FROM anon, authenticated;
REVOKE ALL ON TABLE public.members       FROM anon, authenticated;
REVOKE ALL ON TABLE public.user_accounts FROM anon, authenticated;

-- churches: intentionally no grant to anon or authenticated. This is what
-- actually closes docs/SECURITY.md §3.3 — with no SELECT privilege the
-- permissive `using (true)` policy is unreachable. Section 3 tightens the policy
-- as well, so restoring the grant later cannot silently reopen the leak.

GRANT SELECT, INSERT, UPDATE ON TABLE public.members TO authenticated;

GRANT SELECT, INSERT, DELETE ON TABLE public.collections TO authenticated;
-- Column-scoped UPDATE, first established by 0008_funds_write_policies. A
-- table-wide UPDATE grant would let a caller set created_at = now() and so
-- extend their own 3-hour edit window indefinitely.
GRANT UPDATE (amount) ON TABLE public.collections TO authenticated;

GRANT SELECT, INSERT ON TABLE public.expenses TO authenticated;

GRANT SELECT ON TABLE public.user_accounts TO authenticated;


-- ----------------------------------------------------------------------------
-- 2. Sequences — needed by INSERT on the two bigserial tables
-- ----------------------------------------------------------------------------

REVOKE ALL ON SEQUENCE public.collections_id_seq FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.expenses_id_seq    FROM anon, authenticated;

GRANT USAGE ON SEQUENCE public.collections_id_seq TO authenticated;
GRANT USAGE ON SEQUENCE public.expenses_id_seq    TO authenticated;


-- ----------------------------------------------------------------------------
-- 3. churches policy — defence in depth behind the revoked grant
-- ----------------------------------------------------------------------------
-- docs/SECURITY.md §3.3: the old policy leaked every church's id, name and
-- address to every authenticated user of every church. It was added for a
-- `select('*, churches(name)')` join that no longer exists.

DROP POLICY IF EXISTS "Authenticated users can view churches" ON public.churches;

CREATE POLICY churches_select_own_only
ON public.churches
FOR SELECT
TO authenticated
USING (id = public.get_my_church_id());


-- ----------------------------------------------------------------------------
-- 4. Function EXECUTE — revoke from anon
-- ----------------------------------------------------------------------------
-- 0004 attempted this with `REVOKE ALL ... FROM PUBLIC`, which did not work:
-- anon's EXECUTE comes from Supabase's default privileges, granted directly to
-- the role rather than via PUBLIC. Revoking from anon explicitly is what works.
--
-- Harmless in itself — auth.uid() is NULL without a JWT, so these return nothing
-- — but anon has no reason to reach any of them.

REVOKE EXECUTE ON FUNCTION public.get_my_church()                        FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_my_church_id()                     FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_member_in_my_church(uuid)           FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_group_available_to_my_church(uuid)  FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_finance_member()                    FROM anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user()                      FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable()                      FROM anon, authenticated;

-- handle_new_user and rls_auto_enable are trigger/event-trigger functions. They
-- are invoked by the trigger machinery, not by a client, so neither anon nor
-- authenticated needs EXECUTE on them.

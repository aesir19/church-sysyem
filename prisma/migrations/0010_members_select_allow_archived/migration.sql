-- ============================================================================
-- 0010_members_select_allow_archived — Make archiving actually work.
-- ============================================================================
--
-- WHY
-- Archiving a member has never succeeded in this application. Every attempt
-- fails with `42501: new row violates row-level security policy for table
-- "members"`, and production data confirms it: 27 members across three churches,
-- zero archived rows.
--
-- THE CAUSE — not what docs/SECURITY.md §3.11 originally claimed.
-- That analysis blamed the missing WITH CHECK on the old FOR ALL policy. It was
-- wrong. The real cause is the SELECT policy:
--
--   members_select_own_church  USING (member_of = get_my_church_id()
--                                     AND archived_at IS NULL)
--
-- PostgreSQL evaluates the SELECT policy against the NEW row during an UPDATE.
-- Archiving sets archived_at to a non-NULL value, which makes the updated row
-- invisible under `archived_at IS NULL`, so the statement is rejected.
--
-- This was verified empirically against production inside rolled-back
-- transactions: holding the UPDATE policy at WITH CHECK (true) still failed,
-- while removing `archived_at IS NULL` from the SELECT policy alone succeeded.
-- The pre-0007 FOR ALL policy carried the same condition in its USING clause and
-- failed identically — which is why this is a long-standing bug rather than a
-- regression introduced by 0007_members_policy_split.
--
-- THE FIX AND ITS TRADE-OFF
-- The condition moves out of the policy and into the application. Archived rows
-- become readable over PostgREST by staff of the owning church. Tenant isolation
-- is unaffected — `member_of = get_my_church_id()` still holds — but hiding
-- archived members is now a UI responsibility. Every read of `members` must
-- filter explicitly:
--
--   DashboardView.fetchMembers          .is('archived_at', null)
--   CollectionsInputView.fetchMembers   .is('archived_at', null)
--   MinistrySmallGroupView (search)     .is('archived_at', null)
--   MinistrySmallGroupView (all)        .is('archived_at', null)
--
-- A new read that forgets this filter will show archived people in a list or
-- picker. That is the cost of this approach and it was accepted deliberately;
-- the alternative was a SECURITY DEFINER archive_member() RPC that would have
-- preserved the invisible-once-archived read model.
--
-- INSERT is deliberately left alone: `archived_at IS NULL` still belongs there,
-- because a newly created member must not start out archived.
--
-- ROLLBACK: see rollback.sql in this directory.
-- ============================================================================

DROP POLICY IF EXISTS members_select_own_church ON public.members;

CREATE POLICY members_select_own_church
ON public.members
FOR SELECT
TO authenticated
USING (member_of = public.get_my_church_id());

-- ============================================================================
-- 0008_funds_write_policies — Finance-role RLS + the missing collections writes.
-- ============================================================================
--
-- WHY
-- Two gaps, both documented in docs/SECURITY.md §3.11:
--
--   1. Finance-role authorization was enforced only in the browser. The router
--      guard in src/router/index.js and src/composables/useFinanceMember.js gate
--      the Collections and Expenses pages, but no policy ever checked Finance
--      Team membership — expenses policies checked church only, and collections
--      had no write policy beyond INSERT. Any authenticated staff member could
--      write to their church's books directly through PostgREST. This violated
--      docs/ARCHITECTURE.md §10's "RLS first — never replicate authorization
--      logic in the frontend".
--
--   2. collections had no UPDATE and no DELETE policy at all, so the in-window
--      edit and delete actions in CollectionsInputView.vue were denied by RLS.
--
-- THE RULE: READS ARE CHURCH-SCOPED, WRITES ARE FINANCE-GATED.
-- SELECT policies are deliberately NOT finance-gated. ChurchFundsView.vue reads
-- expenses to build the monthly report and is not a finance-only route, so
-- gating SELECT would break reports for non-finance staff. The same reasoning
-- keeps collections SELECT church-scoped: docs/ARCHITECTURE.md §9.14 plans to
-- feed contributions into that same report.
--
-- THE 3-HOUR EDIT WINDOW MOVES INTO THE DATABASE.
-- It was previously advisory — isWithinEditWindow() in src/utils/collectionsDate.js
-- gated the UI only, so any signed-in user could edit a year-old entry via the
-- anon key. The interval below MUST stay in sync with that helper.
--
-- ROLLBACK: see rollback.sql in this directory.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Finance-role predicate
-- ----------------------------------------------------------------------------
-- Mirrors the is_member_in_my_church / is_group_available_to_my_church pattern
-- from 0004: SECURITY DEFINER + STABLE + fixed search_path, so policy evaluation
-- does not recurse through the policy-protected tables it reads.
--
-- 'Finance Team' is a global ministry (church_id IS NULL) per 0004, while its
-- group_members rows are church-scoped — so this correctly resolves to "is the
-- caller a Finance Team member of their own church".

CREATE OR REPLACE FUNCTION public.is_finance_member()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_accounts AS ua
    JOIN public.group_members AS gm ON gm.member_id = ua.member_id
    JOIN public.groups AS g ON g.id = gm.group_id
    WHERE ua.id = auth.uid()
      AND g.name = 'Finance Team'
      AND g.type = 'Ministry'
      AND g.church_id IS NULL
  )
$$;

REVOKE ALL ON FUNCTION public.is_finance_member() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_finance_member() TO authenticated;


-- ----------------------------------------------------------------------------
-- 2. expenses — finance-gate the writes, leave SELECT alone
-- ----------------------------------------------------------------------------
-- expenses_select_own_church (from 0003) is intentionally untouched: the reports
-- page depends on it and is not finance-only.

DROP POLICY IF EXISTS expenses_insert_own_church ON public.expenses;
DROP POLICY IF EXISTS expenses_update_own_church ON public.expenses;

CREATE POLICY expenses_insert_own_church
ON public.expenses
FOR INSERT
TO authenticated
WITH CHECK (
  from_church = public.get_my_church_id()
  AND public.is_finance_member()
);

-- The app never updates expenses, and 0009_narrow_grants does not grant UPDATE,
-- so this policy is currently unreachable. It is kept correct so that restoring
-- the grant later cannot silently reopen unrestricted writes.
CREATE POLICY expenses_update_own_church
ON public.expenses
FOR UPDATE
TO authenticated
USING (
  from_church = public.get_my_church_id()
  AND public.is_finance_member()
)
WITH CHECK (
  from_church = public.get_my_church_id()
  AND public.is_finance_member()
);


-- ----------------------------------------------------------------------------
-- 3. collections — finance-gate INSERT, add the missing UPDATE and DELETE
-- ----------------------------------------------------------------------------
-- collections_select_own_church (from 0006) is intentionally untouched.
--
-- The INSERT policy is also renamed from the live `collection_insert_own_church`
-- (singular, a typo captured verbatim by 0006) to match every other policy name.

DROP POLICY IF EXISTS collection_insert_own_church ON public.collections;
DROP POLICY IF EXISTS collections_insert_own_church ON public.collections;

CREATE POLICY collections_insert_own_church
ON public.collections
FOR INSERT
TO authenticated
WITH CHECK (
  from_church = public.get_my_church_id()
  AND public.is_finance_member()
);

-- The window is evaluated against the existing row in USING. WITH CHECK omits it
-- because created_at is not editable — see the column grant in section 4, which
-- is what stops a caller resetting created_at to extend their own window.
CREATE POLICY collections_update_own_church_in_window
ON public.collections
FOR UPDATE
TO authenticated
USING (
  from_church = public.get_my_church_id()
  AND public.is_finance_member()
  AND created_at > now() - interval '3 hours'
)
WITH CHECK (
  from_church = public.get_my_church_id()
  AND public.is_finance_member()
);

CREATE POLICY collections_delete_own_church_in_window
ON public.collections
FOR DELETE
TO authenticated
USING (
  from_church = public.get_my_church_id()
  AND public.is_finance_member()
  AND created_at > now() - interval '3 hours'
);


-- ----------------------------------------------------------------------------
-- 4. Restrict which collections columns an UPDATE may touch
-- ----------------------------------------------------------------------------
-- Without this the window is trivially bypassable: a table-wide UPDATE grant
-- lets a caller set created_at = now(), which satisfies the window predicate and
-- reopens editing indefinitely. CollectionsInputView.saveEdit() only ever writes
-- `amount`, so a column grant costs nothing.
--
-- 0009_narrow_grants re-establishes this as part of the full grant reset; it is
-- repeated here so that 0008 is secure on its own if 0009 has not shipped yet.

REVOKE UPDATE ON TABLE public.collections FROM authenticated;
GRANT UPDATE (amount) ON TABLE public.collections TO authenticated;

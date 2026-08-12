-- ============================================================================
-- 0020_my_profile_name — let a signed-in user read their own name
-- ============================================================================
--
-- WHY
-- The dashboard greets people with the local part of their email address:
-- "Good evening, Fjhaze". The name is right there in `members`, linked through
-- `user_accounts.member_id`, and the app cannot reach it — `members_select_own_church`
-- (0015) requires `can_see_member_detail()`, which Finance, Welcome Team and
-- Head Pastor do not hold. A direct select would work for four of the seven
-- roles and silently fall back to the email for the other three, which is worse
-- than the consistent fallback we have now.
--
-- WHY A FUNCTION AND NOT A POLICY
-- The alternative is widening `members_select_own_church` with an OR clause for
-- "the row this account is linked to". That is a bigger change to the most
-- sensitive policy in the schema, evaluated on every member read, in order to
-- expose two columns of one row. This function answers exactly the question
-- asked — "what is MY name" — and nothing else.
--
-- WHY SECURITY DEFINER IS SAFE HERE
-- It bypasses RLS, so the predicate is the whole of the control. `WHERE
-- ua.id = auth.uid()` admits exactly one row: the caller's own account. There
-- is no argument to this function, so there is nothing for a caller to vary —
-- no id to probe, no church to cross. It returns no PII beyond the name the
-- caller already knows, and returns zero rows for an account with no linked
-- member (which is the pre-assignment state, and the app falls back).
--
-- WHY IT IS NOT PART OF get_my_permissions()
-- That would be the free option — same round-trip, no new grant. But changing
-- a function's RETURNS TABLE requires DROP then CREATE, and between those two
-- statements every signed-in session loses its role snapshot and the router
-- fails closed. A new function costs one cached round-trip per session and
-- cannot break the running app.
--
-- SAFE TO APPLY WHILE THE APP IS LIVE. Nothing is dropped and no existing
-- object changes. Until it is applied the SPA's call 404s, which useCurrentUser
-- treats as "no name" and falls back to the email exactly as it does today.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_my_profile()
RETURNS TABLE (
  first_name text,
  last_name  text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT m.first_name::text, m.last_name::text
  FROM public.user_accounts ua
  JOIN public.members m ON m.id = ua.member_id
  WHERE ua.id = auth.uid()
$$;

-- REVOKE before GRANT: Supabase's default privileges fire on creation and GRANT
-- is additive, so granting without revoking leaves the defaults in place. Same
-- order as 0009 and every function since.
REVOKE ALL ON FUNCTION public.get_my_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_profile() TO authenticated;

COMMIT;

-- PostgREST caches the schema. If get_my_profile 404s right after deploy:
--   NOTIFY pgrst, 'reload schema';

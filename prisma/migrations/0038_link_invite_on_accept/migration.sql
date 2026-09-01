-- ============================================================================
-- 0038_link_invite_on_accept — link an invited account when the invite is
-- ACCEPTED, not at the instant the auth row is inserted.
-- ============================================================================
--
-- THE BUG THIS FIXES
-- 0037 linked the member/role inside handle_new_user(), the AFTER INSERT trigger
-- on auth.users, guarded by `if new.invited_at is not null`. The guard is right
-- in spirit — invited_at is set by the admin invite API and by nothing a client
-- can forge, so it is the seam that stops a self-signup from claiming a pending
-- invite by e-mail. But it is checked at the WRONG MOMENT: admin.inviteUserByEmail
-- inserts the auth.users row (firing this AFTER INSERT trigger) and only THEN
-- writes invited_at in a later statement. So at trigger time new.invited_at is
-- still NULL, the linking block is skipped, the bare user_accounts row is created
-- unlinked, and the invite is never consumed. invited_at reads non-null forever
-- after — which is why the row looks invited but was never linked.
--
-- Net effect: EVERY account invited through the app landed roleless and unlinked,
-- so the whole dashboard read empty (RLS returns nothing without a member/church).
--
-- THE FIX
-- Check invited_at at a moment it is actually populated: when the invited person
-- ACCEPTS — i.e. when auth.users.email_confirmed_at transitions to non-null with
-- invited_at already set. That is the first update where both signals are present.
-- The self-signup protection is unchanged: a public sign-up has invited_at NULL
-- and never reaches the linking routine.
--
-- The link/consume itself is factored into consume_account_invite(), shared by the
-- INSERT path (for the case invited_at HAPPENS to be present already) and the new
-- ACCEPT trigger. It is idempotent — it links only an account not yet linked, only
-- from a still-pending invite — so firing it more than once is a safe no-op.
--
-- A BACKFILL at the end repairs every account already broken by 0037.
--
-- ROLLBACK: see rollback.sql (restores 0037's handle_new_user, drops the new
-- trigger + functions; it does NOT un-link accounts the backfill repaired).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. The shared, idempotent link + consume. SECURITY DEFINER so it can write
--    user_accounts (self-read only under RLS) and read auth.users; invoked ONLY
--    from the two trigger functions below, never granted to a caller. It trusts
--    its callers to have established this is a genuine invite (invited_at set) —
--    and matches ONLY rows in account_invites, which only invite_member() (itself
--    permission-checked) can write, so the member/role are already authorised.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consume_account_invite(p_user uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email text;
BEGIN
  SELECT lower(u.email) INTO v_email FROM auth.users AS u WHERE u.id = p_user;
  IF v_email IS NULL THEN
    RETURN;
  END IF;

  -- Link member + role, but ONLY if this account is not already linked (so a
  -- re-fire cannot overwrite a later manual re-assignment) and ONLY from a still
  -- pending invite. coalesce keeps the default role when the invite carried none.
  UPDATE public.user_accounts AS ua
     SET member_id = ai.member_id,
         role      = coalesce(ai.role, ua.role)
    FROM public.account_invites AS ai
   WHERE ua.id = p_user
     AND ua.member_id IS NULL
     AND ai.email = v_email
     AND ai.consumed_at IS NULL;

  -- Mark the invite consumed. Guarded on the account now being linked to that
  -- invite's member, so a no-op link (already linked to someone else) does not
  -- silently burn the invite.
  UPDATE public.account_invites AS ai
     SET consumed_at = now()
   WHERE ai.email = v_email
     AND ai.consumed_at IS NULL
     AND EXISTS (
       SELECT 1 FROM public.user_accounts AS ua
        WHERE ua.id = p_user AND ua.member_id = ai.member_id
     );
END
$$;

COMMENT ON FUNCTION public.consume_account_invite(uuid) IS
  'Idempotent link+consume for an invited account: sets member/role from the pending account_invites row and marks it consumed. Called only by the auth.users triggers; never granted to callers.';

REVOKE ALL ON FUNCTION public.consume_account_invite(uuid) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. handle_new_user() no longer DEPENDS on invited_at at INSERT time. It still
--    tries an immediate link when invited_at happens to be present (harmless,
--    idempotent); otherwise the ACCEPT trigger below does it. The bare-row insert
--    and the fail-loud exception frame are 0006/0037's, unchanged.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
begin
  begin
    insert into public.user_accounts (id) values (new.id);

    -- Best effort at insert. Usually a no-op because invited_at is not yet
    -- written here (that is the whole reason 0037 failed); the ACCEPT trigger is
    -- the reliable path. Kept so a provider that DOES set it at insert links now.
    if new.invited_at is not null then
      perform public.consume_account_invite(new.id);
    end if;
  exception when others then
    raise warning 'handle_new_user failed: % (%)', sqlerrm, sqlstate;
    raise;  -- re-raise so a failed account creation is never silent
  end;
  return new;
end;
$function$;

-- ----------------------------------------------------------------------------
-- 3. THE ACCEPT TRIGGER. Fires when an invited user's e-mail is confirmed (they
--    set their password), which is the first update where BOTH invited_at and
--    email_confirmed_at are present. The WHEN clause keeps it off the hot path:
--    it never fires on ordinary sign-ins (email_confirmed_at already non-null),
--    only on the null -> set transition (or the rare case invited_at is what
--    arrives last). Errors are swallowed here — a bad invite row must never wedge
--    a legitimate confirmation/login — and logged as a warning instead.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_invited_user_accepted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
begin
  begin
    perform public.consume_account_invite(new.id);
  exception when others then
    raise warning 'handle_invited_user_accepted failed for %: % (%)', new.id, sqlerrm, sqlstate;
  end;
  return new;
end;
$function$;

DROP TRIGGER IF EXISTS on_auth_user_invite_accepted ON auth.users;
CREATE TRIGGER on_auth_user_invite_accepted
  AFTER UPDATE ON auth.users
  FOR EACH ROW
  WHEN (
    new.invited_at IS NOT NULL
    AND new.email_confirmed_at IS NOT NULL
    AND (old.email_confirmed_at IS NULL OR old.invited_at IS NULL)
  )
  EXECUTE FUNCTION public.handle_invited_user_accepted();

-- ----------------------------------------------------------------------------
-- 4. BACKFILL. Repair every account that 0037 left invited-but-unlinked. Idempotent
--    via consume_account_invite (links only the still-unlinked, consumes only the
--    still-pending), so re-running this migration changes nothing further.
-- ----------------------------------------------------------------------------
SELECT public.consume_account_invite(u.id)
  FROM auth.users AS u
  JOIN public.user_accounts AS ua ON ua.id = u.id
 WHERE u.invited_at IS NOT NULL
   AND ua.member_id IS NULL;

COMMIT;

-- New functions — PostgREST will not expose consume_account_invite (it is REVOKEd
-- from authenticated on purpose), but reload so the schema cache is current:
--   NOTIFY pgrst, 'reload schema';

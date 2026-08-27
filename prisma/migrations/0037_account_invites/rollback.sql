-- ============================================================================
-- Rollback for 0037_account_invites.
--
-- Restores handle_new_user() to its 0006 body (create the account row, nothing
-- else), drops the invite functions, and drops the table. Safe to run more than
-- once. Any pending invites are lost — they carry no state the app depends on
-- once this feature is gone.
-- ============================================================================

BEGIN;

-- Restore the 0006 trigger body verbatim.
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

DROP FUNCTION IF EXISTS public.invite_to_resend(text);
DROP FUNCTION IF EXISTS public.list_pending_invites();
DROP FUNCTION IF EXISTS public.invite_member(text, uuid, text);
DROP TABLE IF EXISTS public.account_invites;

COMMIT;

-- NOTIFY pgrst, 'reload schema';

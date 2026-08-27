-- ============================================================================
-- ROLLBACK 0038_link_invite_on_accept
-- ============================================================================
-- Restores 0037's handle_new_user() (invite linking back inside the INSERT path,
-- guarded by new.invited_at), drops the ACCEPT trigger and the two functions this
-- migration added.
--
-- NOTE: this does NOT un-link accounts the backfill repaired — that data is
-- correct and there is no reason to undo it. Rolling back only re-introduces the
-- original defect for FUTURE invites.
-- ============================================================================

BEGIN;

DROP TRIGGER IF EXISTS on_auth_user_invite_accepted ON auth.users;
DROP FUNCTION IF EXISTS public.handle_invited_user_accepted();

-- Restore 0037's handle_new_user verbatim.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
begin
  begin
    insert into public.user_accounts (id) values (new.id);

    if new.invited_at is not null then
      update public.user_accounts as ua
         set member_id = ai.member_id,
             role      = coalesce(ai.role, ua.role)
        from public.account_invites as ai
       where ua.id = new.id
         and ai.email = lower(new.email)
         and ai.consumed_at is null;

      update public.account_invites
         set consumed_at = now()
       where email = lower(new.email)
         and consumed_at is null;
    end if;
  exception when others then
    raise warning 'handle_new_user failed: % (%)', sqlerrm, sqlstate;
    raise;
  end;
  return new;
end;
$function$;

DROP FUNCTION IF EXISTS public.consume_account_invite(uuid);

COMMIT;

--   NOTIFY pgrst, 'reload schema';

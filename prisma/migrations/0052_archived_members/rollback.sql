-- Safe only before archive events or rollout bans have been recorded. Once those
-- exist, reverting the access check could admit archived accounts with old JWTs.
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.member_archive_events)
    OR EXISTS (SELECT 1 FROM public.user_accounts WHERE archive_disabled_at IS NOT NULL)
  THEN RAISE EXCEPTION 'Archive access has been used: restore/recover accounts and retain history before rollback'; END IF;
END $$;

ALTER ROLE authenticator RESET pgrst.db_pre_request;

DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND rowsecurity
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS archive_account_access ON public.%I', t.tablename);
  END LOOP;
END $$;

DROP TRIGGER guard_archived_account_link ON public.user_accounts;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['user_accounts', 'members', 'ministry_members', 'small_group_members', 'small_group_leaders', 'ministries', 'small_groups'] LOOP
    EXECUTE format('DROP TRIGGER archive_access_lock ON public.%I', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.my_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT role FROM public.user_accounts WHERE id = auth.uid() $$;
CREATE OR REPLACE FUNCTION public.is_in_ministry(p_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (
  SELECT 1 FROM public.user_accounts ua
  JOIN public.ministry_members mm ON mm.member_id = ua.member_id
  JOIN public.ministries mi ON mi.id = mm.ministry_id
  WHERE ua.id = auth.uid() AND mi.ministry_key = p_key
) $$;
CREATE OR REPLACE FUNCTION public.is_small_group_leader()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.small_group_leaders WHERE account_id = auth.uid()) $$;

DROP FUNCTION public.guard_archived_account_link();
DROP FUNCTION public.lock_archive_access_change();
DROP FUNCTION public.enable_archived_account(uuid, jsonb);
DROP FUNCTION public.list_archived_members(uuid, text, integer, boolean);
DROP FUNCTION public.archived_member_detail(uuid);
DROP FUNCTION public.archive_retained_assignments(uuid);
DROP FUNCTION public.restore_archived_member(uuid, text);
DROP FUNCTION public.archive_member(uuid, text);
DROP FUNCTION public.can_manage_member_archive();
DROP FUNCTION public.check_archive_access();
DROP FUNCTION public.archive_account_active();

DROP POLICY members_update_own_church ON public.members;
CREATE POLICY members_update_own_church ON public.members FOR UPDATE TO authenticated
  USING (public.can_write_church(member_of) AND public.can_write_members())
  WITH CHECK (public.can_write_church(member_of) AND public.can_write_members());
REVOKE UPDATE ON public.members FROM authenticated;
GRANT UPDATE ON public.members TO authenticated;

DROP TABLE public.member_archive_events;
ALTER TABLE public.user_accounts
  DROP COLUMN archive_disabled_at,
  DROP COLUMN archive_previous_ban,
  DROP COLUMN access_revoked_at;

NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
COMMIT;

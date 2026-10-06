-- Archive is an atomic member + account operation. No Auth Admin HTTP call or
-- service key is needed: the database owns the transaction, including Auth's ban.
BEGIN;

ALTER TABLE public.user_accounts
  ADD COLUMN archive_disabled_at timestamptz,
  ADD COLUMN archive_previous_ban timestamptz,
  ADD COLUMN access_revoked_at timestamptz;

-- Lifecycle columns are RPC-only. An arbitrary PATCH must not bypass a ban,
-- restoration reason, safeguards, or history. Ordinary active-member edits remain.
REVOKE UPDATE ON public.members FROM authenticated;
GRANT UPDATE (first_name, last_name, middle_name, birthdate, gender, address,
  date_joined, contact_number, email, member_of, wedding_anniversarry, facebook_link,
  is_one_to_one_completed, is_turning_point_completed, is_baptized,
  marital_status, has_submitted_membership_form) ON public.members TO authenticated;
DROP POLICY members_update_own_church ON public.members;
CREATE POLICY members_update_own_church ON public.members FOR UPDATE TO authenticated
  USING (archived_at IS NULL AND public.can_write_church(member_of) AND public.can_write_members())
  WITH CHECK (archived_at IS NULL AND public.can_write_church(member_of) AND public.can_write_members());

CREATE TABLE public.member_archive_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.members(id),
  church_id uuid NOT NULL REFERENCES public.churches(id),
  actor_id uuid REFERENCES public.user_accounts(id),
  action text NOT NULL CHECK (action IN ('archive', 'restore', 'disable_at_rollout', 'enable_access')),
  reason text,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX member_archive_events_member_time ON public.member_archive_events(member_id, occurred_at DESC);
ALTER TABLE public.member_archive_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.member_archive_events FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.archive_account_active()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_accounts ua
    LEFT JOIN public.members m ON m.id = ua.member_id
    WHERE ua.id = auth.uid() AND ua.archive_disabled_at IS NULL
      AND m.archived_at IS NULL
      AND (ua.access_revoked_at IS NULL OR
        coalesce((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'iat')::numeric, 0)
          >= extract(epoch FROM ua.access_revoked_at))
  )
$$;

CREATE FUNCTION public.check_archive_access()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.archive_account_active() THEN
    RAISE EXCEPTION 'account_disabled' USING ERRCODE = 'PT403';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.my_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT ua.role FROM public.user_accounts ua
      WHERE ua.id = auth.uid() AND public.archive_account_active() $$;

CREATE OR REPLACE FUNCTION public.is_in_ministry(p_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT public.archive_account_active() AND EXISTS (
  SELECT 1 FROM public.user_accounts ua
  JOIN public.ministry_members mm ON mm.member_id = ua.member_id
  JOIN public.ministries mi ON mi.id = mm.ministry_id
  WHERE ua.id = auth.uid() AND mi.ministry_key = p_key
) $$;

CREATE OR REPLACE FUNCTION public.is_small_group_leader()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT public.archive_account_active() AND EXISTS (
  SELECT 1 FROM public.small_group_leaders WHERE account_id = auth.uid()
) $$;

CREATE FUNCTION public.can_manage_member_archive()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT public.is_super_admin() OR public.is_pastor() OR public.is_secretariat() $$;

-- A restrictive policy complements every existing table policy, including simple
-- authenticated reads. The request hook also covers SECURITY DEFINER RPCs, whose
-- owner otherwise bypasses table RLS. Public check-in remains available to anon.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    AND rowsecurity AND tablename <> '_prisma_migrations'
  LOOP
    EXECUTE format('CREATE POLICY archive_account_access ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.archive_account_active())) WITH CHECK ((SELECT public.archive_account_active()))', t.tablename);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole,
    unnest(s.setconfig) c WHERE r.rolname = 'authenticator'
    AND c LIKE 'pgrst.db_pre_request=%' AND c <> 'pgrst.db_pre_request=public.check_archive_access') THEN
    RAISE EXCEPTION 'Existing request hook must be composed with check_archive_access before rollout';
  END IF;
END $$;
ALTER ROLE authenticator SET pgrst.db_pre_request = 'public.check_archive_access';

CREATE FUNCTION public.archive_member(p_member_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE m public.members; a public.user_accounts;
BEGIN
  PERFORM public.check_archive_access();
  IF NOT public.can_manage_member_archive() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  IF length(coalesce(p_reason, '')) > 500 THEN
    RAISE EXCEPTION 'invalid reason' USING ERRCODE = '22023';
  END IF;
  -- Serialize access transitions so two administrators cannot archive each other
  -- and both pass a stale last-active-admin check.
  PERFORM pg_advisory_xact_lock(52710, 52);
  SELECT * INTO m FROM public.members WHERE id = p_member_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_write_church(m.member_of) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO a FROM public.user_accounts WHERE member_id = m.id FOR UPDATE;
  IF a.id = auth.uid() THEN RAISE EXCEPTION 'self_archive' USING ERRCODE = 'AR001'; END IF;
  IF a.role IN ('super_admin', 'head_pastor') AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'protected_account' USING ERRCODE = 'AR002';
  END IF;
  IF a.role = 'super_admin' AND NOT EXISTS (
    SELECT 1 FROM public.user_accounts other
    JOIN auth.users au ON au.id = other.id
    LEFT JOIN public.members om ON om.id = other.member_id
    WHERE other.role = 'super_admin' AND other.id <> a.id
      AND other.archive_disabled_at IS NULL AND om.archived_at IS NULL
      AND (au.banned_until IS NULL OR au.banned_until <= now())
  ) THEN RAISE EXCEPTION 'last_superadmin' USING ERRCODE = 'AR003'; END IF;
  IF m.archived_at IS NOT NULL THEN RETURN jsonb_build_object('id', m.id, 'already_archived', true); END IF;
  IF a.id IS NOT NULL THEN
    UPDATE public.user_accounts SET archive_disabled_at = clock_timestamp(),
      access_revoked_at = clock_timestamp(),
      archive_previous_ban = CASE WHEN a.archive_disabled_at IS NULL
        THEN (SELECT banned_until FROM auth.users WHERE id = a.id) ELSE a.archive_previous_ban END
      WHERE id = a.id;
    UPDATE auth.users SET banned_until = '9999-12-31 00:00:00+00' WHERE id = a.id;
    IF NOT FOUND THEN RAISE EXCEPTION 'disable failed' USING ERRCODE = 'AR004'; END IF;
    DELETE FROM auth.sessions WHERE user_id = a.id;
  END IF;
  UPDATE public.members SET archived_at = clock_timestamp(), archived_reason = nullif(btrim(p_reason), '') WHERE id = m.id;
  INSERT INTO public.member_archive_events(member_id, church_id, actor_id, action, reason)
    VALUES (m.id, m.member_of, auth.uid(), 'archive', nullif(btrim(p_reason), ''));
  RETURN jsonb_build_object('id', m.id);
END
$$;

CREATE FUNCTION public.restore_archived_member(p_member_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE m public.members;
BEGIN
  PERFORM public.check_archive_access();
  IF NOT public.can_manage_member_archive() THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  IF nullif(btrim(p_reason), '') IS NULL OR length(p_reason) > 500 THEN
    RAISE EXCEPTION 'restore_reason_required' USING ERRCODE = 'AR005';
  END IF;
  PERFORM pg_advisory_xact_lock(52710, 52);
  SELECT * INTO m FROM public.members WHERE id = p_member_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_write_church(m.member_of) THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  IF m.archived_at IS NULL THEN RETURN jsonb_build_object('id', m.id, 'already_restored', true); END IF;
  -- Legacy rows have no event. Preserve their date and reason with an unknown actor.
  IF NOT EXISTS (SELECT 1 FROM public.member_archive_events WHERE member_id = m.id AND action = 'archive' AND occurred_at >= m.archived_at) THEN
    INSERT INTO public.member_archive_events(member_id, church_id, action, reason, occurred_at)
      VALUES(m.id, m.member_of, 'archive', m.archived_reason, m.archived_at);
  END IF;
  INSERT INTO public.member_archive_events(member_id, church_id, actor_id, action, reason)
    VALUES(m.id, m.member_of, auth.uid(), 'restore', btrim(p_reason));
  UPDATE public.members SET archived_at = NULL, archived_reason = NULL WHERE id = m.id;
  RETURN jsonb_build_object('id', m.id);
END
$$;

-- Internal helper, not an API. The detail RPC authorizes before reading it.
CREATE FUNCTION public.archive_retained_assignments(p_member_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('key', k, 'label', label, 'kind', kind) ORDER BY k), '[]'::jsonb)
  FROM (
    SELECT 'role:' || ua.role AS k, initcap(replace(ua.role, '_', ' ')) AS label, 'Role' AS kind
    FROM public.user_accounts ua WHERE ua.member_id = p_member_id
    UNION ALL
    SELECT 'ministry:' || mi.id::text, mi.name, 'Ministry'
    FROM public.ministry_members mm JOIN public.ministries mi ON mi.id = mm.ministry_id WHERE mm.member_id = p_member_id
    UNION ALL
    SELECT 'group:' || sg.id::text, sg.name, 'Small group'
    FROM public.small_group_members sm JOIN public.small_groups sg ON sg.id = sm.small_group_id WHERE sm.member_id = p_member_id
    UNION ALL
    SELECT 'leader:' || sg.id::text, 'Leader of ' || sg.name, 'Leadership'
    FROM public.small_group_leaders sl JOIN public.small_groups sg ON sg.id = sl.group_id
    JOIN public.user_accounts ua ON ua.id = sl.account_id WHERE ua.member_id = p_member_id
  ) a
$$;
REVOKE ALL ON FUNCTION public.archive_retained_assignments(uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.archived_member_detail(p_member_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE m public.members; a public.user_accounts; archived record; restored record;
BEGIN
  PERFORM public.check_archive_access();
  SELECT * INTO m FROM public.members WHERE id = p_member_id;
  IF NOT FOUND OR NOT public.can_see_member_detail() OR NOT public.can_read_church(m.member_of) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO a FROM public.user_accounts WHERE member_id = m.id;
  IF m.archived_at IS NULL AND (NOT public.is_super_admin() OR a.archive_disabled_at IS NULL) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  SELECT e.occurred_at, concat_ws(' ', am.first_name, am.last_name) AS actor
    INTO archived FROM public.member_archive_events e
    LEFT JOIN public.user_accounts au ON au.id = e.actor_id
    LEFT JOIN public.members am ON am.id = au.member_id
    WHERE e.member_id = m.id AND e.action = 'archive' ORDER BY e.occurred_at DESC LIMIT 1;
  SELECT e.occurred_at, e.reason, concat_ws(' ', am.first_name, am.last_name) AS actor
    INTO restored FROM public.member_archive_events e
    LEFT JOIN public.user_accounts au ON au.id = e.actor_id
    LEFT JOIN public.members am ON am.id = au.member_id
    WHERE e.member_id = m.id AND e.action = 'restore' ORDER BY e.occurred_at DESC LIMIT 1;
  RETURN jsonb_build_object(
    'id', m.id, 'first_name', m.first_name, 'last_name', m.last_name, 'middle_name', m.middle_name,
    'birthdate', m.birthdate, 'date_joined', m.date_joined, 'contact_number', m.contact_number,
    'address', m.address, 'email', m.email, 'gender', m.gender, 'marital_status', m.marital_status,
    'is_baptized', m.is_baptized, 'is_one_to_one_completed', m.is_one_to_one_completed,
    'is_turning_point_completed', m.is_turning_point_completed,
    'has_submitted_membership_form', m.has_submitted_membership_form,
    'archived_at', m.archived_at, 'archived_reason', m.archived_reason,
    'archived_by', nullif(archived.actor, ''), 'member_of', m.member_of,
    'account_id', a.id, 'account_email', (SELECT email FROM auth.users WHERE id = a.id),
    'disabled_at', a.archive_disabled_at, 'restored_at', restored.occurred_at,
    'restored_reason', restored.reason, 'restored_by', nullif(restored.actor, ''),
    'assignments', public.archive_retained_assignments(m.id)
  );
END
$$;

CREATE FUNCTION public.list_archived_members(p_church_id uuid, p_query text DEFAULT '', p_page integer DEFAULT 1, p_awaiting boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE rows jsonb; total bigint; archived_count bigint; awaiting_count bigint;
BEGIN
  PERFORM public.check_archive_access();
  IF p_church_id IS NULL OR NOT public.can_see_member_detail() OR NOT public.can_read_church(p_church_id)
    OR (p_awaiting AND NOT public.is_super_admin()) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  IF p_page IS NULL OR p_page < 1 OR p_page > 100000 OR length(p_query) > 200 THEN
    RAISE EXCEPTION 'invalid search' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO archived_count FROM public.members WHERE member_of = p_church_id AND archived_at IS NOT NULL;
  IF public.is_super_admin() THEN
    SELECT count(*) INTO awaiting_count FROM public.members m JOIN public.user_accounts a ON a.member_id = m.id
      WHERE m.member_of = p_church_id AND m.archived_at IS NULL AND a.archive_disabled_at IS NOT NULL;
  END IF;
  WITH matching AS (
    SELECT m.id, m.first_name, m.last_name, m.middle_name, m.archived_at, m.archived_reason,
      a.id AS account_id, a.archive_disabled_at AS disabled_at
    FROM public.members m LEFT JOIN public.user_accounts a ON a.member_id = m.id
    WHERE m.member_of = p_church_id
      AND CASE WHEN p_awaiting THEN m.archived_at IS NULL AND a.archive_disabled_at IS NOT NULL ELSE m.archived_at IS NOT NULL END
      AND (coalesce(p_query, '') = '' OR strpos(lower(concat_ws(' ', m.first_name, m.middle_name, m.last_name, m.id::text, m.archived_reason)), lower(btrim(p_query))) > 0)
  ), page AS (
    SELECT * FROM matching ORDER BY archived_at DESC NULLS LAST, last_name, first_name, id LIMIT 25 OFFSET ((p_page - 1) * 25)
  )
  SELECT (SELECT count(*) FROM matching), coalesce((SELECT jsonb_agg(to_jsonb(page)) FROM page), '[]') INTO total, rows;
  RETURN jsonb_build_object('rows', rows, 'total', total, 'archived_count', archived_count, 'awaiting_count', awaiting_count);
END
$$;

CREATE FUNCTION public.enable_archived_account(p_member_id uuid, p_confirmed_assignments jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE m public.members; a public.user_accounts;
BEGIN
  PERFORM public.check_archive_access();
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  PERFORM pg_advisory_xact_lock(52710, 52);
  SELECT * INTO m FROM public.members WHERE id = p_member_id FOR UPDATE;
  IF NOT FOUND OR m.archived_at IS NOT NULL THEN RAISE EXCEPTION 'restore_first' USING ERRCODE = 'AR006'; END IF;
  SELECT * INTO a FROM public.user_accounts WHERE member_id = m.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  IF a.archive_disabled_at IS NULL THEN RETURN jsonb_build_object('id', m.id, 'already_enabled', true); END IF;
  IF p_confirmed_assignments IS DISTINCT FROM public.archive_retained_assignments(m.id) THEN
    RAISE EXCEPTION 'assignments_changed' USING ERRCODE = 'AR007';
  END IF;
  -- Do not remove a ban imposed separately from this archive workflow.
  IF EXISTS (SELECT 1 FROM auth.users WHERE id = a.id AND banned_until IS DISTINCT FROM '9999-12-31 00:00:00+00'::timestamptz)
     OR a.archive_previous_ban > now() THEN
    RAISE EXCEPTION 'separate_restriction' USING ERRCODE = 'AR008';
  END IF;
  UPDATE auth.users SET banned_until = a.archive_previous_ban WHERE id = a.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'enable failed' USING ERRCODE = 'AR004'; END IF;
  UPDATE public.user_accounts SET archive_disabled_at = NULL, archive_previous_ban = NULL WHERE id = a.id;
  INSERT INTO public.member_archive_events(member_id, church_id, actor_id, action)
    VALUES(m.id, m.member_of, auth.uid(), 'enable_access');
  RETURN jsonb_build_object('id', m.id);
END
$$;
REVOKE ALL ON FUNCTION public.enable_archived_account(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enable_archived_account(uuid, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.restore_archived_member(uuid, text), public.archived_member_detail(uuid),
  public.list_archived_members(uuid, text, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_archived_member(uuid, text), public.archived_member_detail(uuid),
  public.list_archived_members(uuid, text, integer, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.archive_account_active(), public.check_archive_access(),
  public.can_manage_member_archive(), public.archive_member(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.archive_account_active(), public.check_archive_access(),
  public.can_manage_member_archive(), public.archive_member(uuid, text) TO authenticated;
-- PostgREST invokes its pre-request function for anonymous public check-in too.
GRANT EXECUTE ON FUNCTION public.check_archive_access() TO anon;

-- All assignment mutations share the archive lock so an assignment cannot change
-- between server-side confirmation and account re-enabling. Keep this lock at the
-- statement level, before row locks are acquired, to avoid lock-order inversions.
CREATE FUNCTION public.lock_archive_access_change()
RETURNS trigger LANGUAGE plpgsql SET search_path = public
AS $$ BEGIN PERFORM pg_advisory_xact_lock(52710, 52); RETURN NULL; END $$;
REVOKE ALL ON FUNCTION public.lock_archive_access_change() FROM PUBLIC, anon, authenticated;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['user_accounts', 'members', 'ministry_members', 'small_group_members', 'small_group_leaders', 'ministries', 'small_groups'] LOOP
    EXECUTE format('CREATE TRIGGER archive_access_lock BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.lock_archive_access_change()', t);
  END LOOP;
END $$;

CREATE FUNCTION public.guard_archived_account_link()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND EXISTS (
    SELECT 1 FROM public.members WHERE id = NEW.member_id AND archived_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'restore_first' USING ERRCODE = 'AR006';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.member_id IS DISTINCT FROM OLD.member_id
    AND (OLD.archive_disabled_at IS NOT NULL OR NEW.archive_disabled_at IS NOT NULL
      OR EXISTS (SELECT 1 FROM public.members WHERE id = NEW.member_id AND archived_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'restore_first' USING ERRCODE = 'AR006';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.role = 'super_admin' AND NEW.role IS DISTINCT FROM 'super_admin'
    AND NOT EXISTS (
      SELECT 1 FROM public.user_accounts ua JOIN auth.users au ON au.id = ua.id
      LEFT JOIN public.members m ON m.id = ua.member_id
      WHERE ua.id <> OLD.id AND ua.role = 'super_admin' AND ua.archive_disabled_at IS NULL
        AND m.archived_at IS NULL AND (au.banned_until IS NULL OR au.banned_until <= now())
    ) THEN RAISE EXCEPTION 'last_superadmin' USING ERRCODE = 'AR003'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_archived_account_link() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_archived_account_link BEFORE INSERT OR UPDATE ON public.user_accounts
  FOR EACH ROW EXECUTE FUNCTION public.guard_archived_account_link();

-- Existing archived accounts follow the same rule on rollout. All of this is in
-- the migration transaction; a failed Auth update rolls back the entire rollout.
INSERT INTO public.member_archive_events(member_id, church_id, action, reason)
  SELECT m.id, m.member_of, 'disable_at_rollout', 'Linked account disabled when the archive access rule was introduced.'
  FROM public.members m JOIN public.user_accounts a ON a.member_id = m.id WHERE m.archived_at IS NOT NULL;
UPDATE public.user_accounts a SET archive_disabled_at = clock_timestamp(), access_revoked_at = clock_timestamp(),
  archive_previous_ban = u.banned_until
  FROM auth.users u, public.members m WHERE u.id = a.id AND m.id = a.member_id AND m.archived_at IS NOT NULL;
UPDATE auth.users u SET banned_until = '9999-12-31 00:00:00+00'
  FROM public.user_accounts a WHERE a.id = u.id AND a.archive_disabled_at IS NOT NULL;
DELETE FROM auth.sessions s USING public.user_accounts a WHERE s.user_id = a.id AND a.archive_disabled_at IS NOT NULL;

NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
COMMIT;

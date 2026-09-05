-- Rollback 0040. Drops the member-first invite_member, cancel_invite and
-- invite_to_cancel, and the orphan-aware list, and restores the 0037 e-mail-first
-- invite_member(text, uuid, text) and the live-only list_pending_invites().
--
-- Any invites cancelled while 0040 was live stay consumed — cancel is append-only,
-- so this loses no state the app depends on.

BEGIN;

DROP FUNCTION IF EXISTS public.cancel_invite(text);
DROP FUNCTION IF EXISTS public.invite_to_cancel(text);
DROP FUNCTION IF EXISTS public.invite_member(uuid, text);
DROP FUNCTION IF EXISTS public.list_pending_invites();

-- Restore 0037 invite_member: e-mail typed by the caller, validated against a member.
CREATE OR REPLACE FUNCTION public.invite_member(
  p_email  text,
  p_member uuid,
  p_role   text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_email         text := lower(trim(p_email));
  v_super         boolean;
  v_member_church uuid;
  v_full_name     text;
  v_role          text;
BEGIN
  IF v_email = '' OR position('@' IN v_email) = 0 THEN
    RAISE EXCEPTION 'invalid email' USING ERRCODE = '22023';
  END IF;

  IF public.is_super_admin() THEN
    v_super := true;
  ELSIF public.is_church_leader() THEN
    v_super := false;
  ELSE
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT m.member_of, (m.first_name || ' ' || m.last_name)
    INTO v_member_church, v_full_name
  FROM public.members AS m
  WHERE m.id = p_member AND m.archived_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such active member' USING ERRCODE = '23503';
  END IF;

  IF v_super THEN
    IF p_role IS NOT NULL AND p_role NOT IN
       ('super_admin','head_pastor','pastor','church_leader','member','unassigned') THEN
      RAISE EXCEPTION 'invalid role: %', p_role USING ERRCODE = '22023';
    END IF;
    v_role := p_role;
  ELSE
    IF v_member_church IS DISTINCT FROM public.get_my_church_id() THEN
      RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
    END IF;
    IF p_role IS NOT NULL AND p_role <> 'unassigned' THEN
      RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
    END IF;
    v_role := NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM public.user_accounts WHERE member_id = p_member) THEN
    RAISE EXCEPTION 'that member is already linked to an account' USING ERRCODE = '23505';
  END IF;
  IF EXISTS (SELECT 1 FROM public.account_invites
             WHERE member_id = p_member AND consumed_at IS NULL) THEN
    RAISE EXCEPTION 'that member already has a pending invite' USING ERRCODE = '23505';
  END IF;
  IF EXISTS (SELECT 1 FROM public.account_invites
             WHERE email = v_email AND consumed_at IS NULL) THEN
    RAISE EXCEPTION 'that email already has a pending invite' USING ERRCODE = '23505';
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = v_email) THEN
    RAISE EXCEPTION 'that email already has an account' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.account_invites (email, member_id, role, invited_by)
  VALUES (v_email, p_member, v_role, auth.uid());

  RETURN v_full_name;
END
$$;

REVOKE ALL ON FUNCTION public.invite_member(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_member(text, uuid, text) TO authenticated;

-- Restore 0037 list_pending_invites: live invites only, no orphaned flag.
CREATE OR REPLACE FUNCTION public.list_pending_invites()
RETURNS TABLE (
  id         uuid,
  email      text,
  member_id  uuid,
  full_name  text,
  church_id  uuid,
  role       text,
  invited_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    ua.id,
    u.email::text,
    ua.member_id,
    (m.first_name || ' ' || m.last_name)::text,
    m.member_of,
    ua.role::text,
    u.invited_at
  FROM public.user_accounts AS ua
  JOIN auth.users           AS u ON u.id = ua.id
  JOIN public.members       AS m ON m.id = ua.member_id
  WHERE u.invited_at IS NOT NULL
    AND u.email_confirmed_at IS NULL
    AND (
      public.is_super_admin()
      OR (public.is_church_leader() AND m.member_of = public.get_my_church_id())
    )
  ORDER BY u.invited_at DESC
$$;

REVOKE ALL ON FUNCTION public.list_pending_invites() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_pending_invites() TO authenticated;

COMMIT;

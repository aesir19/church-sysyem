-- Restore the invite RPCs to their 0040/0041 definitions. This deliberately
-- reintroduces the pre-acceptance visibility defect; it is an operational escape
-- hatch for the migration, not a supported product state.

BEGIN;

CREATE OR REPLACE FUNCTION public.list_pending_invites()
RETURNS TABLE (
  id uuid, email text, member_id uuid, full_name text, church_id uuid,
  role text, invited_at timestamptz, orphaned boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    ua.id, u.email::text, ua.member_id,
    (m.first_name || ' ' || m.last_name)::text,
    m.member_of, ua.role::text, u.invited_at, false AS orphaned
  FROM public.user_accounts AS ua
  JOIN auth.users AS u ON u.id = ua.id
  JOIN public.members AS m ON m.id = ua.member_id
  WHERE u.invited_at IS NOT NULL
    AND u.email_confirmed_at IS NULL
    AND (
      public.is_super_admin()
      OR (public.is_church_leader() AND m.member_of = public.get_my_church_id())
    )

  UNION ALL

  SELECT
    ai.id, ai.email::text, ai.member_id,
    (m.first_name || ' ' || m.last_name)::text,
    m.member_of, ai.role::text, ai.created_at, true AS orphaned
  FROM public.account_invites AS ai
  JOIN public.members AS m ON m.id = ai.member_id
  WHERE ai.consumed_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM auth.users AS u
      WHERE lower(u.email) = ai.email AND u.email_confirmed_at IS NULL
    )
    AND (
      public.is_super_admin()
      OR (public.is_church_leader() AND m.member_of = public.get_my_church_id())
    )
  ORDER BY invited_at DESC
$$;

REVOKE ALL ON FUNCTION public.list_pending_invites() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_pending_invites() TO authenticated;

COMMENT ON FUNCTION public.list_pending_invites() IS
  'Invited-but-not-yet-accepted accounts the caller may see, plus orphaned invites whose login was removed by hand (flagged orphaned=true). Scoped: all for a Super Admin, own-church only for a Church Leader, zero rows for anyone else. Feeds the Pending invites list, where each row can be resent (live only) or cancelled.';

CREATE OR REPLACE FUNCTION public.invite_to_resend(p_email text)
RETURNS TABLE (account_id uuid, member_id uuid, role text, full_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    ua.id, ua.member_id, ua.role::text,
    (m.first_name || ' ' || m.last_name)::text
  FROM public.user_accounts AS ua
  JOIN auth.users AS u ON u.id = ua.id
  JOIN public.members AS m ON m.id = ua.member_id
  WHERE lower(u.email) = lower(trim(p_email))
    AND u.invited_at IS NOT NULL
    AND u.email_confirmed_at IS NULL
    AND (
      public.is_super_admin()
      OR (public.is_church_leader() AND m.member_of = public.get_my_church_id())
    )
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.invite_to_resend(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_to_resend(text) TO authenticated;

COMMENT ON FUNCTION public.invite_to_resend(text) IS
  'For the Edge Function''s resend path: the still-pending account (id + member + role + name) for this e-mail, but only if the caller is allowed to resend it. Zero rows means refuse.';

CREATE OR REPLACE FUNCTION public.invite_member(
  p_member uuid,
  p_role text DEFAULT NULL
)
RETURNS TABLE (email text, full_name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_email text;
  v_super boolean;
  v_member_church uuid;
  v_full_name text;
  v_role text;
BEGIN
  IF public.is_super_admin() THEN
    v_super := true;
  ELSIF public.is_church_leader() THEN
    v_super := false;
  ELSE
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT m.member_of, (m.first_name || ' ' || m.last_name), lower(trim(m.email))
    INTO v_member_church, v_full_name, v_email
  FROM public.members AS m
  WHERE m.id = p_member AND m.archived_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such active member' USING ERRCODE = '23503';
  END IF;

  IF v_email IS NULL OR v_email = '' OR position('@' IN v_email) = 0 THEN
    RAISE EXCEPTION 'that member has no e-mail on file' USING ERRCODE = '22023';
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
  IF EXISTS (SELECT 1 FROM public.account_invites AS ai
             WHERE ai.member_id = p_member AND ai.consumed_at IS NULL) THEN
    RAISE EXCEPTION 'that member already has a pending invite' USING ERRCODE = '23505';
  END IF;
  IF EXISTS (SELECT 1 FROM public.account_invites AS ai
             WHERE ai.email = v_email AND ai.consumed_at IS NULL) THEN
    RAISE EXCEPTION 'that email already has a pending invite' USING ERRCODE = '23505';
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users AS u WHERE lower(u.email) = v_email) THEN
    RAISE EXCEPTION 'that email already has an account' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.account_invites (email, member_id, role, invited_by)
  VALUES (v_email, p_member, v_role, auth.uid());

  RETURN QUERY SELECT v_email, v_full_name;
END
$$;

REVOKE ALL ON FUNCTION public.invite_member(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_member(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.invite_member(uuid, text) IS
  'The only writer of account_invites. Runs as the caller; Super Admin may set any role, a Church Leader may invite a member in their own church with no role. Derives the e-mail from the member record (never trusts a passed address) and returns it with the name so the Edge Function can send the mail. Records the invite; the Edge Function sends only if this succeeds.';

COMMIT;

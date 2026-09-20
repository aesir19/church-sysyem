-- ============================================================================
-- 0043_pending_invites_before_acceptance — keep a Supabase invite visible and
-- resendable before its recipient accepts it.
-- ============================================================================
--
-- 0038 corrected the auth lifecycle: Supabase inserts auth.users before it fills
-- invited_at, so an invited account cannot be linked safely until acceptance. That
-- leaves user_accounts.member_id NULL while the invitation is pending.
--
-- 0037/0040 still found pending invites by joining members through that NULL field.
-- The result was a live auth invite shown as an ordinary unlinked sign-up, with no
-- Resend action. The pending account_invites row already contains the authorized
-- member and role, so it is the source of truth until acceptance.
--
-- Resend has one more consequence: the Edge Function deletes the unaccepted auth
-- account before calling invite_member again. With deferred consumption, the old
-- account_invites row is still pending and used to reject that fresh call as a
-- duplicate. invite_member now retires that exact orphaned attempt and inserts a
-- fresh row, preserving both the audit trail and the partial-unique guarantees.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.list_pending_invites()
RETURNS TABLE (
  id         uuid,
  email      text,
  member_id  uuid,
  full_name  text,
  church_id  uuid,
  role       text,
  invited_at timestamptz,
  orphaned   boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  -- Live: use the linked account after acceptance-era/manual repairs, otherwise use
  -- the still-pending invite that will be consumed when the recipient accepts.
  SELECT
    ua.id,
    u.email::text,
    m.id,
    (m.first_name || ' ' || m.last_name)::text,
    m.member_of,
    coalesce(ai.role, ua.role)::text,
    u.invited_at,
    false AS orphaned
  FROM public.user_accounts AS ua
  JOIN auth.users           AS u ON u.id = ua.id
  LEFT JOIN public.account_invites AS ai
    ON ai.email = lower(u.email) AND ai.consumed_at IS NULL
  JOIN public.members AS m ON m.id = coalesce(ua.member_id, ai.member_id)
  WHERE u.invited_at IS NOT NULL
    AND u.email_confirmed_at IS NULL
    AND (
      public.is_super_admin()
      OR (public.is_church_leader() AND m.member_of = public.get_my_church_id())
    )

  UNION ALL

  -- Orphaned: the pending invite remains but its unaccepted auth account is gone.
  SELECT
    ai.id,
    ai.email::text,
    ai.member_id,
    (m.first_name || ' ' || m.last_name)::text,
    m.member_of,
    ai.role::text,
    ai.created_at,
    true AS orphaned
  FROM public.account_invites AS ai
  JOIN public.members         AS m ON m.id = ai.member_id
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

COMMENT ON FUNCTION public.list_pending_invites() IS
  'Invited-but-unaccepted accounts, resolving member/role from the pending invite until acceptance links user_accounts, plus orphaned invites whose login is gone. Scoped to Super Admin or the inviting Church Leader church.';

REVOKE ALL ON FUNCTION public.list_pending_invites() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_pending_invites() TO authenticated;

CREATE OR REPLACE FUNCTION public.invite_to_resend(p_email text)
RETURNS TABLE (
  account_id uuid,
  member_id  uuid,
  role       text,
  full_name  text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    ua.id,
    m.id,
    coalesce(ai.role, ua.role)::text,
    (m.first_name || ' ' || m.last_name)::text
  FROM public.user_accounts AS ua
  JOIN auth.users           AS u ON u.id = ua.id
  LEFT JOIN public.account_invites AS ai
    ON ai.email = lower(u.email) AND ai.consumed_at IS NULL
  JOIN public.members AS m ON m.id = coalesce(ua.member_id, ai.member_id)
  WHERE lower(u.email) = lower(trim(p_email))
    AND u.invited_at IS NOT NULL
    AND u.email_confirmed_at IS NULL
    AND (
      public.is_super_admin()
      OR (
        public.is_church_leader()
        AND m.member_of = public.get_my_church_id()
        -- Preflight must agree with invite_member before the Edge Function deletes
        -- the old auth account. A Church Leader cannot recreate a privileged role.
        AND coalesce(ai.role, ua.role) = 'unassigned'
      )
    )
  LIMIT 1
$$;

COMMENT ON FUNCTION public.invite_to_resend(text) IS
  'Returns an unaccepted invited account and its authorized member/role, resolving from account_invites before acceptance and user_accounts after a legacy/manual repair. Super Admin may resend any; Church Leader only an unassigned invite in their own church, matching invite_member before deletion. Zero rows means refuse.';

REVOKE ALL ON FUNCTION public.invite_to_resend(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_to_resend(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.invite_member(
  p_member uuid,
  p_role   text DEFAULT NULL
)
RETURNS TABLE (email text, full_name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_email         text;
  v_super         boolean;
  v_member_church uuid;
  v_full_name     text;
  v_role          text;
  v_replacing     boolean;
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

  -- After invite_to_resend authorizes the request, the Edge Function deletes the
  -- unaccepted auth account. At that point an exact pending row is the old attempt,
  -- not a competing invite. Retire it so the replacement keeps a separate audit row.
  SELECT EXISTS (
    SELECT 1
    FROM public.account_invites AS ai
    WHERE ai.member_id = p_member
      AND ai.email = v_email
      AND ai.consumed_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM auth.users AS u WHERE lower(u.email) = v_email
      )
  ) INTO v_replacing;

  IF v_replacing THEN
    UPDATE public.account_invites AS ai
       SET consumed_at = now()
     WHERE ai.member_id = p_member
       AND ai.email = v_email
       AND ai.consumed_at IS NULL;
  ELSE
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
  END IF;

  INSERT INTO public.account_invites (email, member_id, role, invited_by)
  VALUES (v_email, p_member, v_role, auth.uid());

  RETURN QUERY SELECT v_email, v_full_name;
END
$$;

COMMENT ON FUNCTION public.invite_member(uuid, text) IS
  'Records a member-first invite under caller authorization. A resend may replace the exact pending row only after its unaccepted auth account has been deleted; the old row is retained as consumed for audit.';

REVOKE ALL ON FUNCTION public.invite_member(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_member(uuid, text) TO authenticated;

COMMIT;

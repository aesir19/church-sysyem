-- 0044_pending_invite_resend_guards
--
-- 0043 made pre-acceptance invites visible and resendable. Finish the boundary:
-- refuse before the Edge Function deletes an auth account when the member can no
-- longer be invited, and keep known pending invites out of the manual-link queue.

BEGIN;

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
    -- invite_member derives the resend address from the current active member.
    -- Prove those checks before returning an account id that the Edge Function deletes.
    AND m.archived_at IS NULL
    AND lower(trim(m.email)) = lower(u.email)
    AND (
      public.is_super_admin()
      OR (
        public.is_church_leader()
        AND m.member_of = public.get_my_church_id()
        AND coalesce(ai.role, ua.role) = 'unassigned'
      )
    )
  LIMIT 1
$$;

COMMENT ON FUNCTION public.invite_to_resend(text) IS
  'Preflights an unaccepted resend before auth deletion: active member, unchanged e-mail, and caller authority to recreate the role. Resolves member/role from account_invites before acceptance and user_accounts after a legacy/manual repair.';

REVOKE ALL ON FUNCTION public.invite_to_resend(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_to_resend(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_accounts()
RETURNS TABLE (
  account_id    uuid,
  email         text,
  signed_up_at  timestamptz,
  provider      text,
  signup_name   text,
  member_id     uuid,
  member_name   text,
  church_id     uuid,
  role          text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    ua.id,
    u.email::text,
    u.created_at,
    coalesce(u.raw_app_meta_data ->> 'provider', 'email')::text,
    nullif(btrim(coalesce(
      u.raw_user_meta_data ->> 'full_name',
      u.raw_user_meta_data ->> 'name',
      ''
    )), '')::text,
    ua.member_id,
    CASE WHEN m.id IS NULL THEN NULL
         ELSE (m.first_name || ' ' || m.last_name)::text END,
    m.member_of,
    ua.role::text
  FROM public.user_accounts AS ua
  JOIN auth.users           AS u ON u.id = ua.id
  LEFT JOIN public.members  AS m ON m.id = ua.member_id
  WHERE public.is_super_admin()
    AND NOT (
      ua.member_id IS NULL
      AND u.invited_at IS NOT NULL
      AND u.email_confirmed_at IS NULL
      AND EXISTS (
        SELECT 1
        FROM public.account_invites AS ai
        WHERE ai.email = lower(u.email) AND ai.consumed_at IS NULL
      )
    )
  ORDER BY (ua.member_id IS NOT NULL), u.created_at DESC
$$;

COMMENT ON FUNCTION public.list_accounts() IS
  'Every ordinary account with its e-mail address. SuperAdmin only. A genuine pending admin invite is excluded from the manual-link queue because list_pending_invites owns that state.';

REVOKE ALL ON FUNCTION public.list_accounts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_accounts() TO authenticated;

COMMIT;

-- ============================================================================
-- 0041_fix_invite_member_ambiguous_email — qualify column references in
-- invite_member so "email" is never ambiguous.
-- ============================================================================
--
-- BUG (0040). invite_member is declared RETURNS TABLE (email text, full_name
-- text), which puts an OUTPUT variable named `email` in scope for the whole
-- body. Two guards then reference the column `email` unqualified:
--
--   WHERE email = v_email                    -- account_invites.email
--   WHERE lower(email) = v_email             -- auth.users.email
--
-- Postgres cannot tell the OUT variable from the column and raises
-- 42702 "column reference \"email\" is ambiguous". It only fires for a member
-- that gets PAST the earlier member lookup (a real, active member) — which is
-- why it slipped through: a bogus id fails at 23503 before ever reaching these
-- guards, and no real send was exercised.
--
-- FIX. Qualify both column references (account_invites.email, and an alias on
-- auth.users). No signature or behaviour change otherwise, so CREATE OR REPLACE
-- is enough. full_name has no such collision (it is only ever assigned, never
-- compared to a bare column).
-- ============================================================================

BEGIN;

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
  -- Qualified: account_invites.email, not the OUT variable `email`.
  IF EXISTS (SELECT 1 FROM public.account_invites AS ai
             WHERE ai.email = v_email AND ai.consumed_at IS NULL) THEN
    RAISE EXCEPTION 'that email already has a pending invite' USING ERRCODE = '23505';
  END IF;
  -- Qualified: auth.users.email, not the OUT variable `email`.
  IF EXISTS (SELECT 1 FROM auth.users AS u WHERE lower(u.email) = v_email) THEN
    RAISE EXCEPTION 'that email already has an account' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.account_invites (email, member_id, role, invited_by)
  VALUES (v_email, p_member, v_role, auth.uid());

  RETURN QUERY SELECT v_email, v_full_name;
END
$$;

COMMENT ON FUNCTION public.invite_member(uuid, text) IS
  'The only writer of account_invites. Runs as the caller; Super Admin may set any role, a Church Leader may invite a member in their own church with no role. Derives the e-mail from the member record (never trusts a passed address) and returns it with the name so the Edge Function can send the mail. Records the invite; the Edge Function sends only if this succeeds.';

REVOKE ALL ON FUNCTION public.invite_member(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_member(uuid, text) TO authenticated;

COMMIT;

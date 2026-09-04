-- Rollback 0041. Restores the 0040 invite_member (with the ambiguous-column bug).
-- Kept faithful to prior migration state; you almost certainly do not want this,
-- since it reinstates the 42702 "column reference email is ambiguous" failure on
-- every real invite. Roll back only to step behind 0041 as a pair with 0040.

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

  RETURN QUERY SELECT v_email, v_full_name;
END
$$;

REVOKE ALL ON FUNCTION public.invite_member(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_member(uuid, text) TO authenticated;

COMMIT;

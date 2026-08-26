-- ============================================================================
-- 0037_account_invites — send an invitation from inside the app, and tie the
-- new sign-in to a member the moment it is created.
-- ============================================================================
--
-- WHY
-- Provisioning a user has meant two systems: invite by hand in the Supabase
-- dashboard, then come back to the linking screen (0024) to attach a member.
-- Between the two there is a live account with nobody behind it. See ADR-0018.
--
-- THE SEAM, AND WHY IT IS A TABLE AND NOT METADATA
-- The invitation carries a member (and, for a Super Admin, a role). That
-- authority cannot ride in the invite's user_metadata: a self-signup can set
-- user_metadata freely, so a trigger that trusted it would let anyone hand
-- themselves 'super_admin'. So the member/role live in THIS table, which only
-- invite_member() — permission-checked, under the caller's identity — can
-- write. handle_new_user() reads the table, never anything the user controls,
-- and applies the link in the SAME transaction the account is created. No
-- forgeable path, no half-linked window.
--
-- WHO MAY DO WHAT (enforced in invite_member, mirrors set_user_role/0023):
--   Super Admin    — invite anyone, any active member, any role.
--   Church Leader  — invite anyone, active member IN THEIR OWN CHURCH, no role.
--   everyone else  — nothing (raises).
--
-- ROLLBACK: see rollback.sql.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. The table. E-mail is stored already-lowercased so the trigger can match
--    auth.users.email without a functional index; a partial unique keeps one
--    pending invite per e-mail and per member (mirrors one-member-one-login).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.account_invites (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  email       text        NOT NULL,
  member_id   uuid        NOT NULL REFERENCES public.members(id),
  role        text,                                   -- NULL = leave unassigned
  invited_by  uuid,                                   -- auth.uid() at send time
  created_at  timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz,                            -- NULL = still pending
  CONSTRAINT account_invites_pkey PRIMARY KEY (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS account_invites_email_pending_key
  ON public.account_invites (email) WHERE consumed_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS account_invites_member_pending_key
  ON public.account_invites (member_id) WHERE consumed_at IS NULL;

-- No policy is defined, on purpose. Every read and write goes through the
-- SECURITY DEFINER functions below; with RLS on and no policy, a direct
-- PostgREST call sees nothing and writes nothing. Belt-and-suspenders: no grant.
ALTER TABLE public.account_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.account_invites FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. The single sanctioned writer. Runs as the CALLER (via the Edge Function's
--    forwarded JWT), so is_super_admin()/is_church_leader()/get_my_church_id()
--    all decide against the real user. Raises on any violation — the function
--    sends no e-mail when this raises.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invite_member(
  p_email  text,
  p_member uuid,
  p_role   text DEFAULT NULL
)
RETURNS text     -- the member's full name, for the invite greeting
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_email        text := lower(trim(p_email));
  v_super        boolean;
  v_member_church uuid;
  v_full_name    text;
  v_role         text;
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

  -- The member must exist and be active. An archived member is not a person who
  -- should be gaining access (same rule as link_account_to_member/0022). Read as
  -- DEFINER so a Super Admin inviting another church's member still resolves the
  -- name that the members RLS policy would otherwise hide.
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
    -- Church Leader: own church only, and never a role. Roles are the Super
    -- Admin's alone (set_user_role/0023 says the same).
    IF v_member_church IS DISTINCT FROM public.get_my_church_id() THEN
      RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
    END IF;
    IF p_role IS NOT NULL AND p_role <> 'unassigned' THEN
      RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
    END IF;
    v_role := NULL;
  END IF;

  -- One member, one login — and one pending invite. Refuse if the member is
  -- already linked, already invited, or the e-mail already exists or is pending.
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

COMMENT ON FUNCTION public.invite_member(text, uuid, text) IS
  'The only writer of account_invites. Runs as the caller; Super Admin may set any role, a Church Leader may invite a member in their own church with no role. Records the invite; the Edge Function sends the e-mail only if this succeeds.';

REVOKE ALL ON FUNCTION public.invite_member(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_member(text, uuid, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. The pending queue. "Pending" means INVITED BUT NOT YET ACCEPTED, which is a
--    fact about auth.users, not about account_invites: sending an invite creates
--    the account at once, so its account_invites row is consumed immediately and
--    would vanish from any list keyed on it. The real signal is invited_at set
--    (an admin invite) with email_confirmed_at still null (they have not set a
--    password yet). Scoped like list_accounts: all for a Super Admin, own-church
--    for a Church Leader, zero rows to everyone else.
-- ----------------------------------------------------------------------------
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

COMMENT ON FUNCTION public.list_pending_invites() IS
  'Invited-but-not-yet-accepted accounts the caller may see (invited_at set, email not confirmed): all for a Super Admin, own-church only for a Church Leader, zero rows for anyone else. Feeds the Pending invites list.';

REVOKE ALL ON FUNCTION public.list_pending_invites() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_pending_invites() TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. Resend lookup. Resend can't re-mail an existing account through the built-in
--    mailer, so the Edge Function resends by clearing the un-accepted account and
--    inviting fresh (delete cascades user_accounts via the auth.users FK, which
--    unlinks the member so invite_member accepts again). This returns what the
--    function needs to do that — the account to delete, and the member/role/name
--    to re-invite with — but ONLY for an account the caller is allowed to resend
--    (their own church, for a Church Leader) that is genuinely still pending. Zero
--    rows otherwise, so the function refuses.
-- ----------------------------------------------------------------------------
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
    ua.member_id,
    ua.role::text,
    (m.first_name || ' ' || m.last_name)::text
  FROM public.user_accounts AS ua
  JOIN auth.users           AS u ON u.id = ua.id
  JOIN public.members       AS m ON m.id = ua.member_id
  WHERE lower(u.email) = lower(trim(p_email))
    AND u.invited_at IS NOT NULL
    AND u.email_confirmed_at IS NULL
    AND (
      public.is_super_admin()
      OR (public.is_church_leader() AND m.member_of = public.get_my_church_id())
    )
  LIMIT 1
$$;

COMMENT ON FUNCTION public.invite_to_resend(text) IS
  'For the Edge Function''s resend path: the still-pending account (id + member + role + name) for this e-mail, but only if the caller is allowed to resend it. Zero rows means refuse.';

REVOKE ALL ON FUNCTION public.invite_to_resend(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_to_resend(text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. Teach the new-account trigger to consume an invite atomically. The body is
--    otherwise 0006's: create the user_accounts row, then — if this e-mail was
--    invited — apply the pre-authorised member and role and mark the invite
--    consumed, all inside the one transaction auth.users insertion runs in.
--
--    search_path stays '' (0006's choice), so everything is fully-qualified.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
begin
  begin
    insert into public.user_accounts (id) values (new.id);

    -- Atomic linking — but ONLY for a genuine admin invitation. new.invited_at is
    -- set by the auth admin invite API (inviteUserByEmail) and by nothing a client
    -- can reach: a public self-signup leaves it null and cannot forge it. Without
    -- this guard, someone could self-sign-up as an address that happens to have a
    -- pending invite and inherit its member AND role (up to super_admin) by matching
    -- on e-mail alone. The guard is the seam that makes the e-mail match safe.
    --
    -- Only rows written by invite_member() are ever in account_invites, so once we
    -- know this is the invited account, the member and role are already authorised.
    -- coalesce keeps the default role ('unassigned') when the invite carried none
    -- (a Church Leader's invite).
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
    raise;  -- re-raise so you still see it, but now logged with detail
  end;
  return new;
end;
$function$;

COMMIT;

-- New functions, so PostgREST will 404 them until the schema cache reloads:
--   NOTIFY pgrst, 'reload schema';

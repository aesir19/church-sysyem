-- ============================================================================
-- 0040_member_first_invites — the invite is anchored to a member, not a typed
-- e-mail, and a pending invite can be cancelled from inside the app.
-- ============================================================================
--
-- WHY
-- Two problems, one migration (see ADR-0019):
--
--   1. The address was typed by hand. invite_member(p_email, p_member, …) trusted
--      whatever e-mail the caller passed. A mistyped address either failed to match
--      a member or — worse — went to the wrong place. The member already carries an
--      e-mail; that is the only address an invite should ever use. So the caller now
--      passes a MEMBER, and this function reads the address off the member record
--      itself. E-mail stops being a caller-controlled parameter (rule 2: one fewer
--      forgeable field).
--
--   2. A wrong invite stranded the member. Sending an invite creates an auth.users
--      account at once AND an account_invites row. Deleting the account by hand in
--      the dashboard removed the login but left the account_invites row (it has no
--      FK to auth.users — it keys on e-mail + member). That orphaned row then blocked
--      re-inviting the member forever ("that member already has a pending invite").
--      The owner chose an in-app Cancel over an auto-cleanup trigger, so this adds
--      cancel_invite() + invite_to_cancel(), and widens list_pending_invites() to
--      surface orphaned invites so Cancel can reach the ones already stuck.
--
-- WHAT CHANGES
--   invite_member(uuid, text)        — was (text, uuid, text). Derives the e-mail
--                                       from the member; returns (email, full_name)
--                                       so the Edge Function knows where to mail.
--                                       Raises if the member has no e-mail on file.
--   invite_to_cancel(text)           — NEW. The pending invite (live or orphaned)
--                                       the caller may cancel; the auth account id to
--                                       delete, NULL when the login is already gone.
--   cancel_invite(text)              — NEW. Marks the pending account_invites row
--                                       consumed so the member/e-mail guards release.
--   list_pending_invites()           — now UNIONs live invites with orphaned ones,
--                                       flagged `orphaned`, so both can be cancelled.
--
-- SCOPE (unchanged, enforced in every function): Super Admin — anyone, any active
-- member, any role. Church Leader — a member IN THEIR OWN CHURCH, no role. Everyone
-- else — nothing.
--
-- ROLLBACK: see rollback.sql. It restores the 0037/0038 three-argument invite_member
-- and the e-mail-only list, and drops the two new functions.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. invite_member — member-first. The e-mail is the member's, read here, never
--    passed in. Returns it (with the name) so the Edge Function can send the mail.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.invite_member(text, uuid, text);

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

  -- The member must exist and be active, and carries the ONE address the invite may
  -- use. Read as DEFINER so a Super Admin inviting another church's member still
  -- resolves the name and e-mail the members RLS policy would otherwise hide. The
  -- address is lowercased/trimmed so the accept trigger matches auth.users.email.
  SELECT m.member_of, (m.first_name || ' ' || m.last_name), lower(trim(m.email))
    INTO v_member_church, v_full_name, v_email
  FROM public.members AS m
  WHERE m.id = p_member AND m.archived_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such active member' USING ERRCODE = '23503';
  END IF;

  -- No address on the record, nothing to invite to. The invite dialog greys these
  -- members out with a prompt to add an e-mail first; this is the enforcement behind
  -- that, so a crafted call cannot get past the greyed-out state.
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
    -- Church Leader: own church only, and never a role. Roles are the Super Admin's
    -- alone (set_user_role/0023 says the same).
    IF v_member_church IS DISTINCT FROM public.get_my_church_id() THEN
      RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
    END IF;
    IF p_role IS NOT NULL AND p_role <> 'unassigned' THEN
      RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
    END IF;
    v_role := NULL;
  END IF;

  -- One member, one login — and one pending invite. Refuse if the member is already
  -- linked, already invited, or the (derived) e-mail already exists or is pending.
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

COMMENT ON FUNCTION public.invite_member(uuid, text) IS
  'The only writer of account_invites. Runs as the caller; Super Admin may set any role, a Church Leader may invite a member in their own church with no role. Derives the e-mail from the member record (never trusts a passed address) and returns it with the name so the Edge Function can send the mail. Records the invite; the Edge Function sends only if this succeeds.';

REVOKE ALL ON FUNCTION public.invite_member(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_member(uuid, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. invite_to_cancel — the Edge Function's cancel lookup. The pending invite this
--    caller is allowed to cancel, live OR orphaned, and the un-accepted auth account
--    to delete (NULL when the login was already removed by hand and only the invite
--    record lingers). Zero rows => the function refuses. Scoped like resend: own
--    church for a Church Leader, everything for a Super Admin.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invite_to_cancel(p_email text)
RETURNS TABLE (
  account_id uuid,
  member_id  uuid,
  full_name  text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    u.id,                              -- NULL when no un-accepted login exists (orphan)
    ai.member_id,
    (m.first_name || ' ' || m.last_name)::text
  FROM public.account_invites AS ai
  JOIN public.members         AS m ON m.id = ai.member_id
  LEFT JOIN auth.users        AS u
    ON lower(u.email) = ai.email AND u.email_confirmed_at IS NULL
  WHERE ai.consumed_at IS NULL
    AND ai.email = lower(trim(p_email))
    AND (
      public.is_super_admin()
      OR (public.is_church_leader() AND m.member_of = public.get_my_church_id())
    )
  LIMIT 1
$$;

COMMENT ON FUNCTION public.invite_to_cancel(text) IS
  'For the Edge Function''s cancel path: the pending invite (live or orphaned) this caller may cancel, with the un-accepted auth account id to delete (NULL for an orphan). Zero rows means refuse.';

REVOKE ALL ON FUNCTION public.invite_to_cancel(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_to_cancel(text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. cancel_invite — clears the pending account_invites row so the member/e-mail
--    guards in invite_member release. Called AFTER the Edge Function has deleted the
--    un-accepted auth account (order matters: deleting the account cascades
--    user_accounts and unlinks the member; only then does clearing the invite let a
--    fresh invite through). Append-only, like 0039: the row is marked consumed rather
--    than deleted, so the trail of who was invited and when survives. Re-checks scope
--    so this is safe to expose to the caller directly.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_invite(p_email text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_email text := lower(trim(p_email));
  v_name  text;
BEGIN
  SELECT (m.first_name || ' ' || m.last_name)
    INTO v_name
  FROM public.account_invites AS ai
  JOIN public.members         AS m ON m.id = ai.member_id
  WHERE ai.consumed_at IS NULL
    AND ai.email = v_email
    AND (
      public.is_super_admin()
      OR (public.is_church_leader() AND m.member_of = public.get_my_church_id())
    )
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no pending invite you can cancel for that address' USING ERRCODE = '42501';
  END IF;

  UPDATE public.account_invites
     SET consumed_at = now()
   WHERE email = v_email AND consumed_at IS NULL;

  RETURN v_name;
END
$$;

COMMENT ON FUNCTION public.cancel_invite(text) IS
  'Cancels a pending invite: marks the account_invites row consumed so re-inviting the member is allowed again. Scoped to the caller (own church for a Church Leader). The Edge Function deletes the un-accepted auth account first; this releases the invite record.';

REVOKE ALL ON FUNCTION public.cancel_invite(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_invite(text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. list_pending_invites — now two kinds of row. A LIVE pending invite is an
--    un-accepted auth account (the normal state). An ORPHANED pending invite is an
--    account_invites row whose login no longer exists — it stopped showing in the
--    live set the moment the account was deleted by hand, yet it still blocks
--    re-inviting the member. Surfacing it (flagged `orphaned`) is what lets Cancel
--    reach it. The two sets are disjoint: a live invite has an un-accepted auth row,
--    which the orphan branch's NOT EXISTS excludes.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.list_pending_invites();

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
  -- Live: invited, not yet accepted (invited_at set, e-mail not confirmed).
  SELECT
    ua.id,
    u.email::text,
    ua.member_id,
    (m.first_name || ' ' || m.last_name)::text,
    m.member_of,
    ua.role::text,
    u.invited_at,
    false AS orphaned
  FROM public.user_accounts AS ua
  JOIN auth.users           AS u ON u.id = ua.id
  JOIN public.members       AS m ON m.id = ua.member_id
  WHERE u.invited_at IS NOT NULL
    AND u.email_confirmed_at IS NULL
    AND (
      public.is_super_admin()
      OR (public.is_church_leader() AND m.member_of = public.get_my_church_id())
    )

  UNION ALL

  -- Orphaned: the invite record is still pending but its login is gone. It no longer
  -- appears above and silently blocks re-inviting the member until cleared.
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
  'Invited-but-not-yet-accepted accounts the caller may see, plus orphaned invites whose login was removed by hand (flagged orphaned=true). Scoped: all for a Super Admin, own-church for a Church Leader, zero rows for anyone else. Feeds the Pending invites list, where each row can be resent (live only) or cancelled.';

REVOKE ALL ON FUNCTION public.list_pending_invites() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_pending_invites() TO authenticated;

COMMIT;

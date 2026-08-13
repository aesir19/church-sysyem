-- ============================================================================
-- 0024_church_accounts — the list the pastor assignment screen actually needs.
-- ============================================================================
--
-- WHY
-- A gap found building against 0022 rather than reading it. A Head Pastor may appoint
-- pastors — set_user_role() says so — but had no way to see a single account:
--
--   * list_accounts() is SuperAdmin-only, and rightly so: it returns every e-mail
--     address in the system.
--   * user_accounts is self-read only, so a direct query returns one row, their own.
--
-- So the pastor assignment screen would have rendered empty for exactly the role it
-- exists to serve, and the widening in 0022 would have been unreachable through the UI.
--
-- WHAT THIS ADDS, AND WHAT IT WITHHOLDS
-- Accounts by church, carrying the person's name and their role — no e-mail address,
-- no birthdate, no contact details. That matters: a Head Pastor is deliberately outside
-- can_see_member_detail (0015) and sees only the name/group directory. Names are
-- already visible to them through directory_search(), so this adds no new exposure; it
-- reshapes what they can already see into the form the screen needs. SuperAdmin gets
-- e-mail addresses from list_accounts(), which stays as it was.
--
-- ROLLBACK: see rollback.sql.
-- ============================================================================

BEGIN;

-- Accounts belonging to one church, or to every church when p_church_id is NULL.
--
-- Only accounts LINKED to an active member appear. An unlinked account has no church,
-- so it cannot be pastor of one — and surfacing it here would offer an appointment that
-- assign/set_user_role would then have to refuse. Linking comes first; that is the
-- whole reason it is the first slice.
CREATE OR REPLACE FUNCTION public.list_church_accounts(p_church_id uuid DEFAULT NULL)
RETURNS TABLE (
  account_id  uuid,
  member_id   uuid,
  church_id   uuid,
  full_name   text,
  role        text,
  leads_count integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    ua.id,
    m.id,
    m.member_of,
    (m.first_name || ' ' || m.last_name)::text,
    ua.role::text,
    (
      SELECT count(*)::integer
      FROM public.small_group_leaders AS sgl
      WHERE sgl.account_id = ua.id
    )
  FROM public.user_accounts AS ua
  JOIN public.members       AS m ON m.id = ua.member_id
  WHERE (public.is_super_admin() OR public.is_head_pastor())
    AND m.archived_at IS NULL
    AND (p_church_id IS NULL OR m.member_of = p_church_id)
  ORDER BY m.last_name, m.first_name
$$;

COMMENT ON FUNCTION public.list_church_accounts(uuid) IS
  'Linked accounts by church, with name and role but no e-mail or other PII. SuperAdmin and Head Pastor only; zero rows to everyone else. Feeds the pastor assignment screen, which a Head Pastor must be able to use.';

REVOKE ALL ON FUNCTION public.list_church_accounts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_church_accounts(uuid) TO authenticated;

COMMIT;

-- New function, so PostgREST will 404 it until:  NOTIFY pgrst, 'reload schema';

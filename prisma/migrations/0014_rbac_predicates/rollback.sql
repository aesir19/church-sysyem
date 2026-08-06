-- ============================================================================
-- Rollback for 0014_rbac_predicates.
-- ============================================================================
-- Restores is_finance_member() to its 0008 name-based definition, drops every
-- predicate this migration added, drops the ministry_key index and column.
--
-- NOT fully clean: the seeded 'Secretariat' and 'Welcome Team' Ministry rows are
-- LEFT IN PLACE (dropping them could cascade group_members added since deploy).
-- After this runs they are ordinary ministries with no slug. Remove them by hand
-- only after confirming they hold no membership you intend to keep.
--
-- Run only if migrations 0015–0017 have already been rolled back — their policies
-- call these functions and will break the moment the functions disappear.
-- ============================================================================

BEGIN;

-- Restore is_finance_member() to the 0008 body BEFORE dropping ministry_key, so it
-- no longer references the column.
CREATE OR REPLACE FUNCTION public.is_finance_member()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_accounts AS ua
    JOIN public.group_members AS gm ON gm.member_id = ua.member_id
    JOIN public.groups        AS g  ON g.id = gm.group_id
    WHERE ua.id = auth.uid()
      AND g.name = 'Finance Team'
      AND g.type = 'Ministry'
      AND g.church_id IS NULL
  )
$$;

DROP FUNCTION IF EXISTS public.can_manage_small_groups();
DROP FUNCTION IF EXISTS public.can_manage_group_members(uuid);
DROP FUNCTION IF EXISTS public.can_manage_attendance();
DROP FUNCTION IF EXISTS public.can_write_finance();
DROP FUNCTION IF EXISTS public.can_write_members();
DROP FUNCTION IF EXISTS public.can_view_attendance();
DROP FUNCTION IF EXISTS public.can_view_finance();
DROP FUNCTION IF EXISTS public.can_see_member_detail();
DROP FUNCTION IF EXISTS public.can_write_church(uuid);
DROP FUNCTION IF EXISTS public.can_read_church(uuid);
DROP FUNCTION IF EXISTS public.is_finance_group(uuid);
DROP FUNCTION IF EXISTS public.is_welcome_team();
DROP FUNCTION IF EXISTS public.is_secretariat();
DROP FUNCTION IF EXISTS public.is_in_ministry(text);
DROP FUNCTION IF EXISTS public.is_church_leader();
DROP FUNCTION IF EXISTS public.is_pastor();
DROP FUNCTION IF EXISTS public.is_head_pastor();
DROP FUNCTION IF EXISTS public.is_super_admin();
DROP FUNCTION IF EXISTS public.my_role();

DROP INDEX IF EXISTS public.groups_ministry_key_key;
ALTER TABLE public.groups DROP COLUMN IF EXISTS ministry_key;

COMMIT;

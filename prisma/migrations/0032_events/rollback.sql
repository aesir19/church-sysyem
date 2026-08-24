-- Rollback for 0032_events. Reverses the migration in dependency order and restores
-- get_my_permissions() to its pre-0032 (9-column) shape. The Events Team ministry row is
-- left in place but its slug is cleared, so no login silently keeps 'events' powers.

BEGIN;

-- Cross-link columns (drops the FK constraints and indexes with them).
ALTER TABLE public.collections DROP COLUMN IF EXISTS event_id;
ALTER TABLE public.expenses    DROP COLUMN IF EXISTS event_id;

-- The events table and its policies.
DROP POLICY IF EXISTS events_delete_own_church ON public.events;
DROP POLICY IF EXISTS events_update_own_church ON public.events;
DROP POLICY IF EXISTS events_insert_own_church ON public.events;
DROP POLICY IF EXISTS events_select_visible    ON public.events;
DROP TABLE IF EXISTS public.events;

-- Restore get_my_permissions to the pre-0032 shape (as left by 0022).
DROP FUNCTION IF EXISTS public.get_my_permissions();
CREATE FUNCTION public.get_my_permissions()
RETURNS TABLE (
  role                   text,
  is_super_admin         boolean,
  is_head_pastor         boolean,
  is_pastor              boolean,
  is_church_leader       boolean,
  is_finance             boolean,
  is_secretariat         boolean,
  is_welcome             boolean,
  is_small_group_leader  boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    public.my_role(),
    public.is_super_admin(),
    public.is_head_pastor(),
    public.is_pastor(),
    public.is_church_leader(),
    public.is_finance_member(),
    public.is_secretariat(),
    public.is_welcome_team(),
    public.is_small_group_leader()
$$;
REVOKE ALL ON FUNCTION public.get_my_permissions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_permissions() TO authenticated;

-- The capability predicates.
DROP FUNCTION IF EXISTS public.can_manage_events();
DROP FUNCTION IF EXISTS public.can_view_events();
DROP FUNCTION IF EXISTS public.is_events_team();

-- Clear the slug so 'events' grants nothing. The ministry row itself is left; deleting a
-- ministry that may have gained members is not the rollback's call.
UPDATE public.ministries SET ministry_key = NULL WHERE ministry_key = 'events';

COMMIT;

-- NOTIFY pgrst, 'reload schema';

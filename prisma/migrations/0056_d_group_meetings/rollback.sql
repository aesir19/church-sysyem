-- Rollback for 0056 — Group meetings.
-- Restores the 0032/0034 policies and the 0046/0047/0051 functions, then drops the group
-- link. Group meetings made since 0056 lose their group and fall back to the church-wide
-- rule — so take them down (or note their locations) BEFORE rolling back, or a member's
-- home address becomes visible to the whole church.

BEGIN;

DROP POLICY events_select_visible ON public.events;
CREATE POLICY events_select_visible ON public.events FOR SELECT TO authenticated
USING (public.can_read_church(church_id) AND (public.can_view_events() OR status = 'published'));
DROP POLICY events_insert_own_church ON public.events;
CREATE POLICY events_insert_own_church ON public.events FOR INSERT TO authenticated
WITH CHECK (public.can_manage_events() AND public.can_write_church(church_id));
DROP POLICY events_update_own_church ON public.events;
CREATE POLICY events_update_own_church ON public.events FOR UPDATE TO authenticated
USING (public.can_manage_events() AND public.can_write_church(church_id))
WITH CHECK (public.can_manage_events() AND public.can_write_church(church_id));
DROP POLICY events_delete_own_church ON public.events;
CREATE POLICY events_delete_own_church ON public.events FOR DELETE TO authenticated
USING (public.can_manage_events() AND public.can_write_church(church_id));

DROP POLICY event_series_select_visible ON public.event_series;
CREATE POLICY event_series_select_visible ON public.event_series FOR SELECT TO authenticated
USING (public.can_read_church(church_id) AND (public.can_view_events() OR status = 'published'));
DROP POLICY event_series_insert_own_church ON public.event_series;
CREATE POLICY event_series_insert_own_church ON public.event_series FOR INSERT TO authenticated
WITH CHECK (public.can_manage_events() AND public.can_write_church(church_id));
DROP POLICY event_series_update_own_church ON public.event_series;
CREATE POLICY event_series_update_own_church ON public.event_series FOR UPDATE TO authenticated
USING (public.can_manage_events() AND public.can_write_church(church_id))
WITH CHECK (public.can_manage_events() AND public.can_write_church(church_id));
DROP POLICY event_series_delete_own_church ON public.event_series;
CREATE POLICY event_series_delete_own_church ON public.event_series FOR DELETE TO authenticated
USING (public.can_manage_events() AND public.can_write_church(church_id));

COMMIT;

-- The five functions: re-run their latest definitions, which reference no group column —
--   preview_delete_event_series, delete_event_series   from 0046_event_series_delete
--   event_edit_state                                    from 0047_event_date_move
--   preview_split_event_series, split_event_series      from 0051_event_series_split_actual_dates
-- Then:

BEGIN;

DROP TRIGGER IF EXISTS events_take_series_group ON public.events;
DROP FUNCTION IF EXISTS public.events_take_series_group();
DROP FUNCTION IF EXISTS public.can_edit_group_event(uuid, uuid);
DROP FUNCTION IF EXISTS public.can_see_group_meeting(uuid);
DROP FUNCTION IF EXISTS public.in_small_group(uuid);
DROP FUNCTION IF EXISTS public.leads_small_group(uuid);

ALTER TABLE public.events DROP COLUMN IF EXISTS small_group_id;
ALTER TABLE public.event_series DROP COLUMN IF EXISTS small_group_id;
ALTER TABLE public.small_groups DROP CONSTRAINT IF EXISTS small_groups_id_church_key;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Rollback for 0034_event_series. Reverses the migration in dependency order: the events
-- occurrence columns (which carry the FK to event_series) come off first, then the series
-- table and its policies. Exception rows lose their series link; the events themselves stay
-- (dropping the columns does not delete rows), so no attendance history is lost.

BEGIN;

-- events occurrence columns (drops the FK, the CHECK, and the two indexes with them).
DROP INDEX IF EXISTS public.events_series_idx;
DROP INDEX IF EXISTS public.events_series_occurrence_uniq;
ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_series_occurrence_check,
  DROP CONSTRAINT IF EXISTS events_series_fkey,
  DROP COLUMN IF EXISTS occurrence_date,
  DROP COLUMN IF EXISTS series_id;

-- event_series table and its policies.
DROP POLICY IF EXISTS event_series_delete_own_church ON public.event_series;
DROP POLICY IF EXISTS event_series_update_own_church ON public.event_series;
DROP POLICY IF EXISTS event_series_insert_own_church ON public.event_series;
DROP POLICY IF EXISTS event_series_select_visible    ON public.event_series;
DROP TABLE IF EXISTS public.event_series;

COMMIT;

-- NOTIFY pgrst, 'reload schema';

-- Rollback for 0057 — back to 0034's partial index (which breaks the app's one-date saves again).

BEGIN;

CREATE UNIQUE INDEX events_series_occurrence_uniq
  ON public.events (series_id, occurrence_date) WHERE series_id IS NOT NULL;

ALTER TABLE public.events DROP CONSTRAINT events_series_occurrence_key;

COMMIT;

NOTIFY pgrst, 'reload schema';

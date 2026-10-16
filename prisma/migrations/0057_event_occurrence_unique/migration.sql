-- 0057_event_occurrence_unique — make "save one date of a repeating event" work.
--
-- THE BUG. The app saves one date (Skip this date, This date only, and a Group meeting's
-- cancel / move / edit) with supabase .upsert(row, { onConflict: 'series_id,occurrence_date' }),
-- which PostgREST runs as INSERT … ON CONFLICT (series_id, occurrence_date) DO UPDATE. The only
-- uniqueness on those columns was 0034's PARTIAL index (… WHERE series_id IS NOT NULL). ON
-- CONFLICT can use a partial index only when the statement repeats its predicate, which
-- PostgREST never sends, so every such save failed with 42P10. Found live on staging on
-- 2026-10-16 (tests/db/event-occurrence-save.test.js reproduces it).
--
-- THE FIX. An ordinary unique constraint on the same two columns. It means exactly what the
-- partial index meant: Postgres never treats NULLs as equal, so the one-off events (series_id
-- NULL) never clash with each other, while a series still has at most one saved row per date.
-- No data changes; any existing rows already satisfied the partial index.
--
-- ROLLBACK: see rollback.sql.

BEGIN;

ALTER TABLE public.events
  ADD CONSTRAINT events_series_occurrence_key UNIQUE (series_id, occurrence_date);

DROP INDEX public.events_series_occurrence_uniq;

COMMIT;

NOTIFY pgrst, 'reload schema';

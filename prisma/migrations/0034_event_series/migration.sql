-- 0034_event_series — Calendar & Events, Stage 2 (#86): recurring event series.
--
-- Adds event_series (the repeat RULE) and the two columns on events that turn a plain event
-- into an OCCURRENCE of a series. The design decision that keeps everything else cheap:
--
--   An occurrence is worked out from the rule, NOT stored. The Calendar/Week/Agenda compute a
--   series' dates in JS (src/lib/recurrence.js), the same way expandWeeklySchedules already
--   draws the weekly services — nothing is written just because someone looks at a month
--   (rule 1: no write-on-read, no scheduled compute). A row is written to events ONLY when a
--   single date is genuinely changed: moved, cancelled (a skipped week), or given attendance.
--   Such a row is an "exception": it carries series_id + occurrence_date (the slot it
--   replaces), and mergeSeriesOccurrences suppresses the worked-out occupant of that slot so
--   it never double-counts. Everything Stage 1 built on events — RLS, detail, cross-links —
--   works on an exception row with no special case.
--
-- RLS is a copy of the events story (0032): event_series has the SAME two-audience SELECT
-- (privileged five see drafts in a readable church; everyone else sees only published series
-- in their own church) and the SAME manage-gated writes. One story, told twice.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The event_series table — the repeat rule and the shared event fields.
-- ---------------------------------------------------------------------------
CREATE TABLE public.event_series (
  id               uuid        NOT NULL DEFAULT gen_random_uuid(),
  church_id        uuid        NOT NULL,
  title            text        NOT NULL,
  kind             text        NOT NULL,
  status           text        NOT NULL DEFAULT 'draft',
  location         text,
  description      text,
  run_by           text,
  projected_budget numeric(12,2),

  -- The recurrence rule, as explicit columns (NOT an RFC 5545 RRULE string — see #86: the
  -- cadences below are the whole requirement, and explicit columns are queryable and need no
  -- parser). src/lib/recurrence.js is the one reader of these.
  cadence          text        NOT NULL,   -- weekly | monthly | twice_monthly
  interval_n       integer     NOT NULL DEFAULT 1,  -- every N weeks (weekly) / N months (monthly)
  anchor           text,                    -- weekday | date  (monthly & twice_monthly)
  weekday          smallint,                -- 0–6, Sunday = 0 (weekly; weekday anchor)
  week_of_month    smallint,                -- 1–5, or -1 = last (weekday anchor)
  day_of_month     smallint,                -- 1–31 (date anchor)
  weekday2         smallint,                -- second anchor, twice_monthly weekday
  week_of_month2   smallint,
  day_of_month2    smallint,                -- second anchor, twice_monthly date
  time_start       time        NOT NULL,
  time_end         time,
  starts_on        date        NOT NULL,
  ends_on          date,                    -- inclusive last date, or NULL = open-ended
  count_n          integer,                 -- cap to N occurrences, or NULL = uncapped

  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  published_at     timestamptz,

  CONSTRAINT event_series_pkey PRIMARY KEY (id),
  -- Composite unique so events can FK (series_id, church_id) and an occurrence can never
  -- point at a series in another church — the guard events↔churches already uses.
  CONSTRAINT event_series_id_church_key UNIQUE (id, church_id),
  CONSTRAINT event_series_church_fkey FOREIGN KEY (church_id)
    REFERENCES public.churches (id) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT event_series_kind_check CHECK (kind IN
    ('service', 'group_meeting', 'special_service', 'outreach', 'administrative')),
  CONSTRAINT event_series_status_check CHECK (status IN ('draft', 'published')),
  CONSTRAINT event_series_cadence_check CHECK (cadence IN ('weekly', 'monthly', 'twice_monthly')),
  CONSTRAINT event_series_interval_check CHECK (interval_n >= 1),
  CONSTRAINT event_series_anchor_check CHECK (anchor IS NULL OR anchor IN ('weekday', 'date')),
  CONSTRAINT event_series_weekday_check CHECK (weekday IS NULL OR weekday BETWEEN 0 AND 6),
  CONSTRAINT event_series_weekday2_check CHECK (weekday2 IS NULL OR weekday2 BETWEEN 0 AND 6),
  CONSTRAINT event_series_wom_check CHECK (week_of_month IS NULL OR week_of_month = -1 OR week_of_month BETWEEN 1 AND 5),
  CONSTRAINT event_series_wom2_check CHECK (week_of_month2 IS NULL OR week_of_month2 = -1 OR week_of_month2 BETWEEN 1 AND 5),
  CONSTRAINT event_series_dom_check CHECK (day_of_month IS NULL OR day_of_month BETWEEN 1 AND 31),
  CONSTRAINT event_series_dom2_check CHECK (day_of_month2 IS NULL OR day_of_month2 BETWEEN 1 AND 31),
  CONSTRAINT event_series_count_check CHECK (count_n IS NULL OR count_n >= 1),
  CONSTRAINT event_series_time_order_check CHECK (time_end IS NULL OR time_end >= time_start),
  CONSTRAINT event_series_end_order_check CHECK (ends_on IS NULL OR ends_on >= starts_on),
  -- A published series has a publish time; a draft does not. Same honesty check events keeps.
  CONSTRAINT event_series_published_at_check CHECK (
    (status = 'published' AND published_at IS NOT NULL) OR (status <> 'published')
  ),
  -- The rule must actually name a day for its cadence. weekly needs a weekday; a date anchor
  -- needs day_of_month; a weekday anchor needs weekday + week_of_month. twice_monthly needs
  -- the second anchor of the matching kind too.
  CONSTRAINT event_series_rule_shape_check CHECK (
    (cadence = 'weekly' AND weekday IS NOT NULL)
    OR (cadence = 'monthly' AND anchor = 'date' AND day_of_month IS NOT NULL)
    OR (cadence = 'monthly' AND anchor = 'weekday' AND weekday IS NOT NULL AND week_of_month IS NOT NULL)
    OR (cadence = 'twice_monthly' AND anchor = 'date' AND day_of_month IS NOT NULL AND day_of_month2 IS NOT NULL)
    OR (cadence = 'twice_monthly' AND anchor = 'weekday'
        AND weekday IS NOT NULL AND week_of_month IS NOT NULL
        AND weekday2 IS NOT NULL AND week_of_month2 IS NOT NULL)
  )
);

CREATE INDEX event_series_church_idx ON public.event_series (church_id, status);

COMMENT ON TABLE public.event_series IS
  'The repeat RULE for a recurring event (Stage 2, #86). Occurrences are NOT stored — they '
  'are worked out from these columns in src/lib/recurrence.js. A materialised events row with '
  'series_id + occurrence_date is an exception (a moved/cancelled/attended date), not the norm.';

ALTER TABLE public.event_series ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.event_series FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.event_series TO authenticated;

-- SELECT — the same two audiences as events: the privileged five read every series in a
-- readable church (drafts included); every other member reads only published series in their
-- own church. This is what decides which worked-out occurrences each viewer sees.
CREATE POLICY event_series_select_visible
ON public.event_series
FOR SELECT
TO authenticated
USING (
  public.can_read_church(church_id)
  AND (public.can_view_events() OR status = 'published')
);

CREATE POLICY event_series_insert_own_church
ON public.event_series
FOR INSERT
TO authenticated
WITH CHECK (public.can_manage_events() AND public.can_write_church(church_id));

CREATE POLICY event_series_update_own_church
ON public.event_series
FOR UPDATE
TO authenticated
USING (public.can_manage_events() AND public.can_write_church(church_id))
WITH CHECK (public.can_manage_events() AND public.can_write_church(church_id));

CREATE POLICY event_series_delete_own_church
ON public.event_series
FOR DELETE
TO authenticated
USING (public.can_manage_events() AND public.can_write_church(church_id));

-- ---------------------------------------------------------------------------
-- 2. events gains the two occurrence columns.
-- ---------------------------------------------------------------------------
-- series_id: the series this row is an exception of (NULL for a one-off event — nothing about
-- a one-off changes). The FK is composite (series_id, church_id) so an occurrence can never
-- point at a series in another church.
--
-- ON DELETE NO ACTION (not SET NULL): a composite FK that includes the NOT NULL church_id
-- cannot be SET NULL. Deletion is app-managed instead, which is exactly what "keep the past,
-- drop the future" needs: eventSeries.js deleteSeries() detaches PAST occurrences (clears
-- series_id + occurrence_date, so they survive as standalone events with their attendance)
-- and deletes FUTURE ones, before deleting the series. (A church delete still cascades cleanly:
-- it deletes both the events rows and the event_series rows, so nothing dangles.)
--
-- occurrence_date: which worked-out slot this row overrides, so mergeSeriesOccurrences can
-- suppress the virtual occupant of that slot. Set together with series_id.
ALTER TABLE public.events
  ADD COLUMN series_id       uuid,
  ADD COLUMN occurrence_date date,
  ADD CONSTRAINT events_series_fkey FOREIGN KEY (series_id, church_id)
    REFERENCES public.event_series (id, church_id) ON DELETE NO ACTION ON UPDATE NO ACTION,
  -- An exception names both its series and its slot, or neither (a one-off).
  ADD CONSTRAINT events_series_occurrence_check CHECK (
    (series_id IS NULL AND occurrence_date IS NULL)
    OR (series_id IS NOT NULL AND occurrence_date IS NOT NULL)
  );

-- One exception per slot: two rows for the same (series, date) would double a date. Partial,
-- so one-off events (series_id NULL) are unaffected.
CREATE UNIQUE INDEX events_series_occurrence_uniq
  ON public.events (series_id, occurrence_date)
  WHERE series_id IS NOT NULL;

CREATE INDEX events_series_idx ON public.events (series_id) WHERE series_id IS NOT NULL;

COMMIT;

-- PostgREST caches the schema; event_series and the new events columns 404 until it reloads:
--   NOTIFY pgrst, 'reload schema';

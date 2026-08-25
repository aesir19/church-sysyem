// Recurring event series — the reads and writes the Stage-2 Calendar/Events screens make on
// top of Stage 1 (migration 0034, spec #86).
//
// THE MODEL. A series stores a repeat RULE (event_series). Its occurrences are worked out from
// that rule in src/lib/recurrence.js, never stored — the Calendar draws them the way it already
// draws weekly services. A row is written to `events` only when one date genuinely diverges:
//   - skip a date        → a cancelled exception row (a greyed "cancelled this week")
//   - edit one date       → an exception row carrying that date's own values
//   - "apply to the ones after" → the series is SPLIT: the old rule ends the day before, a new
//                            rule starts from the edited date. History is never rewritten.
// An exception is an ordinary events row with series_id + occurrence_date (the slot it
// replaces). mergeSeriesOccurrences suppresses the worked-out occupant of that slot so a date
// never shows twice.
//
// SCOPING & WRITES follow events.js exactly: church_id is passed explicitly for cross-church
// callers, and every mutation goes through the write() seam so a refused write can never read
// as success. RLS on event_series is the same two-audience story as events (0034).

import { supabase } from '../supabase'
import { write } from './write'
import { listEvents, EVENT_COLUMNS } from './events'
import { mergeSeriesOccurrences, nextOccurrence, describeRule, ymd, addDays } from '../recurrence'

const MESSAGES = {
  loadFailed: 'Could not load the calendar. Please try again.',
  seriesFailed: 'Could not load the repeating events. Please try again.',
  createFailed: 'That repeating event could not be created.',
  updateFailed: 'That repeating event could not be saved.',
  deleteFailed: 'That repeating event could not be deleted.',
  skipFailed: 'That date could not be cancelled.',
  editFailed: 'That date could not be changed.',
}

// Never `*` — the same discipline events.js keeps. The rule columns plus the shared event
// fields the series list and composer render.
export const SERIES_COLUMNS =
  'id, church_id, title, kind, status, location, description, run_by, projected_budget, ' +
  'cadence, interval_n, anchor, weekday, week_of_month, day_of_month, ' +
  'weekday2, week_of_month2, day_of_month2, time_start, time_end, starts_on, ends_on, count_n, ' +
  'created_at, created_by, updated_at, published_at'

// A DB row (snake_case) → the camelCase shape the recurrence engine reads, with the display
// fields carried alongside so mergeSeriesOccurrences can decorate occurrences. One mapping,
// so the engine never learns the column names.
export function toSeries(row) {
  return {
    id: row.id,
    church_id: row.church_id,
    title: row.title,
    kind: row.kind,
    status: row.status,
    location: row.location ?? null,
    description: row.description ?? null,
    run_by: row.run_by ?? null,
    projected_budget: row.projected_budget ?? null,
    cadence: row.cadence,
    intervalN: row.interval_n,
    anchor: row.anchor,
    weekday: row.weekday,
    weekOfMonth: row.week_of_month,
    dayOfMonth: row.day_of_month,
    weekday2: row.weekday2,
    weekOfMonth2: row.week_of_month2,
    dayOfMonth2: row.day_of_month2,
    timeStart: hm(row.time_start),
    timeEnd: hm(row.time_end),
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    countN: row.count_n,
  }
}

// A camelCase rule → the snake_case columns event_series stores. The inverse of toSeries for
// the rule half; the composer merges in title/kind/etc separately.
export function ruleColumns(rule) {
  return {
    cadence: rule.cadence,
    interval_n: rule.intervalN ?? 1,
    anchor: rule.anchor ?? null,
    weekday: rule.weekday ?? null,
    week_of_month: rule.weekOfMonth ?? null,
    day_of_month: rule.dayOfMonth ?? null,
    weekday2: rule.weekday2 ?? null,
    week_of_month2: rule.weekOfMonth2 ?? null,
    day_of_month2: rule.dayOfMonth2 ?? null,
    time_start: rule.timeStart,
    time_end: rule.timeEnd ?? null,
    starts_on: rule.startsOn,
    ends_on: rule.endsOn ?? null,
    count_n: rule.countN ?? null,
  }
}

function hm(t) {
  return t == null ? null : String(t).slice(0, 5) // 'HH:MM:SS' → 'HH:MM'
}

/**
 * Every readable series for a church, newest first, as engine-ready objects decorated with a
 * plain-words rule and next occurrence — the series list (frame 6d) reads this directly.
 * Returns { ok, series, message }.
 */
export async function listSeries({ churchId }) {
  if (!churchId) return { ok: false, series: [], message: MESSAGES.seriesFailed }
  const { data, error } = await supabase
    .from('event_series')
    .select(SERIES_COLUMNS)
    .eq('church_id', churchId)
    .order('created_at', { ascending: false })
  if (error) return { ok: false, series: [], message: MESSAGES.seriesFailed }
  const now = new Date()
  const series = (data ?? []).map((row) => {
    const s = toSeries(row)
    return { ...s, ruleText: describeRule(s), next: nextOccurrence(s, now) }
  })
  return { ok: true, series, message: '' }
}

/**
 * The full events pool for a window [from, to): one-off events, plus each series' worked-out
 * occurrences, with saved exception rows overriding their slots. This replaces the Calendar's
 * plain listEvents call — it returns the same item shape, so the grid, week, and agenda bucket
 * it unchanged. Returns { ok, items, message }.
 *
 * Exceptions are fetched two ways and unioned, because a slot in the window and a row whose
 * time moved into the window are different sets: by occurrence_date (to suppress a slot even
 * when its row moved OUT of the window) and by starts_at (the events already in range, which
 * catches a row that moved IN). mergeSeriesOccurrences reconciles the two.
 */
export async function listCalendarOccurrences({ churchId, from, to }) {
  if (!churchId) return { ok: false, items: [], message: MESSAGES.loadFailed }

  const fromDate = ymd(new Date(from))
  const toDate = ymd(new Date(to))

  const [evRes, serRes, slotRes] = await Promise.all([
    // One-off events AND exception rows whose start falls in the window.
    listEvents({ churchId, from, to }),
    supabase.from('event_series').select(SERIES_COLUMNS).eq('church_id', churchId),
    // Exception rows by the slot they override — catches a date moved out of the window.
    supabase
      .from('events')
      .select(EVENT_COLUMNS)
      .eq('church_id', churchId)
      .not('series_id', 'is', null)
      .gte('occurrence_date', fromDate)
      .lt('occurrence_date', toDate),
  ])

  if (!evRes.ok || serRes.error || slotRes.error) {
    return { ok: false, items: [], message: MESSAGES.loadFailed }
  }

  const oneOffs = evRes.events.filter((e) => !e.series_id)
  const inWindowExceptions = evRes.events.filter((e) => e.series_id)
  // Union the two exception sets by id.
  const byId = new Map()
  for (const r of [...inWindowExceptions, ...(slotRes.data ?? [])]) byId.set(r.id, r)
  const exceptions = [...byId.values()]

  const seriesList = (serRes.data ?? []).map(toSeries)
  const merged = mergeSeriesOccurrences({
    seriesList,
    exceptions,
    from: new Date(from),
    to: new Date(to),
  })

  return { ok: true, items: [...oneOffs, ...merged], message: '' }
}

/** One series by id, engine-shaped, for the composer (whole-series edit) and the occurrence
 *  detail. `series` is null when not found or not readable. */
export async function getSeries(id) {
  if (!id) return { ok: false, series: null, message: MESSAGES.seriesFailed }
  const { data, error } = await supabase
    .from('event_series')
    .select(SERIES_COLUMNS)
    .eq('id', id)
    .maybeSingle()
  if (error) return { ok: false, series: null, message: MESSAGES.seriesFailed }
  return { ok: true, series: data ? toSeries(data) : null, message: '' }
}

/** How many future dates a series has that were HAND-EDITED from `fromDate` onward — the
 *  "specially adjusted" dates a split would otherwise sweep up. A cancelled/skipped week is not
 *  a hand-edit, so it is excluded (it would wrongly trigger the keep/overwrite prompt). Drives
 *  the confirm the owner asked for. */
export async function countFutureExceptions({ seriesId, fromDate }) {
  const { count, error } = await supabase
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('series_id', seriesId)
    .gte('occurrence_date', fromDate)
    .neq('status', 'cancelled')
  return error ? 0 : (count ?? 0)
}

/** How many PAST dates of a series have a saved record and will therefore be kept when the
 *  series is deleted. Unmaterialised past dates are purely worked-out and leave nothing behind,
 *  so this — not the rule's occurrence count — is the honest "kept" figure for the delete
 *  confirm. `today` is injectable for testing. */
export async function countKeptPast({ seriesId, today = new Date() }) {
  const { count, error } = await supabase
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('series_id', seriesId)
    .lt('occurrence_date', ymd(today))
  return error ? 0 : (count ?? 0)
}

/** Create a repeating series. `publish` decides the initial status, mirroring createEvent. */
export function createSeries(payload, { publish = false } = {}) {
  const row = {
    ...payload,
    status: publish ? 'published' : 'draft',
    published_at: publish ? new Date().toISOString() : null,
  }
  return write(supabase.from('event_series').insert(row), {
    columns: SERIES_COLUMNS,
    messages: { blocked: MESSAGES.createFailed, denied: MESSAGES.createFailed, failed: MESSAGES.createFailed },
  })
}

/** Save edits to a whole series' rule or shared fields ("apply to every future date"). */
export function updateSeries(id, payload) {
  return write(
    supabase.from('event_series').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', id),
    { columns: SERIES_COLUMNS, messages: { blocked: MESSAGES.updateFailed, denied: MESSAGES.updateFailed, failed: MESSAGES.updateFailed } }
  )
}

/**
 * Cancel a single date of a series (a typhoon week) without touching the rest — story 14. It
 * writes (or updates) a cancelled exception row for that slot, which greys the date out on the
 * calendar. `series` is the engine-shaped series; `occurrenceDate` is 'YYYY-MM-DD'.
 */
export function skipOccurrence({ series, occurrenceDate, reason = null }) {
  const startsAt = new Date(`${occurrenceDate}T${series.timeStart}:00`).toISOString()
  const row = {
    church_id: series.church_id,
    series_id: series.id,
    occurrence_date: occurrenceDate,
    title: series.title,
    kind: series.kind,
    status: 'cancelled',
    starts_at: startsAt,
    cancel_reason: reason,
  }
  return write(
    supabase.from('events').upsert(row, { onConflict: 'series_id,occurrence_date' }),
    { columns: EVENT_COLUMNS, messages: { blocked: MESSAGES.skipFailed, denied: MESSAGES.skipFailed, failed: MESSAGES.skipFailed } }
  )
}

/**
 * Change ONE date of a series — "This date only" (story 9). Writes an exception row carrying
 * that date's own values; every other date stays worked-out and unchanged. `payload` holds the
 * edited event fields (title, starts_at, ends_at, location, …).
 */
export function editOccurrence({ series, occurrenceDate, payload }) {
  const row = {
    church_id: series.church_id,
    series_id: series.id,
    occurrence_date: occurrenceDate,
    status: 'published',
    ...payload,
  }
  return write(
    supabase.from('events').upsert(row, { onConflict: 'series_id,occurrence_date' }),
    { columns: EVENT_COLUMNS, messages: { blocked: MESSAGES.editFailed, denied: MESSAGES.editFailed, failed: MESSAGES.editFailed } }
  )
}

/**
 * "Apply to the ones after this too" (stories 10, 15). Splits the series at `fromDate`: the old
 * rule is ended the day before, a new rule starts from fromDate with the changed values. Past
 * and near dates on the old rule are untouched (never rewritten).
 *
 * `newSeriesPayload` is the full column set for the new event_series row (rule + shared fields).
 * A previously hand-adjusted future date (an exception) is the "specially adjusted" case the
 * owner asked to be prompted about: `overwriteExceptions` true removes those future exceptions
 * so the new rule governs them; false re-points them to the new series so they keep their own
 * values. Returns { ok, message, rows } where rows[0] is the new series.
 */
export async function splitSeries({ oldSeriesId, fromDate, newSeriesPayload, overwriteExceptions = false }) {
  const dayBefore = ymd(addDays(new Date(`${fromDate}T00:00:00`), -1))

  // 1. End the old series the day before the split.
  const ended = await updateSeries(oldSeriesId, { ends_on: dayBefore })
  if (!ended.ok) return ended

  // 2. Create the new series from the split date.
  const created = await createSeries(
    { ...newSeriesPayload, starts_on: fromDate },
    { publish: newSeriesPayload.status !== 'draft' }
  )
  if (!created.ok) return created
  const newId = created.rows[0]?.id

  // 3. Move future exception rows onto the new series, or clear them so the new rule governs.
  // These legitimately affect ZERO rows in the common case (a series with no hand-edited future
  // dates — occurrences are virtual), so a row count of 0 is success, not a refusal; we check
  // .error only. The authoritative permission gate was step 1's updateSeries, through write().
  const move = overwriteExceptions
    ? await supabase.from('events').delete().eq('series_id', oldSeriesId).gte('occurrence_date', fromDate)
    : (newId
        ? await supabase.from('events').update({ series_id: newId }).eq('series_id', oldSeriesId).gte('occurrence_date', fromDate)
        : { error: null })
  if (move.error) return { ok: false, message: MESSAGES.updateFailed, rows: [], cause: move.error }

  return created
}

/**
 * Delete a whole series — story 17. Removes FUTURE dates only; every PAST date and its
 * attendance is KEPT by detaching it into a standalone event. Order matters: detach the past
 * and delete the future exception rows BEFORE the series, because the FK is NO ACTION (0034).
 * `today` is injectable for testing; defaults to now.
 */
export async function deleteSeries({ seriesId, today = new Date() } = {}) {
  const todayYmd = ymd(today)

  // Detach past occurrences: they survive as ordinary events, attendance intact.
  const detach = await supabase.from('events')
    .update({ series_id: null, occurrence_date: null })
    .eq('series_id', seriesId).lt('occurrence_date', todayYmd)
  if (detach.error) return { ok: false, message: MESSAGES.deleteFailed, rows: [], cause: detach.error }

  // Delete future exception rows — they belong to a schedule that is going away.
  const delFuture = await supabase.from('events')
    .delete().eq('series_id', seriesId).gte('occurrence_date', todayYmd)
  if (delFuture.error) return { ok: false, message: MESSAGES.deleteFailed, rows: [], cause: delFuture.error }

  // Finally the series row itself.
  return write(supabase.from('event_series').delete().eq('id', seriesId), {
    columns: 'id',
    messages: { blocked: MESSAGES.deleteFailed, denied: MESSAGES.deleteFailed, failed: MESSAGES.deleteFailed },
  })
}


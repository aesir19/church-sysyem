// Recurring event series — the reads and writes the Stage-2 Calendar/Events screens make on
// top of Stage 1 (migration 0034, spec #86).
//
// THE MODEL. A series stores a repeat RULE (event_series). Its occurrences are worked out from
// that rule in src/lib/recurrence.js, never stored — the Calendar draws them the way it already
// draws weekly services. A row is written to `events` only when one date genuinely diverges:
//   - skip a date        → a cancelled exception row (a greyed "cancelled this week")
//   - edit one date       → an exception row carrying that date's own values
//   - "apply to the ones after" → the series is SPLIT (one database call, splitSeries): the old
//                            rule ends the day before, a new rule starts from the edited date.
//                            History is never rewritten.
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
import { mergeSeriesOccurrences, nextOccurrence, describeRule, expandSeries, ymd, addDays } from '../recurrence'

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
  'created_at, created_by, updated_at, published_at, deleted_at'

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
    deletedAt: row.deleted_at ?? null,
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
    .is('deleted_at', null)
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

/**
 * The saved later dates a split could move: this series' rows from `fromDate` on that have not
 * happened yet — hand-edited, attended, planned or cancelled alike. Drives the optional "Also move
 * already-planned future dates" choice; a failed read is `ok: false`, never "none planned".
 * Returns { ok, dates: [{ id, occurrence_date, status, title }] }.
 */
export async function listPlannedDates({ seriesId, fromDate } = {}) {
  if (!seriesId || !fromDate) return { ok: false, dates: [] }
  const { data, error } = await supabase
    .from('events')
    .select('id, occurrence_date, status, title, starts_at')
    .eq('series_id', seriesId)
    .gte('occurrence_date', fromDate)
    .or(`starts_at.is.null,starts_at.gt.${new Date().toISOString()}`)
    .order('occurrence_date', { ascending: true })
  if (error) return { ok: false, dates: [] }
  return { ok: true, dates: data ?? [] }
}

/**
 * Where each planned date goes when the owner chooses to move them with a split (#105): to the
 * new schedule's date in the same Sunday-first week, never before the split date. When that week
 * has no new date — or its date was already taken (`taken`, e.g. by the date being changed, or by
 * an earlier planned date) — `to_date` is null and the date stays where it is, as a standalone
 * event. Pure; the database re-checks the result. `rule` is the new schedule (engine shape).
 * Returns [{ event_id, to_date }] in date order.
 */
export function mapPlannedDates({ rule, fromDate, planned, taken: alreadyTaken = [] }) {
  const newRule = { ...rule, startsOn: fromDate }
  const taken = new Set(alreadyTaken)
  return [...planned]
    .sort((a, b) => a.occurrence_date.localeCompare(b.occurrence_date))
    .map((p) => {
      const [y, m, d] = p.occurrence_date.split('-').map(Number)
      const day = new Date(y, m - 1, d)
      const weekStart = addDays(day, -day.getDay())
      const to = expandSeries(newRule, weekStart, addDays(weekStart, 7))
        .map((o) => ymd(o.date))
        .find((date) => date >= fromDate && !taken.has(date)) ?? null
      if (to) taken.add(to)
      return { event_id: p.id, to_date: to }
    })
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

const parseDay = (date) => {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** The new schedule's first date on or after `fromDate` (within a year), or null. The date being
 *  changed lands here when a split is saved. */
export function firstNewDate({ rule, fromDate }) {
  const from = parseDay(fromDate)
  const [first] = expandSeries({ ...rule, startsOn: fromDate }, from, addDays(from, 366))
  return first ? ymd(first.date) : null
}

/** A date of the OLD schedule from `newDate` up to (not including) `occurrenceDate`, or null.
 *  Moving the date being changed back past one would make the dates swap order, so a split
 *  refuses it (#105). */
export function previousDateBefore({ series, newDate, occurrenceDate }) {
  if (!newDate || newDate >= occurrenceDate) return null
  const [hit] = expandSeries(series, parseDay(newDate), parseDay(occurrenceDate))
  return hit ? ymd(hit.date) : null
}

/**
 * "This date and the ones after it" (stories 10, 15; #103 bug 2, #105) — ONE database call, so the
 * split happens completely or not at all. The old schedule ends the day before `fromDate`; a new
 * one with `newSeriesPayload` starts on it; earlier dates are never touched.
 *
 * `moves` lists the saved dates that change: the date being changed (`selected: true`, landing on
 * the new schedule's first date), plus — when the owner ticked the box — the mapPlannedDates
 * result for the other planned dates. Saved dates not listed stay as they are. Null when none. `key` is a one-time id the caller keeps
 * until the split succeeds: repeating the call with it after a lost reply returns the first result
 * (`alreadyDone`) instead of splitting twice. Returns { ok, newSeriesId, moved, standalone,
 * alreadyDone, message }.
 */
export async function splitSeries({ oldSeriesId, fromDate, newSeriesPayload, moves = null, key } = {}) {
  const failed = (message = MESSAGES.updateFailed) =>
    ({ ok: false, newSeriesId: null, moved: 0, standalone: 0, alreadyDone: false, message })
  if (!oldSeriesId || !fromDate || !newSeriesPayload || !key) return failed()
  const { data, error } = await supabase.rpc('split_event_series', {
    p_series: oldSeriesId, p_from: fromDate, p_new: newSeriesPayload, p_moves: moves, p_key: key,
  })
  // The database's own refusals (P0001) are written for people; anything else stays generic.
  if (error) return failed(error.code === 'P0001' && error.message ? error.message : MESSAGES.updateFailed)
  if (!data) return failed()
  return {
    ok: true,
    newSeriesId: data.new_series_id ?? null,
    moved: data.moved ?? 0,
    standalone: data.standalone ?? 0,
    alreadyDone: !!data.already_done,
    message: '',
  }
}

/**
 * What deleting a series would do to its upcoming dates — the two numbers in the confirm dialog.
 * Dates with recorded work (attendance, finance, assigned people, a programme) are kept as
 * standalone events; the rest are removed. Returns { ok, kept, removed, message }.
 */
export async function previewDeleteSeries({ seriesId } = {}) {
  if (!seriesId) return { ok: false, kept: 0, removed: 0, message: MESSAGES.deleteFailed }
  const { data, error } = await supabase.rpc('preview_delete_event_series', { p_series: seriesId })
  if (error || !data) return { ok: false, kept: 0, removed: 0, message: MESSAGES.deleteFailed }
  return { ok: true, kept: data.kept ?? 0, removed: data.removed ?? 0, message: '' }
}

/**
 * Delete a whole series — one database call, so it happens completely or not at all (#103).
 * The series is ended and marked deleted; every past date stays on the calendar. Upcoming dates
 * with recorded work become standalone events; the rest are removed. Repeating the call after a
 * lost reply is harmless — the database reports `alreadyDeleted` and changes nothing.
 * Returns { ok, kept, removed, alreadyDeleted, message }.
 */
export async function deleteSeries({ seriesId } = {}) {
  const failed = { ok: false, kept: 0, removed: 0, alreadyDeleted: false, message: MESSAGES.deleteFailed }
  if (!seriesId) return failed
  const { data, error } = await supabase.rpc('delete_event_series', { p_series: seriesId })
  if (error || !data) return failed
  return {
    ok: true,
    kept: data.kept ?? 0,
    removed: data.removed ?? 0,
    alreadyDeleted: !!data.already_deleted,
    message: '',
  }
}

/**
 * The saved row for one date of a series, if that date has one (an edited, cancelled, or
 * attended date). `event` is null when the date is still only worked out from the rule; a failed
 * read is `ok: false`, never mistaken for "no saved row". Returns { ok, event }.
 */
export async function getOccurrenceRow({ seriesId, occurrenceDate } = {}) {
  if (!seriesId || !occurrenceDate) return { ok: false, event: null }
  const { data, error } = await supabase
    .from('events')
    .select(EVENT_COLUMNS)
    .eq('series_id', seriesId)
    .eq('occurrence_date', occurrenceDate)
    .maybeSingle()
  if (error) return { ok: false, event: null }
  return { ok: true, event: data ?? null }
}

// Every read and write the Calendar and Events screens make. Migration 0032.
//
// TWO AUDIENCES, ONE TABLE. The events SELECT policy (0032) shows the five privileged
// roles every event in a readable church — drafts included — and shows every other
// member only PUBLISHED events in their own church. This module never re-implements that
// split; it queries and lets RLS decide. The Calendar view and the Events view issue the
// same reads and simply get different rows depending on who is asking.
//
// CHURCH SCOPING IS THE APP'S JOB FOR CROSS-CHURCH CALLERS. RLS returns every readable
// church's rows to a SuperAdmin / Head Pastor, so — exactly as overview.js and group.js
// do — every query here is filtered by an explicit church_id passed in from
// useActiveChurch. A single-church caller is already narrowed by RLS; the extra filter is
// harmless for them and load-bearing for the cross-church ones.
//
// WRITES GO THROUGH THE write() SEAM. PostgREST filters a forbidden write rather than
// rejecting it (see write.js), so a refused publish/cancel/delete would otherwise read as
// success. Every mutation here returns write()'s { ok, message, rows } shape.
//
// CALENDAR OVERLAYS — members-safe by RPC (0033). The Calendar overlays the church's
// recurring services and member birthdays. Both source tables are gated (attendance /
// member-detail RLS), so instead of reading them directly, listServiceOccurrences() and
// listBirthdays() call the definer RPCs list_calendar_schedules / list_calendar_birthdays,
// which return only the minimum — service times, and names + birth month/day with NO year —
// church-scoped. That is what lets an ordinary member see them without the tables being
// widened. The pure expand* helpers below turn those rows into dated calendar items.

import { supabase } from '../supabase'
import { write } from './write'
import { ymd } from '../recurrence'

const MESSAGES = {
  loadFailed: 'Could not load the calendar. Please try again.',
  eventFailed: 'Could not load this event. Please try again.',
  createFailed: 'That event could not be created.',
  updateFailed: 'That event could not be saved.',
  publishFailed: 'That event could not be published.',
  cancelFailed: 'That event could not be cancelled.',
  deleteFailed: 'That event could not be deleted.',
}

// The columns the calendar and list render. Never `*` — the same discipline the rest of
// the data layer keeps, so a new column is a deliberate addition here, not an automatic
// egress. series_id / occurrence_date (0034) mark a row that is an OCCURRENCE of a series
// (an exception: a moved/cancelled/edited date); both are NULL on a one-off event.
export const EVENT_COLUMNS =
  'id, church_id, title, kind, status, starts_at, ends_at, location, description, ' +
  'run_by, projected_budget, cancel_reason, series_id, occurrence_date, ' +
  // Stage 3 (0035): the room link, the attendance switch, the closeout stamp, and the review.
  'room_id, attendance_tracked, closed_at, review_went_well, review_went_wrong, review_followups, ' +
  'created_at, created_by, updated_at, published_at'

// The five fixed kinds and their calendar legend grouping (0032 CHECK constraint). Kept
// here so the view, the composer, and the legend all read one list. Colours are semantic
// tokens applied in the view; this map is data only.
export const EVENT_KINDS = [
  { value: 'service',         label: 'Service',         legend: 'services' },
  { value: 'group_meeting',   label: 'Group meeting',   legend: 'groups' },
  { value: 'special_service', label: 'Special service', legend: 'special' },
  { value: 'outreach',        label: 'Outreach',        legend: 'special' },
  { value: 'administrative',  label: 'Administrative',  legend: 'admin' },
]

const KIND_LABEL = Object.fromEntries(EVENT_KINDS.map((k) => [k.value, k.label]))
export function kindLabel(value) { return KIND_LABEL[value] ?? value }

/**
 * Events overlapping a date window, for the Calendar. Ordered by start so the view can
 * bucket them into day cells without sorting. `from`/`to` are ISO instants (inclusive
 * lower, exclusive upper — the view passes the visible grid's bounds).
 *
 * Returns { ok, events, message }. On failure `events` is empty and `message` is set, so
 * the view shows its error state rather than a silently empty month.
 */
export async function listEvents({ churchId, from, to }) {
  if (!churchId) return { ok: false, events: [], message: MESSAGES.loadFailed }
  const { data, error } = await supabase
    .from('events')
    .select(EVENT_COLUMNS)
    .eq('church_id', churchId)
    .gte('starts_at', from)
    .lt('starts_at', to)
    .order('starts_at', { ascending: true })
  if (error) return { ok: false, events: [], message: MESSAGES.loadFailed }
  return { ok: true, events: data ?? [], message: '' }
}

/**
 * The Events management list. `scope` selects the tab:
 *   'upcoming' — published or cancelled, starting from now, ascending.
 *   'past'     — anything that has already started, most recent first.
 *   'drafts'   — status draft (visible only to callers who can_view_events; RLS enforces).
 * A caller who cannot see drafts simply gets none, which the view reads as an empty tab.
 */
export async function listManagedEvents({ churchId, scope = 'upcoming' }) {
  if (!churchId) return { ok: false, events: [], message: MESSAGES.loadFailed }
  const nowIso = new Date().toISOString()
  let q = supabase.from('events').select(EVENT_COLUMNS).eq('church_id', churchId)

  if (scope === 'drafts') {
    q = q.eq('status', 'draft').order('starts_at', { ascending: true })
  } else if (scope === 'past') {
    q = q.lt('starts_at', nowIso).order('starts_at', { ascending: false })
  } else {
    q = q.gte('starts_at', nowIso).neq('status', 'draft').order('starts_at', { ascending: true })
  }

  const { data, error } = await q
  if (error) return { ok: false, events: [], message: MESSAGES.loadFailed }
  return { ok: true, events: data ?? [], message: '' }
}

// READABLE URLS (no UUIDs — the same "named, not numbered" rule as group.js). An event's path
// is /dashboard/events/<church>/<date>-<title>, e.g. cogon/2026-08-30-youth-outreach. The date
// is REQUIRED where a group's is not: the calendar is mostly recurring, and a repeat occurrence
// has no row of its own — only its date tells one Sunday's service from the next. A dateless
// draft (no starts_at yet) drops the date and is just <church>/<title>. Renaming or moving an
// event changes its link, which lands on the not-found state — the same accepted cost as groups.

// Slugify a name to a URL segment. Identical rules to group.js's slugify so a church segment
// slugs the same on both features (kept local to avoid an events→groups data-layer dependency).
export function slugify(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// The path slug for an event or a worked-out occurrence. Uses the LOCAL calendar day (ymd),
// so it matches the day the calendar shows — not the UTC date, which can differ in Asia/Manila.
export function eventSlug(event) {
  const title = slugify(event.title)
  return event.starts_at ? `${ymd(new Date(event.starts_at))}-${title}` : title
}

// Split a slug back into its date (or null) and the title portion.
export function parseEventSlug(slug) {
  const m = /^(\d{4}-\d{2}-\d{2})-(.+)$/.exec(slug || '')
  return m ? { date: m[1], titleSlug: m[2] } : { date: null, titleSlug: slug || '' }
}

// A vue-router location for an event's detail (or public) page. `churchName` names the church
// segment; every listed event belongs to the active church, so the caller passes that name.
export function eventLocation(event, churchName, { name = 'EventDetail' } = {}) {
  return { name, params: { church: slugify(churchName), slug: eventSlug(event) } }
}

/**
 * Find the one REAL event row in a church for a calendar date + title slug (or a dateless draft
 * when `date` is null). The title is not a column, so we fetch the day's candidates and match on
 * the slug in JS — the day window keeps that set tiny. A materialised series exception is a real
 * row and resolves here; a purely worked-out occurrence does not and is handled by the caller.
 * Returns { ok, event } with event null when nothing matches.
 */
export async function findEventByDateTitle({ churchId, date, titleSlug }) {
  if (!churchId || !titleSlug) return { ok: false, event: null, message: MESSAGES.eventFailed }
  let q = supabase.from('events').select(EVENT_COLUMNS).eq('church_id', churchId)
  if (date) {
    const from = new Date(`${date}T00:00:00`)
    const to = new Date(from); to.setDate(to.getDate() + 1)
    q = q.gte('starts_at', from.toISOString()).lt('starts_at', to.toISOString())
  } else {
    q = q.is('starts_at', null)
  }
  const { data, error } = await q
  if (error) return { ok: false, event: null, message: MESSAGES.eventFailed }
  const match = (data ?? []).find((r) => slugify(r.title) === titleSlug) ?? null
  return { ok: true, event: match }
}

/** One event by id, for the detail view. `event` is null when not found or not readable. */
export async function getEvent(id) {
  if (!id) return { ok: false, event: null, message: MESSAGES.eventFailed }
  const { data, error } = await supabase
    .from('events')
    .select(EVENT_COLUMNS)
    .eq('id', id)
    .maybeSingle()
  if (error) return { ok: false, event: null, message: MESSAGES.eventFailed }
  return { ok: true, event: data ?? null, message: '' }
}

/**
 * The finance records already linked to an event (the detail's "what this touches"
 * cross-links). Stage 1 shows the links; the write flows are Stage 3 (#87). Contributor
 * identity is never selected here — only the aggregate columns the event may display, and
 * only for callers RLS already lets read finance. A caller who cannot read a table gets an
 * empty array for it, which the view renders as "nothing linked yet" rather than an error.
 */
export async function getEventLinks(eventId) {
  if (!eventId) return { expenses: [], collections: [] }
  const [ex, co] = await Promise.all([
    supabase.from('expenses').select('id, description, amount, spent_on').eq('event_id', eventId),
    supabase.from('collections').select('id, amount, collectedOn').eq('event_id', eventId),
  ])
  return {
    expenses: ex.error ? [] : (ex.data ?? []),
    collections: co.error ? [] : (co.data ?? []),
  }
}

/**
 * Recurring service occurrences overlaid on the Calendar, for the window [from, to).
 * Read-only, shown as "Services". Sourced through list_calendar_schedules (0033) so any
 * member of the church sees them, not only attendance-capable roles. Occurrences are
 * expanded from the weekly schedule rules client-side; nothing is materialised.
 */
export async function listServiceOccurrences({ churchId, from, to }) {
  if (!churchId) return []
  const { data, error } = await supabase.rpc('list_calendar_schedules', { p_church_id: churchId })
  if (error || !data) return []
  return expandWeeklySchedules(data, new Date(from), new Date(to))
}

/**
 * Member birthdays overlaid on the Calendar, for the window [from, to). Read-only, all-day.
 *
 * RULE 2 — this reads `members`, whose birthdate is PII. It relies on the members SELECT
 * policy: a caller who may not read member detail gets zero rows and therefore no
 * birthdays, which is the fail-closed answer. It selects the name and birthdate only, and
 * expandBirthdays keeps just the month and day — the birth YEAR (and therefore age) is
 * never carried into a calendar item. Archived members are excluded, as everywhere else.
 */
export async function listBirthdays({ churchId, from, to }) {
  if (!churchId) return []
  const { data, error } = await supabase.rpc('list_calendar_birthdays', { p_church_id: churchId })
  if (error || !data) return []
  const people = data.map((r) => ({ id: r.member_id, name: r.display_name, month: r.birth_month, day: r.birth_day }))
  return expandBirthdays(people, new Date(from), new Date(to))
}

/**
 * Expand member birthdays into dated, all-day occurrences within [from, to). Pure and
 * exported for unit testing. Takes `{ id, name, month, day }` — month is 1-12, and there is
 * deliberately NO year in the input (the RPC dropped it), so a birthday item cannot reveal a
 * member's age. A 29 Feb birthday lands on 1 Mar in a non-leap year, the harmless fallback.
 */
export function expandBirthdays(people, from, to) {
  const out = []
  for (const p of people) {
    const mo = Number(p.month) - 1
    const day = Number(p.day)
    for (let y = from.getFullYear(); y <= to.getFullYear(); y++) {
      // Anchor the all-day birthday at local NOON, not midnight: serialising midnight to
      // UTC shifts the date a day back in Asia/Manila (UTC+8), landing 1 Dec on 30 Nov.
      // Noon keeps the calendar day stable through the round-trip the grid does.
      const d = new Date(y, mo, day, 12, 0, 0)
      if (d < from || d >= to) continue
      out.push({
        id: `bday-${p.id}-${y}`,
        title: p.name,
        kind: 'birthday',
        status: 'published',
        starts_at: d.toISOString(),
        isBirthday: true,
      })
    }
  }
  return out
}

/**
 * Expand weekly schedule rows into concrete dated occurrences within [from, to). Pure and
 * exported so it can be unit-tested without a database. `weekday` is 0–6 (Sunday=0, the
 * Postgres DOW convention service_schedules uses); `starts_at`/`ends_at` are time-of-day
 * strings. Each occurrence carries the schedule's label and an isService flag so the view
 * styles it as a service, not an event.
 */
export function expandWeeklySchedules(schedules, from, to) {
  const out = []
  for (const s of schedules) {
    const [sh, sm] = String(s.starts_at).split(':').map(Number)
    const cursor = new Date(from)
    // Walk to the first matching weekday on or after `from`.
    while (cursor.getDay() !== s.weekday) cursor.setDate(cursor.getDate() + 1)
    for (; cursor < to; cursor.setDate(cursor.getDate() + 7)) {
      const start = new Date(cursor)
      start.setHours(sh || 0, sm || 0, 0, 0)
      if (start < from || start >= to) continue
      out.push({
        id: `sched-${s.id}-${start.toISOString().slice(0, 10)}`,
        title: s.label,
        kind: 'service',
        status: 'published',
        starts_at: start.toISOString(),
        isService: true,
      })
    }
  }
  return out
}

/**
 * Create an event. `publish` decides the initial status: a published event gets
 * published_at set (the 0032 CHECK requires it). Returns write()'s shape; `rows[0]` is the
 * created event on success.
 */
export function createEvent(payload, { publish = false } = {}) {
  const row = {
    ...payload,
    status: publish ? 'published' : 'draft',
    published_at: publish ? new Date().toISOString() : null,
  }
  return write(supabase.from('events').insert(row), {
    columns: EVENT_COLUMNS,
    messages: { blocked: MESSAGES.createFailed, denied: MESSAGES.createFailed, failed: MESSAGES.createFailed },
  })
}

/** Save edits to a draft or published event (not a status change — see publish/cancel). */
export function updateEvent(id, payload) {
  return write(
    supabase.from('events').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', id),
    { columns: EVENT_COLUMNS, messages: { blocked: MESSAGES.updateFailed, denied: MESSAGES.updateFailed, failed: MESSAGES.updateFailed } }
  )
}

/** Draft → published. Stamps published_at, which the 0032 CHECK requires for the state. */
export function publishEvent(id) {
  return write(
    supabase.from('events').update({ status: 'published', published_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', id),
    { columns: EVENT_COLUMNS, messages: { blocked: MESSAGES.publishFailed, denied: MESSAGES.publishFailed, failed: MESSAGES.publishFailed } }
  )
}

/** Cancel a published event. It STAYS on the calendar marked cancelled (frame 7h), with a
 *  reason members read — so this is a status change, never a delete. */
export function cancelEvent(id, reason) {
  return write(
    supabase.from('events').update({ status: 'cancelled', cancel_reason: reason ?? null, updated_at: new Date().toISOString() }).eq('id', id),
    { columns: EVENT_COLUMNS, messages: { blocked: MESSAGES.cancelFailed, denied: MESSAGES.cancelFailed, failed: MESSAGES.cancelFailed } }
  )
}

/** Hard delete — for a draft the team abandons. A published event is cancelled, not
 *  deleted, so the view offers delete only for drafts. */
export function deleteEvent(id) {
  return write(supabase.from('events').delete().eq('id', id), {
    columns: 'id',
    messages: { blocked: MESSAGES.deleteFailed, denied: MESSAGES.deleteFailed, failed: MESSAGES.deleteFailed },
  })
}

// Leaders' Group meetings (docs/specs/d-group-leader-view.md, Phase 2; mockups 13g–13i).
//
// A Group meeting is an ordinary event or repeating series with kind 'group_meeting' and a
// small_group_id (0056). The database decides who may see and change it — the group's
// members and leaders, the Events Team and SuperAdmin see it; only its leaders create one —
// so this module adds no permission logic of its own. What it adds is the group's view of
// the existing event and series machinery:
//
//   - the short form (13h) → one live event, or one live series with a simple repeat rule
//   - one read of a leader's groups' meetings, one-offs and repeating dates together
//   - the ⋯ menu (13i): which actions a meeting offers, before and after it happens
//   - cancel / move / delete, each sent down the right existing path for a one-off or for
//     one date of a repeating meeting
//
// Times typed into the form are Manila times, written as such whatever the device's zone.

import { supabase } from '../supabase'
import { EVENT_COLUMNS, createEvent, updateEvent, cancelEvent, deleteEvent } from './events'
import {
  SERIES_COLUMNS, toSeries, ruleColumns, createSeries, updateSeries, skipOccurrence, editOccurrence, deleteSeries, splitSeries, getSeries
} from './eventSeries'
import { mergeSeriesOccurrences, expandSeries, ymd } from '../recurrence'
import { dayMonth } from '../../utils/dayMonth'

const MESSAGES = {
  loadFailed: 'Group meetings could not be loaded. Please try again.',
  incomplete: 'Add a title, a date, a start time and a group.',
  endBeforeStart: 'The meeting must end after it starts.'
}

const KIND = 'group_meeting'
const PAST_DAYS = 14
const AHEAD_DAYS = 90
const DAY = 86_400_000

// A Manila date and time from the form → an instant.
function manilaInstant (date, time) {
  return new Date(`${date}T${time}:00+08:00`).toISOString()
}

function dayBefore (isoDate) {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) - DAY).toISOString().slice(0, 10)
}

/**
 * The form's Repeat choice as a series rule (engine shape), or null for a one-off.
 * repeat: 'none' | 'weekly' | 'fortnightly' | 'monthly'. count: meetings before it ends, or
 * null for no end. Monthly is the same weekday each month — the 1st Thursday — and a fifth
 * weekday becomes "the last", since most months have no fifth.
 */
export function meetingRule ({ date, startTime, endTime = null, repeat, count = null }) {
  if (!repeat || repeat === 'none') return null
  const day = new Date(`${date}T00:00:00Z`)
  const weekday = day.getUTCDay()
  const base = { weekday, startsOn: date, timeStart: startTime, timeEnd: endTime || null, countN: count ?? null }
  if (repeat === 'weekly') return { ...base, cadence: 'weekly', intervalN: 1 }
  if (repeat === 'fortnightly') return { ...base, cadence: 'weekly', intervalN: 2 }
  if (repeat === 'monthly') {
    const nth = Math.ceil(day.getUTCDate() / 7)
    return { ...base, cadence: 'monthly', intervalN: 1, anchor: 'weekday', weekOfMonth: nth === 5 ? -1 : nth }
  }
  return null
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const NTH = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', '-1': 'last' }

// "every Thursday" / "every 2 weeks on Thursday" / "the first Thursday of every month".
function cadenceWords (rule) {
  const day = WEEKDAYS[rule.weekday]
  if (rule.cadence === 'monthly') return `the ${NTH[rule.weekOfMonth]} ${day} of every month`
  return (rule.intervalN || 1) === 1 ? `every ${day}` : `every ${rule.intervalN} weeks on ${day}`
}

/** A row's repeat line (13g): "Repeats every Thursday · 8 meetings". */
export function repeatSummary (rule) {
  if (!rule) return ''
  const words = cadenceWords(rule)
  const how = rule.cadence === 'monthly' ? `Repeats on ${words}` : `Repeats ${words}`
  return rule.countN ? `${how} · ${rule.countN} meetings` : how
}

/** The form's summary line (13h): "Every Thursday · ends after 8 meetings (24 Sep)". */
export function formSummary (rule) {
  if (!rule) return ''
  const words = cadenceWords(rule)
  const every = words.charAt(0).toUpperCase() + words.slice(1)
  if (!rule.countN) return `${every} · no end date`
  const start = new Date(`${rule.startsOn}T00:00:00`)
  const dates = expandSeries(rule, start, new Date(start.getTime() + 800 * DAY))
  const last = dates.at(-1)?.date
  const when = last ? ` (${dayMonth(ymd(last))})` : ''
  return `${every} · ends after ${rule.countN} meetings${when}`
}

/**
 * Create a meeting from the form. Always a live Group meeting of `groupId`.
 * Returns write()'s shape ({ ok, message, rows }).
 */
export async function createGroupMeeting (form) {
  const { churchId, groupId, title, date, startTime, endTime = null, location = null, notes = null } = form
  if (!churchId || !groupId || !title?.trim() || !date || !startTime) return { ok: false, message: MESSAGES.incomplete, rows: [] }
  if (endTime && endTime <= startTime) return { ok: false, message: MESSAGES.endBeforeStart, rows: [] }

  const shared = {
    church_id: churchId,
    small_group_id: groupId,
    kind: KIND,
    title: title.trim(),
    location: location?.trim() || null,
    description: notes?.trim() || null
  }
  const rule = meetingRule(form)
  if (!rule) {
    return createEvent({
      ...shared,
      starts_at: manilaInstant(date, startTime),
      ends_at: endTime ? manilaInstant(date, endTime) : null
    }, { publish: true })
  }
  return createSeries({ ...shared, ...ruleColumns(rule) }, { publish: true })
}

/**
 * Every meeting of the given groups from PAST_DAYS back to AHEAD_DAYS on: one-off meetings
 * and each repeating meeting's dates, a saved date overriding its slot. Oldest first.
 * Returns { ok, meetings, message }; a failed read is never an empty list.
 */
export async function listGroupMeetings ({ groupIds, now = new Date() }) {
  if (!groupIds?.length) return { ok: true, meetings: [], message: '' }
  const from = new Date(now.getTime() - PAST_DAYS * DAY)
  const to = new Date(now.getTime() + AHEAD_DAYS * DAY)

  const [eventsRes, seriesRes] = await Promise.all([
    supabase.from('events').select(EVENT_COLUMNS)
      .in('small_group_id', groupIds)
      // In the window by start, or a saved date whose slot is (it moved out and must hide it).
      .or(`starts_at.gte.${from.toISOString()},occurrence_date.gte.${ymd(from)}`),
    supabase.from('event_series').select(SERIES_COLUMNS)
      .in('small_group_id', groupIds)
      .is('deleted_at', null)
  ])
  if (eventsRes.error || seriesRes.error) return { ok: false, meetings: [], message: MESSAGES.loadFailed }

  const rows = eventsRes.data ?? []
  const seriesById = new Map((seriesRes.data ?? []).map(row => [row.id, toSeries(row)]))
  const merged = mergeSeriesOccurrences({
    seriesList: [...seriesById.values()],
    exceptions: rows.filter(r => r.series_id),
    from,
    to
  })
  const inWindow = r => { const t = Date.parse(r.starts_at); return t >= from.getTime() && t < to.getTime() }
  const items = [...merged, ...rows.filter(r => !r.series_id && inWindow(r))]

  const meetings = items
    .map(item => toMeeting(item, seriesById.get(seriesIdOf(item)) ?? null))
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
  return { ok: true, meetings, message: '' }
}

/**
 * Which ⋯ menu actions a meeting offers (13i). Before it starts: everything, with "change
 * from here on" only for a repeating meeting. Once it has started: cancel only — delete is
 * shown as unavailable, matching the database's delete rule (0056).
 */
export function meetingMenu (meeting, now = new Date()) {
  const happened = Date.parse(meeting.startsAt) <= now.getTime()
  const canCancel = meeting.status !== 'cancelled'
  if (happened) {
    return { edit: false, move: false, changeFromHere: false, cancel: canCancel, delete: false, deleteNote: 'Not available after the meeting date' }
  }
  return { edit: true, move: true, changeFromHere: !!meeting.seriesId, cancel: canCancel, delete: true, deleteNote: null }
}

/** Cancel one meeting: a one-off by its status, one repeating date by a cancelled saved date. */
export function cancelMeeting (meeting, reason = null) {
  if (!meeting.seriesId) return cancelEvent(meeting.id, reason)
  return skipOccurrence({ series: meeting.series, occurrenceDate: meeting.occurrenceDate, reason })
}

/** Move one meeting to a new Manila date and time. A repeating date keeps its original slot. */
export function moveMeeting (meeting, { date, startTime, endTime = null }) {
  const when = { starts_at: manilaInstant(date, startTime), ends_at: endTime ? manilaInstant(date, endTime) : null }
  if (!meeting.seriesId) return updateEvent(meeting.id, when)
  const s = meeting.series
  return editOccurrence({
    series: s,
    occurrenceDate: meeting.occurrenceDate,
    payload: { title: s.title, kind: s.kind, location: s.location ?? null, description: s.description ?? null, ...when }
  })
}

/**
 * Delete before the meeting (13i): a one-off outright. For a repeating meeting the Delete
 * dialog asks which: 'this' takes out the one date (a cancelled saved date, so the slot
 * stays empty), 'following' ends the series the day before, 'series' deletes it as
 * delete_event_series does — keeping its past.
 */
export function deleteMeeting (meeting, scope = 'this') {
  if (!meeting.seriesId) return deleteEvent(meeting.id)
  if (scope === 'series') return deleteSeries({ seriesId: meeting.seriesId })
  if (scope === 'following') return deleteFollowing(meeting)
  return skipOccurrence({ series: meeting.series, occurrenceDate: meeting.occurrenceDate })
}

// "This and following". From the first date that is the whole series — ending it the day
// before would put its end before its start, which the database refuses. Otherwise the
// saved dates from there on (moved, edited or cancelled ones, which stand as their own rows)
// go first, then the series ends the day before; if the first step fails nothing else
// changes. A Group meeting carries no attendance or finance, so its saved dates can go.
async function deleteFollowing (meeting) {
  const { seriesId, occurrenceDate, series } = meeting
  if (!series?.startsOn || occurrenceDate <= series.startsOn) return deleteSeries({ seriesId })
  const { error } = await supabase.from('events').delete().eq('series_id', seriesId).gte('occurrence_date', occurrenceDate)
  if (error) return { ok: false, message: 'Those meetings could not be deleted. Please try again.', rows: [] }
  return updateSeries(seriesId, { ends_on: dayBefore(occurrenceDate) })
}

/**
 * What the Group meetings card lists (13g): each repeating meeting once, at its next date;
 * upcoming one-offs; then the recent past, newest first. Later dates of a repeating
 * meeting are on the Calendar.
 */
export function cardMeetings (meetings, now = new Date()) {
  const t = now.getTime()
  const upcoming = []
  const seen = new Set()
  for (const m of [...meetings].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))) {
    if (Date.parse(m.startsAt) <= t) continue
    if (m.seriesId) {
      if (seen.has(m.seriesId)) continue
      seen.add(m.seriesId)
    }
    upcoming.push(m)
  }
  const past = meetings.filter(m => Date.parse(m.startsAt) <= t)
    .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt))
  return [...upcoming, ...past]
}

// The Monday (Manila) of the week an instant falls in, as a day number.
function mondayOf (instant) {
  const local = new Date(new Date(instant).getTime() + 8 * 3_600_000)
  const day = Math.floor(local.getTime() / DAY)
  return day - ((local.getUTCDay() + 6) % 7)
}

/** How a past meeting reads (13g): "Last week · held". */
export function pastLabel (meeting, now = new Date()) {
  const weeks = Math.round((mondayOf(now) - mondayOf(meeting.startsAt)) / 7)
  const when = weeks === 0 ? 'Earlier this week' : weeks === 1 ? 'Last week' : `${weeks} weeks ago`
  return `${when} · ${meeting.status === 'cancelled' ? 'cancelled' : 'held'}`
}

function formTimes ({ date, startTime, endTime }) {
  return { starts_at: manilaInstant(date, startTime), ends_at: endTime ? manilaInstant(date, endTime) : null }
}

/** "Edit…" (S2): this meeting only — a one-off in place, one repeating date as a saved date. */
export function editMeeting (meeting, form) {
  const fields = {
    title: form.title.trim(),
    location: form.location?.trim() || null,
    description: form.notes?.trim() || null,
    ...formTimes(form)
  }
  if (!meeting.seriesId) return updateEvent(meeting.id, fields)
  return editOccurrence({
    series: meeting.series,
    occurrenceDate: meeting.occurrenceDate,
    payload: { kind: KIND, ...fields }
  })
}

/**
 * "Change from here on…": this date and every one after it take the form's details and
 * repeat, through the existing split (one database call). `key` is the split's one-time
 * key, kept by the caller until it succeeds. Returns { ok, newSeriesId, message }.
 */
export function changeFromHere (meeting, form, key) {
  const rule = meetingRule(form)
  return splitSeries({
    oldSeriesId: meeting.seriesId,
    occurrenceDate: meeting.occurrenceDate,
    startsOn: form.date,
    newSeriesPayload: {
      title: form.title.trim(),
      kind: KIND,
      status: 'published',
      location: form.location?.trim() || null,
      description: form.notes?.trim() || null,
      ...ruleColumns(rule)
    },
    moves: null,
    key
  })
}

/** The groups the signed-in person leads (0022). UI only — the database enforces. */
export async function myLedGroupIds () {
  const { data, error } = await supabase.rpc('my_led_group_ids')
  if (error || !Array.isArray(data)) return { ok: false, ids: [] }
  return { ok: true, ids: data }
}

/**
 * A Calendar item as the meeting the ⋯ actions expect. A repeating date needs its
 * series' rule (to cancel, move or change it), which the Calendar's item does not carry,
 * so it is read here; a one-off needs nothing more. Returns { ok, meeting }.
 */
export async function meetingFromCalendarItem (item) {
  const seriesId = seriesIdOf(item)
  let series = null
  if (seriesId) {
    const r = await getSeries(seriesId)
    if (!r.ok || !r.series) return { ok: false, meeting: null }
    series = r.series
  }
  return { ok: true, meeting: toMeeting(item, series) }
}

/**
 * The ⋯ menu (13i) as a list both the Group meetings card and the Calendar's preview card
 * draw: [{ kind, label, danger, disabled, note, dividerBefore }]. kind is 'edit' | 'move' |
 * 'from-here' | 'cancel' | 'delete'. Delete is always last, set apart, and shown as
 * unavailable once the meeting has happened.
 */
export function meetingActions (meeting, now = new Date()) {
  const allowed = meetingMenu(meeting, now)
  const item = (kind, label) => ({ kind, label, danger: false, disabled: false, note: null, dividerBefore: false })
  const out = []
  if (allowed.edit) out.push(item('edit', 'Edit…'))
  if (allowed.move) out.push(item('move', 'Move this meeting…'))
  if (allowed.changeFromHere) out.push(item('from-here', 'Change from here on…'))
  if (allowed.cancel) out.push(item('cancel', 'Cancel meeting'))
  out.push({
    kind: 'delete',
    label: allowed.delete ? 'Delete…' : 'Delete',
    danger: allowed.delete,
    disabled: !allowed.delete,
    note: allowed.deleteNote,
    dividerBefore: allowed.delete && out.length > 0
  })
  return out
}

/**
 * The church's D-Group names by id, for naming a meeting's group on the Calendar. A name
 * is a nicety: a failed read answers {} rather than failing the Calendar.
 */
export async function groupNamesFor (churchId) {
  if (!churchId) return {}
  const { data, error } = await supabase.from('small_groups').select('id, name').eq('church_id', churchId)
  if (error || !data) return {}
  return Object.fromEntries(data.map(g => [g.id, g.name]))
}

// A Calendar or events row's series: worked-out dates carry seriesId, saved rows series_id.
export function seriesIdOf (item) {
  return item?.seriesId ?? item?.series_id ?? null
}

// The one meeting shape every screen uses — from an events row or a worked-out date, with
// its series (engine shape) when it repeats. Built in one place so the D-Group card and the
// Calendar can never describe the same meeting differently.
function toMeeting (item, series) {
  return {
    id: item.id,
    groupId: item.small_group_id ?? series?.smallGroupId ?? null,
    title: item.title,
    startsAt: item.starts_at,
    endsAt: item.ends_at ?? null,
    location: item.location ?? null,
    notes: item.description ?? null,
    status: item.status,
    cancelReason: item.cancel_reason ?? null,
    seriesId: series?.id ?? seriesIdOf(item),
    occurrenceDate: item.occurrence_date ?? null,
    series,
    repeatText: series ? repeatSummary(series) : null,
    countN: series?.countN ?? null,
    virtual: !!item.virtual
  }
}

/** Edit… and Change from here on… open the form; the other actions open a dialog. */
export function actionOpensForm (kind) {
  return kind === 'edit' || kind === 'from-here'
}

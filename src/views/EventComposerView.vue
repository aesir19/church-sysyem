<script setup>
// New / edit event OR repeating series (frames 6c, 7d — Stage 2, #86). Route-gated by
// canManageEvents. The form is one screen with an optional "Repeats" section; whether a save
// writes a one-off event, a whole series, or a single occurrence is decided by the mode:
//
//   new, repeat off        → createEvent   (a one-off, unchanged from Stage 1)
//   new, repeat on         → createSeries  (a repeating series)
//   ?id=…                  → updateEvent   (edit the one-off)
//   ?series=…              → updateSeries  (edit the whole rule / shared fields)
//   ?series=…&date=…       → edit ONE occurrence, with the scope choice the owner asked for:
//                            "This date only" → editOccurrence (an exception row), or
//                            "…and the ones after" → splitSeries (one database call: end the old
//                            rule, start a new one). Already-planned later dates stay as they are
//                            unless "Also move already-planned future dates" is ticked (#105).
// Past dates are never rewritten — the scope choices only ever touch this date forward.

import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Button from '../components/ui/Button.vue'
import Alert from '../components/ui/Alert.vue'
import Modal from '../components/ui/Modal.vue'
import Spinner from '../components/ui/Spinner.vue'
import { useActiveChurch } from '../composables/useActiveChurch'
import { useToast } from '../composables/useToast'
import Toggle from '../components/ui/Toggle.vue'
import EventRolesField from '../components/events/EventRolesField.vue'
import { EVENT_KINDS, createEvent, updateEvent, getEvent, eventLocation, listServiceOccurrences, getEditState } from '../lib/data/events'
import {
  createSeries, updateSeries, getSeries, editOccurrence, splitSeries,
  ruleColumns, listPlannedDates, mapPlannedDates, firstNewDate, previousDateBefore,
  listCalendarOccurrences, getOccurrenceRow,
} from '../lib/data/eventSeries'
import { describeRule, ymd } from '../lib/recurrence'
import { listRooms, findRoomClashes } from '../lib/data/eventRooms'
import { listRoster, addRole, updateRole, deleteRole } from '../lib/data/eventRoles'
import { ensureEventService } from '../lib/data/eventCloseout'

const route = useRoute()
const router = useRouter()
const { activeChurchId, churches, ensureLoaded } = useActiveChurch()
const { showToast } = useToast()
// The church segment for the detail links this form redirects to on save/cancel.
const activeChurchName = computed(() => churches.value.find((c) => c.id === activeChurchId.value)?.name || '')
// The event as originally loaded for a one-off edit — Cancel returns to its detail even if the
// form's title/date were changed and then discarded.
const loadedEvent = ref(null)

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const NTHS = [{ v: 1, l: 'first' }, { v: 2, l: 'second' }, { v: 3, l: 'third' }, { v: 4, l: 'fourth' }, { v: -1, l: 'last' }]

// --- mode -----------------------------------------------------------------
const editId = computed(() => route.params.id || null)
const seriesId = computed(() => route.query.series || null)
const occDate = computed(() => route.query.date || null)
const isOneOffEdit = computed(() => !!editId.value)
const isSeriesEdit = computed(() => !!seriesId.value && !occDate.value)
const isOccurrenceEdit = computed(() => !!seriesId.value && !!occDate.value)
const isNew = computed(() => !isOneOffEdit.value && !seriesId.value)

const loading = ref(false)
const saving = ref(false)
const errorMsg = ref('')
const wasPublished = ref(false)
const loadedSeries = ref(null)

const form = ref({
  title: '', kind: 'service', date: '', starts: '', ends: '',
  location: '', run_by: '', description: '', projected_budget: '',
  // Stage 3: a structured room (separate from the free-text "Where") and the attendance switch.
  room_id: '', attendance_tracked: false,
  // repeat
  repeats: false,
  cadence: 'weekly', intervalN: 1, anchor: 'weekday',
  weekOfMonth1: 'auto',
  dayOfMonth2: '', weekday2: 0, weekOfMonth2: 1,
  endMode: 'never', endsOn: '', countN: '',
  // occurrence scope
  scope: 'this',
})

// "This date and the ones after it" (#105). The date being changed always takes the change. The
// OTHER saved later dates (hand-edited, cancelled, planned) stay as they are unless the owner
// ticks the quiet "Also move already-planned future dates" box, which only shows when there are
// some. Ticked, the save asks first.
const occurrenceRow = ref(null) // the saved row of the date being changed, if it has one
const plannedDates = ref([])
const movePlanned = ref(false)
const movePlannedConfirmOpen = ref(false)
// One key per split, kept until it succeeds, so a retry after a lost reply cannot split twice.
let splitKey = null

// Changing ONE date (#105). The database, not the device clock, says whether the date has already
// happened, how much attendance it carries, and whether it is locked (past + 11 or more records).
// `editState` stays null until asked; a failed answer locks the form (fail closed).
const editState = ref(null)
// The calendar day the date sits on now, so a move to another day can be spotted.
const originalDate = ref('')
// Moving a date that has attendance files that attendance as history — confirmed first.
const moveConfirmOpen = ref(false)
let moveConfirmed = false
let pendingPublish = false

// Rooms and the soft double-booking check (Q2). Rooms attach to a one-off event (the
// series table has no room column), so the picker shows only when the event does not repeat.
const rooms = ref([])
const roomClashes = ref([])
const showRoomFields = computed(() => !form.value.repeats)

async function checkRoomClash() {
  roomClashes.value = []
  if (!form.value.room_id || !form.value.date || !form.value.starts) return
  const startsAt = new Date(`${form.value.date}T${form.value.starts}`).toISOString()
  const endsAt = form.value.ends ? new Date(`${form.value.date}T${form.value.ends}`).toISOString() : null
  roomClashes.value = await findRoomClashes({
    churchId: activeChurchId.value, roomId: form.value.room_id,
    startsAt, endsAt, excludeEventId: editId.value,
  })
}
// Re-check whenever the room or the time changes — the warning is shown before saving.
watch(() => [form.value.room_id, form.value.date, form.value.starts, form.value.ends], checkRoomClash)

// --- staffing: roles to fill + the publish-readiness rail (frame 6c) ---------
// Roles are a one-off event's own event_roles rows. A repeating series has no event row to
// hang them on, and an occurrence edit isn't where they're created — so the whole staffing
// rail shows only for a new one-off or a one-off edit, mirroring how the room fields hide.
const showStaffing = computed(() => (isNew.value && !form.value.repeats) || isOneOffEdit.value)
// The roles the field edits (local until save). Each: { _key, id, label, count_required,
// requires_finance, note }. `id` is null for one added here, set for one loaded from the event.
const roles = ref([])
const loadedRoles = ref([])            // snapshot for the add/update/delete diff on an edit
const rosterFillById = ref({})         // roleId → people already assigned (edit only, for the rail)

let roleKeySeq = 0
function roleKey() { return `L${++roleKeySeq}` }

// Readiness (the "BEFORE IT CAN BE PUBLISHED" rail). Advisory, not a hard gate — the Publish
// button uses canPublish. Each item: { key, label, sub, state: 'done' | 'todo' | 'neutral' }.
const readiness = computed(() => {
  const items = []
  const placeOk = canPublish.value
  items.push({
    key: 'when', label: 'Name, date and place',
    sub: placeOk ? 'all set' : 'name, date and time still needed',
    state: placeOk ? 'done' : 'todo',
  })
  const hasDesc = !!form.value.description.trim()
  items.push({
    key: 'desc', label: 'Description members will read',
    sub: hasDesc ? 'written' : 'not written yet',
    state: hasDesc ? 'done' : 'todo',
  })
  const required = roles.value.reduce((s, r) => s + (Number(r.count_required) || 0), 0)
  if (!required) {
    items.push({ key: 'roles', label: 'Roles filled', sub: 'no roles added yet', state: 'neutral' })
  } else {
    const filled = roles.value.reduce((s, r) => {
      const have = r.id ? (rosterFillById.value[r.id] || 0) : 0
      return s + Math.min(have, Number(r.count_required) || 0)
    }, 0)
    const gap = required - filled
    items.push({
      key: 'roles', label: 'Roles filled',
      sub: gap > 0 ? `${gap} of ${required} still unassigned` : 'all assigned',
      state: gap > 0 ? 'todo' : 'done',
    })
  }
  return items
})

// "THAT DAY" — what else is already on the chosen date, so the day isn't double-booked. Pulls
// the same three sources the calendar overlays (real events, worked-out series occurrences,
// service times), the current event excluded. We surface them; we don't auto-move anything.
const dayNote = ref('')
async function refreshDayNote() {
  dayNote.value = ''
  if (!showStaffing.value || !form.value.date || !activeChurchId.value) return
  const from = new Date(`${form.value.date}T00:00:00`)
  const to = new Date(from); to.setDate(to.getDate() + 1)
  const fromIso = from.toISOString(); const toIso = to.toISOString()
  // listCalendarOccurrences already unions the day's real one-off events, series exceptions, and
  // worked-out series occurrences; service times come from the members-safe schedule RPC.
  const [occRes, svc] = await Promise.all([
    listCalendarOccurrences({ churchId: activeChurchId.value, from: fromIso, to: toIso }),
    listServiceOccurrences({ churchId: activeChurchId.value, from: fromIso, to: toIso }),
  ])
  const names = []
  for (const it of occRes?.items || []) {
    if (it.id && it.id === editId.value) continue    // don't count the event being edited
    if (it.status === 'cancelled') continue
    names.push(it.title)
  }
  for (const s of svc || []) names.push(s.title)
  const pretty = from.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })  // "22 August"
  const unique = [...new Set(names.filter(Boolean))]
  dayNote.value = unique.length
    ? `Also on ${pretty}: ${unique.join(', ')}.`
    : `Nothing else on ${pretty}.`
}
watch(() => [form.value.date, showStaffing.value, activeChurchId.value], refreshDayNote)

onMounted(async () => {
  await ensureLoaded()
  const roomRes = await listRooms({ churchId: activeChurchId.value })
  rooms.value = roomRes.ok ? roomRes.rooms : []
  if (isOneOffEdit.value) { await loadOneOff() }
  else if (seriesId.value) { await loadSeries() }
  refreshDayNote()
})

// The roles an existing one-off already declares (created here or on the detail roster) — loaded
// so the composer edits the same rows, with the roster's fill counts for the readiness rail.
async function loadRolesFor(eventId) {
  const res = await listRoster({ eventId })
  const list = res.ok ? res.roles : []
  loadedRoles.value = list.map((r) => ({
    _key: roleKey(), id: r.id, label: r.label,
    count_required: r.count_required, requires_finance: r.requires_finance, note: r.note,
  }))
  roles.value = loadedRoles.value.map((r) => ({ ...r }))
  const fill = {}
  for (const r of list) fill[r.id] = Math.min(r.filled ?? 0, r.count_required)
  rosterFillById.value = fill
}

async function loadOneOff() {
  loading.value = true
  const res = await getEvent(editId.value)
  if (res.event) {
    const e = res.event
    loadedEvent.value = e
    wasPublished.value = e.status === 'published'
    form.value = { ...form.value,
      title: e.title, kind: e.kind,
      // LOCAL calendar day — the time below is loaded local too, and starts_at is a UTC instant,
      // so slicing its ISO string would read a day early for an early-morning Manila event.
      date: e.starts_at ? ymd(new Date(e.starts_at)) : '',
      starts: e.starts_at ? toTimeInput(e.starts_at) : '',
      ends: e.ends_at ? toTimeInput(e.ends_at) : '',
      location: e.location || '', run_by: e.run_by || '',
      description: e.description || '', projected_budget: e.projected_budget ?? '',
      room_id: e.room_id || '', attendance_tracked: !!e.attendance_tracked,
    }
    originalDate.value = form.value.date
    editState.value = await getEditState({ eventId: e.id })
    if (!editState.value.ok) errorMsg.value = editState.value.message
    await loadRolesFor(e.id)
  } else { errorMsg.value = res.message }
  loading.value = false
}

async function loadSeries() {
  loading.value = true
  const res = await getSeries(seriesId.value)
  if (!res.series) { errorMsg.value = res.message; loading.value = false; return }
  const s = res.series
  loadedSeries.value = s
  // A deleted series is finished — reached by a typed or stale address, it cannot be changed.
  if (s.deletedAt) {
    seriesDeleted.value = true
    errorMsg.value = 'This repeating event was deleted and can’t be changed.'
  }
  wasPublished.value = s.status === 'published'
  form.value = { ...form.value,
    title: s.title, kind: s.kind,
    // Occurrence edit sits on that date; whole-series edit sits on the series start.
    date: isOccurrenceEdit.value ? occDate.value : s.startsOn,
    starts: s.timeStart || '', ends: s.timeEnd || '',
    location: s.location || '', run_by: s.run_by || '',
    description: s.description || '', projected_budget: s.projected_budget ?? '',
    repeats: true,
    cadence: s.cadence, intervalN: s.intervalN || 1, anchor: s.anchor || 'weekday',
    weekOfMonth1: (s.cadence === 'monthly' && s.anchor === 'weekday' && s.weekOfMonth != null) ? s.weekOfMonth : 'auto',
    dayOfMonth2: s.dayOfMonth2 ?? '', weekday2: s.weekday2 ?? 0, weekOfMonth2: s.weekOfMonth2 ?? 1,
    endMode: s.endsOn ? 'on' : s.countN ? 'after' : 'never',
    endsOn: s.endsOn || '', countN: s.countN ?? '',
    scope: 'this',
  }
  if (isOccurrenceEdit.value) await loadOccurrenceState(s)
  loading.value = false
}

// One date of a series: if it already has a saved row (edited, cancelled, attended), the form
// shows THAT row's values and the date it actually sits on (#105 rule 3) — not the rule's slot.
async function loadOccurrenceState(s) {
  const row = await getOccurrenceRow({ seriesId: s.id, occurrenceDate: occDate.value })
  if (!row.ok) {
    editState.value = { ok: false, isPast: false, currentAttendance: 0, totalAttendance: 0, locked: false }
    errorMsg.value = 'Could not load this date. Please try again.'
    return
  }
  const e = row.event
  occurrenceRow.value = e
  if (e?.starts_at) {
    form.value = { ...form.value,
      title: e.title || form.value.title,
      date: ymd(new Date(e.starts_at)),
      starts: toTimeInput(e.starts_at),
      ends: e.ends_at ? toTimeInput(e.ends_at) : form.value.ends,
      location: e.location ?? form.value.location,
    }
  }
  originalDate.value = form.value.date
  const slotStart = new Date(`${occDate.value}T${s.timeStart}:00`).toISOString()
  editState.value = await getEditState(e ? { eventId: e.id } : { startsAt: slotStart })
  if (!editState.value.ok) errorMsg.value = editState.value.message
}

// A DRAFT needs only a name (Q14): everything else is optional until publish. A dateless
// draft simply never appears on the calendar; a draft WITH a date is "tentative" (shown
// grayed to privileged roles). PUBLISH re-tightens: a published event must have a date and
// time — the DB publish-gate (0035) enforces the same, this is the affordance.
const canSaveDraft = computed(() => !!form.value.title.trim())
const canPublish = computed(() => form.value.title.trim() && form.value.date && form.value.starts)

// Editing an existing date waits for the database's answer, and a locked or unanswered date
// cannot be saved. A past date that is not locked may still be changed — "this date only", since
// a split from the past would rewrite history.
const needsEditState = computed(() => isOneOffEdit.value || isOccurrenceEdit.value)
const editIsPast = computed(() => !!editState.value?.isPast)
const seriesDeleted = ref(false)
const editLocked = computed(() => seriesDeleted.value
  || (needsEditState.value && (!editState.value || !editState.value.ok || editState.value.locked)))

// The planned later dates are looked up when "…and the ones after it" is chosen. A failed look-up
// just hides the option: leaving planned dates alone is the safe default.
watch(() => form.value.scope, async (scope) => {
  movePlanned.value = false
  if (scope !== 'after' || !isOccurrenceEdit.value) { plannedDates.value = []; return }
  const res = await listPlannedDates({ seriesId: seriesId.value, fromDate: occDate.value })
  if (form.value.scope === 'after') {
    plannedDates.value = res.ok ? res.dates.filter((d) => d.id !== occurrenceRow.value?.id) : []
  }
})

// --- rule building --------------------------------------------------------
function nthOfDate(d) { return Math.ceil(d.getDate() / 7) }

function buildRule() {
  const d = new Date(`${form.value.date}T00:00:00`)
  const rule = {
    cadence: form.value.cadence,
    intervalN: Number(form.value.intervalN) || 1,
    anchor: form.value.cadence === 'weekly' ? null : form.value.anchor,
    weekday: null, weekOfMonth: null, dayOfMonth: null,
    weekday2: null, weekOfMonth2: null, dayOfMonth2: null,
    timeStart: form.value.starts,
    timeEnd: form.value.ends || null,
    startsOn: form.value.date,
    endsOn: form.value.endMode === 'on' ? (form.value.endsOn || null) : null,
    countN: form.value.endMode === 'after' ? (Number(form.value.countN) || null) : null,
  }
  if (rule.cadence === 'weekly') {
    rule.weekday = d.getDay()
  } else if (rule.cadence === 'monthly' && rule.anchor === 'date') {
    rule.dayOfMonth = d.getDate()
  } else if (rule.cadence === 'monthly') {
    // "Auto" tracks whichever nth the chosen date is; an explicit pick (incl. "last", -1) lets
    // a "last Saturday" series exist even though the date lands on the 4th.
    rule.weekday = d.getDay()
    rule.weekOfMonth = form.value.weekOfMonth1 === 'auto' ? nthOfDate(d) : Number(form.value.weekOfMonth1)
  } else if (rule.cadence === 'twice_monthly' && rule.anchor === 'date') {
    rule.dayOfMonth = d.getDate()
    rule.dayOfMonth2 = Number(form.value.dayOfMonth2) || d.getDate()
  } else if (rule.cadence === 'twice_monthly') {
    rule.weekday = d.getDay(); rule.weekOfMonth = nthOfDate(d)
    rule.weekday2 = Number(form.value.weekday2); rule.weekOfMonth2 = Number(form.value.weekOfMonth2)
  }
  return rule
}

// Live plain-words preview of the repeat, so the writer reads what they are about to make.
const rulePreview = computed(() => {
  if (!form.value.repeats || !form.value.date || !form.value.starts) return ''
  try { return describeRule(buildRule()) } catch { return '' }
})

function sharedFields() {
  return {
    church_id: activeChurchId.value,
    title: form.value.title.trim(),
    kind: form.value.kind,
    location: form.value.location.trim() || null,
    run_by: form.value.run_by.trim() || null,
    description: form.value.description.trim() || null,
    projected_budget: form.value.projected_budget === '' ? null : Number(form.value.projected_budget),
  }
}

function eventPayload() {
  // A dateless draft carries no start (Q14). starts_at stays null until a date is set; the
  // publish-gate refuses to publish without one.
  const startsAt = form.value.date && form.value.starts
    ? new Date(`${form.value.date}T${form.value.starts}`).toISOString() : null
  const endsAt = form.value.date && form.value.ends
    ? new Date(`${form.value.date}T${form.value.ends}`).toISOString() : null
  const { church_id, title, kind, location, run_by, description, projected_budget } = sharedFields()
  return {
    church_id, title, kind, starts_at: startsAt, ends_at: endsAt,
    location, run_by, description, projected_budget,
    room_id: form.value.room_id || null,
    attendance_tracked: form.value.attendance_tracked,
  }
}

function seriesPayload() {
  return { ...sharedFields(), ...ruleColumns(buildRule()) }
}

// Reconcile the roles field against what the event had: delete the ones dropped, add the new
// ones, update the changed. A one-off only (a series has no event row). Returns { ok }; a
// failed role write is surfaced as a soft toast — it never undoes the event save.
async function persistRoles(eventId, churchId) {
  let ok = true
  const currentIds = new Set(roles.value.filter((r) => r.id).map((r) => r.id))
  for (const r of loadedRoles.value) {
    if (r.id && !currentIds.has(r.id)) {
      const res = await deleteRole(r.id); if (!res.ok) ok = false
    }
  }
  const loadedById = new Map(loadedRoles.value.map((r) => [r.id, r]))
  for (const r of roles.value) {
    const payload = {
      label: r.label,
      count_required: Math.max(1, Number(r.count_required) || 1),
      requires_finance: !!r.requires_finance,
      note: r.note || null,
    }
    if (!r.id) {
      const res = await addRole({
        eventId, churchId, label: payload.label, countRequired: payload.count_required,
        requiresFinance: payload.requires_finance, note: payload.note,
      })
      if (!res.ok) ok = false
    } else {
      const was = loadedById.get(r.id)
      const changed = was && (was.label !== payload.label || was.count_required !== payload.count_required
        || was.requires_finance !== payload.requires_finance || (was.note || null) !== payload.note)
      if (changed) { const res = await updateRole(r.id, payload); if (!res.ok) ok = false }
    }
  }
  return { ok }
}

// --- submit ---------------------------------------------------------------
async function submit(publish) {
  if (saving.value) return
  if (publish ? !canPublish.value : !canSaveDraft.value) return
  if (editLocked.value) return
  errorMsg.value = ''

  if (!moveConfirmed && needsMoveConfirm()) {
    pendingPublish = publish
    moveConfirmOpen.value = true
    return
  }

  if (isOccurrenceEdit.value) return submitOccurrence()

  saving.value = true
  let res
  if (isSeriesEdit.value) {
    res = await updateSeries(seriesId.value, publish && !wasPublished.value
      ? { ...seriesPayload(), status: 'published', published_at: new Date().toISOString() }
      : seriesPayload())
  } else if (isNew.value && form.value.repeats) {
    res = await createSeries(seriesPayload(), { publish })
  } else if (isNew.value) {
    res = await createEvent(eventPayload(), { publish })
  } else {
    // one-off edit
    res = await updateEvent(editId.value, publish && !wasPublished.value
      ? { ...eventPayload(), status: 'published', published_at: new Date().toISOString() }
      : eventPayload())
  }
  saving.value = false
  if (!res.ok) { errorMsg.value = res.message; return }

  showToast(publish ? 'Saved and published' : 'Saved as draft')
  const saved = res.rows[0]
  // Persist the "Roles to fill" the same event carries (frame 6c). One-off only — a series has
  // no event row. A role write that fails is soft: the event is already saved.
  if (saved?.id && !form.value.repeats && !isSeriesEdit.value) {
    const rres = await persistRoles(saved.id, saved.church_id || activeChurchId.value)
    if (!rres.ok) showToast('Event saved, but some roles could not be saved.', 'error')
  }
  // Q17: publishing a "track attendance" one-off provisions its ad-hoc service so live
  // check-in is ready (window: start−2h .. end+1h). Best-effort — a failure here does not
  // undo the save; the closeout panel will ensure it again if needed.
  if (publish && !form.value.repeats && form.value.attendance_tracked && saved?.id && saved?.starts_at) {
    await ensureEventService({ event: saved })
  }
  if (form.value.repeats || isSeriesEdit.value) router.push({ name: 'Events' })
  else router.push(saved?.id ? eventLocation(saved, activeChurchName.value) : { name: 'Events' })
}

// A move to another calendar day files the date's current attendance as history (#105 rule 5).
// A time-only change on the same day keeps it, so it needs no warning.
function needsMoveConfirm() {
  if (!needsEditState.value || !(editState.value?.currentAttendance > 0)) return false
  if (isOccurrenceEdit.value && form.value.scope !== 'this') return false
  return !!form.value.date && form.value.date !== originalDate.value
}

function confirmMove() {
  moveConfirmOpen.value = false
  moveConfirmed = true
  submit(pendingPublish).finally(() => { moveConfirmed = false })
}

async function submitOccurrence() {
  // A past date can only ever be changed on its own.
  if (editIsPast.value) form.value.scope = 'this'
  if (form.value.scope === 'after') {
    // Splitting the rule from this date. Moving it back past an earlier date of the schedule would
    // make the dates swap order, so that is a change to this date alone.
    const before = previousDateBefore({ series: loadedSeries.value, newDate: form.value.date, occurrenceDate: occDate.value })
    if (before) {
      errorMsg.value = `The new date can’t be on or before the previous date (${longDate(before)}). Change this date on its own instead.`
      return
    }
    // Moving the other planned dates too is confirmed first.
    if (movePlanned.value && plannedDates.value.length) { movePlannedConfirmOpen.value = true; return }
    return doSplit()
  }
  // "This date only" — a single exception row, everything else untouched.
  saving.value = true
  const res = await editOccurrence({ series: loadedSeries.value, occurrenceDate: occDate.value, payload: eventPayload() })
  saving.value = false
  if (!res.ok) { errorMsg.value = res.message; return }
  showToast('This date updated')
  router.push({ name: 'Events' })
}

async function doSplit() {
  movePlannedConfirmOpen.value = false
  // Moved earlier, the new schedule starts on the new date, so that week keeps its date.
  const fromDate = form.value.date && form.value.date < occDate.value ? form.value.date : occDate.value
  const rule = buildRule()
  const moves = []
  // The date being changed lands on the new schedule's first date.
  const selectedTo = occurrenceRow.value ? firstNewDate({ rule, fromDate }) : null
  if (selectedTo) moves.push({ event_id: occurrenceRow.value.id, to_date: selectedTo, selected: true })
  if (movePlanned.value && plannedDates.value.length) {
    moves.push(...mapPlannedDates({ rule, fromDate, planned: plannedDates.value, taken: selectedTo ? [selectedTo] : [] }))
  }
  splitKey = splitKey || crypto.randomUUID()
  saving.value = true
  const res = await splitSeries({
    oldSeriesId: seriesId.value,
    fromDate,
    newSeriesPayload: { ...seriesPayload(), status: wasPublished.value ? 'published' : 'draft' },
    moves: moves.length ? moves : null,
    key: splitKey,
  })
  saving.value = false
  if (!res.ok) { errorMsg.value = res.message; return }
  splitKey = null
  showToast('This date and the ones after were updated')
  router.push({ name: 'Events' })
}

function cancel() {
  if (isOneOffEdit.value && loadedEvent.value) return router.push(eventLocation(loadedEvent.value, activeChurchName.value))
  router.push({ name: 'Events' })
}

// --- headings -------------------------------------------------------------
const heading = computed(() => {
  if (isOccurrenceEdit.value) return 'Change this date'
  if (isSeriesEdit.value) return 'Edit repeating event'
  if (isOneOffEdit.value) return 'Edit event'
  return 'New event'
})

// '2026-10-04' → '4 October', for messages.
function longDate(date) {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })
}

// Under the heading: the draft promise only for something not yet published.
const subtitle = computed(() => {
  if (seriesDeleted.value) return 'This repeating event was deleted.'
  if (wasPublished.value) return 'Members can already see this. Your changes show once you save.'
  return 'Saved as a draft until you publish it. Members see nothing before then.'
})

function toTimeInput(iso) {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
</script>

<template>
  <div
    class="cmp"
    :class="{ 'cmp--railed': showStaffing }"
  >
    <h1 class="cmp__title">
      {{ heading }}
    </h1>
    <p class="cmp__sub">
      {{ isOccurrenceEdit ? (editIsPast ? 'This affects one date of a repeating event.' : 'This affects one date of a repeating event — choose how far the change reaches below.') : subtitle }}
    </p>

    <div
      v-if="loading"
      class="cmp__loading"
    >
      <Spinner label="Loading" />
    </div>

    <div
      v-else
      class="cmp__form"
    >
      <div class="cmp__layout">
        <div class="cmp__body">
          <Alert
            v-if="errorMsg"
            tone="danger"
            class="cmp__alert"
          >
            {{ errorMsg }}
          </Alert>

          <div class="cmp__sec">
            <h2 class="cmp__sec-title">
              What it is
            </h2>
            <p class="cmp__sec-help">
              The name is what members see in their calendar.
            </p>
          </div>
          <div class="cmp__grid cmp__grid--2">
            <label class="cmp__field cmp__field--wide">
              <span class="cmp__label">Name of the event</span>
              <input
                v-model="form.title"
                class="cmp__input"
                type="text"
                placeholder="e.g. Youth outreach — San Roque"
              >
            </label>
            <label class="cmp__field">
              <span class="cmp__label">Kind</span>
              <select
                v-model="form.kind"
                class="cmp__input"
              >
                <option
                  v-for="k in EVENT_KINDS"
                  :key="k.value"
                  :value="k.value"
                >{{ k.label }}</option>
              </select>
            </label>
          </div>

          <div class="cmp__sec">
            <h2 class="cmp__sec-title">
              When
            </h2>
            <p class="cmp__sec-help">
              A one-off unless you set it to repeat.
            </p>
          </div>
          <div class="cmp__grid cmp__grid--3">
            <label class="cmp__field">
              <span class="cmp__label">{{ form.repeats ? 'Starts on' : 'Date' }}</span>
              <input
                v-model="form.date"
                class="cmp__input"
                type="date"
              >
            </label>
            <label class="cmp__field">
              <span class="cmp__label">Starts</span>
              <input
                v-model="form.starts"
                class="cmp__input"
                type="time"
              >
            </label>
            <label class="cmp__field">
              <span class="cmp__label">Ends</span>
              <input
                v-model="form.ends"
                class="cmp__input"
                type="time"
              >
            </label>
          </div>

          <!-- Repeat section (frame 6c). Hidden on a one-off edit and an occurrence edit; those
             are not where the rule is created or changed. -->
          <div
            v-if="isNew || isSeriesEdit"
            class="cmp__repeat"
          >
            <label
              v-if="isNew"
              class="cmp__toggle"
            >
              <input
                v-model="form.repeats"
                type="checkbox"
              >
              <span>This event repeats</span>
            </label>

            <div
              v-if="form.repeats"
              class="cmp__repeat-body"
            >
              <div class="cmp__grid cmp__grid--3">
                <label class="cmp__field">
                  <span class="cmp__label">How often</span>
                  <select
                    v-model="form.cadence"
                    class="cmp__input"
                  >
                    <option value="weekly">Every week / few weeks</option>
                    <option value="monthly">Every month / few months</option>
                    <option value="twice_monthly">Twice a month</option>
                  </select>
                </label>
                <label
                  v-if="form.cadence !== 'twice_monthly'"
                  class="cmp__field"
                >
                  <span class="cmp__label">Every</span>
                  <div class="cmp__inline">
                    <input
                      v-model="form.intervalN"
                      class="cmp__input cmp__input--num"
                      type="number"
                      min="1"
                      max="24"
                    >
                    <span class="cmp__unit">{{ form.cadence === 'weekly' ? 'week(s)' : 'month(s)' }}</span>
                  </div>
                </label>
                <label
                  v-if="form.cadence !== 'weekly'"
                  class="cmp__field"
                >
                  <span class="cmp__label">On the</span>
                  <select
                    v-model="form.anchor"
                    class="cmp__input"
                  >
                    <option value="weekday">Same weekday (e.g. 3rd Saturday)</option>
                    <option value="date">Same date (e.g. the 15th)</option>
                  </select>
                </label>
              </div>

              <!-- Which weekday-of-month, incl. "last" — lets a "last Saturday" series exist. -->
              <label
                v-if="form.cadence === 'monthly' && form.anchor === 'weekday'"
                class="cmp__field"
              >
                <span class="cmp__label">Which one</span>
                <select
                  v-model="form.weekOfMonth1"
                  class="cmp__input"
                >
                  <option value="auto">Whichever the start date falls on</option>
                  <option
                    v-for="n in NTHS"
                    :key="n.v"
                    :value="n.v"
                  >The {{ n.l }} of the month</option>
                </select>
              </label>

              <!-- Twice-a-month needs a SECOND day. -->
              <div
                v-if="form.cadence === 'twice_monthly'"
                class="cmp__grid cmp__grid--2"
              >
                <label
                  v-if="form.anchor === 'date'"
                  class="cmp__field"
                >
                  <span class="cmp__label">…and also on day</span>
                  <input
                    v-model="form.dayOfMonth2"
                    class="cmp__input cmp__input--num"
                    type="number"
                    min="1"
                    max="31"
                    placeholder="e.g. 15"
                  >
                </label>
                <div
                  v-else
                  class="cmp__field"
                >
                  <span class="cmp__label">…and also the</span>
                  <div class="cmp__inline">
                    <select
                      v-model.number="form.weekOfMonth2"
                      class="cmp__input"
                    >
                      <option
                        v-for="n in NTHS"
                        :key="n.v"
                        :value="n.v"
                      >
                        {{ n.l }}
                      </option>
                    </select>
                    <select
                      v-model.number="form.weekday2"
                      class="cmp__input"
                    >
                      <option
                        v-for="(w, i) in WEEKDAYS"
                        :key="w"
                        :value="i"
                      >
                        {{ w }}
                      </option>
                    </select>
                  </div>
                </div>
              </div>

              <div class="cmp__grid cmp__grid--2">
                <label class="cmp__field">
                  <span class="cmp__label">Ends</span>
                  <select
                    v-model="form.endMode"
                    class="cmp__input"
                  >
                    <option value="never">Never — keeps repeating</option>
                    <option value="on">On a date</option>
                    <option value="after">After a number of times</option>
                  </select>
                </label>
                <label
                  v-if="form.endMode === 'on'"
                  class="cmp__field"
                >
                  <span class="cmp__label">End date</span>
                  <input
                    v-model="form.endsOn"
                    class="cmp__input"
                    type="date"
                  >
                </label>
                <label
                  v-if="form.endMode === 'after'"
                  class="cmp__field"
                >
                  <span class="cmp__label">Number of times</span>
                  <input
                    v-model="form.countN"
                    class="cmp__input cmp__input--num"
                    type="number"
                    min="1"
                  >
                </label>
              </div>

              <p
                v-if="rulePreview"
                class="cmp__preview"
              >
                <span aria-hidden="true">⟳</span> {{ rulePreview }}
              </p>
            </div>
          </div>

          <Alert
            v-if="editState?.ok && editState.locked"
            tone="warning"
          >
            This date has already happened and has 11 or more attendance records, so it can’t be changed.
          </Alert>
          <Alert
            v-else-if="editState?.ok && editIsPast && isOccurrenceEdit"
            tone="info"
          >
            This date has already happened. You can still change this date on its own — later dates aren’t affected.
          </Alert>

          <!-- Occurrence-edit scope (frame 7d), the owner's two-option model. Past dates: this one only. -->
          <div
            v-if="isOccurrenceEdit && !editIsPast"
            class="cmp__scope"
          >
            <span class="cmp__label">This change is for…</span>
            <label class="cmp__radio">
              <input
                v-model="form.scope"
                type="radio"
                value="this"
              >
              <span><strong>This date only.</strong> Every other date stays as it is.</span>
            </label>
            <label class="cmp__radio">
              <input
                v-model="form.scope"
                type="radio"
                value="after"
              >
              <span><strong>This date and the ones after it.</strong> Earlier dates are left untouched.</span>
            </label>
            <label
              v-if="form.scope === 'after' && plannedDates.length"
              class="cmp__radio cmp__optional"
            >
              <input
                v-model="movePlanned"
                type="checkbox"
              >
              <span>
                Also move already-planned future dates
                <span class="cmp__optional-hint">
                  {{ plannedDates.length }} later date{{ plannedDates.length === 1 ? ' has' : 's have' }}
                  already been planned, changed or cancelled. Left unticked, {{ plannedDates.length === 1 ? 'it stays' : 'they stay' }} as {{ plannedDates.length === 1 ? 'it is' : 'they are' }}.
                </span>
              </span>
            </label>
          </div>

          <div class="cmp__sec">
            <h2 class="cmp__sec-title">
              Where, and who runs it
            </h2>
            <p class="cmp__sec-help">
              The ministry named here is where the event’s roles are drawn from.
            </p>
          </div>
          <div class="cmp__grid cmp__grid--2">
            <label class="cmp__field">
              <span class="cmp__label">Where</span>
              <input
                v-model="form.location"
                class="cmp__input"
                type="text"
                placeholder="Main hall"
              >
            </label>
            <label class="cmp__field">
              <span class="cmp__label">Run by</span>
              <input
                v-model="form.run_by"
                class="cmp__input"
                type="text"
                placeholder="Youth Ministry"
              >
            </label>
          </div>

          <!-- Room (structured) + soft double-booking check (frames 7j, 7b). One-off events
             only — a series' occurrences pick a room once materialised. -->
          <div
            v-if="showRoomFields && rooms.length"
            class="cmp__field"
          >
            <span class="cmp__label">Room</span>
            <select
              v-model="form.room_id"
              class="cmp__input"
            >
              <option value="">
                No room needed
              </option>
              <option
                v-for="r in rooms"
                :key="r.id"
                :value="r.id"
                :disabled="!r.is_bookable"
              >
                {{ r.label }}{{ r.capacity ? ` · seats ${r.capacity}` : '' }}{{ r.is_bookable ? '' : ' · not bookable' }}
              </option>
            </select>
          </div>
          <Alert
            v-if="showRoomFields && roomClashes.length"
            tone="warning"
          >
            That room is already booked at this time:
            <span
              v-for="c in roomClashes"
              :key="c.eventId"
            >“{{ c.title }}”</span>. You can save anyway.
          </Alert>

          <!-- Track attendance switch (Q17): provisions live check-in at publish. -->
          <div
            v-if="showRoomFields"
            class="cmp__track"
          >
            <Toggle v-model="form.attendance_tracked">
              Track attendance for this event
            </Toggle>
            <p class="cmp__track-note">
              Opens a check-in sheet 2 hours before and closes it 1 hour after the event.
            </p>
          </div>

          <div class="cmp__sec">
            <h2 class="cmp__sec-title">
              What members will read
            </h2>
            <p class="cmp__sec-help">
              Shown under the event in the calendar and in the reminder.
            </p>
          </div>
          <label class="cmp__field">
            <textarea
              v-model="form.description"
              class="cmp__input cmp__textarea"
              rows="3"
              aria-label="What members will read"
              placeholder="A short description members will see once it is published."
            />
          </label>

          <div class="cmp__sec">
            <h2 class="cmp__sec-title">
              Budget
            </h2>
            <p class="cmp__sec-help">
              Shown for planning only — there is no approval step.
            </p>
          </div>
          <label class="cmp__field cmp__field--budget">
            <input
              v-model="form.projected_budget"
              class="cmp__input"
              type="number"
              min="0"
              step="0.01"
              aria-label="Projected budget"
              placeholder="0.00"
            >
          </label>

          <!-- Roles to fill (6c). One-off only — a series has no event row to hang roles on, so
             this hides when Repeats is on, the same rule the room fields follow. -->
          <template v-if="showStaffing">
            <div class="cmp__sec">
              <h2 class="cmp__sec-title">
                Roles to fill
              </h2>
              <p class="cmp__sec-help">
                Add the roles now and the event tells you when it is ready to publish.
              </p>
            </div>
            <EventRolesField v-model="roles" />
          </template>
        </div>

        <!-- Right rail (6c): what is left before this can be published, and what else is on the
           chosen day. One-off only, alongside the roles it reports on. -->
        <aside
          v-if="showStaffing"
          class="cmp__rail"
        >
          <div class="cmp__rail-block">
            <h3 class="cmp__rail-title">
              Before it can be published
            </h3>
            <ul class="cmp__ready">
              <li
                v-for="r in readiness"
                :key="r.key"
                class="cmp__ready-item"
                :class="`is-${r.state}`"
              >
                <span
                  class="cmp__ready-mark"
                  aria-hidden="true"
                >{{ r.state === 'done' ? '✓' : (r.state === 'todo' ? '!' : '•') }}</span>
                <span class="cmp__ready-body">
                  <span class="cmp__ready-label">{{ r.label }}</span>
                  <span class="cmp__ready-sub">{{ r.sub }}</span>
                </span>
              </li>
            </ul>
          </div>
          <div
            v-if="dayNote"
            class="cmp__rail-block"
          >
            <h3 class="cmp__rail-title">
              That day
            </h3>
            <p class="cmp__daynote">
              {{ dayNote }}
            </p>
          </div>
        </aside>
      </div>

      <div class="cmp__foot">
        <span class="cmp__foot-status">
          {{ isNew ? 'A draft stays private — nothing is visible to members yet.' : (wasPublished ? 'Members can see this event.' : 'Not visible to members until you publish.') }}
        </span>
        <div class="cmp__foot-commit">
          <Button
            variant="secondary"
            @click="cancel"
          >
            Cancel
          </Button>
          <Button
            v-if="!isOccurrenceEdit"
            variant="secondary"
            :disabled="!canSaveDraft || editLocked"
            :loading="saving"
            @click="submit(false)"
          >
            {{ isNew ? 'Keep as draft' : 'Save draft' }}
          </Button>
          <Button
            variant="primary"
            :disabled="!canPublish || editLocked"
            :loading="saving"
            @click="submit(true)"
          >
            {{ isOccurrenceEdit ? 'Save this change' : (wasPublished ? 'Save changes' : 'Save and publish') }}
          </Button>
        </div>
      </div>
    </div>

    <!-- Moving a date with attendance to another day (#105 rule 5). -->
    <Modal
      v-model:open="moveConfirmOpen"
      title="Move this date to another day?"
      description="Attendance already taken stays with the old date."
      icon="alert"
      icon-tone="warning"
      layout="stack"
      :close-on-outside-click="false"
    >
      <p class="cmp__dialog-text">
        This date has <strong>{{ editState?.currentAttendance }}</strong>
        attendance record{{ editState?.currentAttendance === 1 ? '' : 's' }}.
        {{ editState?.currentAttendance === 1 ? 'It' : 'They' }}’ll be kept as history for the old date,
        and attendance will need to be taken again for the new date.
      </p>
      <template #footer>
        <Button
          variant="secondary"
          @click="moveConfirmOpen = false"
        >
          Keep the date
        </Button>
        <Button
          variant="primary"
          :loading="saving"
          @click="confirmMove"
        >
          Move it
        </Button>
      </template>
    </Modal>

    <!-- Moving the already-planned later dates with a split (#105). -->
    <Modal
      v-model:open="movePlannedConfirmOpen"
      title="Move the planned dates too?"
      description="Their own changes are replaced by this one."
      icon="alert"
      icon-tone="warning"
      layout="stack"
      :close-on-outside-click="false"
    >
      <p class="cmp__dialog-text">
        <strong>{{ plannedDates.length }}</strong> planned date{{ plannedDates.length === 1 ? '' : 's' }}
        will move to the new day in the same week and take this change’s name, time and place.
        A date with no new day that week stays where it is, as a separate event.
      </p>
      <p class="cmp__dialog-text">
        Cancelled dates stay cancelled. People, programme, money and attendance stay attached —
        a date that moves to another day starts its attendance fresh.
      </p>
      <template #footer>
        <Button
          variant="secondary"
          @click="movePlannedConfirmOpen = false"
        >
          Go back
        </Button>
        <Button
          variant="primary"
          :loading="saving"
          @click="doSplit"
        >
          Move them
        </Button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
/* Centered on the page so the form reads as one contained card (6c stays a page, not an overlay
   modal — its commit is pinned to the form foot, per 5b — but it sits in the middle, not hugging
   the left with dead space beside it). */
.cmp { display: flex; flex-direction: column; gap: var(--sp-5); width: 100%; max-width: 760px; margin: 0 auto; }
/* When the staffing rail shows (a one-off), the page widens to seat the form + rail side by side
   and stays centred; without it, it stays the narrow single column. */
.cmp--railed { max-width: 1080px; }
.cmp__title { margin: 0; font-size: var(--text-h1); font-weight: 800; letter-spacing: -0.03em; }
.cmp__sub { margin: var(--sp-5) 0 var(--sp-16); font-size: var(--text-body); color: var(--ink-5); }
.cmp__loading { display: grid; place-items: center; min-height: 200px; }

/* Borderless: the form IS the page, not a card or a modal — no border, no shadow, no surface.
   Structure comes from the section headers and the underline fields below. */
.cmp__form { display: flex; flex-direction: column; }
/* Form body left, readiness rail right; the foot spans full width below both. */
.cmp__layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--sp-32); }
.cmp--railed .cmp__layout { grid-template-columns: minmax(0, 1fr) 264px; }
.cmp__body { padding: 0; display: flex; flex-direction: column; gap: var(--sp-18); }
.cmp__alert { margin-bottom: var(--sp-5); }

/* Readiness rail (6c). Sticks under the header as the form scrolls, and reads as quiet guidance —
   a checklist of what is still open, and what else is on the day. */
.cmp__rail { display: flex; flex-direction: column; gap: var(--sp-22); align-self: start; position: sticky; top: var(--sp-16); }
.cmp__rail-block { display: flex; flex-direction: column; gap: var(--sp-10); }
.cmp__rail-title { margin: 0; font-size: 10.5px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-5); }
.cmp__ready { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--sp-10); }
.cmp__ready-item { display: flex; align-items: flex-start; gap: var(--sp-8); }
.cmp__ready-mark { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; flex: none; margin-top: 1px; border-radius: 50%; font-size: 10px; font-weight: 900; }
.cmp__ready-item.is-done .cmp__ready-mark { background: var(--accent-tint, #e9f8ff); color: var(--accent); }
.cmp__ready-item.is-todo .cmp__ready-mark { background: var(--danger-tint, #fdeef0); color: var(--accent-deep, #aa0b56); }
.cmp__ready-item.is-neutral .cmp__ready-mark { background: var(--surface-subtle-2, #f2f4f7); color: var(--ink-5); }
.cmp__ready-body { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.cmp__ready-label { font-size: var(--text-body-sm); font-weight: 700; color: var(--ink); }
.cmp__ready-item.is-todo .cmp__ready-label { color: var(--accent-deep, #aa0b56); }
.cmp__ready-sub { font-size: var(--text-meta); color: var(--ink-5); }
.cmp__daynote { margin: 0; font-size: var(--text-body-sm); color: var(--ink-3); line-height: 1.55; }

/* Section header (What it is / When / …) with a divider above every section but the first. */
.cmp__sec { display: flex; flex-direction: column; gap: 2px; padding-top: var(--sp-20); border-top: 1px solid var(--border-subtle, var(--border)); }
.cmp__sec:first-child { padding-top: 0; border-top: none; }
.cmp__sec-title { margin: 0; font-size: var(--text-h3); font-weight: 800; letter-spacing: -0.02em; }
.cmp__sec-help { margin: 0; font-size: var(--text-body-sm); color: var(--ink-5); }
.cmp__grid { display: grid; gap: var(--sp-14); }
.cmp__grid--2 { grid-template-columns: 1fr 220px; }
.cmp__grid--3 { grid-template-columns: 1fr 1fr 1fr; }
.cmp__field { display: flex; flex-direction: column; gap: var(--sp-6); }
.cmp__field--wide { min-width: 0; }
.cmp__field--budget { max-width: 240px; }
.cmp__label { font-size: var(--text-meta); font-weight: 700; color: var(--ink-3); }
.cmp__hint { font-weight: 500; color: var(--ink-5); }
/* Underline fields (the sample's feel): a bottom rule, no box, transparent ground. */
.cmp__input { padding: 8px 2px; border: none; border-bottom: 1.5px solid var(--border-strong); border-radius: 0; background: transparent; font-family: inherit; font-size: var(--text-body); font-weight: 600; color: var(--ink); transition: border-color var(--dur-state) ease, box-shadow var(--dur-state) ease; }
.cmp__input::placeholder { color: var(--ink-6, var(--ink-5)); font-weight: 500; }
.cmp__input:focus-visible { outline: none; border-bottom-color: var(--accent); box-shadow: 0 1px 0 0 var(--accent); }
.cmp__input--num { max-width: 90px; }
.cmp__textarea { font-weight: 500; resize: vertical; }
.cmp__inline { display: flex; align-items: center; gap: var(--sp-8); }
.cmp__unit { font-size: var(--text-body-sm); color: var(--ink-5); font-weight: 600; }

.cmp__repeat { border: 1px solid var(--border); border-radius: var(--r-control); padding: var(--sp-14); background: var(--surface-subtle); display: flex; flex-direction: column; gap: var(--sp-14); }
.cmp__toggle { display: flex; align-items: center; gap: var(--sp-8); font-size: var(--text-body-sm); font-weight: 700; cursor: pointer; }
.cmp__repeat-body { display: flex; flex-direction: column; gap: var(--sp-14); }
.cmp__preview { margin: 0; padding: var(--sp-10) var(--sp-12); background: var(--accent-tint); border-radius: var(--r-inset); font-size: var(--text-body-sm); font-weight: 700; color: var(--accent-darkest); }

.cmp__scope { border: 1px solid var(--border); border-radius: var(--r-control); padding: var(--sp-14); background: var(--surface-subtle); display: flex; flex-direction: column; gap: var(--sp-10); }
.cmp__radio { display: flex; align-items: flex-start; gap: var(--sp-8); font-size: var(--text-body-sm); color: var(--ink-2); cursor: pointer; line-height: 1.45; }
.cmp__radio input { margin-top: 3px; }
/* Optional, not the main choice: indented under its option and quieter (owner's Q6). */
.cmp__optional { margin-left: var(--sp-22); color: var(--ink-4); }
.cmp__optional-hint { display: block; margin-top: 2px; font-size: var(--text-meta); color: var(--ink-5); }

.cmp__dialog-text { margin: 0; font-size: var(--text-body-sm); color: var(--ink-2); line-height: 1.55; }

.cmp__track { display: flex; flex-direction: column; gap: var(--sp-5); }
.cmp__track-note { margin: 0; font-size: var(--text-meta); color: var(--ink-5); }

/* On the page, not a tinted card foot: a divider, the draft status left, the commit right. */
.cmp__foot { display: flex; align-items: center; gap: var(--sp-12); margin-top: var(--sp-22); padding: var(--sp-16) 0 0; border-top: 1px solid var(--border); background: transparent; }
.cmp__foot-status { font-size: var(--text-meta); color: var(--ink-5); }
.cmp__foot-commit { margin-left: auto; display: flex; gap: var(--sp-9); }

/* Below this the rail no longer fits beside the form — it drops under it, and the page narrows. */
@media (max-width: 900px) {
  .cmp--railed { max-width: 760px; }
  .cmp--railed .cmp__layout { grid-template-columns: minmax(0, 1fr); gap: var(--sp-20); }
  .cmp__rail { position: static; }
}
@media (max-width: 640px) {
  .cmp__grid--2, .cmp__grid--3 { grid-template-columns: 1fr; }
  .cmp__foot { flex-direction: column; align-items: stretch; }
  .cmp__foot-commit { margin-left: 0; }
}
</style>

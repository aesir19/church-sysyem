<script setup>
// The members' Calendar (frames 6a, 7b, 7c). Open to everyone: the church year in one place,
// showing published events, each series' worked-out occurrences, and — for callers who may
// read them — recurring services and member birthdays overlaid. A non-privileged member sees
// only published rows; that narrowing is the SELECT policies' (0032/0034), not this view's.
//
// THREE MODES behind the Month / Week / Agenda pill (Stage 2, #86):
//   Month   — the 6-week grid (Stage 1).
//   Week    — a time-of-day grid, Sunday-first, events placed at their real time and height,
//             overlaps split into side-by-side columns; all-day items (birthdays) in a top strip.
//   Agenda  — the next ~30 days as a grouped, printable list.
// All three read the SAME occurrence pool (listCalendarOccurrences) for the visible window;
// switching mode re-queries and re-renders, it does not add a data path.

import { ref, computed, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import Card from '../components/ui/Card.vue'
import Button from '../components/ui/Button.vue'
import Badge from '../components/ui/Badge.vue'
import Spinner from '../components/ui/Spinner.vue'
import Alert from '../components/ui/Alert.vue'
import Icon from '../components/ui/icons/Icon.vue'
import { useActiveChurch } from '../composables/useActiveChurch'
import { useCurrentRole } from '../composables/useCurrentRole'
import { listServiceOccurrences, listBirthdays, EVENT_KINDS, kindLabel, eventLocation } from '../lib/data/events'
import { listCalendarOccurrences } from '../lib/data/eventSeries'
import { listUnderstaffedEvents } from '../lib/data/eventRoles'
import { expandHolidays, definedThrough } from '../lib/holidays'
import { buildIcs, icsFilename } from '../lib/ics'
import { addDays, ymd } from '../lib/recurrence'
import EventPeekCard from '../components/events/EventPeekCard.vue'

const router = useRouter()
const { activeChurchId, churches, ensureLoaded } = useActiveChurch()
const { canManageEvents, canViewEvents } = useCurrentRole()
// The church segment in every event link — all listed items belong to the active church.
const activeChurchName = computed(() => churches.value.find((c) => c.id === activeChurchId.value)?.name || '')
// The event peek card (7a): which item is being peeked, the anchor rect of the clicked element
// it floats from, and whether it is open.
const peekItem = ref(null)
const peekAnchor = ref(null)
const peekOpen = ref(false)

const MODES = ['month', 'week', 'agenda']
const mode = ref('month')
// The anchor date. Month uses its month; Week uses its week; Agenda counts forward from today.
const cursor = ref(startOfMonth(new Date()))
const loading = ref(true)
const errorMsg = ref('')
const events = ref([])
const services = ref([])
const birthdays = ref([])
const understaffed = ref([])
// PH holidays are a static, vendored overlay (Q13) — no fetch. Expanded for the visible
// window from the bundled list; every viewer sees them, they are purely visual.
const holidays = computed(() => {
  const [from, to] = windowRange.value
  return expandHolidays(from, to)
})
const holidaysThrough = definedThrough()
const allItems = computed(() => [...events.value, ...services.value, ...birthdays.value, ...holidays.value])

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']
const DOWS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const LEGEND = [
  { key: 'services', label: 'Services' },
  { key: 'groups',   label: 'Groups' },
  { key: 'special',  label: 'Special' },
  { key: 'admin',    label: 'Admin' },
  { key: 'birthday', label: 'Birthdays' },
  { key: 'holiday',  label: 'Holidays' },
]
const KIND_LEGEND = Object.fromEntries(EVENT_KINDS.map((k) => [k.value, k.legend]))
function legendOf(item) {
  if (item.isHoliday) return 'holiday'
  if (item.isBirthday) return 'birthday'
  if (item.isService) return 'services'
  return KIND_LEGEND[item.kind] ?? 'groups'
}

// --- the visible window per mode -------------------------------------------
// [from, to) as Date objects. Month spans the 6-week grid; Week the Sun–Sat week; Agenda a
// 30-day look-ahead from the start of today.
const windowRange = computed(() => {
  if (mode.value === 'week') {
    const start = startOfWeek(cursor.value)
    return [start, addDays(start, 7)]
  }
  if (mode.value === 'agenda') {
    const start = startOfDay(new Date())
    return [start, addDays(start, 30)]
  }
  const gridStart = startOfWeek(startOfMonth(cursor.value))
  return [gridStart, addDays(gridStart, 42)]
})

const headingLabel = computed(() => {
  if (mode.value === 'week') {
    const [start] = windowRange.value
    const end = addDays(start, 6)
    const sameMonth = start.getMonth() === end.getMonth()
    const left = `${MONTHS[start.getMonth()].slice(0, 3)} ${start.getDate()}`
    const right = sameMonth ? `${end.getDate()}` : `${MONTHS[end.getMonth()].slice(0, 3)} ${end.getDate()}`
    return `${left} – ${right}, ${end.getFullYear()}`
  }
  if (mode.value === 'agenda') return 'Next 30 days'
  return `${MONTHS[cursor.value.getMonth()]} ${cursor.value.getFullYear()}`
})
const crumbNow = computed(() => mode.value.charAt(0).toUpperCase() + mode.value.slice(1))

// The month header's live summary (6a): "N events in <month> · N still need volunteers ·
// N draft not yet published". Counts only real events of the shown month (drafts are in
// `events` only for callers RLS lets see them, so the line adapts to the role). Falls back to
// the tagline when there is nothing to summarise, and in Week/Agenda.
const subtitle = computed(() => {
  if (mode.value !== 'month') return 'The church year in one place'
  const m = cursor.value.getMonth()
  const monthEvents = events.value.filter((e) => e.starts_at && new Date(e.starts_at).getMonth() === m && e.status !== 'cancelled')
  if (!monthEvents.length && !understaffed.value.length) return 'The church year in one place'
  const parts = [`${monthEvents.length} event${monthEvents.length === 1 ? '' : 's'} in ${MONTHS[m]}`]
  if (understaffed.value.length) parts.push(`${understaffed.value.length} still need${understaffed.value.length === 1 ? 's' : ''} volunteers`)
  const drafts = monthEvents.filter((e) => e.status === 'draft').length
  if (drafts) parts.push(`${drafts} draft${drafts === 1 ? '' : 's'} not yet published`)
  return parts.join(' · ')
})
function shortDate(iso) {
  return iso ? new Date(iso).toLocaleDateString('en-PH', { day: 'numeric', month: 'short' }) : ''
}

// --- month grid (unchanged shape) ------------------------------------------
const cells = computed(() => {
  const [start] = windowRange.value
  const byDay = bucketByDay(allItems.value)
  const today = ymd(new Date())
  const first = startOfMonth(cursor.value)
  const out = []
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i)
    const key = ymd(d)
    const items = (byDay.get(key) || []).sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    out.push({
      key, day: d.getDate(),
      inMonth: d.getMonth() === first.getMonth(),
      isToday: key === today,
      isSunday: d.getDay() === 0,
      items: items.slice(0, 3),
      more: Math.max(0, items.length - 3),
    })
  }
  return out
})

// --- week grid -------------------------------------------------------------
const HOUR_PX = 46
const DEFAULT_START_HOUR = 6
const DEFAULT_END_HOUR = 22

// The axis spans a sensible 6 am–10 pm by default, but STRETCHES to fit anything outside it —
// a dawn service or a watchnight would otherwise be clamped to the edge or overflow the grid.
const weekBounds = computed(() => {
  const [from, to] = windowRange.value
  let start = DEFAULT_START_HOUR
  let end = DEFAULT_END_HOUR
  for (const it of allItems.value) {
    if (it.isBirthday || it.isHoliday) continue
    const s = new Date(it.starts_at)
    if (s < from || s >= to) continue
    const e = it.ends_at ? new Date(it.ends_at) : new Date(s.getTime() + 60 * 60 * 1000)
    start = Math.min(start, s.getHours())
    end = Math.max(end, e.getHours() + (e.getMinutes() > 0 ? 1 : 0), s.getHours() + 1)
  }
  start = Math.max(0, Math.min(start, 23))
  end = Math.min(24, Math.max(end, start + 1))
  return { start, end }
})
const hours = computed(() => {
  const { start, end } = weekBounds.value
  const out = []
  for (let h = start; h < end; h++) out.push(h)
  return out
})

// The seven day columns: each with its all-day items (birthdays) and its timed items laid out
// into non-overlapping columns so two events at the same hour sit side by side (story 25).
const weekDays = computed(() => {
  const [start] = windowRange.value
  const byDay = bucketByDay(allItems.value)
  const today = ymd(new Date())
  const out = []
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i)
    const key = ymd(d)
    const items = byDay.get(key) || []
    const allDay = items.filter((it) => it.isBirthday || it.isHoliday)
    const timed = layoutDay(items.filter((it) => !it.isBirthday && !it.isHoliday), weekBounds.value.start)
    out.push({
      key, date: d, dow: DOWS[d.getDay()], dayNum: d.getDate(),
      isToday: key === today, allDay, timed,
    })
  }
  return out
})

// Place a day's timed items: top/height from their time, and a column so overlapping events sit
// side by side. Columns are counted PER OVERLAP CLUSTER, not per day — a lone morning service
// stays full width even when two afternoon events overlap each other (story 25 is about the
// actual overlap, not the whole day). `startHour` is the axis's first hour.
function layoutDay(items, startHour) {
  const evs = items
    .map((it) => {
      const start = new Date(it.starts_at)
      const end = it.ends_at ? new Date(it.ends_at) : new Date(start.getTime() + 60 * 60 * 1000)
      return { it, start, end, startT: start.getTime(), endT: end.getTime() }
    })
    .sort((a, b) => a.startT - b.startT)

  // Break into clusters: a run of events where each overlaps the running span of the cluster.
  const clusters = []
  let cluster = []
  let clusterEnd = -Infinity
  for (const ev of evs) {
    if (cluster.length && ev.startT >= clusterEnd) { clusters.push(cluster); cluster = [] }
    cluster.push(ev)
    clusterEnd = cluster.length === 1 ? ev.endT : Math.max(clusterEnd, ev.endT)
  }
  if (cluster.length) clusters.push(cluster)

  const placed = []
  for (const group of clusters) {
    const columnsEnd = [] // end time per active column, within this cluster only
    for (const ev of group) {
      let col = columnsEnd.findIndex((e) => e <= ev.startT)
      if (col === -1) { col = columnsEnd.length; columnsEnd.push(ev.endT) } else { columnsEnd[col] = ev.endT }
      ev.col = col
    }
    const cols = columnsEnd.length
    for (const ev of group) {
      const startMins = (ev.start.getHours() - startHour) * 60 + ev.start.getMinutes()
      const endMins = (ev.end.getHours() - startHour) * 60 + ev.end.getMinutes()
      placed.push({
        ...ev.it, col: ev.col, cols,
        top: Math.max(0, (startMins / 60) * HOUR_PX),
        height: Math.max(22, ((endMins - startMins) / 60) * HOUR_PX),
      })
    }
  }
  return placed
}

// --- agenda ----------------------------------------------------------------
// Grouped by day, upcoming only, each heading noting its count. Cancelled items are shown
// (greyed) but do not count toward the "N events" tally.
const agendaDays = computed(() => {
  const [from, to] = windowRange.value
  const byDay = bucketByDay(allItems.value.filter((it) => {
    const t = new Date(it.starts_at)
    return t >= from && t < to
  }))
  const out = []
  for (const [key, items] of [...byDay.entries()].sort()) {
    const sorted = items.sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    const live = sorted.filter((it) => it.status !== 'cancelled')
    out.push({ key, date: new Date(`${key}T00:00:00`), items: sorted, count: live.length })
  }
  return out
})

// --- the next seven days (month mode's side panel) -------------------------
const upcoming = computed(() => {
  const now = new Date()
  const horizon = addDays(now, 7)
  return allItems.value
    .filter((e) => {
      const t = new Date(e.starts_at)
      return t >= startOfDay(now) && t < horizon && e.status !== 'cancelled'
    })
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .slice(0, 8)
})

async function load() {
  loading.value = true
  errorMsg.value = ''
  await ensureLoaded()
  const churchId = activeChurchId.value
  if (!churchId) { loading.value = false; return }

  const [fromD, toD] = windowRange.value
  const from = fromD.toISOString()
  const to = toD.toISOString()

  const [ev, sv, bd] = await Promise.all([
    listCalendarOccurrences({ churchId, from, to }),
    listServiceOccurrences({ churchId, from, to }),
    listBirthdays({ churchId, from, to }),
  ])
  if (!ev.ok) { errorMsg.value = ev.message; events.value = [] } else { events.value = ev.items }
  services.value = sv
  birthdays.value = bd
  // The "needs a decision" gaps card (6a) — only the roles that manage events see it.
  understaffed.value = canManageEvents.value
    ? await listUnderstaffedEvents({ churchId })
    : []
  loading.value = false
}

function setMode(m) {
  if (m === mode.value) return
  // Keep the eye near "now" when switching into a mode with a different anchor.
  if (m === 'week' && mode.value === 'month') cursor.value = startOfWeek(new Date())
  if (m === 'month') cursor.value = startOfMonth(cursor.value)
  mode.value = m
}

function step(delta) {
  const d = new Date(cursor.value)
  if (mode.value === 'week') d.setDate(d.getDate() + 7 * delta)
  else d.setMonth(d.getMonth() + delta)
  cursor.value = mode.value === 'week' ? startOfWeek(d) : startOfMonth(d)
}
function goToday() {
  cursor.value = mode.value === 'week' ? startOfWeek(new Date()) : startOfMonth(new Date())
}

function openItem(item, ev) {
  if (item.isService || item.isBirthday || item.isHoliday) return // read-only overlays
  // Clicking an event opens the peek card (7a) — what/where/when — floating at the event's spot
  // for EVERY user, rather than jumping straight to a page. The card carries the role-gated way
  // onward: "Go to event" for canViewEvents, "I can serve" for a plain member on a real event.
  const r = ev?.currentTarget?.getBoundingClientRect()
  peekAnchor.value = r ? { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height } : null
  peekItem.value = item
  peekOpen.value = true
}
// "Go to event" — the privileged detail (works for a real event and a worked-out occurrence).
function goToEvent(item) {
  peekOpen.value = false
  router.push(eventLocation(item, activeChurchName.value, { name: 'EventDetail' }))
}
// "I can serve" — the member's read-and-serve view (7s); only a real published event reaches here.
function serveEvent(item) {
  peekOpen.value = false
  router.push(eventLocation(item, activeChurchName.value, { name: 'EventPublic' }))
}
function printAgenda() { window.print() }

/** Download the visible window's events as one .ics (story 39) — built in the browser, no
 *  server. Only real, dated, non-cancelled events; the overlays are not exported. */
function downloadMonthIcs() {
  const exportable = events.value.filter((e) => e.starts_at && e.status !== 'cancelled' && !String(e.id).startsWith('sched-'))
  if (!exportable.length) return
  const ics = buildIcs(exportable)
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = icsFilename(headingLabel.value)
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

watch([cursor, activeChurchId, mode], load)
onMounted(load)

// --- date helpers (pure) ---------------------------------------------------
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1) }
function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()) }
function startOfWeek(d) { const s = startOfDay(d); s.setDate(s.getDate() - s.getDay()); return s } // Sunday-first
function bucketByDay(items) {
  const m = new Map()
  for (const it of items) {
    const key = ymd(new Date(it.starts_at))
    if (!m.has(key)) m.set(key, [])
    m.get(key).push(it)
  }
  return m
}
function timeLabel(iso) {
  return new Date(iso).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(':00', '')
}
function hourLabel(h) {
  const period = h < 12 ? 'am' : 'pm'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12} ${period}`
}
function dowLabel(iso) { return DOWS[new Date(iso).getDay()] }
function dayHeading(date) {
  return date.toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric' })
}
function metaOf(it) {
  if (it.isHoliday) return 'Holiday'
  if (it.isBirthday) return 'Birthday'
  if (it.isService) return 'Service'
  return kindLabel(it.kind)
}
</script>

<template>
  <div class="cal">
    <header class="cal__head">
      <div>
        <div class="cal__crumb">
          <span>Calendar</span><span>/</span><span class="cal__crumb-now">{{ crumbNow }}</span>
        </div>
        <h1 class="cal__title">
          Calendar
        </h1>
        <p class="cal__sub">
          {{ subtitle }}
        </p>
      </div>
      <div class="cal__head-actions">
        <Button
          variant="secondary"
          @click="downloadMonthIcs"
        >
          Download .ics
        </Button>
        <Button
          v-if="canManageEvents"
          variant="primary"
          :to="{ name: 'EventNew' }"
        >
          New event
        </Button>
      </div>
    </header>

    <div class="cal__controls">
      <div
        v-if="mode !== 'agenda'"
        class="cal__stepper"
      >
        <button
          type="button"
          class="cal__step"
          :aria-label="mode === 'week' ? 'Previous week' : 'Previous month'"
          @click="step(-1)"
        >
          <Icon
            name="chevronLeft"
            :size="15"
          />
        </button>
        <span class="cal__month">{{ headingLabel }}</span>
        <button
          type="button"
          class="cal__step"
          :aria-label="mode === 'week' ? 'Next week' : 'Next month'"
          @click="step(1)"
        >
          <Icon
            name="chevronRight"
            :size="15"
          />
        </button>
      </div>
      <span
        v-else
        class="cal__month cal__month--static"
      >{{ headingLabel }}</span>
      <Button
        v-if="mode !== 'agenda'"
        variant="secondary"
        size="sm"
        @click="goToday"
      >
        Today
      </Button>
      <Button
        v-else
        variant="secondary"
        size="sm"
        @click="printAgenda"
      >
        Print
      </Button>

      <div
        class="cal__views"
        role="tablist"
        aria-label="Calendar view"
      >
        <button
          v-for="m in MODES"
          :key="m"
          type="button"
          role="tab"
          :aria-selected="mode === m"
          class="cal__view"
          :class="{ 'is-on': mode === m }"
          @click="setMode(m)"
        >
          {{ m.charAt(0).toUpperCase() + m.slice(1) }}
        </button>
      </div>

      <ul class="cal__legend">
        <li
          v-for="l in LEGEND"
          :key="l.key"
          :class="`cal__legend-item cal__tone--${l.key}`"
          :title="l.key === 'holiday' && holidaysThrough ? `Philippine holidays, defined through ${holidaysThrough}` : null"
        >
          <span class="cal__dot" />{{ l.label }}
        </li>
      </ul>
    </div>

    <Alert
      v-if="errorMsg"
      tone="danger"
    >
      {{ errorMsg }}
    </Alert>

    <div
      v-if="loading"
      class="cal__loading"
    >
      <Spinner label="Loading the calendar" />
    </div>

    <!-- MONTH -->
    <template v-else-if="mode === 'month'">
      <Card
        class="cal__grid-card"
        :padded="false"
      >
        <div class="cal__dows">
          <span
            v-for="(d, i) in DOWS"
            :key="d"
            :class="{ 'is-sun': i === 0 }"
          >{{ d }}</span>
        </div>
        <div class="cal__grid">
          <div
            v-for="c in cells"
            :key="c.key"
            class="cal__cell"
            :class="{ 'is-out': !c.inMonth, 'is-today': c.isToday }"
          >
            <span class="cal__num-row">
              <span
                class="cal__num"
                :class="{ 'is-today': c.isToday, 'is-sun': c.isSunday && c.inMonth }"
              >{{ c.day }}</span>
            </span>
            <button
              v-for="it in c.items"
              :key="it.id"
              type="button"
              class="cal__ev"
              :class="[`cal__tone--${legendOf(it)}`, { 'is-cancelled': it.status === 'cancelled', 'is-service': it.isService, 'is-birthday': it.isBirthday, 'is-holiday': it.isHoliday, 'is-tentative': it.status === 'draft' }]"
              @click="openItem(it, $event)"
            >
              <span
                v-if="it.isBirthday"
                class="cal__ev-time"
                aria-hidden="true"
              >🎂</span>
              <span
                v-else-if="it.isHoliday"
                class="cal__ev-time"
                aria-hidden="true"
              >★</span>
              <span
                v-else
                class="cal__ev-time"
              >{{ timeLabel(it.starts_at) }}</span>
              <span class="cal__ev-title">{{ it.isBirthday ? it.title + '’s birthday' : it.title }}</span>
              <span
                v-if="it.isSeries"
                class="cal__chip"
                title="Part of a repeating series"
              >⟳</span>
            </button>
            <span
              v-if="c.more"
              class="cal__more"
            >+{{ c.more }} more</span>
          </div>
        </div>
      </Card>

      <div
        class="cal__bottom"
        :class="{ 'cal__bottom--split': understaffed.length }"
      >
        <Card class="cal__next">
          <div class="cal__next-head">
            <h2>The next seven days</h2>
            <span class="cal__next-count">{{ upcoming.length }} events</span>
          </div>
          <p
            v-if="!upcoming.length"
            class="cal__empty"
          >
            Nothing scheduled in the next seven days.
          </p>
          <ul
            v-else
            class="cal__next-list"
          >
            <li
              v-for="u in upcoming"
              :key="u.id"
              class="cal__next-row"
              :class="{ 'is-clickable': !u.isService && !u.isBirthday && !u.isHoliday }"
              @click="openItem(u, $event)"
            >
              <span class="cal__next-date">
                <span class="cal__next-dow">{{ dowLabel(u.starts_at) }}</span>
                <span class="cal__next-day">{{ new Date(u.starts_at).getDate() }}</span>
              </span>
              <span class="cal__next-body">
                <span class="cal__next-title">{{ u.isBirthday ? u.title + '’s birthday' : u.title }}</span>
                <span class="cal__next-meta">{{ metaOf(u) }}{{ u.location ? ' · ' + u.location : '' }}</span>
              </span>
              <span class="cal__next-time">{{ u.isBirthday ? '🎂' : (u.isHoliday ? '★' : timeLabel(u.starts_at)) }}</span>
            </li>
          </ul>
        </Card>

        <!-- Needs a decision (6a): published events within the next week short of volunteers,
             each with the way to fix it. Shown to canManageEvents; understaffed is empty for
             anyone who cannot see the roster. -->
        <Card
          v-if="understaffed.length"
          class="cal__decide"
        >
          <p class="cal__decide-eyebrow">
            Needs a decision
          </p>
          <h2 class="cal__decide-title">
            {{ understaffed.length }} event{{ understaffed.length === 1 ? '' : 's' }} short of volunteers
          </h2>
          <p class="cal__decide-sub">
            Roles left open a week before the date. Assign from the event, or ask the group leader.
          </p>
          <ul class="cal__decide-list">
            <li
              v-for="u in understaffed"
              :key="u.id"
              class="cal__decide-row"
            >
              <span class="cal__decide-gap">{{ u.needed - u.filled }}</span>
              <span class="cal__decide-body">
                <span class="cal__decide-name">{{ u.title }}</span>
                <span class="cal__decide-meta">{{ shortDate(u.starts_at) }} · {{ u.filled }} of {{ u.needed }} filled</span>
              </span>
              <RouterLink
                :to="eventLocation(u, activeChurchName)"
                class="cal__decide-assign"
              >
                Assign
              </RouterLink>
            </li>
          </ul>
        </Card>
      </div>
    </template>

    <!-- WEEK -->
    <Card
      v-else-if="mode === 'week'"
      class="cal__grid-card"
      :padded="false"
    >
      <div class="week">
        <div class="week__corner" />
        <div
          v-for="d in weekDays"
          :key="d.key"
          class="week__dayhead"
          :class="{ 'is-today': d.isToday }"
        >
          <span class="week__dow">{{ d.dow }}</span>
          <span class="week__daynum">{{ d.dayNum }}</span>
        </div>

        <div class="week__corner week__corner--allday">
          All day
        </div>
        <div
          v-for="d in weekDays"
          :key="`ad-${d.key}`"
          class="week__allday"
          :class="{ 'is-today': d.isToday }"
        >
          <span
            v-for="it in d.allDay"
            :key="it.id"
            class="week__badge cal__tone--birthday"
          >🎂 {{ it.title }}</span>
        </div>

        <div class="week__axis">
          <span
            v-for="h in hours"
            :key="h"
            class="week__hour"
            :style="{ height: HOUR_PX + 'px' }"
          >{{ hourLabel(h) }}</span>
        </div>
        <div
          v-for="d in weekDays"
          :key="`col-${d.key}`"
          class="week__col"
          :class="{ 'is-today': d.isToday }"
          :style="{ height: hours.length * HOUR_PX + 'px' }"
        >
          <span
            v-for="h in hours"
            :key="h"
            class="week__line"
            :style="{ height: HOUR_PX + 'px' }"
          />
          <button
            v-for="it in d.timed"
            :key="it.id"
            type="button"
            class="week__ev"
            :class="[`cal__tone--${legendOf(it)}`, { 'is-cancelled': it.status === 'cancelled', 'is-service': it.isService }]"
            :style="{ top: it.top + 'px', height: it.height + 'px', left: `calc(${(it.col / it.cols) * 100}% + 2px)`, width: `calc(${100 / it.cols}% - 4px)` }"
            @click="openItem(it, $event)"
          >
            <span class="week__ev-time">{{ timeLabel(it.starts_at) }}</span>
            <span class="week__ev-title">{{ it.title }}<span
              v-if="it.isSeries"
              class="cal__chip"
            >⟳</span></span>
          </button>
        </div>
      </div>
    </Card>

    <!-- AGENDA -->
    <Card
      v-else
      class="agenda"
    >
      <p
        v-if="!agendaDays.length"
        class="cal__empty"
      >
        Nothing on the calendar in the next 30 days.
      </p>
      <template v-else>
        <section
          v-for="day in agendaDays"
          :key="day.key"
          class="agenda__day"
        >
          <header class="agenda__dayhead">
            <h2>{{ dayHeading(day.date) }}</h2>
            <span class="agenda__count">{{ day.count }} event{{ day.count === 1 ? '' : 's' }}</span>
          </header>
          <ul class="agenda__list">
            <li
              v-for="it in day.items"
              :key="it.id"
              class="agenda__row"
              :class="{ 'is-clickable': !it.isService && !it.isBirthday && !it.isHoliday, 'is-cancelled': it.status === 'cancelled' }"
              @click="openItem(it, $event)"
            >
              <span class="agenda__time">{{ it.isBirthday ? '🎂' : (it.isHoliday ? '★' : timeLabel(it.starts_at)) }}</span>
              <span class="agenda__body">
                <span class="agenda__title">
                  {{ it.isBirthday ? it.title + '’s birthday' : it.title }}
                  <span
                    v-if="it.isSeries"
                    class="cal__chip"
                    title="Repeating series"
                  >⟳</span>
                  <Badge
                    v-if="it.status === 'cancelled'"
                    tone="neutral"
                  >Cancelled</Badge>
                </span>
                <span class="agenda__meta">{{ metaOf(it) }}{{ it.location ? ' · ' + it.location : '' }}</span>
              </span>
            </li>
          </ul>
        </section>
      </template>
    </Card>

    <EventPeekCard
      v-model:open="peekOpen"
      :item="peekItem"
      :anchor="peekAnchor"
      :can-view-events="canViewEvents"
      @go="goToEvent"
      @serve="serveEvent"
    />
  </div>
</template>

<style scoped>
.cal { display: flex; flex-direction: column; gap: var(--sp-18); }

.cal__head { display: flex; align-items: flex-end; justify-content: space-between; gap: var(--sp-16); flex-wrap: wrap; }
.cal__crumb { display: flex; align-items: center; gap: var(--sp-6); font-size: var(--text-meta); color: var(--ink-5); font-weight: 600; }
.cal__crumb-now { color: var(--ink-3); }
.cal__title { margin: var(--sp-6) 0 0; font-size: var(--text-h1); font-weight: 800; letter-spacing: -0.03em; }
.cal__sub { margin: var(--sp-5) 0 0; font-size: var(--text-body); color: var(--ink-5); }
.cal__head-actions { display: flex; align-items: center; gap: var(--sp-9); }

.cal__controls { display: flex; align-items: center; gap: var(--sp-10); flex-wrap: wrap; }
.cal__stepper { display: flex; align-items: center; gap: 2px; padding: 3px; border: 1px solid var(--border); border-radius: var(--r-control); background: var(--surface); }
.cal__step { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: none; background: none; border-radius: var(--r-inset); color: var(--ink-5); cursor: pointer; }
.cal__step:hover { background: var(--surface-subtle-2); }
.cal__month { padding: 0 var(--sp-10); font-weight: 800; font-size: var(--text-body-sm); white-space: nowrap; }
.cal__month--static { padding-left: 0; }

.cal__views { display: flex; gap: 3px; padding: 3px; border-radius: var(--r-control); background: var(--surface-subtle-2); }
.cal__view { display: inline-flex; align-items: center; gap: var(--sp-6); padding: 7px 13px; border: none; background: none; border-radius: var(--r-inset); font-weight: 700; font-size: var(--text-meta); color: var(--ink-5); cursor: pointer; }
.cal__view.is-on { background: var(--surface); color: var(--ink); box-shadow: 0 1px 2px rgba(16,24,40,.1); }

.cal__legend { display: flex; gap: var(--sp-8); margin: 0 0 0 auto; padding: 0; list-style: none; flex-wrap: wrap; }
/* Pills, not bare text (6a): a tone-tinted chip with a dot; currentColor is the tone. */
.cal__legend-item { display: inline-flex; align-items: center; gap: var(--sp-6); padding: 4px 10px; border-radius: var(--r-pill); border: 1px solid color-mix(in srgb, currentColor 30%, transparent); background: color-mix(in srgb, currentColor 9%, var(--surface)); font-size: var(--text-meta); font-weight: 700; }
.cal__dot { width: 8px; height: 8px; border-radius: var(--r-pill); background: currentColor; }

/* The month's bottom section (6a): the next-seven list, and — when there is one — the
   "needs a decision" card beside it. Collapses to one column on a narrow screen. */
.cal__bottom { display: grid; grid-template-columns: 1fr; gap: var(--sp-16); align-items: start; }
.cal__bottom--split { grid-template-columns: minmax(0, 1fr) 360px; }
@media (max-width: 900px) { .cal__bottom--split { grid-template-columns: 1fr; } }
.cal__decide-eyebrow { margin: 0; font-size: 10.5px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; color: var(--magenta); }
.cal__decide-title { margin: var(--sp-6) 0 0; font-size: var(--text-h3); font-weight: 800; letter-spacing: -0.02em; }
.cal__decide-sub { margin: var(--sp-6) 0 0; font-size: var(--text-body-sm); color: var(--ink-5); line-height: 1.5; }
.cal__decide-list { list-style: none; margin: var(--sp-14) 0 0; padding: 0; }
.cal__decide-row { display: grid; grid-template-columns: 30px 1fr auto; gap: var(--sp-12); align-items: center; padding: var(--sp-12) 0; border-bottom: 1px solid var(--border-subtle, var(--border)); }
.cal__decide-row:last-child { border-bottom: none; }
.cal__decide-gap { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 50%; background: var(--magenta-tint, #fff1f4); color: var(--magenta); font-size: var(--text-body-sm); font-weight: 800; font-variant-numeric: tabular-nums; }
.cal__decide-body { display: flex; flex-direction: column; min-width: 0; }
.cal__decide-name { font-size: var(--text-body-sm); font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cal__decide-meta { font-size: var(--text-meta); color: var(--ink-5); }
.cal__decide-assign { padding: 7px 14px; border: 1px solid var(--border-strong); border-radius: 9px; background: var(--surface); font-size: var(--text-meta); font-weight: 700; color: var(--accent); text-decoration: none; white-space: nowrap; transition: background .15s, border-color .15s; }
.cal__decide-assign:hover { background: var(--accent-tint, #e9f8ff); border-color: var(--accent); }

.cal__tone--services { color: var(--accent); }
.cal__tone--groups { color: var(--ink-5); }
.cal__tone--special { color: var(--magenta); }
.cal__tone--admin { color: var(--warning, #e08b2c); }
.cal__tone--birthday { color: #9333ea; }
.cal__tone--holiday { color: #d92d20; }

.cal__loading { display: grid; place-items: center; min-height: 200px; }

.cal__grid-card { overflow: hidden; }
.cal__dows { display: grid; grid-template-columns: repeat(7, 1fr); background: var(--surface-subtle); border-bottom: 1px solid var(--border); }
.cal__dows span { padding: 11px 12px; font-size: var(--text-meta-sm); font-weight: 800; letter-spacing: .09em; text-transform: uppercase; color: var(--ink-5); }
.cal__dows .is-sun { color: var(--accent-darkest); }

.cal__grid { display: grid; grid-template-columns: repeat(7, 1fr); }
.cal__cell { min-height: 104px; padding: 8px 9px 10px; border-right: 1px solid var(--border-subtle, var(--border)); border-bottom: 1px solid var(--border-subtle, var(--border)); display: flex; flex-direction: column; gap: 4px; background: var(--surface); }
.cal__cell.is-out { background: var(--surface-subtle); }
.cal__cell.is-today { background: var(--accent-tint); }
.cal__num-row { display: flex; align-items: center; justify-content: space-between; }
.cal__num { display: inline-flex; align-items: center; justify-content: center; min-width: 21px; height: 21px; padding: 0 5px; border-radius: var(--r-pill); font-size: var(--text-meta); font-weight: 600; font-variant-numeric: tabular-nums; color: var(--ink-3); }
.cal__num.is-sun { color: var(--accent-darkest); font-weight: 800; }
.cal__num.is-today { background: var(--accent); color: #fff; font-weight: 800; }
.cal__cell.is-out .cal__num { color: var(--ink-6); }

.cal__ev { display: flex; align-items: center; gap: var(--sp-6); padding: 4px 7px; border-radius: var(--r-inset); border: none; border-left: 2.5px solid currentColor; background: color-mix(in srgb, currentColor 12%, var(--surface)); cursor: pointer; text-align: left; width: 100%; transition: filter var(--dur-state) ease; }
.cal__ev:hover { filter: brightness(.97); }
.cal__ev.is-service, .cal__ev.is-birthday, .cal__ev.is-holiday { cursor: default; }
.cal__ev.is-cancelled { opacity: .5; text-decoration: line-through; }
/* Tentative = a draft with a date, shown grayed to privileged roles (Q14). */
.cal__ev.is-tentative { opacity: .55; border-left-style: dashed; }
.cal__ev-time { font-size: var(--text-meta-sm); font-weight: 800; font-variant-numeric: tabular-nums; white-space: nowrap; color: currentColor; }
.cal__ev-title { font-size: var(--text-meta); font-weight: 600; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cal__chip { margin-left: 3px; font-size: 0.85em; color: var(--accent); font-weight: 800; }
.cal__more { font-size: var(--text-meta-sm); font-weight: 700; color: var(--ink-6); padding-left: 7px; }

/* --- next seven days (month side panel) + empty states --- */
.cal__empty { margin: 0; font-size: var(--text-body-sm); color: var(--ink-5); }
.cal__next-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--sp-12); margin-bottom: var(--sp-10); }
.cal__next-head h2 { margin: 0; font-size: var(--text-h3); font-weight: 800; letter-spacing: -0.02em; }
.cal__next-count { font-size: var(--text-meta); color: var(--ink-5); }
.cal__next-list { list-style: none; margin: 0; padding: 0; }
.cal__next-row { display: grid; grid-template-columns: 54px 1fr auto; gap: var(--sp-12); padding: 11px 0; border-bottom: 1px solid var(--border-subtle, var(--border)); align-items: center; }
.cal__next-row.is-clickable { cursor: pointer; }
.cal__next-row.is-clickable:hover { background: var(--surface-subtle); }
.cal__next-row:last-child { border-bottom: none; }
.cal__next-date { display: flex; flex-direction: column; line-height: 1.15; }
.cal__next-dow { font-size: var(--text-meta-sm); font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--ink-5); }
.cal__next-day { font-size: var(--text-h3); font-weight: 800; font-variant-numeric: tabular-nums; }
.cal__next-body { display: flex; flex-direction: column; min-width: 0; }
.cal__next-title { font-weight: 700; font-size: var(--text-body-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cal__next-meta { font-size: var(--text-meta); color: var(--ink-5); }
.cal__next-time { font-size: var(--text-body-sm); color: var(--ink-3); font-variant-numeric: tabular-nums; white-space: nowrap; }

/* --- week grid --- */
.week { display: grid; grid-template-columns: 54px repeat(7, 1fr); }
.week__corner { border-bottom: 1px solid var(--border); border-right: 1px solid var(--border-subtle, var(--border)); }
.week__corner--allday { display: flex; align-items: center; justify-content: flex-end; padding: 4px 8px; font-size: var(--text-meta-sm); font-weight: 700; color: var(--ink-6); }
.week__dayhead { display: flex; flex-direction: column; align-items: center; gap: 1px; padding: 8px 4px; border-bottom: 1px solid var(--border); border-right: 1px solid var(--border-subtle, var(--border)); }
.week__dayhead.is-today { background: var(--accent-tint); }
.week__dow { font-size: var(--text-meta-sm); font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--ink-5); }
.week__daynum { font-size: var(--text-h3); font-weight: 800; font-variant-numeric: tabular-nums; }
.week__allday { min-height: 26px; display: flex; flex-direction: column; gap: 2px; padding: 3px; border-bottom: 1px solid var(--border); border-right: 1px solid var(--border-subtle, var(--border)); }
.week__allday.is-today { background: var(--accent-tint); }
.week__badge { font-size: var(--text-meta-sm); font-weight: 700; padding: 1px 5px; border-radius: var(--r-inset); background: color-mix(in srgb, currentColor 14%, var(--surface)); color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.week__axis { display: flex; flex-direction: column; }
.week__hour { display: flex; align-items: flex-start; justify-content: flex-end; padding: 2px 8px 0 0; font-size: var(--text-meta-sm); font-weight: 700; color: var(--ink-6); box-sizing: border-box; }
.week__col { position: relative; border-right: 1px solid var(--border-subtle, var(--border)); }
.week__col.is-today { background: color-mix(in srgb, var(--accent-tint) 60%, transparent); }
.week__line { display: block; border-bottom: 1px solid var(--border-subtle, var(--border)); box-sizing: border-box; }
.week__ev { position: absolute; display: flex; flex-direction: column; gap: 1px; padding: 3px 5px; border-radius: var(--r-inset); border: none; border-left: 3px solid currentColor; background: color-mix(in srgb, currentColor 16%, var(--surface)); cursor: pointer; text-align: left; overflow: hidden; }
.week__ev.is-service { cursor: default; }
.week__ev.is-cancelled { opacity: .5; text-decoration: line-through; }
.week__ev-time { font-size: var(--text-meta-sm); font-weight: 800; color: currentColor; font-variant-numeric: tabular-nums; }
.week__ev-title { font-size: var(--text-meta); font-weight: 600; color: var(--ink); overflow: hidden; text-overflow: ellipsis; }

/* --- agenda --- */
.agenda__day { margin-bottom: var(--sp-16); }
.agenda__day:last-child { margin-bottom: 0; }
.agenda__dayhead { display: flex; align-items: baseline; justify-content: space-between; gap: var(--sp-12); padding-bottom: var(--sp-6); border-bottom: 2px solid var(--border); margin-bottom: var(--sp-6); }
.agenda__dayhead h2 { margin: 0; font-size: var(--text-h3); font-weight: 800; letter-spacing: -0.02em; }
.agenda__count { font-size: var(--text-meta); color: var(--ink-5); font-weight: 700; }
.agenda__list { list-style: none; margin: 0; padding: 0; }
.agenda__row { display: grid; grid-template-columns: 74px 1fr; gap: var(--sp-12); padding: 9px 4px; border-bottom: 1px solid var(--border-subtle, var(--border)); align-items: baseline; }
.agenda__row:last-child { border-bottom: none; }
.agenda__row.is-clickable { cursor: pointer; }
.agenda__row.is-clickable:hover { background: var(--surface-subtle); }
.agenda__row.is-cancelled .agenda__title { text-decoration: line-through; opacity: .6; }
.agenda__time { font-size: var(--text-body-sm); font-weight: 800; color: var(--ink-3); font-variant-numeric: tabular-nums; white-space: nowrap; }
.agenda__body { display: flex; flex-direction: column; min-width: 0; }
.agenda__title { font-weight: 700; font-size: var(--text-body-sm); display: flex; align-items: center; gap: var(--sp-6); flex-wrap: wrap; }
.agenda__meta { font-size: var(--text-meta); color: var(--ink-5); }

@media (max-width: 640px) {
  .cal__legend { margin-left: 0; width: 100%; }
  .cal__cell { min-height: 76px; }
  .cal__ev-title { display: none; }
}

@media print {
  .cal__head, .cal__controls, .cal__legend { display: none; }
  .agenda { box-shadow: none; border: none; }
}
</style>

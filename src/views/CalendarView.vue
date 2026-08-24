<script setup>
// The members' Calendar (frame 6a). Open to everyone: a month grid of the church year,
// showing published events and — for callers who may read them — the recurring services
// overlaid. A non-privileged member sees published events only; that narrowing is the
// SELECT policy's (0032), not this view's. Clicking an event opens its detail.
//
// Month is the only view in Stage 1. Week and Agenda are Stage 2 (#86); their pill is
// rendered but inert, marked the same way the nav marks a Soon item, so the shape is
// visible without pretending to work.

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
import { listEvents, listServiceOccurrences, listBirthdays, EVENT_KINDS, kindLabel } from '../lib/data/events'

const router = useRouter()
const { activeChurchId, ensureLoaded } = useActiveChurch()
const { canManageEvents } = useCurrentRole()

// The month being viewed, as a first-of-month Date. Defaults to today's month.
const cursor = ref(startOfMonth(new Date()))
const loading = ref(true)
const errorMsg = ref('')
const events = ref([])
const services = ref([])
// Member birthdays overlaid on the month, via list_calendar_birthdays (0033) — visible to
// every member of the church. Name and day only; the birth year never leaves the database.
const birthdays = ref([])
// One pool the grid and the "next seven days" both bucket from.
const allItems = computed(() => [...events.value, ...services.value, ...birthdays.value])

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']
const DOWS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// The legend groups events by kind → a colour family. Services (and the overlay) are the
// accent; group meetings neutral; special/outreach magenta; admin warning.
const LEGEND = [
  { key: 'services', label: 'Services' },
  { key: 'groups',   label: 'Groups' },
  { key: 'special',  label: 'Special' },
  { key: 'admin',    label: 'Admin' },
  { key: 'birthday', label: 'Birthdays' },
]
const KIND_LEGEND = Object.fromEntries(EVENT_KINDS.map((k) => [k.value, k.legend]))
function legendOf(item) {
  if (item.isBirthday) return 'birthday'
  if (item.isService) return 'services'
  return KIND_LEGEND[item.kind] ?? 'groups'
}

const monthLabel = computed(() => `${MONTHS[cursor.value.getMonth()]} ${cursor.value.getFullYear()}`)

// The 42-cell (6-week) grid, Monday-first, covering the visible month plus its
// leading/trailing days. Each cell carries its date, whether it is in-month/today, and the
// items that fall on it (events + service occurrences), capped for display.
const cells = computed(() => {
  const first = cursor.value
  const start = new Date(first)
  const lead = start.getDay() // Sunday=0 — the week starts on Sunday
  start.setDate(start.getDate() - lead)

  const byDay = bucketByDay(allItems.value)
  const today = ymd(new Date())
  const out = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    const key = ymd(d)
    const items = (byDay.get(key) || []).sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    out.push({
      key,
      day: d.getDate(),
      inMonth: d.getMonth() === first.getMonth(),
      isToday: key === today,
      isSunday: d.getDay() === 0,
      items: items.slice(0, 3),
      more: Math.max(0, items.length - 3),
    })
  }
  return out
})

// The next seven days as a flat, time-ordered list — frame 6a's right-hand summary.
const upcoming = computed(() => {
  const now = new Date()
  const horizon = new Date(now); horizon.setDate(horizon.getDate() + 7)
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

  // Load the visible grid's window (6 weeks), so leading/trailing cells are populated too.
  const gridStart = new Date(cursor.value)
  gridStart.setDate(gridStart.getDate() - gridStart.getDay())
  const gridEnd = new Date(gridStart)
  gridEnd.setDate(gridEnd.getDate() + 42)
  const from = gridStart.toISOString()
  const to = gridEnd.toISOString()

  const [ev, sv, bd] = await Promise.all([
    listEvents({ churchId, from, to }),
    listServiceOccurrences({ churchId, from, to }),
    listBirthdays({ churchId, from, to }),
  ])
  if (!ev.ok) { errorMsg.value = ev.message; events.value = [] } else { events.value = ev.events }
  services.value = sv
  birthdays.value = bd
  loading.value = false
}

function step(delta) {
  const d = new Date(cursor.value)
  d.setMonth(d.getMonth() + delta)
  cursor.value = startOfMonth(d)
}
function goToday() { cursor.value = startOfMonth(new Date()) }

function openItem(item) {
  // Services and birthdays are read-only overlays — they have no event detail to open.
  if (item.isService || item.isBirthday) return
  router.push({ name: 'EventDetail', params: { id: item.id } })
}

watch([cursor, activeChurchId], load)
onMounted(load)

// --- date helpers (pure) ---------------------------------------------------
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1) }
function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()) }
function ymd(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
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
function dowLabel(iso) { return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(iso).getDay()] }
</script>

<template>
  <div class="cal">
    <header class="cal__head">
      <div>
        <div class="cal__crumb">
          <span>Calendar</span><span>/</span><span class="cal__crumb-now">Month</span>
        </div>
        <h1 class="cal__title">
          Calendar
        </h1>
        <p class="cal__sub">
          The church year in one place
        </p>
      </div>
      <Button
        v-if="canManageEvents"
        variant="primary"
        :to="{ name: 'EventNew' }"
      >
        New event
      </Button>
    </header>

    <div class="cal__controls">
      <div class="cal__stepper">
        <button
          type="button"
          class="cal__step"
          aria-label="Previous month"
          @click="step(-1)"
        >
          <Icon
            name="chevronLeft"
            :size="15"
          />
        </button>
        <span class="cal__month">{{ monthLabel }}</span>
        <button
          type="button"
          class="cal__step"
          aria-label="Next month"
          @click="step(1)"
        >
          <Icon
            name="chevronRight"
            :size="15"
          />
        </button>
      </div>
      <Button
        variant="secondary"
        size="sm"
        @click="goToday"
      >
        Today
      </Button>

      <div
        class="cal__views"
        role="tablist"
        aria-label="Calendar view"
      >
        <span class="cal__view is-on">Month</span>
        <span
          class="cal__view is-soon"
          aria-disabled="true"
        >Week <Badge tone="magenta">Soon</Badge></span>
        <span
          class="cal__view is-soon"
          aria-disabled="true"
        >Agenda <Badge tone="magenta">Soon</Badge></span>
      </div>

      <ul class="cal__legend">
        <li
          v-for="l in LEGEND"
          :key="l.key"
          :class="`cal__legend-item cal__tone--${l.key}`"
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
      <Spinner label="Loading the month" />
    </div>

    <template v-else>
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
              :class="[`cal__tone--${legendOf(it)}`, { 'is-cancelled': it.status === 'cancelled', 'is-service': it.isService, 'is-birthday': it.isBirthday }]"
              @click="openItem(it)"
            >
              <span
                v-if="it.isBirthday"
                class="cal__ev-time"
                aria-hidden="true"
              >🎂</span>
              <span
                v-else
                class="cal__ev-time"
              >{{ timeLabel(it.starts_at) }}</span>
              <span class="cal__ev-title">{{ it.isBirthday ? it.title + '’s birthday' : it.title }}</span>
            </button>
            <span
              v-if="c.more"
              class="cal__more"
            >+{{ c.more }} more</span>
          </div>
        </div>
      </Card>

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
            :class="{ 'is-clickable': !u.isService && !u.isBirthday }"
            @click="openItem(u)"
          >
            <span class="cal__next-date">
              <span class="cal__next-dow">{{ dowLabel(u.starts_at) }}</span>
              <span class="cal__next-day">{{ new Date(u.starts_at).getDate() }}</span>
            </span>
            <span class="cal__next-body">
              <span class="cal__next-title">{{ u.isBirthday ? u.title + '’s birthday' : u.title }}</span>
              <span class="cal__next-meta">{{ u.isBirthday ? 'Birthday' : (u.isService ? 'Service' : kindLabel(u.kind)) }}{{ u.location ? ' · ' + u.location : '' }}</span>
            </span>
            <span class="cal__next-time">{{ u.isBirthday ? '🎂' : timeLabel(u.starts_at) }}</span>
          </li>
        </ul>
      </Card>
    </template>
  </div>
</template>

<style scoped>
.cal { display: flex; flex-direction: column; gap: var(--sp-18); }

.cal__head { display: flex; align-items: flex-end; justify-content: space-between; gap: var(--sp-16); flex-wrap: wrap; }
.cal__crumb { display: flex; align-items: center; gap: var(--sp-6); font-size: var(--text-meta); color: var(--ink-5); font-weight: 600; }
.cal__crumb-now { color: var(--ink-3); }
.cal__title { margin: var(--sp-6) 0 0; font-size: var(--text-h1); font-weight: 800; letter-spacing: -0.03em; }
.cal__sub { margin: var(--sp-4) 0 0; font-size: var(--text-body); color: var(--ink-5); }

.cal__controls { display: flex; align-items: center; gap: var(--sp-10); flex-wrap: wrap; }
.cal__stepper { display: flex; align-items: center; gap: 2px; padding: 3px; border: 1px solid var(--border); border-radius: var(--r-control); background: var(--surface); }
.cal__step { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: none; background: none; border-radius: var(--r-inset); color: var(--ink-5); cursor: pointer; }
.cal__step:hover { background: var(--surface-subtle-2); }
.cal__month { padding: 0 var(--sp-10); font-weight: 800; font-size: var(--text-body-sm); white-space: nowrap; }

.cal__views { display: flex; gap: 3px; padding: 3px; border-radius: var(--r-control); background: var(--surface-subtle-2); }
.cal__view { display: inline-flex; align-items: center; gap: var(--sp-6); padding: 7px 13px; border-radius: var(--r-inset); font-weight: 700; font-size: var(--text-meta); color: var(--ink-5); }
.cal__view.is-on { background: var(--surface); color: var(--ink); box-shadow: 0 1px 2px rgba(16,24,40,.1); }
.cal__view.is-soon { cursor: default; }

.cal__legend { display: flex; gap: var(--sp-10); margin: 0 0 0 auto; padding: 0; list-style: none; flex-wrap: wrap; }
.cal__legend-item { display: inline-flex; align-items: center; gap: var(--sp-6); font-size: var(--text-meta); font-weight: 700; color: var(--ink-4); }
.cal__dot { width: 8px; height: 8px; border-radius: var(--r-pill); background: currentColor; }

/* Tone families — services/overlay accent, groups neutral, special magenta, admin warning */
.cal__tone--services { color: var(--accent); }
.cal__tone--groups { color: var(--ink-5); }
.cal__tone--special { color: var(--magenta); }
.cal__tone--admin { color: var(--warning, #e08b2c); }
.cal__tone--birthday { color: #9333ea; }

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
.cal__ev.is-service, .cal__ev.is-birthday { cursor: default; }
.cal__ev.is-cancelled { opacity: .5; text-decoration: line-through; }
.cal__ev-time { font-size: var(--text-meta-sm); font-weight: 800; font-variant-numeric: tabular-nums; white-space: nowrap; color: currentColor; }
.cal__ev-title { font-size: var(--text-meta); font-weight: 600; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cal__more { font-size: var(--text-meta-sm); font-weight: 700; color: var(--ink-6); padding-left: 7px; }

.cal__next-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--sp-12); margin-bottom: var(--sp-10); }
.cal__next-head h2 { margin: 0; font-size: var(--text-h3); font-weight: 800; letter-spacing: -0.02em; }
.cal__next-count { font-size: var(--text-meta); color: var(--ink-5); }
.cal__empty { margin: 0; font-size: var(--text-body-sm); color: var(--ink-5); }
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

@media (max-width: 640px) {
  .cal__legend { margin-left: 0; width: 100%; }
  .cal__cell { min-height: 76px; }
  .cal__ev-title { display: none; }
}
</style>

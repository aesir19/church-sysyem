<script setup>
// The Events management list (frame 6d, Stage 1 cut — no Volunteers/Series columns yet;
// those are Stage 3/2). Visible to the five privileged roles (canViewEvents gates the
// route and the nav); only canManageEvents sees the New event verb and the row is a link
// into detail for everyone who can reach here. Drafts appear only to callers RLS lets read
// them — the Drafts tab is simply empty for an oversight role that has none.

import { ref, computed, watch, onMounted } from 'vue'
import Card from '../components/ui/Card.vue'
import Button from '../components/ui/Button.vue'
import Badge from '../components/ui/Badge.vue'
import Spinner from '../components/ui/Spinner.vue'
import Alert from '../components/ui/Alert.vue'
import { useActiveChurch } from '../composables/useActiveChurch'
import { useCurrentRole } from '../composables/useCurrentRole'
import { listManagedEvents, kindLabel, eventLocation } from '../lib/data/events'
import { listSeries } from '../lib/data/eventSeries'
import EventRoomsManager from '../components/events/EventRoomsManager.vue'

const { activeChurchId, churches, ensureLoaded } = useActiveChurch()
const { canManageEvents, canManageRooms } = useCurrentRole()
const roomsOpen = ref(false)
// The church segment for every event link — the list is scoped to the active church.
const activeChurchName = computed(() => churches.value.find((c) => c.id === activeChurchId.value)?.name || '')

const TABS = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'past', label: 'Past' },
  { key: 'series', label: 'Repeating' },
  { key: 'drafts', label: 'Drafts' },
]
const tab = ref('upcoming')
const loading = ref(true)
const errorMsg = ref('')
const events = ref([])
const series = ref([])

const statusTone = { draft: 'warning', published: 'success', cancelled: 'magenta' }
const statusLabel = { draft: 'Draft', published: 'Published', cancelled: 'Cancelled' }

async function load() {
  loading.value = true
  errorMsg.value = ''
  await ensureLoaded()
  if (!activeChurchId.value) { loading.value = false; return }
  if (tab.value === 'series') {
    const res = await listSeries({ churchId: activeChurchId.value })
    if (!res.ok) { errorMsg.value = res.message; series.value = [] } else { series.value = res.series }
  } else {
    const res = await listManagedEvents({ churchId: activeChurchId.value, scope: tab.value })
    if (!res.ok) { errorMsg.value = res.message; events.value = [] } else { events.value = res.events }
  }
  loading.value = false
}

function fmtNext(d) {
  return d ? new Date(d).toLocaleDateString('en-PH', { weekday: 'short', day: 'numeric', month: 'short' }) : 'No upcoming dates'
}

watch([tab, activeChurchId], load)
onMounted(load)

const empty = computed(() => {
  if (loading.value || errorMsg.value) return false
  return tab.value === 'series' ? series.value.length === 0 : events.value.length === 0
})
const emptyText = computed(() => ({
  upcoming: 'No upcoming events. Create one to start filling the calendar.',
  past: 'No past events yet.',
  series: 'No repeating events yet. Most of a church year repeats — set the Sunday service up once and the calendar fills itself.',
  drafts: 'No drafts waiting. Everything you have written is published.',
}[tab.value]))

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-PH', { day: 'numeric', month: 'short' })
}
function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(':00', '')
}
</script>

<template>
  <div class="ev">
    <header class="ev__head">
      <div>
        <div class="ev__crumb">
          <span>Calendar</span><span>/</span><span class="ev__crumb-now">Events</span>
        </div>
        <h1 class="ev__title">
          Events
        </h1>
        <p class="ev__sub">
          Everything on the calendar as a list — plan it here, members see it once published
        </p>
      </div>
      <div class="ev__head-actions">
        <Button
          v-if="canManageRooms"
          variant="secondary"
          @click="roomsOpen = true"
        >
          Rooms
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

    <EventRoomsManager
      v-model:open="roomsOpen"
      :church-id="activeChurchId"
    />

    <div
      class="ev__tabs"
      role="tablist"
      aria-label="Events"
    >
      <button
        v-for="t in TABS"
        :key="t.key"
        type="button"
        role="tab"
        :aria-selected="tab === t.key"
        class="ev__tab"
        :class="{ 'is-on': tab === t.key }"
        @click="tab = t.key"
      >
        {{ t.label }}
      </button>
    </div>

    <Alert
      v-if="errorMsg"
      tone="danger"
    >
      {{ errorMsg }}
    </Alert>

    <div
      v-if="loading"
      class="ev__loading"
    >
      <Spinner label="Loading events" />
    </div>

    <Card
      v-else-if="empty"
      class="ev__empty"
    >
      <p>{{ emptyText }}</p>
      <Button
        v-if="canManageEvents && tab !== 'past'"
        variant="primary"
        :to="{ name: 'EventNew' }"
      >
        New event
      </Button>
    </Card>

    <!-- Repeating series (frame 6d): the rule in plain words and its next date. -->
    <Card
      v-else-if="tab === 'series'"
      :padded="false"
      class="ev__table-card"
    >
      <div class="ev__thead ev__thead--series">
        <span>Repeating event</span><span>Repeats</span><span>Next date</span>
      </div>
      <component
        :is="canManageEvents ? 'RouterLink' : 'div'"
        v-for="s in series"
        :key="s.id"
        :to="canManageEvents ? { name: 'EventNew', query: { series: s.id } } : undefined"
        class="ev__row ev__row--series"
      >
        <span class="ev__name">
          <span class="ev__bar ev__tone--published" />
          <span class="ev__name-text">
            <span class="ev__name-title">{{ s.title }}</span>
            <span class="ev__name-where">{{ kindLabel(s.kind) }}{{ s.location ? ' · ' + s.location : '' }}</span>
          </span>
        </span>
        <span class="ev__rule">⟳ {{ s.ruleText }}</span>
        <span class="ev__next">{{ fmtNext(s.next) }}</span>
      </component>
    </Card>

    <Card
      v-else
      :padded="false"
      class="ev__table-card"
    >
      <div class="ev__thead">
        <span>When</span><span>Event</span><span>Kind</span><span class="ev__col-status">Status</span>
      </div>
      <RouterLink
        v-for="e in events"
        :key="e.id"
        :to="eventLocation(e, activeChurchName)"
        class="ev__row"
      >
        <span class="ev__when">
          <span class="ev__date">{{ fmtDate(e.starts_at) }}</span>
          <span class="ev__time">{{ fmtTime(e.starts_at) }}</span>
        </span>
        <span class="ev__name">
          <span
            class="ev__bar"
            :class="`ev__tone--${e.status}`"
          />
          <span class="ev__name-text">
            <span class="ev__name-title">{{ e.title }}</span>
            <span
              v-if="e.location"
              class="ev__name-where"
            >{{ e.location }}</span>
          </span>
        </span>
        <span class="ev__kind">{{ kindLabel(e.kind) }}</span>
        <span class="ev__col-status">
          <Badge :tone="statusTone[e.status] || 'neutral'">{{ statusLabel[e.status] || e.status }}</Badge>
        </span>
      </RouterLink>
    </Card>
  </div>
</template>

<style scoped>
.ev { display: flex; flex-direction: column; gap: var(--sp-16); }
.ev__head { display: flex; align-items: flex-end; justify-content: space-between; gap: var(--sp-16); flex-wrap: wrap; }
.ev__head-actions { display: flex; align-items: center; gap: var(--sp-9); }
.ev__crumb { display: flex; align-items: center; gap: var(--sp-6); font-size: var(--text-meta); color: var(--ink-5); font-weight: 600; }
.ev__crumb-now { color: var(--ink-3); }
.ev__title { margin: var(--sp-6) 0 0; font-size: var(--text-h1); font-weight: 800; letter-spacing: -0.03em; }
.ev__sub { margin: var(--sp-5) 0 0; font-size: var(--text-body); color: var(--ink-5); }

.ev__tabs { display: flex; gap: 3px; padding: 3px; border-radius: var(--r-control); background: var(--surface-subtle-2); width: max-content; }
.ev__tab { padding: 7px 13px; border: none; border-radius: var(--r-inset); font-family: inherit; font-weight: 700; font-size: var(--text-meta); color: var(--ink-5); cursor: pointer; background: transparent; }
.ev__tab.is-on { background: var(--surface); color: var(--ink); box-shadow: 0 1px 2px rgba(16,24,40,.1); }

.ev__loading { display: grid; place-items: center; min-height: 160px; }
.ev__empty { display: flex; flex-direction: column; align-items: flex-start; gap: var(--sp-12); }
.ev__empty p { margin: 0; font-size: var(--text-body); color: var(--ink-5); }

.ev__table-card { overflow: hidden; }
.ev__thead, .ev__row { display: grid; grid-template-columns: 110px 1fr 150px 120px; gap: var(--sp-12); padding: 13px var(--sp-16); align-items: center; }
.ev__thead { background: var(--surface-subtle); border-bottom: 1px solid var(--border); font-size: var(--text-meta-sm); font-weight: 800; letter-spacing: .09em; text-transform: uppercase; color: var(--ink-5); }
.ev__col-status { text-align: right; justify-self: end; }
.ev__row { border-bottom: 1px solid var(--border-subtle, var(--border)); text-decoration: none; color: inherit; transition: background-color var(--dur-state) ease; }
.ev__row:last-child { border-bottom: none; }
.ev__row:hover { background: var(--surface-subtle); }
.ev__when { display: flex; flex-direction: column; line-height: 1.25; }
.ev__date { font-weight: 800; font-size: var(--text-body-sm); font-variant-numeric: tabular-nums; }
.ev__time { font-size: var(--text-meta); color: var(--ink-5); font-variant-numeric: tabular-nums; }
.ev__name { display: flex; align-items: center; gap: var(--sp-10); min-width: 0; }
.ev__bar { width: 3px; height: 26px; flex: none; border-radius: var(--r-pill); background: var(--ink-5); }
.ev__tone--published { background: var(--accent); }
.ev__tone--draft { background: var(--warning, #e08b2c); }
.ev__tone--cancelled { background: var(--magenta); }
.ev__name-text { display: flex; flex-direction: column; min-width: 0; }
.ev__name-title { font-weight: 700; font-size: var(--text-body-sm); }
.ev__name-where { font-size: var(--text-meta); color: var(--ink-5); }
.ev__kind { font-size: var(--text-body-sm); color: var(--ink-3); }

.ev__thead--series, .ev__row--series { grid-template-columns: 1fr 1fr 150px; }
.ev__row--series { text-decoration: none; color: inherit; }
.ev__rule { font-size: var(--text-body-sm); color: var(--ink-3); font-weight: 600; }
.ev__next { font-size: var(--text-body-sm); color: var(--ink-3); font-variant-numeric: tabular-nums; }

@media (max-width: 640px) {
  .ev__thead { display: none; }
  .ev__row { grid-template-columns: 1fr auto; grid-template-areas: 'name status' 'when when'; row-gap: var(--sp-6); }
  .ev__name { grid-area: name; }
  .ev__col-status { grid-area: status; }
  .ev__when { grid-area: when; flex-direction: row; gap: var(--sp-8); }
  .ev__kind { display: none; }
}
</style>

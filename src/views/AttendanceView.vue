<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { supabase } from '../lib/supabase'
import Avatar from '../components/ui/Avatar.vue'
import Button from '../components/ui/Button.vue'
import Icon from '../components/ui/icons/Icon.vue'
import Modal from '../components/ui/Modal.vue'
import RecordAttendeeModal from '../components/attendance/RecordAttendeeModal.vue'
import CheckinQrModal from '../components/attendance/CheckinQrModal.vue'
import CheckinWindowsModal from '../components/attendance/CheckinWindowsModal.vue'
import LinkMemberModal from '../components/attendance/LinkMemberModal.vue'
import { write, writeRpc } from '../lib/data/write'
import { countAttendanceByService } from '../lib/data/attendance'
import {
  attendeeLabel,
  describeNextWindow,
  formatClockTime,
  formatTimeRemaining,
  isWindowOpen,
  summariseRoster
} from '../utils/attendanceWindow'
import {
  buildServiceBars,
  describeAgainstAverage,
  longDate,
  previousValues,
  averageOf
} from '../utils/attendanceStats'
import { showToast } from '../composables/useToast'
import { useCurrentRole } from '../composables/useCurrentRole'
import { useActiveChurch } from '../composables/useActiveChurch'

// Attendance — who is here, how that compares, and the two controls that make
// self check-in possible.
//
// WHAT MOVED. The old screen was one 2,000-line file with two tabs: a setup tab
// (schedules, QR, link rotation) and a record tab (picker, summary tiles,
// roster). The mockup collapses that into a single screen whose subject is the
// roster, with everything else behind a button. The setup did not disappear —
// it is CheckinWindowsModal and CheckinQrModal — because self check-in only
// works inside a scheduled window, and nothing else in the app manages those.
//
// canManageAttendance (Welcome Team / SuperAdmin) gates every write; viewers
// (Pastor / Church Leader / Head Pastor) get the same screen read-only. RLS is
// the enforcement — this only decides what to draw.

const { canManageAttendance } = useCurrentRole()

// The church-param RPCs (0018) let a SuperAdmin / Head Pastor target the
// selected church; a single-church user's active church is simply their own.
const { activeChurchId, ensureLoaded } = useActiveChurch()

const ATTENDANCE_COLUMNS =
  'id, member_id, guest_name, guest_contact, source, created_at, members(first_name, middle_name, last_name)'
const SERVICE_COLUMNS = 'id, label, service_date, opens_at, closes_at, schedule_id'
const SCHEDULE_COLUMNS = 'id, label, weekday, starts_at, ends_at, is_active'

// Loading and error state are kept apart per concern rather than merged, so a
// roster that loads cleanly does not clear a standing schedule failure.
const loadingContext = ref(true)
const loadingRoster = ref(true)
const contextError = ref('')
const rosterError = ref('')
const loadError = computed(() => contextError.value || rosterError.value)

const checkinToken = ref('')
const services = ref([])
const selectedServiceId = ref('')
const roster = ref([])
const schedules = ref([])
const members = ref([])
const serviceCounts = ref(new Map())

const recordOpen = ref(false)
const qrOpen = ref(false)
const windowsOpen = ref(false)
const linkRow = ref(null)
const linkOpen = ref(false)
const removeRow = ref(null)
const removing = ref(false)
const closingService = ref(false)

// Guards against out-of-order roster responses when the service select is
// changed quickly — the slower earlier request must not overwrite the newer one.
let rosterRequestId = 0

// The live service, found by WINDOW rather than by selection. The picker is a
// filter over history; reviewing last month's roster must not make the screen
// claim check-in is closed while a service is actually running.
const openService = computed(
  () => services.value.find((s) => isWindowOpen(s.opens_at, s.closes_at)) || null
)

const selectedService = computed(
  () => services.value.find((s) => s.id === selectedServiceId.value) || null
)

const viewingLive = computed(
  () => !!openService.value && openService.value.id === selectedServiceId.value
)

const summary = computed(() => summariseRoster(roster.value))

const subtitle = computed(() => {
  if (!selectedService.value) return 'No services yet'
  return `${selectedService.value.label} · ${longDate(selectedService.value.service_date)}`
})

const nextWindowLabel = computed(() => describeNextWindow(schedules.value))

// The card's second line. Live: how long is left. Historical: how it compared.
const liveNote = computed(() => {
  if (viewingLive.value) return formatTimeRemaining(openService.value.closes_at)
  if (openService.value) return `${openService.value.label} is open now`
  return nextWindowLabel.value || 'No active weekly slot — self check-in will never open.'
})

const bars = computed(() => {
  // The roster is fresher than the counts fetched at load — someone recorded
  // ten seconds ago is in one and not the other — so the selected service's
  // bar is taken from the roster itself.
  const counts = new Map(serviceCounts.value)
  if (selectedServiceId.value && !loadingRoster.value) {
    counts.set(selectedServiceId.value, roster.value.length)
  }
  return buildServiceBars(services.value, counts)
})

const comparison = computed(() => {
  const latest = bars.value.at(-1)
  if (!latest || latest.id !== selectedServiceId.value) return ''
  return describeAgainstAverage(summary.value.total, previousValues(bars.value))
})

const chartAverage = computed(() => {
  const average = averageOf(bars.value.map((b) => b.value))
  return average === null ? '' : `average ${Math.round(average)}`
})

const checkinUrl = computed(() => {
  if (!checkinToken.value) return ''
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  // The token goes in the FRAGMENT, never the path — fragments are not sent to
  // the server, so it stays out of Netlify access logs and any Referer header.
  return `${origin}/checkin#t=${checkinToken.value}`
})

const qrStatus = computed(() => {
  if (openService.value) {
    return `Open until ${formatClockTime(new Date(openService.value.closes_at).toTimeString().slice(0, 5))} · closes automatically`
  }
  return nextWindowLabel.value || 'Check-in is closed. It opens on its own inside a scheduled window.'
})

onMounted(async () => {
  // Resolve the active church before loadContext scopes its calls to it.
  await ensureLoaded()
  loadContext()
})

// The link dialog holds a roster row and is backed by the member list, and both
// are replaced underneath it when the service or church changes.
watch(selectedServiceId, () => {
  linkOpen.value = false
  loadRoster()
})

watch(activeChurchId, () => {
  if (!activeChurchId.value) return
  selectedServiceId.value = ''
  checkinToken.value = ''
  linkOpen.value = false
  serviceCounts.value = new Map()
  loadContext()
})

async function loadContext () {
  loadingContext.value = true
  contextError.value = ''

  const churchId = activeChurchId.value
  if (!churchId) {
    contextError.value = 'Unable to resolve church context.'
    loadingContext.value = false
    loadingRoster.value = false
    return
  }

  // One round-trip per intent, run in parallel. Every call is scoped to the
  // active church.
  const [linkResult, serviceResult, schedulesResult, membersResult, ensureResult] =
    await Promise.all([
      supabase.rpc('get_checkin_link', { p_church_id: churchId }),
      supabase.from('services').select(SERVICE_COLUMNS).eq('church_id', churchId).order('opens_at', { ascending: false }).limit(12),
      supabase.from('service_schedules').select(SCHEDULE_COLUMNS).eq('church_id', churchId).order('weekday').order('starts_at'),
      // Member picker source. Uses directory_search, NOT the members table: a
      // Welcome Team member has no can_see_member_detail and cannot read
      // `members` under RLS (0015), so the table select would be empty and the
      // attendee picker unusable.
      supabase.rpc('directory_search', { p_church_id: churchId }),
      // Materialises today's service from the recurring schedule if the window
      // is open and nothing has created it yet, so "close now" and "record
      // attendee" always have a real service to work against.
      supabase.rpc('ensure_open_service', { p_church_id: churchId })
    ])

  checkinToken.value = linkResult.error ? '' : (linkResult.data?.[0]?.token || '')
  schedules.value = schedulesResult.error ? [] : (schedulesResult.data || [])
  members.value = membersResult.error
    ? []
    : (membersResult.data || []).map((r) => ({
      id: r.member_id,
      first_name: r.first_name,
      last_name: r.last_name
    }))

  let list = serviceResult.error ? [] : (serviceResult.data || [])
  const openedId = ensureResult.error ? null : ensureResult.data

  // ensure_open_service may have created a row after the services select was
  // planned, so refetch rather than showing a roster with no service attached.
  if (openedId && !list.some((s) => s.id === openedId)) {
    const { data } = await supabase
      .from('services')
      .select(SERVICE_COLUMNS)
      .eq('church_id', churchId)
      .order('opens_at', { ascending: false })
      .limit(12)
    list = data || list
  }

  services.value = list

  if (serviceResult.error || schedulesResult.error || membersResult.error) {
    contextError.value = 'Some information could not be loaded. What you see below may be incomplete.'
  }

  loadingContext.value = false
  loadChart()

  const preferred = openedId || list[0]?.id || ''
  if (preferred === selectedServiceId.value) {
    await loadRoster()
  } else {
    selectedServiceId.value = preferred
    if (!preferred) loadingRoster.value = false
  }
}

// The chart's ten bars. Head counts only — see lib/data/attendance.js for why
// this is not one query that pulls the rows back and counts them here.
async function loadChart () {
  const ids = services.value.slice(0, 10).map((s) => s.id)
  const { counts } = await countAttendanceByService({ serviceIds: ids })
  serviceCounts.value = counts
}

async function loadRoster () {
  if (!selectedServiceId.value) {
    roster.value = []
    loadingRoster.value = false
    return
  }

  const requestId = ++rosterRequestId
  loadingRoster.value = true
  rosterError.value = ''

  // No `.is('archived_at', null)` on the embedded member, deliberately. That
  // rule exists so archived people do not appear in lists and pickers; an
  // attendance record is neither. Filtering the embed would blank the name on a
  // historical row and render it as "Unknown", which misrepresents what
  // happened.
  const { data, error } = await supabase
    .from('attendance')
    .select(ATTENDANCE_COLUMNS)
    .eq('service_id', selectedServiceId.value)
    .order('created_at', { ascending: false })

  if (requestId !== rosterRequestId) return

  if (error) {
    rosterError.value = 'Failed to load the roster. Please try again.'
    roster.value = []
    loadingRoster.value = false
    return
  }

  roster.value = data || []
  loadingRoster.value = false
}

function onRecorded (row) {
  roster.value = [row, ...roster.value]
}

function onLinked (row) {
  roster.value = roster.value.map((entry) => (entry.id === row.id ? row : entry))
}

function onUnlinkedRemoval (row) {
  roster.value = roster.value.filter((entry) => entry.id !== row.id)
}

function askRemove (row) {
  removeRow.value = row
}

async function confirmRemove () {
  const row = removeRow.value
  if (!row) return
  removing.value = true

  const result = await write(
    supabase.from('attendance').delete().eq('id', row.id),
    { columns: 'id', messages: { blocked: 'That record could not be removed.' } }
  )
  removing.value = false

  if (!result.ok) {
    showToast(result.message, 'error')
    return
  }

  roster.value = roster.value.filter((entry) => entry.id !== row.id)
  removeRow.value = null
  showToast(`Removed ${attendeeLabel(row)}.`)
}

async function closeNow () {
  const target = openService.value
  if (!target) return

  closingService.value = true
  const result = await writeRpc(
    supabase.rpc('close_service_now', { p_service_id: target.id }),
    { messages: { denied: 'You cannot close that service. It may belong to another church.' } }
  )
  closingService.value = false

  if (!result.ok) {
    showToast(result.message, 'error')
    return
  }

  // close_service_now clamps closes_at with LEAST/GREATEST, so the value it
  // lands on is not something the client can predict — refetch rather than
  // guess.
  const { data } = await supabase
    .from('services')
    .select(SERVICE_COLUMNS)
    .eq('id', target.id)
    .maybeSingle()

  if (data) {
    services.value = services.value.map((s) => (s.id === data.id ? data : s))
  }
  showToast('Check-in closed.')
}

function onScheduleAdded (row) {
  schedules.value = [...schedules.value, row].sort(
    (a, b) => a.weekday - b.weekday || String(a.starts_at).localeCompare(String(b.starts_at))
  )
}

function onScheduleUpdated (row) {
  schedules.value = schedules.value.map((s) => (s.id === row.id ? row : s))
}

function onServiceCreated (row) {
  services.value = [row, ...services.value]
  selectedServiceId.value = row.id
}

function formatServiceOption (service) {
  return `${service.label} — ${longDate(service.service_date)}`
}

function formatRecordedAt (value) {
  return new Date(value).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })
}
</script>

<template>
  <div class="att">
    <header
      class="att__head anim-rise"
      style="--i: 0"
    >
      <div class="att__title-block">
        <h1 class="att__title">
          Attendance
        </h1>
        <p class="att__sub">
          {{ subtitle }}
        </p>
      </div>

      <div class="att__actions">
        <Button
          variant="ghost"
          @click="windowsOpen = true"
        >
          Check-in windows
        </Button>
        <Button @click="qrOpen = true">
          Show QR
        </Button>
        <Button
          v-if="canManageAttendance"
          variant="primary"
          :disabled="!selectedServiceId"
          @click="recordOpen = true"
        >
          + Record attendee
        </Button>
      </div>
    </header>

    <!-- Amber, not red: a partial load is degraded output, not a failed
         action. Red stays reserved for writes that were rejected. -->
    <p
      v-if="loadError"
      class="att__warn"
    >
      {{ loadError }}
    </p>

    <div
      v-if="loadingContext"
      class="att__grid"
    >
      <div class="skeleton att__skeleton att__skeleton--live" />
      <div class="skeleton att__skeleton att__skeleton--chart" />
    </div>

    <div
      v-else-if="!services.length"
      class="empty"
    >
      <span class="empty__tile"><Icon
        name="attendance"
        :size="22"
      /></span>
      <h2 class="empty__title">
        No services yet
      </h2>
      <p class="empty__body">
        Check-in opens on its own once a weekly slot exists — or create a one-off
        service for something outside the usual pattern.
      </p>
      <Button
        variant="primary"
        @click="windowsOpen = true"
      >
        Set up check-in
      </Button>
    </div>

    <template v-else>
      <div class="att__grid">
        <!-- The live card. Gradient only while the service being viewed is the
             one actually running: the same card in cyan over last month's
             roster would say "live now" about a service that closed weeks
             ago. -->
        <section
          class="att__live anim-rise"
          :class="{ 'is-live': viewingLive }"
          style="--i: 1"
        >
          <div class="att__live-top">
            <span
              v-if="viewingLive"
              class="att__dot anim-pulse"
              aria-hidden="true"
            />
            <span class="att__eyebrow">{{ viewingLive ? 'Live now' : 'Recorded' }}</span>
          </div>

          <div class="att__figure">
            {{ summary.total }}
          </div>
          <p class="att__figure-note">
            present<template v-if="comparison">
              · {{ comparison }}
            </template>
          </p>

          <div class="att__split">
            <div class="att__split-cell">
              <span class="att__split-value">{{ summary.members }}</span>
              <span class="att__split-label">Members</span>
            </div>
            <div class="att__split-cell">
              <span class="att__split-value">{{ summary.guests }}</span>
              <span class="att__split-label">Guests</span>
            </div>
            <div class="att__split-cell">
              <span class="att__split-value">{{ summary.selfRecorded }}</span>
              <span class="att__split-label">Self check-in</span>
            </div>
          </div>

          <p class="att__live-note">
            {{ liveNote }}
          </p>

          <Button
            v-if="viewingLive && canManageAttendance"
            variant="onDark"
            size="sm"
            :loading="closingService"
            @click="closeNow"
          >
            Close check-in now
          </Button>
        </section>

        <!-- Last ten services -->
        <section
          class="card att__chart anim-rise"
          style="--i: 2"
        >
          <div class="att__card-head">
            <h2 class="att__card-title">
              Last ten services
            </h2>
            <span class="att__card-meta">{{ chartAverage }}</span>
          </div>

          <div class="att__bars">
            <div
              v-for="(bar, i) in bars"
              :key="bar.id"
              class="att__bar"
              :style="`--i: ${i}`"
              :title="bar.fullLabel"
            >
              <span
                class="att__bar-value"
                :class="{ 'is-latest': bar.isLatest }"
              >{{ bar.value === null ? '–' : bar.value }}</span>
              <span
                class="att__bar-fill"
                :class="{ 'is-latest': bar.isLatest, 'is-unknown': bar.value === null }"
                :style="`height: ${bar.heightPercent}%`"
              />
              <span class="att__bar-label">{{ bar.label }}</span>
            </div>
          </div>
        </section>
      </div>

      <!-- Who attended -->
      <section
        class="card att__roster anim-rise"
        style="--i: 3"
      >
        <div class="att__card-head att__card-head--padded">
          <h2 class="att__card-title">
            Who attended
          </h2>

          <div class="att__roster-tools">
            <span class="att__card-meta">
              {{ summary.total }} {{ summary.total === 1 ? 'record' : 'records' }} · newest first
            </span>
            <label
              class="att__picker"
              for="service-select"
            >
              <span class="visually-hidden">Showing</span>
              <select
                id="service-select"
                v-model="selectedServiceId"
                class="att__select"
              >
                <option
                  v-for="service in services"
                  :key="service.id"
                  :value="service.id"
                >
                  {{ formatServiceOption(service) }}
                </option>
              </select>
              <Icon
                name="chevronDown"
                :size="14"
                class="att__select-chevron"
              />
            </label>
          </div>
        </div>

        <div
          v-if="loadingRoster"
          class="att__rows"
        >
          <div
            v-for="n in 4"
            :key="n"
            class="skeleton att__row-skeleton"
          />
        </div>

        <p
          v-else-if="!roster.length"
          class="att__empty-row"
        >
          Nobody recorded yet for this service.
        </p>

        <ul
          v-else
          class="att__rows"
        >
          <li
            v-for="row in roster"
            :key="row.id"
            class="att__row"
          >
            <Avatar
              :name="attendeeLabel(row)"
              :size="30"
            />
            <span class="att__name">
              {{ attendeeLabel(row) }}
              <span
                v-if="row.guest_contact"
                class="att__contact"
              >{{ row.guest_contact }}</span>
            </span>

            <span
              class="att__tag"
              :class="row.member_id ? 'att__tag--member' : 'att__tag--guest'"
            >{{ row.member_id ? 'Member' : 'Guest' }}</span>

            <!-- Provenance on every row because a self check-in is an
                 unverified self-assertion — anyone holding the QR link can type
                 any name. Staff-recorded rows are the authoritative ones. -->
            <span class="att__source">{{ row.source === 'self' ? 'Self check-in' : 'Recorded by staff' }}</span>

            <span class="att__time">{{ formatRecordedAt(row.created_at) }}</span>

            <span
              v-if="canManageAttendance"
              class="att__row-actions"
            >
              <button
                v-if="!row.member_id"
                type="button"
                class="att__link"
                @click="linkRow = row; linkOpen = true"
              >
                Link to member
              </button>
              <button
                type="button"
                class="att__remove"
                :aria-label="`Remove ${attendeeLabel(row)} from this service`"
                @click="askRemove(row)"
              >
                <Icon
                  name="close"
                  :size="13"
                  :width="2.2"
                />
              </button>
            </span>
          </li>
        </ul>
      </section>
    </template>

    <RecordAttendeeModal
      v-if="canManageAttendance"
      v-model:open="recordOpen"
      :service-id="selectedServiceId"
      :service-label="selectedService?.label || ''"
      :service-date="longDate(selectedService?.service_date)"
      :recorded="summary.total"
      :church-id="activeChurchId"
      :members="members"
      @recorded="onRecorded"
    />

    <CheckinQrModal
      v-model:open="qrOpen"
      :checkin-url="checkinUrl"
      :title="`${openService?.label || selectedService?.label || 'Check-in'} check-in`"
      :status="qrStatus"
      :church-id="activeChurchId"
      :can-rotate="canManageAttendance"
      @rotated="checkinToken = $event"
    />

    <CheckinWindowsModal
      v-model:open="windowsOpen"
      :schedules="schedules"
      :church-id="activeChurchId"
      :can-manage="canManageAttendance"
      @schedule-added="onScheduleAdded"
      @schedule-updated="onScheduleUpdated"
      @service-created="onServiceCreated"
    />

    <LinkMemberModal
      v-if="canManageAttendance"
      v-model:open="linkOpen"
      :row="linkRow"
      :members="members"
      @linked="onLinked"
      @removed="onUnlinkedRemoval"
    />

    <Modal
      v-if="canManageAttendance"
      :open="!!removeRow"
      :title="`Remove ${attendeeLabel(removeRow)}?`"
      description="The record is deleted and the totals for this service change. Recording them again is the only way back."
      width="sm"
      layout="stack"
      footer-layout="even"
      icon="archive"
      icon-tone="magenta"
      :close-on-outside-click="false"
      @update:open="removeRow = $event ? removeRow : null"
    >
      <template #footer>
        <Button
          block
          :disabled="removing"
          @click="removeRow = null"
        >
          Keep record
        </Button>
        <Button
          block
          variant="danger"
          :loading="removing"
          @click="confirmRemove"
        >
          Remove
        </Button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.att { display: flex; flex-direction: column; gap: var(--sp-18); }

.att__head { display: flex; align-items: flex-end; justify-content: space-between; gap: var(--sp-16); }
.att__title-block { display: flex; flex-direction: column; gap: var(--sp-5); min-width: 0; }

.att__title {
  font-size: var(--text-h1);
  font-weight: 800;
  letter-spacing: var(--tracking-h1);
  line-height: var(--leading-h1);
}

.att__sub { font-size: var(--text-body); color: var(--ink-4); }

.att__actions { display: flex; align-items: center; gap: var(--sp-9); flex-wrap: wrap; }

.att__warn {
  padding: var(--sp-10) var(--sp-12);
  border-radius: var(--r-inset);
  background: var(--warning-tint);
  border: 1px solid var(--warning-border);
  font-size: var(--text-body-sm);
  color: var(--warning-deep);
}

.att__grid { display: grid; grid-template-columns: 320px 1fr; gap: var(--sp-18); align-items: start; }

.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-card);
  box-shadow: var(--shadow-card);
}

/* --- The live card ------------------------------------------------------ */
.att__live {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--sp-3);
  padding: var(--sp-20);
  border-radius: var(--r-card);
  background: var(--surface);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-card);
  color: var(--ink);
}

/* Cyan only while the service on screen is the one running. */
.att__live.is-live {
  background: linear-gradient(150deg, var(--accent), #005f7c);
  border-color: transparent;
  box-shadow: 0 18px 34px -22px rgba(0, 90, 120, .9);
  color: #fff;
}

.att__live-top { display: flex; align-items: center; gap: var(--sp-8); }

.att__dot { width: 8px; height: 8px; border-radius: var(--r-pill); background: #a7f3d0; }

.att__eyebrow {
  font-size: var(--text-meta-sm);
  font-weight: 800;
  letter-spacing: var(--tracking-eyebrow);
  text-transform: uppercase;
  color: var(--ink-5);
}
.att__live.is-live .att__eyebrow { color: var(--accent-border); }

.att__figure {
  margin-top: var(--sp-12);
  font-size: 52px;
  font-weight: 800;
  letter-spacing: -0.04em;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.att__figure-note { margin-top: var(--sp-8); font-size: var(--text-body-sm); color: var(--ink-4); }
.att__live.is-live .att__figure-note { color: var(--accent-border); }

.att__split {
  display: flex;
  width: 100%;
  margin-top: var(--sp-18);
  padding-top: var(--sp-14);
  border-top: 1px solid var(--divider);
}
.att__live.is-live .att__split { border-top-color: rgba(255, 255, 255, .22); }

.att__split-cell { flex: 1; display: flex; flex-direction: column; gap: 1px; }
.att__split-value { font-size: 19px; font-weight: 800; font-variant-numeric: tabular-nums; }
.att__split-label { font-size: var(--text-meta-sm); color: var(--ink-5); }
.att__live.is-live .att__split-label { color: var(--accent-border); }

.att__live-note { margin-top: var(--sp-14); font-size: var(--text-meta); color: var(--ink-5); }
.att__live.is-live .att__live-note { color: var(--accent-border); }

.att__live .btn { margin-top: var(--sp-12); }

/* --- The chart ---------------------------------------------------------- */
.att__chart { padding: var(--sp-20); }

.att__card-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--sp-12); }
.att__card-head--padded { padding: var(--sp-14) var(--sp-20); border-bottom: 1px solid var(--divider); }

.att__card-title { font-size: var(--text-h2); font-weight: 800; letter-spacing: var(--tracking-h2); }
.att__card-meta { font-size: var(--text-meta); color: var(--ink-5); }

.att__bars { display: flex; align-items: flex-end; gap: var(--sp-10); height: 150px; margin-top: var(--sp-18); }

.att__bar {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-7);
  height: 100%;
  justify-content: flex-end;
  min-width: 0;
}

.att__bar-value { font-size: var(--text-meta-sm); font-weight: 700; color: var(--ink-5); font-variant-numeric: tabular-nums; }
.att__bar-value.is-latest { color: var(--accent); }

.att__bar-fill {
  width: 100%;
  min-height: 3px;
  border-radius: 6px 6px 3px 3px;
  background: var(--divider);
  transform-origin: bottom;
  animation: tall var(--dur-tall) var(--ease-entrance) both;
  animation-delay: calc(var(--i, 0) * var(--stagger));
}
.att__bar-fill.is-latest { background: var(--accent); }

/* A service whose count could not be read is drawn as an outline, not as a
   floor-height bar — an empty bar and an unknown one must not look alike. */
.att__bar-fill.is-unknown {
  background: repeating-linear-gradient(
    45deg,
    var(--divider) 0 4px,
    transparent 4px 8px
  );
  min-height: 6px;
}

.att__bar-label { font-size: var(--text-meta-sm); color: var(--ink-6); white-space: nowrap; }

/* --- The roster --------------------------------------------------------- */
.att__roster { overflow: hidden; }

.att__roster-tools { display: flex; align-items: center; gap: var(--sp-12); }

.att__picker { position: relative; display: inline-flex; align-items: center; }

.att__select {
  appearance: none;
  padding: var(--sp-7) var(--sp-26) var(--sp-7) var(--sp-10);
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: var(--r-tag);
  font-family: var(--font-sans);
  font-size: var(--text-meta);
  font-weight: 700;
  color: var(--ink-2);
  cursor: pointer;
  max-width: 260px;
}
.att__select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.att__select-chevron { position: absolute; right: var(--sp-9); color: var(--ink-5); pointer-events: none; }

.att__rows { list-style: none; display: flex; flex-direction: column; }

.att__row {
  display: flex;
  align-items: center;
  gap: var(--sp-12);
  padding: var(--sp-12) var(--sp-20);
  border-bottom: 1px solid var(--divider);
  transition: background-color var(--dur-state) ease;
}
.att__row:last-child { border-bottom: 0; }
.att__row:hover { background: var(--surface-subtle-2); }

.att__name {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
  font-size: var(--text-body-sm);
  font-weight: 700;
  color: var(--ink);
}
.att__contact { font-size: var(--text-meta-sm); font-weight: 500; color: var(--ink-5); }

.att__tag {
  padding: 3px var(--sp-9);
  border-radius: var(--r-tag);
  font-size: var(--text-meta-sm);
  font-weight: 700;
  flex: none;
}
.att__tag--member { background: var(--accent-tint); color: var(--accent-darkest); }
.att__tag--guest { background: var(--magenta-tint); color: var(--magenta-deep); }

.att__source { width: 130px; flex: none; font-size: var(--text-meta); color: var(--ink-5); }
.att__time { width: 66px; flex: none; text-align: right; font-size: var(--text-meta); color: var(--ink-4); font-variant-numeric: tabular-nums; }

.att__row-actions { display: flex; align-items: center; gap: var(--sp-8); flex: none; }

.att__link {
  border: 0;
  background: none;
  padding: 0;
  font-family: var(--font-sans);
  font-size: var(--text-meta);
  font-weight: 700;
  color: var(--accent);
  cursor: pointer;
}
.att__link:hover { text-decoration: underline; }
.att__link:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: var(--r-checkbox); }

.att__remove {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: 1px solid var(--border-strong);
  border-radius: var(--r-tag);
  background: var(--surface);
  color: var(--ink-5);
  cursor: pointer;
  transition: background-color var(--dur-state) ease, color var(--dur-state) ease;
}
.att__remove:hover { background: var(--magenta-tint); border-color: var(--magenta-border); color: var(--magenta); }
.att__remove:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.att__empty-row { padding: var(--sp-22) var(--sp-20); font-size: var(--text-body-sm); color: var(--ink-5); }
.att__row-skeleton { height: 54px; border-radius: 0; }

/* --- States ------------------------------------------------------------- */
.att__skeleton { border-radius: var(--r-card); }
.att__skeleton--live { height: 260px; }
.att__skeleton--chart { height: 260px; }

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-12);
  padding: var(--sp-32) var(--sp-22);
  text-align: center;
}

.empty__tile {
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  border-radius: var(--r-inset);
  background: var(--accent-tint);
  color: var(--accent);
}

.empty__title { font-size: var(--text-h3); font-weight: 800; letter-spacing: var(--tracking-h3); }
.empty__body { font-size: var(--text-body-sm); color: var(--ink-4); max-width: 46ch; line-height: 1.55; }

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

@media (max-width: 900px) {
  .att__grid { grid-template-columns: 1fr; }
  .att__head { flex-direction: column; align-items: stretch; }
  .att__source { display: none; }
}

@media (max-width: 620px) {
  .att__tag { display: none; }
  .att__card-head--padded { flex-direction: column; align-items: flex-start; gap: var(--sp-9); }
}

@media (prefers-reduced-motion: reduce) {
  .att__bar-fill { animation: none; }
}
</style>

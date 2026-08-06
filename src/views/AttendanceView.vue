<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { supabase } from '../lib/supabase'
import MemberAutocomplete from '../components/MemberAutocomplete.vue'
import { interpretMutation } from '../utils/mutationResult'
import { buildStaffAttendancePayload, validateCheckinContact, validateCheckinName } from '../utils/checkinPayload'
import {
  attendeeLabel,
  buildAdhocServicePayload,
  buildSchedulePayload,
  describeNextWindow,
  formatScheduleRange,
  formatTimeRemaining,
  isWindowOpen,
  summariseRoster,
  validateAdhocService,
  validateSchedule,
  weekdayLabel,
  WEEKDAY_LABELS,
} from '../utils/attendanceWindow'
import { formatDateISO } from '../utils/collectionsDate'
import { useCurrentRole } from '../composables/useCurrentRole'
import { useActiveChurch } from '../composables/useActiveChurch'

// canManageAttendance (Welcome Team / SuperAdmin) gates every write action; viewers
// (Pastor / Church Leader / Head Pastor) see the roster read-only. RLS enforces it.
const { canManageAttendance } = useCurrentRole()

// Church scoping. The church-param RPCs (0018) let a SuperAdmin / Head Pastor target
// the selected church; a single-church user's active church is simply their own.
const { activeChurchId, activeChurchName, ensureLoaded } = useActiveChurch()

const ATTENDANCE_COLUMNS =
  'id, member_id, guest_name, guest_contact, source, created_at, members(first_name, middle_name, last_name)'
const SERVICE_COLUMNS = 'id, label, service_date, opens_at, closes_at, schedule_id'
const SCHEDULE_COLUMNS = 'id, label, weekday, starts_at, ends_at, is_active'

// Loading and error state are kept apart per concern rather than merged, so a
// roster that loads cleanly does not clear a standing schedule failure. Same
// discipline as ChurchFundsView.
const loadingContext = ref(true)
const loadingRoster = ref(true)
const contextError = ref('')
const rosterError = ref('')
const loading = computed(() => loadingContext.value || loadingRoster.value)
const loadError = computed(() => contextError.value || rosterError.value)

// Aliases to the shared active church so the rest of the view is unchanged.
const myChurchId = activeChurchId
const myChurchName = activeChurchName
const checkinToken = ref('')
const services = ref([])
const selectedServiceId = ref('')
const roster = ref([])
const schedules = ref([])
const members = ref([])

// The page is the two halves of one causal chain — the schedule and QR that make
// check-in open, and the record that falls out of it. The tabs name that split
// instead of leaving it to scroll position.
const activeTab = ref('checkin')

const toast = ref(null)
const savingAttendee = ref(false)
const closingService = ref(false)
const rotatingToken = ref(false)
const attendeeError = ref('')

const attendeeMode = ref('member')
const attendeeForm = ref({ memberId: '', guestName: '', guestContact: '' })
const memberPicker = ref(null)

const qrSvg = ref('')
const showQr = ref(false)
const qrError = ref('')

const scheduleModal = ref({ open: false, saving: false, error: '', form: null })
const adhocModal = ref({ open: false, saving: false, error: '', form: null })

// Guards against out-of-order roster responses when the service select is
// changed quickly — the slower earlier request must not overwrite the newer one.
let rosterRequestId = 0

// The live service, found by window rather than by selection. The select below
// is a filter over history; reviewing last month's roster must not make the
// banner claim check-in is closed while a service is actually running.
const openService = computed(
  () => services.value.find((service) => isWindowOpen(service.opens_at, service.closes_at)) || null
)

const closingLabel = computed(() =>
  openService.value ? formatTimeRemaining(openService.value.closes_at) : ''
)

const nextWindowLabel = computed(() => describeNextWindow(schedules.value))

const rosterSummary = computed(() => summariseRoster(roster.value))

const checkinUrl = computed(() => {
  if (!checkinToken.value) return ''
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  // The token goes in the FRAGMENT, never the path — fragments are not sent to
  // the server, so it stays out of Netlify access logs and any Referer header.
  return `${origin}/checkin#t=${checkinToken.value}`
})

const activeSchedules = computed(() => schedules.value.filter((row) => row.is_active))

onMounted(async () => {
  // Resolve the active church before loadContext scopes its calls to it.
  await ensureLoaded()
  loadContext()
})

watch(selectedServiceId, loadRoster)

// Reload everything for the newly selected church (church selector).
watch(activeChurchId, () => {
  if (!activeChurchId.value) return
  selectedServiceId.value = ''
  checkinToken.value = ''
  qrSvg.value = ''
  showQr.value = false
  loadContext()
})

async function loadContext() {
  loadingContext.value = true
  contextError.value = ''

  const churchId = activeChurchId.value
  if (!churchId) {
    contextError.value = 'Unable to resolve church context.'
    loadingContext.value = false
    loadingRoster.value = false
    return
  }

  // One round-trip per intent, run in parallel. Every call is scoped to the active
  // church: the church-param RPCs (0018) and explicit .eq('church_id', …) filters let
  // a SuperAdmin / Head Pastor target the selected church rather than their own.
  const [linkResult, serviceResult, schedulesResult, membersResult, ensureResult] =
    await Promise.all([
      supabase.rpc('get_checkin_link', { p_church_id: churchId }),
      supabase.from('services').select(SERVICE_COLUMNS).eq('church_id', churchId).order('opens_at', { ascending: false }).limit(12),
      supabase.from('service_schedules').select(SCHEDULE_COLUMNS).eq('church_id', churchId).order('weekday').order('starts_at'),
      // Member picker source. Uses directory_search, NOT the members table: a Welcome
      // Team member has no can_see_member_detail and cannot read `members` under RLS
      // (0015), so the table select would be empty and the attendee picker unusable.
      supabase.rpc('directory_search', { p_church_id: churchId }),
      // Materialises today's service from the recurring schedule if the window is
      // open and nothing has created it yet, so "close now" and "add attendee"
      // always have a real service to work against.
      supabase.rpc('ensure_open_service', { p_church_id: churchId }),
    ])

  checkinToken.value = linkResult.error ? '' : (linkResult.data?.[0]?.token || '')
  schedules.value = schedulesResult.error ? [] : (schedulesResult.data || [])
  members.value = membersResult.error
    ? []
    : (membersResult.data || []).map((r) => ({
        id: r.member_id,
        first_name: r.first_name,
        last_name: r.last_name,
      }))

  let list = serviceResult.error ? [] : (serviceResult.data || [])
  const openedId = ensureResult.error ? null : ensureResult.data

  // ensure_open_service may have created a row after the services select was
  // planned, so refetch rather than showing a roster with no service attached.
  if (openedId && !list.some((service) => service.id === openedId)) {
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

  // Land on whichever half of the chain the user came for. A service running
  // right now means they are here to record; the rest of the week, the schedule
  // is the thing worth seeing.
  activeTab.value = openService.value ? 'record' : 'checkin'

  loadingContext.value = false

  const preferred = openedId || list[0]?.id || ''
  if (preferred === selectedServiceId.value) {
    await loadRoster()
  } else {
    selectedServiceId.value = preferred
    if (!preferred) loadingRoster.value = false
  }
}

async function loadRoster() {
  if (!selectedServiceId.value) {
    roster.value = []
    loadingRoster.value = false
    return
  }

  const requestId = ++rosterRequestId
  loadingRoster.value = true
  rosterError.value = ''

  // No `.is('archived_at', null)` on the embedded member, deliberately. That rule
  // exists so archived people do not appear in lists and pickers; an attendance
  // record is neither. Filtering the embed would blank the name on a historical
  // row and render it as "Unknown", which misrepresents what happened.
  const { data, error } = await supabase
    .from('attendance')
    .select(ATTENDANCE_COLUMNS)
    .eq('service_id', selectedServiceId.value)
    .order('created_at', { ascending: false })

  if (requestId !== rosterRequestId) return

  if (error) {
    rosterError.value = `Failed to load the roster: ${error.message}`
    roster.value = []
    loadingRoster.value = false
    return
  }

  roster.value = data || []
  loadingRoster.value = false
}

function showToast(message, type = 'success') {
  toast.value = { message, type }
  window.setTimeout(() => {
    toast.value = null
  }, 3000)
}

async function handleAddAttendee() {
  attendeeError.value = ''

  if (!selectedServiceId.value) {
    attendeeError.value = 'Select a service first.'
    return
  }

  if (attendeeMode.value === 'member' && !attendeeForm.value.memberId) {
    attendeeError.value = 'Choose a member from the list.'
    return
  }

  if (attendeeMode.value === 'guest') {
    const nameError = validateCheckinName(attendeeForm.value.guestName)
    if (nameError) {
      attendeeError.value = nameError
      return
    }
    const contactError = validateCheckinContact(attendeeForm.value.guestContact)
    if (contactError) {
      attendeeError.value = contactError
      return
    }
  }

  const payload = buildStaffAttendancePayload({
    serviceId: selectedServiceId.value,
    churchId: myChurchId.value,
    memberId: attendeeMode.value === 'member' ? attendeeForm.value.memberId : '',
    guestName: attendeeForm.value.guestName,
    guestContact: attendeeForm.value.guestContact,
  })

  savingAttendee.value = true
  const result = await supabase.from('attendance').insert(payload).select(ATTENDANCE_COLUMNS)
  savingAttendee.value = false

  // PostgREST enforces RLS by filtering, so a blocked insert returns success with
  // zero rows. Without this the UI would report a rejected write as saved.
  const outcome = interpretMutation(
    result,
    'That attendance could not be saved. It may already be recorded, or the service may belong to another church.'
  )

  if (!outcome.ok) {
    attendeeError.value = outcome.message
    return
  }

  roster.value = [result.data[0], ...roster.value]
  attendeeForm.value = { memberId: '', guestName: '', guestContact: '' }
  memberPicker.value?.reset()
  showToast('Attendance recorded.')
}

async function handleRemove(row) {
  const label = attendeeLabel(row)
  if (!window.confirm(`Remove ${label} from this service's attendance?`)) return

  const result = await supabase.from('attendance').delete().eq('id', row.id).select('id')
  const outcome = interpretMutation(result, 'That record could not be removed.')

  if (!outcome.ok) {
    showToast(outcome.message, 'error')
    return
  }

  roster.value = roster.value.filter((entry) => entry.id !== row.id)
  showToast(`Removed ${label}.`)
}

async function handleCloseNow() {
  const target = openService.value
  if (!target) return
  if (!window.confirm('Close check-in for this service now? People will no longer be able to check themselves in.')) {
    return
  }

  closingService.value = true
  const { error } = await supabase.rpc('close_service_now', { p_service_id: target.id })
  closingService.value = false

  if (error) {
    showToast(error.message, 'error')
    return
  }

  // close_service_now clamps closes_at with LEAST/GREATEST, so the value it lands
  // on is not something the client can predict — refetch rather than guess.
  const { data } = await supabase
    .from('services')
    .select(SERVICE_COLUMNS)
    .eq('id', target.id)
    .maybeSingle()

  if (data) {
    services.value = services.value.map((service) => (service.id === data.id ? data : service))
  }
  showToast('Check-in closed.')
}

async function toggleQr() {
  showQr.value = !showQr.value
  if (!showQr.value || qrSvg.value || !checkinUrl.value) return

  qrError.value = ''
  try {
    // Dynamically imported so the ~51 KB generator lands in its own chunk that
    // only staff who open this panel ever download — attendees never do.
    const { default: qrcode } = await import('qrcode-generator')
    const qr = qrcode(0, 'M')
    qr.addData(checkinUrl.value)
    qr.make()
    // Rendered inline rather than fetched from a QR image API: an external URL
    // would need a CSP change, add a vendor, and hand the check-in token to it.
    qrSvg.value = qr.createSvgTag({ cellSize: 6, margin: 4, scalable: true })
  } catch {
    qrError.value = 'The QR code could not be generated. The link below still works.'
  }
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(checkinUrl.value)
    showToast('Check-in link copied.')
  } catch {
    showToast('Could not copy. Select the link and copy it manually.', 'error')
  }
}

async function handleRotateToken() {
  if (!window.confirm('Generate a new check-in link? Every QR code already printed will stop working.')) {
    return
  }

  rotatingToken.value = true
  const { data, error } = await supabase.rpc('rotate_checkin_token', { p_church_id: myChurchId.value })
  rotatingToken.value = false

  if (error) {
    showToast(error.message, 'error')
    return
  }

  checkinToken.value = data || ''
  qrSvg.value = ''
  showQr.value = false
  showToast('New check-in link generated. Reprint the QR code.')
}

function openScheduleModal() {
  scheduleModal.value = {
    open: true,
    saving: false,
    error: '',
    // 0 = Sunday, the common case, but only as the default — a midweek service
    // is a recurring slot too, not something to re-create as a one-off weekly.
    form: { label: '', weekday: 0, startsAt: '08:00', endsAt: '11:00' },
  }
}

async function saveSchedule() {
  const error = validateSchedule(scheduleModal.value.form)
  if (error) {
    scheduleModal.value.error = error
    return
  }

  scheduleModal.value.saving = true
  const result = await supabase
    .from('service_schedules')
    .insert(buildSchedulePayload(scheduleModal.value.form, myChurchId.value))
    .select(SCHEDULE_COLUMNS)
  scheduleModal.value.saving = false

  const outcome = interpretMutation(
    result,
    'That schedule could not be saved. A slot may already exist for that day and time.'
  )
  if (!outcome.ok) {
    scheduleModal.value.error = outcome.message
    return
  }

  schedules.value = [...schedules.value, result.data[0]].sort(
    (a, b) => a.weekday - b.weekday || String(a.starts_at).localeCompare(String(b.starts_at))
  )
  scheduleModal.value.open = false
  showToast('Schedule added.')
}

async function toggleSchedule(schedule) {
  const result = await supabase
    .from('service_schedules')
    .update({ is_active: !schedule.is_active })
    .eq('id', schedule.id)
    .select(SCHEDULE_COLUMNS)

  const outcome = interpretMutation(result, 'That schedule could not be updated.')
  if (!outcome.ok) {
    showToast(outcome.message, 'error')
    return
  }

  schedules.value = schedules.value.map((row) => (row.id === schedule.id ? result.data[0] : row))
  showToast(result.data[0].is_active ? 'Schedule resumed.' : 'Schedule paused.')
}

function openAdhocModal() {
  adhocModal.value = {
    open: true,
    saving: false,
    error: '',
    // formatDateISO, not toISOString().slice(0,10) — the latter is defect D8 and
    // is wrong for the first eight hours of every Manila day.
    form: { label: '', date: formatDateISO(new Date()), startsAt: '18:00', endsAt: '20:00' },
  }
}

async function saveAdhocService() {
  const error = validateAdhocService(adhocModal.value.form)
  if (error) {
    adhocModal.value.error = error
    return
  }

  adhocModal.value.saving = true
  const result = await supabase
    .from('services')
    .insert(buildAdhocServicePayload(adhocModal.value.form, myChurchId.value))
    .select(SERVICE_COLUMNS)
  adhocModal.value.saving = false

  const outcome = interpretMutation(
    result,
    'That service could not be created. One with the same name may already exist on that date.'
  )
  if (!outcome.ok) {
    adhocModal.value.error = outcome.message
    return
  }

  services.value = [result.data[0], ...services.value]
  selectedServiceId.value = result.data[0].id
  adhocModal.value.open = false
  // A one-off exists to be recorded against, so follow the chain to its output
  // rather than leaving the user on the setup tab wondering where it went.
  activeTab.value = 'record'
  showToast('Service created.')
}

function formatServiceOption(service) {
  const date = new Date(`${service.service_date}T00:00:00`).toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  return `${service.label} — ${date}`
}

function formatRecordedAt(value) {
  return new Date(value).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })
}
</script>

<template>
  <div class="page-container">
    <header class="page-header">
      <h1>Attendance</h1>
      <p class="page-subtitle">{{ myChurchName }}</p>
    </header>

    <!-- Amber, not red: a partial load is degraded output, not a failed action.
         Red stays reserved for writes that were rejected. -->
    <p v-if="loadError" class="notice notice-warning">{{ loadError }}</p>

    <div v-if="loading" class="card">
      <div class="state-message"><p>Loading attendance…</p></div>
    </div>

    <template v-else>
      <!-- Held above the tabs because it is true of the church, not of whichever
           tab happens to be showing. It is also the thread joining the two: the
           schedule causes this state, and this state causes the record. -->
      <div class="status-band" :class="openService ? 'is-open' : 'is-closed'">
        <span class="status-dot" aria-hidden="true"></span>
        <div class="status-text">
          <strong>{{ openService ? 'Check-in is open' : 'Check-in is closed' }}</strong>
          <span v-if="openService">{{ openService.label }} · {{ closingLabel }}</span>
          <span v-else-if="nextWindowLabel">{{ nextWindowLabel }}</span>
          <span v-else class="status-alert">No active weekly slot — self check-in will never open.</span>
        </div>
        <button
          v-if="openService && canManageAttendance"
          type="button"
          class="btn-caution"
          :disabled="closingService"
          @click="handleCloseNow"
        >
          {{ closingService ? 'Closing…' : 'Close check-in now' }}
        </button>
      </div>

      <div class="tabs" role="tablist" aria-label="Attendance sections">
        <button
          id="tab-checkin"
          type="button"
          role="tab"
          class="tab"
          :class="{ 'is-active': activeTab === 'checkin' }"
          :aria-selected="activeTab === 'checkin'"
          aria-controls="panel-checkin"
          @click="activeTab = 'checkin'"
        >
          Self check-in
        </button>
        <button
          id="tab-record"
          type="button"
          role="tab"
          class="tab"
          :class="{ 'is-active': activeTab === 'record' }"
          :aria-selected="activeTab === 'record'"
          aria-controls="panel-record"
          @click="activeTab = 'record'"
        >
          Attendance record
        </button>
      </div>

      <!-- Tab 1 — the cause. The schedule is the opening hours, the QR is the
           door; they were only ever separate because the tables are. Numbering
           them makes the dependency visible instead of implied. -->
      <section
        v-show="activeTab === 'checkin'"
        id="panel-checkin"
        role="tabpanel"
        aria-labelledby="tab-checkin"
        class="card"
      >
        <div class="chain-step">
          <span class="step-index" aria-hidden="true">1</span>
          <div class="step-body">
            <div class="step-head">
              <div>
                <h2>When check-in opens</h2>
                <p class="step-note">
                  Self check-in works only inside these windows, and opens on its own when one
                  starts. Pause a slot to stop it without losing past records.
                </p>
              </div>
              <div v-if="canManageAttendance" class="step-actions">
                <button type="button" class="btn-tertiary" @click="openScheduleModal">+ Weekly slot</button>
                <button type="button" class="btn-tertiary" @click="openAdhocModal">+ One-off service</button>
              </div>
            </div>

            <div v-if="schedules.length === 0" class="state-message">
              <p>No recurring services yet. Add a weekly slot and check-in will open on its own.</p>
            </div>

            <ul v-else class="schedule-list">
              <li v-for="schedule in schedules" :key="schedule.id" class="schedule-item">
                <div>
                  <span class="schedule-label">{{ schedule.label }}</span>
                  <span class="schedule-when">
                    {{ weekdayLabel(schedule.weekday) }} · {{ formatScheduleRange(schedule) }}
                  </span>
                </div>
                <div class="schedule-actions">
                  <span v-if="!schedule.is_active" class="tag tag-paused">Paused</span>
                  <button v-if="canManageAttendance" type="button" class="btn-link" @click="toggleSchedule(schedule)">
                    {{ schedule.is_active ? 'Pause' : 'Resume' }}
                  </button>
                </div>
              </li>
            </ul>

            <p v-if="activeSchedules.length === 0 && schedules.length > 0" class="notice notice-warning">
              Every slot is paused, so self check-in will never open.
            </p>
          </div>
        </div>

        <div class="chain-link"><span>During those windows</span></div>

        <div class="chain-step">
          <span class="step-index" aria-hidden="true">2</span>
          <div class="step-body">
            <div class="step-head">
              <div>
                <h2>How people check themselves in</h2>
                <p class="step-note">
                  Print this once and post it where people arrive. The link never changes — it
                  simply stops working whenever no window is open.
                </p>
              </div>
              <div class="step-actions">
                <button type="button" class="btn-secondary" @click="toggleQr">
                  {{ showQr ? 'Hide QR' : 'Show QR' }}
                </button>
              </div>
            </div>

            <div v-if="showQr" class="qr-panel">
              <p v-if="qrError" class="form-error">{{ qrError }}</p>
              <!-- eslint-disable-next-line vue/no-v-html -->
              <div v-else-if="qrSvg" class="qr-code" v-html="qrSvg"></div>
              <div v-else class="state-message"><p>Generating…</p></div>
            </div>

            <div class="link-row">
              <code class="checkin-link">{{ checkinUrl || 'Unavailable' }}</code>
              <button type="button" class="btn-secondary" :disabled="!checkinUrl" @click="copyLink">Copy</button>
            </div>

            <!-- Deliberately not styled as danger. ADR-0007 makes rotation *the*
                 control when a code leaks, so dressing it in error red discourages
                 the one action we want reachable. The consequence is carried by
                 the text and the confirm dialog, which is where it belongs. -->
            <div v-if="canManageAttendance" class="rotate-row">
              <button
                type="button"
                class="btn-caution-link"
                :disabled="rotatingToken"
                @click="handleRotateToken"
              >
                {{ rotatingToken ? 'Generating…' : 'Generate a new link' }}
              </button>
              <p class="rotate-hint">
                Use this if the code was shared outside the congregation. Every QR code already
                printed stops working.
              </p>
            </div>
          </div>
        </div>
      </section>

      <!-- Tab 2 — the effect. The service picker is a filter over history here,
           not a subject in its own right, so it sits inline rather than in a card
           of its own. -->
      <section
        v-show="activeTab === 'record'"
        id="panel-record"
        role="tabpanel"
        aria-labelledby="tab-record"
        class="record-panel"
      >
        <div v-if="services.length === 0" class="card">
          <div class="state-message">
            <p>
              No services yet. Check-in opens on its own once a weekly slot exists — or create a
              one-off service for something outside the usual pattern.
            </p>
            <button type="button" class="btn-secondary" @click="activeTab = 'checkin'">
              Set up self check-in
            </button>
          </div>
        </div>

        <template v-else>
          <div class="card">
            <div class="record-bar">
              <div class="form-group service-select">
                <label for="service-select">Showing</label>
                <select id="service-select" v-model="selectedServiceId">
                  <option v-for="service in services" :key="service.id" :value="service.id">
                    {{ formatServiceOption(service) }}
                  </option>
                </select>
              </div>
            </div>

            <div class="summary-row">
              <div class="summary-tile is-primary">
                <span class="summary-value">{{ rosterSummary.total }}</span>
                <span class="summary-label">Total</span>
              </div>
              <div class="summary-tile">
                <span class="summary-value">{{ rosterSummary.members }}</span>
                <span class="summary-label">Members</span>
              </div>
              <div class="summary-tile">
                <span class="summary-value">{{ rosterSummary.guests }}</span>
                <span class="summary-label">Guests</span>
              </div>
              <div class="summary-tile">
                <span class="summary-value">{{ rosterSummary.selfRecorded }}</span>
                <span class="summary-label">Self check-in</span>
              </div>
            </div>
          </div>

          <div v-if="selectedServiceId" class="card">
            <h2>Who attended</h2>

            <!-- Recording attendees is a management action (Welcome Team / SuperAdmin);
                 viewers see the roster below read-only. -->
            <template v-if="canManageAttendance">
            <div class="mode-toggle" role="group" aria-label="Attendee type">
              <button
                type="button"
                :class="{ 'is-active': attendeeMode === 'member' }"
                @click="attendeeMode = 'member'"
              >
                Registered member
              </button>
              <button
                type="button"
                :class="{ 'is-active': attendeeMode === 'guest' }"
                @click="attendeeMode = 'guest'"
              >
                Guest / visitor
              </button>
            </div>

            <form class="attendee-form" @submit.prevent="handleAddAttendee">
              <MemberAutocomplete
                v-if="attendeeMode === 'member'"
                ref="memberPicker"
                v-model="attendeeForm.memberId"
                :members="members"
                input-id="attendance-member"
                label="Member"
              />

              <template v-else>
                <div class="form-group">
                  <label for="guest-name">Guest name</label>
                  <input
                    id="guest-name"
                    v-model="attendeeForm.guestName"
                    type="text"
                    maxlength="80"
                    placeholder="e.g. Maria Santos"
                  />
                </div>
                <div class="form-group">
                  <label for="guest-contact">Contact number <span class="optional">(optional)</span></label>
                  <input
                    id="guest-contact"
                    v-model="attendeeForm.guestContact"
                    type="tel"
                    maxlength="32"
                    placeholder="e.g. 0917 555 1234"
                  />
                </div>
              </template>

              <button type="submit" class="btn-primary" :disabled="savingAttendee">
                {{ savingAttendee ? 'Saving…' : 'Add' }}
              </button>
            </form>

            <p v-if="attendeeError" class="form-error">{{ attendeeError }}</p>
            </template>

            <div v-if="roster.length === 0" class="state-message">
              <p>Nobody recorded yet for this service.</p>
            </div>

            <table v-else class="data-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Type</th>
                  <th scope="col">Recorded</th>
                  <th scope="col"><span class="visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in roster" :key="row.id">
                  <td>
                    <span class="attendee-name">{{ attendeeLabel(row) }}</span>
                    <span v-if="row.guest_contact" class="attendee-contact">{{ row.guest_contact }}</span>
                  </td>
                  <td>
                    <span class="tag" :class="row.member_id ? 'tag-member' : 'tag-guest'">
                      {{ row.member_id ? 'Member' : 'Guest' }}
                    </span>
                    <!-- Provenance is surfaced on every row because a self check-in is
                         an unverified self-assertion — anyone holding the QR link can
                         type any name. Staff-recorded rows are the authoritative ones. -->
                    <span class="tag" :class="row.source === 'self' ? 'tag-self' : 'tag-staff'">
                      {{ row.source === 'self' ? 'Self check-in' : 'Recorded by staff' }}
                    </span>
                  </td>
                  <td class="time-cell">{{ formatRecordedAt(row.created_at) }}</td>
                  <td class="actions-cell">
                    <button v-if="canManageAttendance" type="button" class="btn-link-danger" @click="handleRemove(row)">Remove</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </section>
    </template>

    <Teleport to="body">
      <div v-if="scheduleModal.open" class="modal-overlay" @click.self="scheduleModal.open = false">
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="schedule-modal-title">
          <div class="modal-header">
            <h3 id="schedule-modal-title">Add a weekly slot</h3>
            <button type="button" class="btn-close" aria-label="Close" @click="scheduleModal.open = false">×</button>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label for="schedule-label">Service name</label>
              <input id="schedule-label" v-model="scheduleModal.form.label" type="text" maxlength="60" placeholder="e.g. Sunday Service" />
            </div>
            <div class="form-group">
              <label for="schedule-weekday">Day</label>
              <!-- .number matters: weekday is an integer column and validateSchedule
                   rejects a non-integer, which a plain v-model would produce. -->
              <select id="schedule-weekday" v-model.number="scheduleModal.form.weekday">
                <option v-for="(day, index) in WEEKDAY_LABELS" :key="day" :value="index">{{ day }}</option>
              </select>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label for="schedule-start">Opens</label>
                <input id="schedule-start" v-model="scheduleModal.form.startsAt" type="time" />
              </div>
              <div class="form-group">
                <label for="schedule-end">Closes</label>
                <input id="schedule-end" v-model="scheduleModal.form.endsAt" type="time" />
              </div>
            </div>
            <p v-if="scheduleModal.error" class="form-error">{{ scheduleModal.error }}</p>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn-secondary" @click="scheduleModal.open = false">Cancel</button>
            <button type="button" class="btn-primary" :disabled="scheduleModal.saving" @click="saveSchedule">
              {{ scheduleModal.saving ? 'Saving…' : 'Add slot' }}
            </button>
          </div>
        </div>
      </div>

      <div v-if="adhocModal.open" class="modal-overlay" @click.self="adhocModal.open = false">
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="adhoc-modal-title">
          <div class="modal-header">
            <h3 id="adhoc-modal-title">One-off service</h3>
            <button type="button" class="btn-close" aria-label="Close" @click="adhocModal.open = false">×</button>
          </div>
          <div class="modal-body">
            <p class="card-note">
              For anything outside the weekly schedule — a revival, a watchnight, a special service.
            </p>
            <div class="form-group">
              <label for="adhoc-label">Service name</label>
              <input id="adhoc-label" v-model="adhocModal.form.label" type="text" maxlength="60" placeholder="e.g. Watchnight Service" />
            </div>
            <div class="form-group">
              <label for="adhoc-date">Date</label>
              <input id="adhoc-date" v-model="adhocModal.form.date" type="date" />
            </div>
            <div class="form-row">
              <div class="form-group">
                <label for="adhoc-start">Opens</label>
                <input id="adhoc-start" v-model="adhocModal.form.startsAt" type="time" />
              </div>
              <div class="form-group">
                <label for="adhoc-end">Closes</label>
                <input id="adhoc-end" v-model="adhocModal.form.endsAt" type="time" />
              </div>
            </div>
            <p v-if="adhocModal.error" class="form-error">{{ adhocModal.error }}</p>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn-secondary" @click="adhocModal.open = false">Cancel</button>
            <button type="button" class="btn-primary" :disabled="adhocModal.saving" @click="saveAdhocService">
              {{ adhocModal.saving ? 'Creating…' : 'Create service' }}
            </button>
          </div>
        </div>
      </div>

      <div v-if="toast" class="toast" :class="`toast-${toast.type}`">{{ toast.message }}</div>
    </Teleport>
  </div>
</template>

<style scoped>
.page-container {
  padding: 24px;
  max-width: 900px;
}

.page-header {
  margin-bottom: 20px;
}

h1 {
  margin: 0;
  font-size: 1.5rem;
  color: #1e293b;
}

h2 {
  margin: 0;
  font-size: 1rem;
  color: #1e293b;
}

.page-subtitle {
  margin: 4px 0 0;
  font-size: 0.875rem;
  color: #64748b;
}

.card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 20px;
}

.record-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* ---- Live state ------------------------------------------------------- */

.status-band {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 14px 18px;
  border-radius: 12px;
  border: 1px solid;
  margin-bottom: 16px;
}

.status-band.is-open {
  background: #ecfdf5;
  border-color: #a7f3d0;
}

.status-band.is-closed {
  background: #f8fafc;
  border-color: #e2e8f0;
}

.status-dot {
  flex: none;
  width: 10px;
  height: 10px;
  border-radius: 999px;
}

.status-band.is-open .status-dot {
  background: #059669;
  box-shadow: 0 0 0 4px rgba(5, 150, 105, 0.16);
}

.status-band.is-closed .status-dot {
  background: #94a3b8;
}

.status-text {
  flex: 1;
  min-width: 200px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.status-text strong {
  font-size: 0.9375rem;
  color: #1e293b;
}

.status-text span {
  font-size: 0.8125rem;
  color: #64748b;
}

.status-text .status-alert {
  color: #92400e;
  font-weight: 600;
}

/* ---- Tabs ------------------------------------------------------------- */

.tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid #e2e8f0;
  margin-bottom: 16px;
}

.tab {
  padding: 12px 16px;
  border: none;
  background: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  font-size: 0.9375rem;
  font-weight: 600;
  color: #64748b;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}

.tab:hover {
  color: #1e293b;
}

.tab.is-active {
  color: #1a56db;
  border-bottom-color: #1a56db;
}

/* ---- The causal chain ------------------------------------------------- */

.chain-step {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}

.step-index {
  flex: none;
  width: 26px;
  height: 26px;
  margin-top: 2px;
  border-radius: 999px;
  background: #eff6ff;
  color: #1a56db;
  font-size: 0.8125rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

.step-body {
  flex: 1;
  min-width: 0;
}

.step-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}

.step-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.step-note {
  margin: 6px 0 0;
  max-width: 52ch;
  font-size: 0.8125rem;
  line-height: 1.5;
  color: #64748b;
}

/* The dashed rule descends from the step marker so the two steps read as one
   sequence rather than two panels that happen to be stacked. */
.chain-link {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 20px 0;
  padding-left: 12px;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #94a3b8;
}

.chain-link::before {
  content: '';
  align-self: stretch;
  border-left: 2px dashed #e2e8f0;
}

.chain-link::after {
  content: '';
  flex: 1;
  height: 1px;
  background: #e2e8f0;
}

.chain-link span {
  padding: 6px 0;
}

/* ---- Notices ---------------------------------------------------------- */

/* Amber is the app's caution colour (DashboardView .form-warning,
   AccountPendingView). Red is kept for rejected writes only — .form-error and
   .toast-error — so the two read as different classes of event. */
.notice {
  margin: 0 0 16px;
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 0.875rem;
  line-height: 1.5;
}

.notice-warning {
  background: #fffbeb;
  border: 1px solid #fde68a;
  color: #92400e;
}

.card .notice {
  margin: 14px 0 0;
}

/* ---- Record ----------------------------------------------------------- */

.record-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 16px;
}

.service-select {
  flex: 1;
  min-width: 240px;
  max-width: 380px;
  margin-bottom: 0;
}

.summary-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 18px;
}

.summary-tile {
  flex: 1;
  min-width: 110px;
  padding: 14px;
  border-radius: 12px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* One tile carries the headline number so the row has a focal point instead of
   four identical boxes. The rest are supporting breakdown. */
.summary-tile.is-primary {
  background: #eff6ff;
  border-color: #bfdbfe;
}

.summary-value {
  font-size: 1.5rem;
  font-weight: 700;
  color: #1e293b;
  line-height: 1.2;
}

.summary-tile.is-primary .summary-value {
  color: #1a56db;
}

.summary-label {
  font-size: 0.75rem;
  color: #64748b;
}

.mode-toggle {
  display: inline-flex;
  gap: 4px;
  padding: 4px;
  margin: 16px 0;
  border-radius: 10px;
  background: #f1f5f9;
}

.mode-toggle button {
  padding: 8px 16px;
  border: none;
  border-radius: 8px;
  background: transparent;
  font-size: 0.875rem;
  font-weight: 600;
  color: #64748b;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.mode-toggle button:hover:not(.is-active) {
  color: #1e293b;
}

.mode-toggle button.is-active {
  background: #ffffff;
  color: #1a56db;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
}

.attendee-form {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 16px;
}

.attendee-form > .form-group {
  flex: 1;
  min-width: 200px;
}

.attendee-form .btn-primary {
  margin-top: 26px;
}

/* ---- Forms ------------------------------------------------------------ */

.form-row {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}

.form-row > .form-group {
  flex: 1;
  min-width: 140px;
}

.form-group {
  margin-bottom: 14px;
}

label {
  display: block;
  margin-bottom: 6px;
  font-size: 0.875rem;
  font-weight: 600;
  color: #1e293b;
}

.optional {
  font-weight: 400;
  color: #64748b;
}

input,
select {
  width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  font-size: 0.9375rem;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  color: #1e293b;
  background: #ffffff;
}

input:focus,
select:focus {
  outline: none;
  border-color: #1a56db;
  box-shadow: 0 0 0 3px rgba(26, 86, 219, 0.12);
}

/* ---- Roster ----------------------------------------------------------- */

.data-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 16px;
}

.data-table th {
  text-align: left;
  padding: 10px 12px;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #64748b;
  border-bottom: 1px solid #e2e8f0;
}

.data-table td {
  padding: 12px;
  border-bottom: 1px solid #f1f5f9;
  font-size: 0.875rem;
  color: #1e293b;
  vertical-align: middle;
}

.data-table tbody tr {
  transition: background 0.15s;
}

.data-table tbody tr:hover {
  background: #f8fafc;
}

.attendee-name {
  display: block;
  font-weight: 600;
}

.attendee-contact {
  display: block;
  margin-top: 2px;
  font-size: 0.75rem;
  color: #64748b;
}

.tag {
  display: inline-block;
  margin-right: 6px;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 0.6875rem;
  font-weight: 600;
}

.tag-member {
  background: #eff6ff;
  color: #1a56db;
}

.tag-guest {
  background: #fef3c7;
  color: #b45309;
}

.tag-self {
  background: #f1f5f9;
  color: #64748b;
}

.tag-staff {
  background: #ecfdf5;
  color: #059669;
}

.tag-paused {
  background: #f1f5f9;
  color: #64748b;
}

.time-cell {
  color: #64748b;
  white-space: nowrap;
}

.actions-cell {
  text-align: right;
}

/* ---- Schedule --------------------------------------------------------- */

.schedule-list {
  list-style: none;
  margin: 14px 0 0;
  padding: 0;
  border-top: 1px solid #f1f5f9;
}

.schedule-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid #f1f5f9;
}

.schedule-label {
  display: block;
  font-size: 0.9375rem;
  font-weight: 600;
  color: #1e293b;
}

.schedule-when {
  display: block;
  margin-top: 2px;
  font-size: 0.8125rem;
  color: #64748b;
}

.schedule-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

/* ---- QR and link ------------------------------------------------------ */

.qr-panel {
  display: flex;
  justify-content: center;
  padding: 18px 0;
}

.qr-code :deep(svg) {
  width: 220px;
  height: 220px;
}

.link-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 14px;
}

.checkin-link {
  flex: 1;
  min-width: 200px;
  padding: 10px 12px;
  border-radius: 8px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  font-size: 0.75rem;
  color: #1e293b;
  overflow-wrap: anywhere;
}

.rotate-row {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid #f1f5f9;
}

.rotate-hint {
  margin: 6px 0 0;
  max-width: 52ch;
  font-size: 0.75rem;
  line-height: 1.5;
  color: #64748b;
}

/* ---- Buttons ---------------------------------------------------------- */

/* Four tiers, and the tier is the message: primary = the thing you came to do,
   secondary/tertiary = supporting, caution (amber) = deliberate and disruptive
   but expected, danger (red) = destroys a record. */
.btn-primary {
  padding: 10px 20px;
  font-size: 0.9375rem;
  font-weight: 600;
  color: #ffffff;
  background: #1a56db;
  border: 1px solid #1a56db;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.btn-primary:hover:not(:disabled) {
  background: #1547b5;
  border-color: #1547b5;
}

.btn-primary:disabled {
  background: #94a3b8;
  border-color: #94a3b8;
  cursor: not-allowed;
}

.btn-secondary {
  padding: 8px 16px;
  font-size: 0.875rem;
  font-weight: 600;
  color: #1e293b;
  background: #f1f5f9;
  border: 1px solid transparent;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
}

.btn-secondary:hover:not(:disabled) {
  background: #e2e8f0;
}

.btn-secondary:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.btn-tertiary {
  padding: 8px 14px;
  font-size: 0.875rem;
  font-weight: 600;
  color: #475569;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}

.btn-tertiary:hover {
  background: #f8fafc;
  border-color: #cbd5e1;
  color: #1e293b;
}

.btn-caution {
  padding: 8px 14px;
  font-size: 0.8125rem;
  font-weight: 600;
  color: #92400e;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
}

.btn-caution:hover:not(:disabled) {
  background: #fef3c7;
}

.btn-caution:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.btn-link,
.btn-link-danger,
.btn-caution-link {
  padding: 4px 6px;
  margin: -4px -6px;
  border: none;
  background: none;
  border-radius: 6px;
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}

.btn-link {
  color: #1a56db;
}

.btn-link:hover {
  background: #eff6ff;
}

.btn-link-danger {
  color: #b91c1c;
}

.btn-link-danger:hover {
  background: #fef2f2;
}

.btn-caution-link {
  color: #92400e;
}

.btn-caution-link:hover:not(:disabled) {
  background: #fffbeb;
}

.btn-caution-link:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

/* The base reset strips focus rings; keyboard users need them back on every
   control that is not a native input (those already have :focus styling). */
button:focus-visible {
  outline: 2px solid #1a56db;
  outline-offset: 2px;
}

/* ---- Shared states ---------------------------------------------------- */

.form-error {
  margin: 12px 0 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: #fef2f2;
  color: #dc2626;
  font-size: 0.875rem;
}

.state-message {
  padding: 24px 0;
  text-align: center;
  color: #64748b;
  font-size: 0.9375rem;
}

.state-message p {
  margin: 0 auto 12px;
  max-width: 46ch;
  line-height: 1.5;
}

.state-message p:last-child {
  margin-bottom: 0;
}

.card-note {
  margin: 8px 0 16px;
  font-size: 0.8125rem;
  line-height: 1.5;
  color: #64748b;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

@media (max-width: 640px) {
  .page-container {
    padding: 16px;
  }

  .chain-step {
    gap: 10px;
  }

  .step-actions {
    width: 100%;
  }

  .step-actions .btn-tertiary,
  .step-actions .btn-secondary {
    flex: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  * {
    transition-duration: 0.01ms !important;
  }
}
</style>

<style>
/* Modal and toast live under <Teleport to="body">, so they sit outside this
   component's scoped-style root and cannot be reached by scoped selectors. */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  z-index: 50;
}

.modal {
  width: 100%;
  max-width: 460px;
  background: #ffffff;
  border-radius: 12px;
  overflow: hidden;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid #e2e8f0;
}

.modal-header h3 {
  margin: 0;
  font-size: 1rem;
  color: #1e293b;
}

.btn-close {
  border: none;
  background: none;
  font-size: 1.5rem;
  line-height: 1;
  color: #64748b;
  cursor: pointer;
}

.modal-body {
  padding: 20px;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 16px 20px;
  border-top: 1px solid #e2e8f0;
}

.toast {
  position: fixed;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  padding: 12px 20px;
  border-radius: 8px;
  font-size: 0.875rem;
  font-weight: 600;
  color: #ffffff;
  z-index: 60;
}

.toast-success {
  background: #059669;
}

.toast-error {
  background: #dc2626;
}
</style>

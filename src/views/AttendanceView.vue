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

const myChurchId = ref('')
const myChurchName = ref('')
const checkinToken = ref('')
const services = ref([])
const selectedServiceId = ref('')
const roster = ref([])
const schedules = ref([])
const members = ref([])

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

const selectedService = computed(
  () => services.value.find((service) => service.id === selectedServiceId.value) || null
)

const isSelectedOpen = computed(() =>
  selectedService.value
    ? isWindowOpen(selectedService.value.opens_at, selectedService.value.closes_at)
    : false
)

const closingLabel = computed(() =>
  selectedService.value ? formatTimeRemaining(selectedService.value.closes_at) : ''
)

const rosterSummary = computed(() => summariseRoster(roster.value))

const checkinUrl = computed(() => {
  if (!checkinToken.value) return ''
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  // The token goes in the FRAGMENT, never the path — fragments are not sent to
  // the server, so it stays out of Netlify access logs and any Referer header.
  return `${origin}/checkin#t=${checkinToken.value}`
})

const activeSchedules = computed(() => schedules.value.filter((row) => row.is_active))

onMounted(loadContext)

watch(selectedServiceId, loadRoster)

async function loadContext() {
  loadingContext.value = true
  contextError.value = ''

  // One round-trip per intent, run in parallel rather than serialised.
  const [churchResult, linkResult, serviceResult, schedulesResult, membersResult, ensureResult] =
    await Promise.all([
      supabase.rpc('get_my_church').single(),
      supabase.rpc('get_my_checkin_link'),
      supabase.from('services').select(SERVICE_COLUMNS).order('opens_at', { ascending: false }).limit(12),
      supabase.from('service_schedules').select(SCHEDULE_COLUMNS).order('weekday').order('starts_at'),
      // Fetched once for the autocomplete and filtered in memory. archived_at is
      // filtered here because this IS a picker — the SELECT policy returns
      // archived rows and excluding them is the application's job (ADR-0001).
      supabase
        .from('members')
        .select('id, first_name, middle_name, last_name')
        .is('archived_at', null)
        .order('first_name', { ascending: true }),
      // Materialises today's service from the recurring schedule if the window is
      // open and nothing has created it yet, so "close now" and "add attendee"
      // always have a real service to work against.
      supabase.rpc('ensure_my_open_service'),
    ])

  if (churchResult.error || !churchResult.data) {
    contextError.value = churchResult.error?.message || 'Unable to resolve church context.'
    loadingContext.value = false
    loadingRoster.value = false
    return
  }

  myChurchId.value = churchResult.data.id
  myChurchName.value = churchResult.data.name

  checkinToken.value = linkResult.error ? '' : (linkResult.data?.[0]?.token || '')
  schedules.value = schedulesResult.error ? [] : (schedulesResult.data || [])
  members.value = membersResult.error ? [] : (membersResult.data || [])

  let list = serviceResult.error ? [] : (serviceResult.data || [])
  const openedId = ensureResult.error ? null : ensureResult.data

  // ensure_my_open_service may have created a row after the services select was
  // planned, so refetch rather than showing a roster with no service attached.
  if (openedId && !list.some((service) => service.id === openedId)) {
    const { data } = await supabase
      .from('services')
      .select(SERVICE_COLUMNS)
      .order('opens_at', { ascending: false })
      .limit(12)
    list = data || list
  }

  services.value = list

  if (serviceResult.error || schedulesResult.error || membersResult.error) {
    contextError.value = 'Some information could not be loaded. What you see below may be incomplete.'
  }

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
  if (!selectedService.value) return
  if (!window.confirm('Close check-in for this service now? People will no longer be able to check themselves in.')) {
    return
  }

  closingService.value = true
  const { error } = await supabase.rpc('close_service_now', { p_service_id: selectedService.value.id })
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
    .eq('id', selectedService.value.id)
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
  const { data, error } = await supabase.rpc('rotate_my_checkin_token')
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
      <div>
        <h1>Attendance</h1>
        <p class="page-subtitle">{{ myChurchName }}</p>
      </div>
      <div class="header-actions">
        <button type="button" class="btn-secondary" @click="openAdhocModal">+ One-off service</button>
      </div>
    </header>

    <p v-if="loadError" class="load-warning">{{ loadError }}</p>

    <div v-if="loading" class="card">
      <div class="state-message"><p>Loading attendance…</p></div>
    </div>

    <template v-else>
      <section class="card">
        <div class="service-bar">
          <div class="form-group service-select">
            <label for="service-select">Service</label>
            <select id="service-select" v-model="selectedServiceId">
              <option v-if="services.length === 0" value="">No services yet</option>
              <option v-for="service in services" :key="service.id" :value="service.id">
                {{ formatServiceOption(service) }}
              </option>
            </select>
          </div>

          <div v-if="selectedService" class="service-status">
            <span class="status-pill" :class="isSelectedOpen ? 'is-open' : 'is-closed'">
              {{ isSelectedOpen ? 'Open' : 'Closed' }}
            </span>
            <span v-if="isSelectedOpen" class="status-detail">{{ closingLabel }}</span>
            <button
              v-if="isSelectedOpen"
              type="button"
              class="btn-danger-ghost"
              :disabled="closingService"
              @click="handleCloseNow"
            >
              {{ closingService ? 'Closing…' : 'Close check-in now' }}
            </button>
          </div>
        </div>

        <div v-if="services.length === 0" class="state-message">
          <p>
            No services yet. Add a recurring schedule below and one will be created automatically
            when its window opens, or create a one-off service now.
          </p>
        </div>

        <div v-else class="summary-row">
          <div class="summary-tile">
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
      </section>

      <section v-if="selectedServiceId" class="card">
        <h2>Record attendance</h2>

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
      </section>

      <section v-if="selectedServiceId" class="card">
        <h2>Who attended</h2>

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
                <button type="button" class="btn-link-danger" @click="handleRemove(row)">Remove</button>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="card">
        <div class="card-header">
          <h2>Check-in QR code</h2>
          <button type="button" class="btn-secondary" @click="toggleQr">
            {{ showQr ? 'Hide' : 'Show QR' }}
          </button>
        </div>

        <p class="card-note">
          Print this once and post it where people arrive. The link stays the same — it only works
          while a service window is open, so there is nothing to change week to week.
        </p>

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

        <button
          type="button"
          class="btn-link-danger rotate-btn"
          :disabled="rotatingToken"
          @click="handleRotateToken"
        >
          {{ rotatingToken ? 'Generating…' : 'Generate a new link' }}
        </button>
      </section>

      <section class="card">
        <div class="card-header">
          <h2>Weekly schedule</h2>
          <button type="button" class="btn-secondary" @click="openScheduleModal">+ Add slot</button>
        </div>

        <p class="card-note">
          Check-in opens automatically during these windows. Pause a slot to stop it without losing
          past records.
        </p>

        <div v-if="schedules.length === 0" class="state-message">
          <p>No recurring services yet.</p>
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
              <button type="button" class="btn-link" @click="toggleSchedule(schedule)">
                {{ schedule.is_active ? 'Pause' : 'Resume' }}
              </button>
            </div>
          </li>
        </ul>

        <p v-if="activeSchedules.length === 0 && schedules.length > 0" class="card-note warning-note">
          Every slot is paused, so self check-in will never open.
        </p>
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
  max-width: 1100px;
}

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
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
  margin-bottom: 16px;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.card-note {
  margin: 8px 0 16px;
  font-size: 0.8125rem;
  line-height: 1.5;
  color: #64748b;
}

.warning-note {
  color: #dc2626;
}

.load-warning {
  margin: 0 0 16px;
  padding: 10px 14px;
  border-radius: 8px;
  background: #fef2f2;
  color: #dc2626;
  font-size: 0.875rem;
}

.service-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 16px;
  justify-content: space-between;
}

.service-select {
  flex: 1;
  min-width: 220px;
}

.service-status {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.status-pill {
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 700;
}

.status-pill.is-open {
  background: #ecfdf5;
  color: #059669;
}

.status-pill.is-closed {
  background: #f1f5f9;
  color: #64748b;
}

.status-detail {
  font-size: 0.8125rem;
  color: #64748b;
}

.summary-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 20px;
}

.summary-tile {
  flex: 1;
  min-width: 110px;
  padding: 14px;
  border-radius: 12px;
  background: #f8fafc;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.summary-value {
  font-size: 1.5rem;
  font-weight: 700;
  color: #1e293b;
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
}

.mode-toggle button.is-active {
  background: #ffffff;
  color: #1a56db;
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

.data-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 12px;
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

.schedule-list {
  list-style: none;
  margin: 0;
  padding: 0;
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

.qr-panel {
  display: flex;
  justify-content: center;
  padding: 16px 0;
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

.rotate-btn {
  margin-top: 14px;
}

.btn-primary {
  padding: 10px 20px;
  font-size: 0.9375rem;
  font-weight: 600;
  color: #ffffff;
  background: #1a56db;
  border: none;
  border-radius: 8px;
  cursor: pointer;
}

.btn-primary:disabled {
  background: #94a3b8;
  cursor: not-allowed;
}

.btn-secondary {
  padding: 8px 16px;
  font-size: 0.875rem;
  font-weight: 600;
  color: #1e293b;
  background: #f1f5f9;
  border: none;
  border-radius: 8px;
  cursor: pointer;
}

.btn-danger-ghost {
  padding: 8px 14px;
  font-size: 0.8125rem;
  font-weight: 600;
  color: #dc2626;
  background: #fef2f2;
  border: none;
  border-radius: 8px;
  cursor: pointer;
}

.btn-link,
.btn-link-danger {
  padding: 0;
  border: none;
  background: none;
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
}

.btn-link {
  color: #1a56db;
}

.btn-link-danger {
  color: #dc2626;
}

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

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
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

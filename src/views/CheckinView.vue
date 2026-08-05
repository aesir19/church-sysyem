<script setup>
import { computed, onMounted, ref } from 'vue'
import { supabase } from '../lib/supabase'
import {
  buildCheckinArgs,
  interpretCheckin,
  readCheckinToken,
  sanitizeCheckinName,
  validateCheckinContact,
  validateCheckinName,
} from '../utils/checkinPayload'
import { formatTimeRemaining } from '../utils/attendanceWindow'

/**
 * The public self check-in page. NO AUTHENTICATION.
 *
 * This is the only view in the application an anonymous visitor can use, and it
 * reaches exactly two SECURITY DEFINER functions — never a table. Three rules
 * hold here and nowhere else in the codebase:
 *
 *   1. NO MEMBER AUTOCOMPLETE. A typeahead over member names on a page whose URL
 *      is printed on a wall would publish the church directory to anyone who
 *      photographs the poster. The name is typed blind and matched server-side.
 *   2. NO RAW error.message. The house pattern surfaces Supabase errors verbatim,
 *      which is right behind a login but wrong here: those strings carry
 *      constraint names, column names and Postgres error codes
 *      (docs/SECURITY.md §3.5), and this audience is unauthenticated. Failures
 *      are reported generically and deliberately.
 *   3. NOTHING IS INFERRED FROM THE REPLY. submit_checkin returns 'recorded' or
 *      'closed' and nothing else — never whether a member matched, never whether
 *      this person had already checked in. See interpretCheckin().
 *
 * This view must not import DashboardLayout or anything under it: the router
 * lazy-loads it precisely so an attendee's phone never downloads the staff
 * bundle over church wifi.
 */

const STATE = {
  LOADING: 'loading',
  BAD_LINK: 'bad-link',
  CLOSED: 'closed',
  OPEN: 'open',
  DONE: 'done',
}

const state = ref(STATE.LOADING)
const session = ref(null)
const token = ref('')
const submitting = ref(false)
const formError = ref('')
const doneMessage = ref('')

const form = ref({ name: '', contact: '' })

const serviceDateLabel = computed(() => {
  const value = session.value?.service_date
  if (!value) return ''
  // Parsed with an explicit midnight so the browser reads it as a local date
  // rather than a UTC instant — the same guard collectionsDate.js applies.
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-PH', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
})

const closingLabel = computed(() =>
  session.value?.closes_at ? formatTimeRemaining(session.value.closes_at) : ''
)

onMounted(loadSession)

async function loadSession() {
  state.value = STATE.LOADING

  const hash = typeof window === 'undefined' ? '' : window.location.hash
  token.value = readCheckinToken(hash)

  // Shape is checked client-side purely so a mistyped or truncated QR never
  // reaches the network. It is not a security control; the function re-checks.
  if (!token.value) {
    state.value = STATE.BAD_LINK
    return
  }

  const { data, error } = await supabase.rpc('checkin_session_status', { p_token: token.value })

  if (error) {
    state.value = STATE.CLOSED
    return
  }

  const row = Array.isArray(data) ? data[0] : data
  if (!row) {
    // Zero rows means "nothing open right now" OR "no such token" — the function
    // does not distinguish, so neither does this page.
    state.value = STATE.CLOSED
    return
  }

  session.value = row
  state.value = STATE.OPEN
}

async function handleSubmit() {
  formError.value = ''

  const nameError = validateCheckinName(form.value.name)
  if (nameError) {
    formError.value = nameError
    return
  }

  const contactError = validateCheckinContact(form.value.contact)
  if (contactError) {
    formError.value = contactError
    return
  }

  submitting.value = true
  const { data, error } = await supabase.rpc('submit_checkin', buildCheckinArgs(token.value, form.value))
  submitting.value = false

  if (error) {
    formError.value = 'Something went wrong. Please try again, or ask a volunteer for help.'
    return
  }

  const result = interpretCheckin(data)
  if (!result.ok) {
    // The window closed between load and submit, or the per-service ceiling was
    // reached. Both mean "a volunteer needs to record this instead".
    state.value = STATE.CLOSED
    return
  }

  doneMessage.value = `Thanks, ${sanitizeCheckinName(form.value.name)}.`
  state.value = STATE.DONE
}

function checkInSomeoneElse() {
  form.value = { name: '', contact: '' }
  formError.value = ''
  doneMessage.value = ''
  loadSession()
}
</script>

<template>
  <main class="checkin-page">
    <div class="checkin-card">
      <div v-if="state === STATE.LOADING" class="state-message">
        <p>Checking…</p>
      </div>

      <template v-else-if="state === STATE.BAD_LINK">
        <h1>This link isn't valid</h1>
        <p class="state-detail">
          Scan the QR code again, or ask a volunteer to check you in.
        </p>
      </template>

      <template v-else-if="state === STATE.CLOSED">
        <h1>Check-in isn't open right now</h1>
        <p class="state-detail">
          Check-in opens shortly before each service. Please ask a volunteer if you need help.
        </p>
      </template>

      <template v-else-if="state === STATE.DONE">
        <div class="success-mark" aria-hidden="true">
          <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </div>
        <h1>You're checked in</h1>
        <p class="state-detail">{{ doneMessage }}</p>
        <button type="button" class="btn-secondary" @click="checkInSomeoneElse">
          Check in someone else
        </button>
      </template>

      <template v-else>
        <header class="checkin-header">
          <p class="church-name">{{ session.church_name }}</p>
          <h1>{{ session.service_label }}</h1>
          <p class="service-date">{{ serviceDateLabel }}</p>
          <p v-if="closingLabel" class="closing-note">{{ closingLabel }}</p>
        </header>

        <form class="checkin-form" @submit.prevent="handleSubmit">
          <div class="form-group">
            <label for="checkin-name">Your name</label>
            <input
              id="checkin-name"
              v-model="form.name"
              type="text"
              placeholder="e.g. Juan Dela Cruz"
              autocomplete="name"
              maxlength="80"
              required
            />
            <!-- No suggestions here, deliberately. See the block comment above. -->
            <p class="field-note">Type your full name as the church has it on record.</p>
          </div>

          <div class="form-group">
            <label for="checkin-contact">Contact number <span class="optional">(optional)</span></label>
            <input
              id="checkin-contact"
              v-model="form.contact"
              type="tel"
              placeholder="e.g. 0917 555 1234"
              autocomplete="tel"
              maxlength="32"
            />
            <p class="field-note">Only needed if you're visiting for the first time.</p>
          </div>

          <p v-if="formError" class="form-error">{{ formError }}</p>

          <button type="submit" class="btn-primary" :disabled="submitting">
            {{ submitting ? 'Checking in…' : 'Check in' }}
          </button>
        </form>

        <!-- Republic Act 10173 (Data Privacy Act of 2012). docs/SECURITY.md §3.10
             already identifies the church as the personal information controller;
             collecting a name and number from non-users over an open endpoint is
             exactly where a notice belongs, and it is far cheaper now than later. -->
        <p class="privacy-note">
          {{ session.church_name }} records your name to track attendance for this service, and your
          contact number only if you provide one, so the church can follow up with visitors. Ask a
          church leader to view, correct, or delete your information.
        </p>
      </template>
    </div>
  </main>
</template>

<style scoped>
.checkin-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
  background: #f8fafc;
}

.checkin-card {
  width: 100%;
  max-width: 420px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 28px 24px;
  box-shadow: 0 18px 40px rgba(15, 23, 42, 0.08);
  text-align: center;
}

h1 {
  margin: 0;
  font-size: 1.375rem;
  color: #1e293b;
}

.checkin-header {
  margin-bottom: 24px;
}

.church-name {
  margin: 0 0 4px;
  font-size: 0.8125rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #1a56db;
}

.service-date {
  margin: 6px 0 0;
  font-size: 0.875rem;
  color: #64748b;
}

.closing-note {
  margin: 10px 0 0;
  display: inline-block;
  padding: 4px 10px;
  border-radius: 999px;
  background: #eff6ff;
  color: #1a56db;
  font-size: 0.75rem;
  font-weight: 600;
}

.checkin-form {
  text-align: left;
}

.form-group {
  margin-bottom: 18px;
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

input {
  width: 100%;
  box-sizing: border-box;
  padding: 12px 14px;
  font-size: 1rem;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  color: #1e293b;
}

input:focus {
  outline: none;
  border-color: #1a56db;
  box-shadow: 0 0 0 3px rgba(26, 86, 219, 0.12);
}

.field-note {
  margin: 6px 0 0;
  font-size: 0.75rem;
  color: #64748b;
}

.form-error {
  margin: 0 0 14px;
  padding: 10px 12px;
  border-radius: 8px;
  background: #fef2f2;
  color: #dc2626;
  font-size: 0.875rem;
}

.btn-primary {
  width: 100%;
  padding: 14px;
  font-size: 1rem;
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
  margin-top: 20px;
  padding: 10px 18px;
  font-size: 0.875rem;
  font-weight: 600;
  color: #1a56db;
  background: #eff6ff;
  border: none;
  border-radius: 8px;
  cursor: pointer;
}

.state-message,
.state-detail {
  color: #64748b;
  font-size: 0.9375rem;
}

.state-detail {
  margin: 12px 0 0;
}

.success-mark {
  width: 56px;
  height: 56px;
  margin: 0 auto 16px;
  border-radius: 999px;
  background: #ecfdf5;
  color: #059669;
  display: flex;
  align-items: center;
  justify-content: center;
}

.privacy-note {
  margin: 24px 0 0;
  padding-top: 16px;
  border-top: 1px solid #e2e8f0;
  font-size: 0.6875rem;
  line-height: 1.5;
  color: #94a3b8;
  text-align: left;
}
</style>

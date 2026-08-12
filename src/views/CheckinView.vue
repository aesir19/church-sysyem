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
import { readCheckedInNames, rememberCheckinName } from '../utils/checkinMemory'
import { formatTimeRemaining } from '../utils/attendanceWindow'
// Only the two smallest primitives, and never `ui/Modal`: it pulls Reka UI, and
// no attendee's phone should download a focus-trap implementation to type their
// name. The build gate on this bundle is in the ADR beside Modal.vue.
import Icon from '../components/ui/icons/Icon.vue'
import Input from '../components/ui/Input.vue'

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
 * The "you're already listed" state is a corollary of rule 3, not an exception
 * to it: it is read from this device's own localStorage, never from the server.
 * See src/utils/checkinMemory.js for why, and do not replace it with a lookup.
 *
 * This view must not import DashboardLayout or anything under it: the router
 * lazy-loads it precisely so an attendee's phone never downloads the staff
 * bundle over church wifi.
 */

// THERE IS NO SEPARATE BAD-LINK STATE, and that is a decision rather than an
// omission. A malformed token and a closed window render the same screen, which
// is what the handoff specifies — "the same screen appears for an expired or
// mistyped link, it never says which". Splitting them turns the page into a
// checker for whether a token is real, for anyone who photographs the poster,
// and the useful advice is identical either way: ask a volunteer.
const STATE = {
  LOADING: 'loading',
  CLOSED: 'closed',
  OPEN: 'open',
  ALREADY: 'already',
  DONE: 'done',
}

const state = ref(STATE.LOADING)
const session = ref(null)
const token = ref('')
const submitting = ref(false)
const formError = ref('')
const doneMessage = ref('')
const rememberedNames = ref([])

const form = ref({ name: '', contact: '' })

/**
 * localStorage, or null when it cannot be reached.
 *
 * Reading `window.localStorage` can itself throw when storage is disabled, so
 * the access is guarded and not just the calls on it.
 */
function deviceStorage() {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

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

/**
 * Phrasing for the already-listed state.
 *
 * One name is the attendee re-opening their own confirmation. Several means a
 * volunteer's phone worked through a queue, which is an expected case rather
 * than an edge one, so it is named plainly instead of being flattened to the
 * most recent person.
 */
const rememberedLabel = computed(() => {
  const names = rememberedNames.value
  if (names.length === 0) return ''
  if (names.length === 1) return `This phone checked in ${names[0]}.`
  return `This phone checked in ${names.length} people: ${names.join(', ')}.`
})

onMounted(() => loadSession())

async function loadSession({ checkMemory = true } = {}) {
  state.value = STATE.LOADING

  const hash = typeof window === 'undefined' ? '' : window.location.hash
  token.value = readCheckinToken(hash)

  // Shape is checked client-side purely so a mistyped or truncated QR never
  // reaches the network. It is not a security control; the function re-checks.
  if (!token.value) {
    state.value = STATE.CLOSED
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

  // Device-local, and costs no request: the status call above happens either
  // way. Asking the server "has this person already checked in?" would answer
  // "is X here today?" for anyone holding the token — see checkinMemory.js.
  const remembered = checkMemory ? readCheckedInNames(deviceStorage(), row) : []
  if (remembered.length > 0) {
    rememberedNames.value = remembered
    state.value = STATE.ALREADY
    return
  }

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

  const name = sanitizeCheckinName(form.value.name)
  rememberedNames.value = rememberCheckinName(deviceStorage(), session.value, name)

  doneMessage.value = `Thanks, ${name}.`
  state.value = STATE.DONE
}

function checkInSomeoneElse() {
  form.value = { name: '', contact: '' }
  formError.value = ''
  doneMessage.value = ''
  // checkMemory: false — the visitor has just said this is a different person,
  // so re-reading this device's history would bounce them straight back.
  loadSession({ checkMemory: false })
}
</script>

<template>
  <main class="ci">
    <!-- LOADING -->
    <div
      v-if="state === STATE.LOADING"
      class="ci__card ci__card--state"
    >
      <p class="ci__muted">
        Checking…
      </p>
    </div>

    <!-- CLOSED, OR A LINK THAT DOES NOT RESOLVE — ONE SCREEN.
         The handoff is explicit that these are never told apart: "the same
         screen appears for an expired or mistyped link — it never says which."
         A page that distinguishes them answers "is this token real?" for
         anyone holding a photograph of the poster, and the honest answer to
         both is the same anyway: find a volunteer. -->
    <div
      v-else-if="state === STATE.CLOSED"
      class="ci__card ci__card--state"
    >
      <span class="ci__mark ci__mark--quiet"><Icon
        name="clock"
        :size="26"
        :width="2"
      /></span>
      <h1 class="ci__title">
        Check-in isn't open
      </h1>
      <p class="ci__body">
        Check-in opens shortly before each service. Please ask a volunteer if
        you need help.
      </p>
    </div>

    <!-- ALREADY LISTED. Read from this device's localStorage, never from the
         server: a server-sourced version of this screen would answer "is X here
         today?" for anyone holding the token. See utils/checkinMemory.js. -->
    <div
      v-else-if="state === STATE.ALREADY"
      class="ci__card ci__card--state"
    >
      <span class="ci__mark ci__mark--accent"><Icon
        name="checkThick"
        :size="26"
        :width="2.4"
      /></span>
      <h1 class="ci__title">
        You're already listed
      </h1>
      <p class="ci__body">
        {{ rememberedLabel }}
      </p>
      <p class="ci__meta">
        {{ session.service_label }} · {{ serviceDateLabel }}
      </p>
      <button
        type="button"
        class="ci__again"
        @click="checkInSomeoneElse"
      >
        Check in someone else
      </button>
      <p class="ci__footnote">
        Only this phone remembers who it checked in.
      </p>
    </div>

    <!-- RECORDED -->
    <div
      v-else-if="state === STATE.DONE"
      class="ci__card ci__card--state"
    >
      <span class="ci__mark ci__mark--success"><Icon
        name="checkThick"
        :size="26"
        :width="2.4"
      /></span>
      <h1 class="ci__title">
        You're checked in
      </h1>
      <p class="ci__body">
        {{ doneMessage }}
      </p>
      <p class="ci__meta">
        {{ session.service_label }} · {{ serviceDateLabel }}
      </p>
      <button
        type="button"
        class="ci__again"
        @click="checkInSomeoneElse"
      >
        Check in someone else
      </button>
    </div>

    <!-- OPEN — the form -->
    <div
      v-else
      class="ci__card"
    >
      <header class="ci__head">
        <p class="ci__church">
          {{ session.church_name }}
        </p>
        <h1 class="ci__service">
          {{ session.service_label }}
        </h1>
        <p class="ci__date">
          {{ serviceDateLabel }}
        </p>
        <p
          v-if="closingLabel"
          class="ci__closing"
        >
          <span
            class="ci__dot anim-pulse"
            aria-hidden="true"
          />
          {{ closingLabel }}
        </p>
      </header>

      <form
        class="ci__form"
        @submit.prevent="handleSubmit"
      >
        <!-- NO AUTOCOMPLETE OVER MEMBER NAMES, EVER. A typeahead on a page whose
             URL is printed on a wall would publish the church directory to
             anyone who photographs the poster. `autocomplete="name"` below is
             the BROWSER's own saved-value list, which never leaves the device
             and knows nothing about the roll. -->
        <Input
          v-model="form.name"
          label="Your name"
          size="lg"
          required
          maxlength="80"
          autocomplete="name"
          autocapitalize="words"
          placeholder="e.g. Juan Dela Cruz"
          hint="Type your full name as the church has it on record."
          :error="formError"
        />

        <Input
          v-model="form.contact"
          label="Contact number"
          optional
          size="lg"
          type="tel"
          inputmode="tel"
          maxlength="32"
          autocomplete="tel"
          placeholder="e.g. 0917 555 1234"
          hint="Only needed if you're visiting for the first time."
        />

        <button
          type="submit"
          class="ci__submit"
          :disabled="submitting"
        >
          {{ submitting ? 'Checking in…' : 'Check in' }}
        </button>
      </form>

      <!-- Republic Act 10173 (Data Privacy Act of 2012). docs/SECURITY.md §3.10
           identifies the church as the personal information controller;
           collecting a name and number from non-users over an open endpoint is
           exactly where a notice belongs. -->
      <p class="ci__privacy">
        {{ session.church_name }} records your name to track attendance for this
        service, and your contact number only if you give one. Ask a church
        leader to view, correct or delete your information.
      </p>
    </div>
  </main>
</template>

<style scoped>
/* The only page an attendee ever sees, and it is seen on a phone in a pew.
   Everything here is sized for a thumb. */
.ci {
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--sp-22) var(--sp-16);
  background: var(--app-bg);
}

.ci__card {
  width: 100%;
  max-width: 400px;
  display: flex;
  flex-direction: column;
  gap: var(--sp-18);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 18px;
  box-shadow: var(--shadow-card);
  padding: var(--sp-22);
  animation: rise var(--dur-rise) var(--ease-entrance) both;
}

/* The three outcome screens are centred; the form is not. */
.ci__card--state { align-items: center; text-align: center; gap: var(--sp-14); }

.ci__mark {
  display: grid;
  place-items: center;
  width: 72px;
  height: 72px;
  border-radius: var(--r-pill);
}
.ci__mark--success { background: var(--success-tint); color: var(--success); }
.ci__mark--accent  { background: var(--accent-tint);  color: var(--accent); }
.ci__mark--quiet   { background: var(--surface-subtle-2); color: var(--ink-5); }

.ci__title {
  font-size: 22px;
  font-weight: 800;
  letter-spacing: var(--tracking-h1);
  line-height: 1.2;
  color: var(--ink);
}

.ci__body { font-size: var(--text-body); color: var(--ink-3); line-height: 1.55; }
.ci__meta { font-size: var(--text-body-sm); color: var(--ink-5); }
.ci__muted { font-size: var(--text-body); color: var(--ink-5); }

.ci__footnote {
  font-size: var(--text-meta);
  color: var(--ink-5);
  line-height: 1.5;
  max-width: 30ch;
}

/* --- The header of the open form -------------------------------------- */
.ci__head { display: flex; flex-direction: column; gap: var(--sp-5); }

.ci__church {
  font-size: var(--text-eyebrow);
  font-weight: 800;
  letter-spacing: var(--tracking-eyebrow);
  text-transform: uppercase;
  color: var(--accent-dark);
}

.ci__service {
  font-size: 24px;
  font-weight: 800;
  letter-spacing: var(--tracking-h1);
  line-height: 1.15;
  color: var(--ink);
}

.ci__date { font-size: var(--text-body-sm); color: var(--ink-4); }

.ci__closing {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-7);
  align-self: flex-start;
  margin-top: var(--sp-6);
  padding: var(--sp-7) var(--sp-12);
  border-radius: var(--r-pill);
  background: var(--accent-tint);
  color: var(--accent-dark);
  font-size: var(--text-label);
  font-weight: 700;
}
/* formatTimeRemaining returns "closes in 1h 12m" — sentence case here rather
   than a second copy of the string in this file, so the util stays the one
   place the wording lives. */
.ci__closing::first-letter { text-transform: uppercase; }

.ci__dot {
  width: 7px;
  height: 7px;
  flex: none;
  border-radius: var(--r-pill);
  background: var(--accent);
}

/* --- Form -------------------------------------------------------------- */
.ci__form { display: flex; flex-direction: column; gap: var(--sp-16); }

/* 16px, not 14px. Anything smaller and iOS Safari zooms the page on focus,
   which on a phone held at arm's length in a service is disorienting and does
   not zoom back out. */
.ci__form :deep(.field__input) { font-size: 16px; }

.ci__submit,
.ci__again {
  font-family: var(--font-sans);
  cursor: pointer;
  border-radius: var(--r-inset);
  transition: transform var(--dur-state) ease, background-color var(--dur-state) ease;
}

.ci__submit {
  width: 100%;
  min-height: 52px;
  padding: var(--sp-16);
  border: 0;
  background: var(--accent);
  color: #fff;
  font-size: var(--text-body);
  font-weight: 800;
  box-shadow: var(--shadow-primary);
}
.ci__submit:hover:not(:disabled) { background: var(--accent-deep); }
.ci__submit:disabled { opacity: .6; cursor: progress; }

.ci__again {
  min-height: 44px;
  padding: var(--sp-12) var(--sp-18);
  border: 0;
  background: var(--accent-tint);
  color: var(--accent-dark);
  font-size: var(--text-body-sm);
  font-weight: 800;
}
.ci__again:hover { background: var(--accent-tint-2); }

.ci__submit:focus-visible,
.ci__again:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.ci__privacy {
  padding-top: var(--sp-16);
  border-top: 1px solid var(--divider);
  font-size: var(--text-meta);
  color: var(--ink-5);
  line-height: 1.55;
}

@media (prefers-reduced-motion: reduce) {
  .ci__card { animation: none; }
}
</style>

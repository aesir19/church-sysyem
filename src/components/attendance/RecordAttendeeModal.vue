<script setup>
import { computed, ref, watch } from 'vue'
import Modal from '../ui/Modal.vue'
import Button from '../ui/Button.vue'
import Input from '../ui/Input.vue'
import Toggle from '../ui/Toggle.vue'
import MemberAutocomplete from '../MemberAutocomplete.vue'
import { supabase } from '../../lib/supabase'
import { write } from '../../lib/data/write'
import { buildStaffAttendancePayload, validateCheckinContact, validateCheckinName } from '../../utils/checkinPayload'
import { showToast } from '../../composables/useToast'

// Dialog 06 — recording somebody who did not check themselves in.
//
// This was an inline form under the roster. It is a dialog now because the
// mockup makes it one, and because the roster is the screen's subject: a form
// permanently occupying the space above it said "recording" was, and that is
// only true for ten minutes a week.
//
// WHAT THE MOCKUP DRAWS AND THIS DOES NOT: "Time in" and "Recorded by" as
// fields. Neither is settable. created_at is the database's own default and
// recorded_by comes from auth.uid() in the policy — rendering them as inputs
// would invite staff to correct a time they cannot correct, and rendering a
// hard-coded "9:12 AM" for a row that does not exist yet would simply be false.
// The time is whatever the server stamps at insert, and the roster shows it a
// second later.

const props = defineProps({
  open: { type: Boolean, default: false },
  serviceId: { type: String, default: '' },
  serviceLabel: { type: String, default: '' },
  serviceDate: { type: String, default: '' },
  recorded: { type: Number, default: 0 },
  churchId: { type: String, default: '' },
  // The roll, fetched once by the view through directory_search. A Welcome Team
  // member cannot read `members` under RLS, which is why it is not queried here.
  members: { type: Array, default: () => [] }
})

const emit = defineEmits(['update:open', 'recorded'])

const MODES = [
  { key: 'member', label: 'On the roll' },
  { key: 'guest', label: 'First-time guest' }
]

const mode = ref('member')
const memberId = ref('')
const guestName = ref('')
const guestContact = ref('')
const keepOpen = ref(true)
const saving = ref(false)
const errorMessage = ref('')
const picker = ref(null)

const subtitle = computed(() => {
  const parts = [props.serviceLabel, props.serviceDate].filter(Boolean)
  parts.push(`${props.recorded} recorded`)
  return parts.join(' · ')
})

const dirty = computed(() =>
  !!memberId.value || !!guestName.value.trim() || !!guestContact.value.trim()
)

watch(() => props.open, (open) => {
  if (!open) return
  mode.value = 'member'
  resetFields()
  keepOpen.value = true
  saving.value = false
  errorMessage.value = ''
})

function resetFields () {
  memberId.value = ''
  guestName.value = ''
  guestContact.value = ''
  picker.value?.reset()
}

// Switching mode clears the other side rather than keeping it in reserve: the
// payload builder decides member-or-guest from what is set, and a stale guest
// name left behind a member selection is the kind of thing that only shows up
// once it is in the database.
function setMode (next) {
  mode.value = next
  errorMessage.value = ''
  resetFields()
}

function requestClose () {
  if (saving.value) return
  emit('update:open', false)
}

async function submit () {
  errorMessage.value = ''

  if (!props.serviceId) {
    errorMessage.value = 'No service is selected.'
    return
  }

  if (mode.value === 'member' && !memberId.value) {
    errorMessage.value = 'Choose a member from the list.'
    return
  }

  if (mode.value === 'guest') {
    const nameError = validateCheckinName(guestName.value)
    if (nameError) {
      errorMessage.value = nameError
      return
    }
    const contactError = validateCheckinContact(guestContact.value)
    if (contactError) {
      errorMessage.value = contactError
      return
    }
  }

  const payload = buildStaffAttendancePayload({
    serviceId: props.serviceId,
    churchId: props.churchId,
    memberId: mode.value === 'member' ? memberId.value : '',
    guestName: guestName.value,
    guestContact: guestContact.value
  })

  saving.value = true
  const result = await write(
    supabase.from('attendance').insert(payload),
    {
      columns: 'id, member_id, guest_name, guest_contact, source, created_at, members(first_name, middle_name, last_name)',
      messages: {
        blocked: 'That attendance could not be saved. It may already be recorded, or the service may belong to another church.',
        conflict: 'That person is already recorded for this service.'
      }
    }
  )
  saving.value = false

  if (!result.ok) {
    errorMessage.value = result.message
    return
  }

  emit('recorded', result.rows[0])
  showToast('Attendance recorded.')

  // The door case: somebody stands there marking a queue of arrivals present.
  // Closing after each one would cost a click and a focus hunt per person.
  if (keepOpen.value) {
    resetFields()
    return
  }
  emit('update:open', false)
}
</script>

<template>
  <Modal
    :open="open"
    title="Record attendee"
    :description="subtitle"
    width="md"
    :close-on-outside-click="!dirty"
    @update:open="$event ? null : requestClose()"
  >
    <p
      v-if="errorMessage"
      class="ra__error"
      role="alert"
    >
      {{ errorMessage }}
    </p>

    <div
      class="ra__modes"
      role="group"
      aria-label="Attendee type"
    >
      <button
        v-for="m in MODES"
        :key="m.key"
        type="button"
        class="ra__mode"
        :class="{ 'is-on': mode === m.key }"
        :aria-pressed="mode === m.key"
        @click="setMode(m.key)"
      >
        {{ m.label }}
      </button>
    </div>

    <MemberAutocomplete
      v-if="mode === 'member'"
      ref="picker"
      v-model="memberId"
      :members="members"
      input-id="record-attendee-member"
      label="Member"
    />

    <template v-else>
      <Input
        v-model="guestName"
        label="Guest name"
        required
        maxlength="80"
        placeholder="e.g. Maria Santos"
      />
      <Input
        v-model="guestContact"
        label="Contact number"
        optional
        type="tel"
        maxlength="32"
        placeholder="e.g. 0917 555 1234"
        hint="Only if they want to be followed up."
      />
    </template>

    <Toggle
      v-model="keepOpen"
      band
    >
      Keep this open to record another
    </Toggle>

    <template #footer>
      <Button
        :disabled="saving"
        @click="requestClose"
      >
        Cancel
      </Button>
      <Button
        variant="primary"
        :loading="saving"
        @click="submit"
      >
        Mark present
      </Button>
    </template>
  </Modal>
</template>

<style scoped>
.ra__error {
  padding: var(--sp-10) var(--sp-12);
  border-radius: var(--r-inset);
  background: var(--magenta-tint);
  border: 1px solid var(--magenta-border);
  font-size: var(--text-body-sm);
  color: var(--magenta-darkest);
}

/* The mockup's segmented control: an inset track with the live half raised out
   of it on its own surface. */
.ra__modes {
  display: flex;
  gap: var(--sp-6);
  padding: 4px;
  border-radius: var(--r-control);
  background: var(--divider);
}

.ra__mode {
  flex: 1;
  padding: var(--sp-8);
  border: 0;
  border-radius: var(--r-tag);
  background: transparent;
  font-family: var(--font-sans);
  font-size: var(--text-label);
  font-weight: 700;
  color: var(--ink-4);
  cursor: pointer;
  transition: background-color var(--dur-state) ease, color var(--dur-state) ease;
}
.ra__mode.is-on {
  background: var(--surface);
  color: var(--ink);
  box-shadow: 0 1px 2px rgba(16, 24, 40, .08);
}
.ra__mode:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>

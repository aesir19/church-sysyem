<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import Button from '../ui/Button.vue'
import Card from '../ui/Card.vue'
import Input from '../ui/Input.vue'
import MemberAutocomplete from '../MemberAutocomplete.vue'
import { supabase } from '../../lib/supabase'
import { write } from '../../lib/data/write'
import { buildStaffAttendancePayload, validateCheckinContact, validateCheckinName } from '../../utils/checkinPayload'
import { showToast } from '../../composables/useToast'

// The door workflow is deliberately inline. An usher can mark a queue of people
// present without repeatedly opening and dismissing a dialog; a successful save
// clears the fields and returns focus to the next name.
const props = defineProps({
  serviceId: { type: String, default: '' },
  serviceLabel: { type: String, default: '' },
  serviceDate: { type: String, default: '' },
  recorded: { type: Number, default: 0 },
  churchId: { type: String, default: '' },
  members: { type: Array, default: () => [] }
})

const emit = defineEmits(['recorded'])

const MODES = [
  { key: 'member', label: 'On the roll' },
  { key: 'guest', label: 'First-time guest' }
]

const mode = ref('member')
const memberId = ref('')
const guestName = ref('')
const guestContact = ref('')
const saving = ref(false)
const errorMessage = ref('')
const successMessage = ref('')
const picker = ref(null)
const guestNameField = ref(null)

const context = computed(() => {
  const parts = [props.serviceLabel, props.serviceDate].filter(Boolean)
  parts.push(`${props.recorded} recorded`)
  return parts.join(' · ')
})

watch(() => props.serviceId, () => {
  mode.value = 'member'
  errorMessage.value = ''
  successMessage.value = ''
  resetFields()
})

function resetFields () {
  memberId.value = ''
  guestName.value = ''
  guestContact.value = ''
  picker.value?.reset()
}

function setMode (next) {
  mode.value = next
  errorMessage.value = ''
  successMessage.value = ''
  resetFields()
  nextTick(() => focusEntry())
}

function focusEntry () {
  if (mode.value === 'member') {
    picker.value?.focus()
    return
  }
  guestNameField.value?.$el?.querySelector('input')?.focus()
}

async function submit () {
  errorMessage.value = ''
  successMessage.value = ''

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

  const selectedMember = props.members.find((member) => member.id === memberId.value)
  const recordedName = mode.value === 'guest'
    ? guestName.value.trim()
    : [selectedMember?.first_name, selectedMember?.middle_name, selectedMember?.last_name].filter(Boolean).join(' ')

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
  successMessage.value = `${recordedName || 'Attendee'} marked present. Ready for the next person.`
  showToast('Attendance recorded.')
  resetFields()
  await nextTick()
  focusEntry()
}
</script>

<template>
  <Card
    as="section"
    class="recorder"
  >
    <div class="recorder__head">
      <div>
        <p class="recorder__eyebrow">
          Continuous entry
        </p>
        <h2 class="recorder__title">
          Record attendance
        </h2>
      </div>
      <span class="recorder__count">{{ recorded }} present</span>
    </div>

    <p class="recorder__context">
      {{ context }}
    </p>

    <div
      class="recorder__modes"
      role="group"
      aria-label="Attendee type"
    >
      <button
        v-for="item in MODES"
        :key="item.key"
        type="button"
        class="recorder__mode"
        :class="{ 'is-on': mode === item.key }"
        :aria-pressed="mode === item.key"
        @click="setMode(item.key)"
      >
        {{ item.label }}
      </button>
    </div>

    <p
      v-if="errorMessage"
      class="recorder__message recorder__message--error"
      role="alert"
    >
      {{ errorMessage }}
    </p>
    <p
      v-else-if="successMessage"
      class="recorder__message recorder__message--success"
      role="status"
    >
      {{ successMessage }}
    </p>

    <form
      class="recorder__form"
      novalidate
      @submit.prevent="submit"
    >
      <MemberAutocomplete
        v-if="mode === 'member'"
        ref="picker"
        v-model="memberId"
        :members="members"
        input-id="record-attendee-member"
        label="Search member"
      />

      <div
        v-else
        class="recorder__guest-fields"
      >
        <Input
          ref="guestNameField"
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
      </div>

      <Button
        type="submit"
        variant="primary"
        size="lg"
        :loading="saving"
        :disabled="!serviceId"
        block
      >
        Mark present
      </Button>
    </form>

    <p class="recorder__hint">
      After saving, the field clears and stays ready for the next person.
    </p>
  </Card>
</template>

<style scoped>
.recorder { display: flex; flex-direction: column; gap: var(--sp-12); min-width: 0; }
.recorder__head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--sp-12); }
.recorder__eyebrow {
  margin-bottom: var(--sp-4);
  font-size: var(--text-meta-sm);
  font-weight: 800;
  letter-spacing: var(--tracking-eyebrow);
  text-transform: uppercase;
  color: var(--accent);
}
.recorder__title { font-size: var(--text-h2); font-weight: 800; letter-spacing: var(--tracking-h2); color: var(--ink); }
.recorder__count {
  flex: none;
  padding: var(--sp-5) var(--sp-9);
  border-radius: var(--r-pill);
  background: var(--accent-tint);
  font-size: var(--text-meta);
  font-weight: 700;
  color: var(--accent-darkest);
}
.recorder__context { font-size: var(--text-meta); color: var(--ink-5); }
.recorder__modes { display: flex; gap: var(--sp-6); padding: 4px; border-radius: var(--r-control); background: var(--divider); }
.recorder__mode {
  flex: 1;
  min-height: 44px;
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
.recorder__mode.is-on { background: var(--surface); color: var(--ink); box-shadow: 0 1px 2px rgba(16, 24, 40, .08); }
.recorder__mode:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.recorder__message {
  padding: var(--sp-9) var(--sp-11);
  border: 1px solid;
  border-radius: var(--r-inset);
  font-size: var(--text-body-sm);
  font-weight: 600;
}
.recorder__message--error { background: var(--magenta-tint); border-color: var(--magenta-border); color: var(--magenta-darkest); }
.recorder__message--success { background: var(--success-tint); border-color: var(--success-border); color: var(--success); }
.recorder__form { display: flex; flex-direction: column; gap: var(--sp-12); }
.recorder__form :deep(.btn) { min-height: 44px; }
.recorder__guest-fields { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-12); align-items: start; }
.recorder__hint { font-size: var(--text-meta); color: var(--ink-5); text-align: center; }

@media (max-width: 620px) {
  .recorder__guest-fields { grid-template-columns: 1fr; }
}
</style>

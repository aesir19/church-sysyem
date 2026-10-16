<script setup>
// The small dialogs behind the meeting ⋯ menu (mockup 13i): move one meeting, cancel it
// with an optional reason members see on the Calendar, and delete it — for a repeating
// meeting, asking which dates (this one, this and following, the whole series).
// `action` is { kind: 'move' | 'cancel' | 'delete', meeting } or null.
import { computed, ref, watch } from 'vue'
import Modal from '../ui/Modal.vue'
import Button from '../ui/Button.vue'
import Input from '../ui/Input.vue'
import Alert from '../ui/Alert.vue'
import { moveMeeting, cancelMeeting, deleteMeeting } from '../../lib/data/groupMeetings'

const props = defineProps({
  action: { type: Object, default: null }
})
const emit = defineEmits(['close', 'saved'])

const TZ = 'Asia/Manila'
const manilaDate = iso => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ })
const manilaTime = iso => new Date(iso).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })

const kind = computed(() => props.action?.kind ?? null)
const meeting = computed(() => props.action?.meeting ?? null)
const repeating = computed(() => !!meeting.value?.seriesId)

const move = ref({ date: '', startTime: '', endTime: '' })
const reason = ref('')
const scope = ref('this')
const error = ref('')
const busy = ref(false)

watch(() => props.action, a => {
  error.value = ''
  reason.value = ''
  scope.value = 'this'
  if (a?.kind === 'move') {
    const m = a.meeting
    move.value = { date: manilaDate(m.startsAt), startTime: manilaTime(m.startsAt), endTime: m.endsAt ? manilaTime(m.endsAt) : '' }
  }
})

const SCOPES = [
  { value: 'this', label: 'This meeting' },
  { value: 'following', label: 'This and following' },
  { value: 'series', label: 'The whole series' }
]

function close (open) { if (!open) emit('close') }

async function run (fn, done) {
  error.value = ''
  busy.value = true
  const result = await fn()
  busy.value = false
  if (!result.ok) {
    error.value = result.message || 'That change could not be saved.'
    return
  }
  emit('saved', done)
  emit('close')
}

function doMove () {
  const m = move.value
  if (m.endTime && m.endTime <= m.startTime) { error.value = 'The meeting must end after it starts.'; return }
  run(() => moveMeeting(meeting.value, m), 'Meeting moved.')
}
const doCancel = () => run(() => cancelMeeting(meeting.value, reason.value.trim() || null), 'Meeting cancelled.')
const doDelete = () => run(() => deleteMeeting(meeting.value, repeating.value ? scope.value : 'this'), 'Meeting deleted.')
</script>

<template>
  <Modal
    :open="kind === 'move'"
    title="Move this meeting"
    description="Only this meeting moves. Any others stay where they are."
    width="sm"
    @update:open="close"
  >
    <div class="md">
      <Alert
        v-if="error"
        tone="danger"
      >
        {{ error }}
      </Alert>
      <Input
        v-model="move.date"
        label="Date"
        type="date"
        required
      />
      <div class="md__times">
        <Input
          v-model="move.startTime"
          label="Starts"
          type="time"
          required
        />
        <Input
          v-model="move.endTime"
          label="Ends"
          type="time"
        />
      </div>
    </div>
    <template #footer>
      <Button
        variant="secondary"
        @click="emit('close')"
      >
        Keep it
      </Button>
      <Button
        variant="primary"
        :loading="busy"
        @click="doMove"
      >
        Move meeting
      </Button>
    </template>
  </Modal>

  <Modal
    :open="kind === 'cancel'"
    title="Cancel this meeting?"
    description="It stays on the Calendar marked cancelled, so the group knows not to come."
    width="sm"
    icon="alert"
    icon-tone="magenta"
    @update:open="close"
  >
    <div class="md">
      <Alert
        v-if="error"
        tone="danger"
      >
        {{ error }}
      </Alert>
      <Input
        v-model="reason"
        label="Reason"
        optional
        hint="The group sees this beside the meeting."
      />
    </div>
    <template #footer>
      <Button
        variant="secondary"
        @click="emit('close')"
      >
        Keep it
      </Button>
      <Button
        variant="danger"
        :loading="busy"
        @click="doCancel"
      >
        Cancel meeting
      </Button>
    </template>
  </Modal>

  <Modal
    :open="kind === 'delete'"
    title="Delete this meeting?"
    :description="repeating ? 'Choose which meetings to delete. Past ones stay.' : 'It is removed from the Calendar. This cannot be undone.'"
    width="sm"
    icon="alert"
    icon-tone="magenta"
    @update:open="close"
  >
    <div class="md">
      <Alert
        v-if="error"
        tone="danger"
      >
        {{ error }}
      </Alert>
      <div
        v-if="repeating"
        class="md__scopes"
        role="radiogroup"
        aria-label="Which meetings"
      >
        <label
          v-for="s in SCOPES"
          :key="s.value"
          class="md__scope"
        >
          <input
            v-model="scope"
            type="radio"
            :value="s.value"
          >
          {{ s.label }}
        </label>
      </div>
    </div>
    <template #footer>
      <Button
        variant="secondary"
        @click="emit('close')"
      >
        Keep it
      </Button>
      <Button
        variant="danger"
        :loading="busy"
        @click="doDelete"
      >
        Delete
      </Button>
    </template>
  </Modal>
</template>

<style scoped>
.md { display:flex; flex-direction:column; gap:var(--sp-12); }
.md__times { display:grid; grid-template-columns:1fr 1fr; gap:var(--sp-10); }
.md__scopes { display:flex; flex-direction:column; gap:var(--sp-8); }
.md__scope { display:flex; align-items:center; gap:var(--sp-8); padding:10px 12px; border:1px solid var(--border-strong); border-radius:var(--r-inset); font-size:var(--text-body-sm); color:var(--ink-2); cursor:pointer; }
.md__scope:has(input:checked) { border-color:var(--accent); background:var(--accent-tint); }
</style>

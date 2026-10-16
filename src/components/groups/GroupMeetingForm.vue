<script setup>
// The short Group meeting form (mockup 13h). Three uses:
//   create     — a new meeting, one-off or repeating, for a group the person leads
//   edit       — "Edit…": this meeting only (a repeating date becomes a saved date)
//   from-here  — "Change from here on…": this date and every one after, via the split
// Leaders never see the full event composer; budget, rooms, roles, programme and closeout
// stay with the Events team. Who may save is the database's call (0056).
import { computed, ref, watch } from 'vue'
import Modal from '../ui/Modal.vue'
import Button from '../ui/Button.vue'
import Input from '../ui/Input.vue'
import Alert from '../ui/Alert.vue'
import {
  meetingRule, formSummary, createGroupMeeting, editMeeting, changeFromHere
} from '../../lib/data/groupMeetings'

const props = defineProps({
  open: { type: Boolean, required: true },
  mode: { type: String, default: 'create', validator: v => ['create', 'edit', 'from-here'].includes(v) },
  meeting: { type: Object, default: null },
  // Only groups the person leads: [{ id, name }].
  groups: { type: Array, required: true },
  defaultGroupId: { type: String, default: null },
  churchId: { type: String, default: null }
})
const emit = defineEmits(['update:open', 'saved'])

const REPEATS = [
  { value: 'none', label: "Doesn't repeat" },
  { value: 'weekly', label: 'Weekly' },
  { value: 'fortnightly', label: 'Every 2 weeks' },
  { value: 'monthly', label: 'Monthly' }
]
const DEFAULT_COUNT = 8

const form = ref(blank())
const error = ref('')
const saving = ref(false)
let splitKey = null

const TZ = 'Asia/Manila'
const manilaDate = iso => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ })
const manilaTime = iso => new Date(iso).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })

function blank () {
  return {
    title: '', date: '', startTime: '', endTime: '', location: '', notes: '',
    groupId: props.defaultGroupId || props.groups[0]?.id || '',
    repeat: 'none', ends: 'after', count: DEFAULT_COUNT
  }
}

function fromMeeting (m) {
  const s = m.series
  const repeat = !s ? 'none' : s.cadence === 'monthly' ? 'monthly' : (s.intervalN || 1) === 2 ? 'fortnightly' : 'weekly'
  return {
    title: m.title,
    date: manilaDate(m.startsAt),
    startTime: manilaTime(m.startsAt),
    endTime: m.endsAt ? manilaTime(m.endsAt) : '',
    location: m.location || '',
    notes: m.notes || '',
    groupId: m.groupId,
    repeat,
    ends: s && !s.countN ? 'never' : 'after',
    count: s?.countN || DEFAULT_COUNT
  }
}

watch(() => props.open, open => {
  if (!open) return
  form.value = props.mode === 'create' || !props.meeting ? blank() : fromMeeting(props.meeting)
  error.value = ''
  splitKey = null
})
// A changed form is a different change: a split retried after an edit gets a fresh key.
watch(form, () => { splitKey = null }, { deep: true })

const repeats = computed(() => props.mode === 'from-here' ? REPEATS.filter(r => r.value !== 'none') : REPEATS)
const count = computed(() => form.value.ends === 'never' ? null : Number(form.value.count) || null)
const rule = computed(() => form.value.date && form.value.startTime
  ? meetingRule({ ...form.value, count: count.value })
  : null)
const summary = computed(() => formSummary(rule.value))

const title = computed(() => ({ create: 'New group meeting', edit: 'Edit this meeting', 'from-here': 'Change from here on' })[props.mode])
const description = computed(() => ({
  create: 'Goes live right away. Only this group sees it on the Calendar.',
  edit: 'Changes this meeting only.',
  'from-here': 'This meeting and every one after it change. Earlier ones stay as they were.'
})[props.mode])
const primary = computed(() => {
  if (props.mode !== 'create') return 'Save'
  if (form.value.repeat === 'none') return 'Create meeting'
  return count.value ? `Create ${count.value} meetings` : 'Create meetings'
})

async function save () {
  error.value = ''
  const f = form.value
  if (f.endTime && f.startTime && f.endTime <= f.startTime) {
    error.value = 'The meeting must end after it starts.'
    return
  }
  saving.value = true
  let result
  if (props.mode === 'create') {
    result = await createGroupMeeting({ ...f, churchId: props.churchId, count: count.value })
  } else if (props.mode === 'edit') {
    result = await editMeeting(props.meeting, f)
  } else {
    splitKey ??= crypto.randomUUID()
    result = await changeFromHere(props.meeting, { ...f, count: count.value }, splitKey)
  }
  saving.value = false
  if (!result.ok) {
    error.value = result.message || 'That meeting could not be saved.'
    return
  }
  emit('saved', props.mode === 'create' ? 'Meeting created.' : 'Meeting saved.')
  emit('update:open', false)
}
</script>

<template>
  <Modal
    :open="open"
    :title="title"
    :description="description"
    @update:open="emit('update:open', $event)"
  >
    <form
      class="mf"
      @submit.prevent="save"
    >
      <Alert
        v-if="error"
        tone="danger"
      >
        {{ error }}
      </Alert>
      <Input
        v-model="form.title"
        label="Title"
        required
      />
      <div class="mf__when">
        <Input
          v-model="form.date"
          label="Date"
          type="date"
          required
        />
        <Input
          v-model="form.startTime"
          label="Starts"
          type="time"
          required
        />
        <Input
          v-model="form.endTime"
          label="Ends"
          type="time"
        />
      </div>
      <Input
        v-model="form.location"
        label="Location"
        hint="Only this group's members and leaders, the Events team and Super Admin see it."
      />
      <Input
        v-model="form.notes"
        label="Notes"
        as="textarea"
        optional
        :rows="2"
      />
      <Input
        v-model="form.groupId"
        label="Group"
        as="select"
        hint="Only groups you lead are listed."
        :disabled="mode !== 'create'"
      >
        <option
          v-for="g in groups"
          :key="g.id"
          :value="g.id"
        >
          {{ g.name }}
        </option>
      </Input>

      <fieldset
        v-if="mode !== 'edit'"
        class="mf__repeat"
      >
        <legend>Repeat</legend>
        <div
          class="seg"
          role="radiogroup"
          aria-label="Repeat"
        >
          <button
            v-for="r in repeats"
            :key="r.value"
            type="button"
            role="radio"
            class="seg__opt"
            :class="{ 'is-on': form.repeat === r.value }"
            :aria-checked="form.repeat === r.value"
            @click="form.repeat = r.value"
          >
            {{ r.label }}
          </button>
        </div>
        <div
          v-if="form.repeat !== 'none'"
          class="mf__ends"
          role="radiogroup"
          aria-label="Ends"
        >
          <span class="mf__label">Ends</span>
          <label class="mf__choice">
            <input
              v-model="form.ends"
              type="radio"
              value="after"
              aria-label="After"
            >
            After
            <input
              v-model="form.count"
              class="mf__count"
              type="number"
              min="1"
              max="52"
              aria-label="Number of meetings"
              :disabled="form.ends !== 'after'"
            >
            meetings
          </label>
          <label class="mf__choice">
            <input
              v-model="form.ends"
              type="radio"
              value="never"
            >
            Never
          </label>
        </div>
        <p
          v-if="summary"
          class="mf__summary"
        >
          {{ summary }}
        </p>
      </fieldset>
    </form>

    <template #footer>
      <Button
        variant="secondary"
        @click="emit('update:open', false)"
      >
        Cancel
      </Button>
      <Button
        variant="primary"
        :loading="saving"
        @click="save"
      >
        {{ primary }}
      </Button>
    </template>
  </Modal>
</template>

<style scoped>
.mf { display:flex; flex-direction:column; gap:var(--sp-14); }
.mf__when { display:grid; grid-template-columns:1.3fr 1fr 1fr; gap:var(--sp-10); }
.mf__repeat { border:0; margin:0; padding:0; display:flex; flex-direction:column; gap:var(--sp-8); }
.mf__repeat legend, .mf__label { color:var(--ink-2); font-size:var(--text-body-sm); font-weight:700; margin-bottom:var(--sp-6); }
.seg { display:inline-flex; flex-wrap:wrap; align-self:flex-start; gap:3px; padding:3px; border-radius:var(--r-control); background:var(--surface-subtle-2); }
.seg__opt { padding:7px 13px; border:none; background:none; border-radius:var(--r-inset); font:inherit; font-weight:700; font-size:var(--text-meta); color:var(--ink-5); cursor:pointer; }
.seg__opt.is-on { background:var(--surface); color:var(--ink); box-shadow:0 1px 2px rgba(16,24,40,.1); }
.seg__opt:focus-visible { outline:var(--ring-focus); outline-offset:1px; }
.mf__ends { display:flex; flex-wrap:wrap; align-items:center; gap:var(--sp-12); font-size:var(--text-body-sm); color:var(--ink-3); }
.mf__ends .mf__label { margin:0; }
.mf__choice { display:inline-flex; align-items:center; gap:6px; }
.mf__count { width:56px; padding:4px 6px; border:1px solid var(--border-strong); border-radius:var(--r-inset); background:var(--surface); color:var(--ink); font:inherit; }
.mf__summary { color:var(--ink-3); font-size:var(--text-body-sm); }
@media (max-width:480px) { .mf__when { grid-template-columns:1fr 1fr; } .mf__when > :first-child { grid-column:1 / -1; } }
</style>

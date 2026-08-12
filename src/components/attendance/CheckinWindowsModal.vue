<script setup>
import { computed, ref, watch } from 'vue'
import Modal from '../ui/Modal.vue'
import Button from '../ui/Button.vue'
import Input from '../ui/Input.vue'
import { supabase } from '../../lib/supabase'
import { write } from '../../lib/data/write'
import { showToast } from '../../composables/useToast'
import { formatDateISO } from '../../utils/collectionsDate'
import {
  buildAdhocServicePayload,
  buildSchedulePayload,
  formatScheduleRange,
  validateAdhocService,
  validateSchedule,
  weekdayLabel,
  WEEKDAY_LABELS
} from '../../utils/attendanceWindow'

// When check-in opens — the recurring weekly slots, and the one-off services
// that sit outside them.
//
// NOT IN THE MOCKUP AT ALL. The design draws an attendance screen with two
// buttons and no way to say when check-in happens, which would be fine if the
// windows were configured somewhere else; they are not. Self check-in works
// only inside these windows and opens on its own when one starts, so deleting
// the only screen that manages them would take the feature with it. It is a
// dialog rather than a second tab because it is setup: touched when the service
// times change, not weekly.
//
// The three panels are one dialog, swapped in place, for the same reason the QR
// confirm is inline — one focus trap at a time.

const props = defineProps({
  open: { type: Boolean, default: false },
  schedules: { type: Array, default: () => [] },
  churchId: { type: String, default: '' },
  canManage: { type: Boolean, default: false }
})

const emit = defineEmits(['update:open', 'schedule-added', 'schedule-updated', 'service-created'])

const panel = ref('list')
const saving = ref(false)
const errorMessage = ref('')
const busyId = ref('')

// 0 = Sunday, the common case — but only as a default. A midweek service is a
// recurring slot too, not something to re-create as a one-off every week.
const weekly = ref({ label: '', weekday: 0, startsAt: '08:00', endsAt: '11:00' })
const adhoc = ref({ label: '', date: '', startsAt: '18:00', endsAt: '20:00' })

const anyActive = computed(() => props.schedules.some((s) => s.is_active))

const TITLES = {
  list: 'When check-in opens',
  weekly: 'Add a weekly slot',
  adhoc: 'One-off service'
}

const DESCRIPTIONS = {
  list: 'Self check-in works only inside these windows, and opens on its own when one starts. Pausing a slot stops it without losing past records.',
  weekly: 'A slot repeats every week. Check-in opens and closes on its own between these times.',
  adhoc: 'For anything outside the weekly pattern — a revival, a watchnight, a special service.'
}

watch(() => props.open, (open) => {
  if (!open) return
  panel.value = 'list'
  errorMessage.value = ''
  saving.value = false
  weekly.value = { label: '', weekday: 0, startsAt: '08:00', endsAt: '11:00' }
  // formatDateISO, not toISOString().slice(0, 10) — the latter is defect D8 and
  // is wrong for the first eight hours of every Manila day.
  adhoc.value = { label: '', date: formatDateISO(new Date()), startsAt: '18:00', endsAt: '20:00' }
})

function show (next) {
  panel.value = next
  errorMessage.value = ''
}

async function saveWeekly () {
  const invalid = validateSchedule(weekly.value)
  if (invalid) {
    errorMessage.value = invalid
    return
  }

  saving.value = true
  const result = await write(
    supabase.from('service_schedules').insert(buildSchedulePayload(weekly.value, props.churchId)),
    {
      columns: 'id, label, weekday, starts_at, ends_at, is_active',
      messages: {
        blocked: 'That schedule could not be saved. A slot may already exist for that day and time.',
        conflict: 'A slot already exists for that day and time.'
      }
    }
  )
  saving.value = false

  if (!result.ok) {
    errorMessage.value = result.message
    return
  }

  emit('schedule-added', result.rows[0])
  show('list')
  showToast('Weekly slot added.')
}

async function toggle (schedule) {
  busyId.value = schedule.id
  const result = await write(
    supabase.from('service_schedules').update({ is_active: !schedule.is_active }).eq('id', schedule.id),
    { columns: 'id, label, weekday, starts_at, ends_at, is_active', messages: { blocked: 'That schedule could not be updated.' } }
  )
  busyId.value = ''

  if (!result.ok) {
    showToast(result.message, 'error')
    return
  }

  emit('schedule-updated', result.rows[0])
  showToast(result.rows[0].is_active ? 'Schedule resumed.' : 'Schedule paused.')
}

async function saveAdhoc () {
  const invalid = validateAdhocService(adhoc.value)
  if (invalid) {
    errorMessage.value = invalid
    return
  }

  saving.value = true
  const result = await write(
    supabase.from('services').insert(buildAdhocServicePayload(adhoc.value, props.churchId)),
    {
      columns: 'id, label, service_date, opens_at, closes_at, schedule_id',
      messages: {
        blocked: 'That service could not be created. One with the same name may already exist on that date.',
        conflict: 'A service with that name already exists on that date.'
      }
    }
  )
  saving.value = false

  if (!result.ok) {
    errorMessage.value = result.message
    return
  }

  emit('service-created', result.rows[0])
  emit('update:open', false)
  showToast('Service created.')
}
</script>

<template>
  <Modal
    :open="open"
    :title="TITLES[panel]"
    :description="DESCRIPTIONS[panel]"
    width="md"
    :close-on-outside-click="panel === 'list'"
    @update:open="$emit('update:open', $event)"
  >
    <p
      v-if="errorMessage"
      class="cw__error"
      role="alert"
    >
      {{ errorMessage }}
    </p>

    <!-- The slots themselves -->
    <template v-if="panel === 'list'">
      <p
        v-if="!schedules.length"
        class="cw__empty"
      >
        No recurring services yet. Add a weekly slot and check-in will open on its own.
      </p>

      <ul
        v-else
        class="cw__list"
      >
        <li
          v-for="s in schedules"
          :key="s.id"
          class="cw__row"
          :class="{ 'is-paused': !s.is_active }"
        >
          <span class="cw__when">
            <span class="cw__label">{{ s.label }}</span>
            <span class="cw__time">{{ weekdayLabel(s.weekday) }} · {{ formatScheduleRange(s) }}</span>
          </span>
          <span
            v-if="!s.is_active"
            class="tag tag--paused"
          >Paused</span>
          <Button
            v-if="canManage"
            size="sm"
            :loading="busyId === s.id"
            @click="toggle(s)"
          >
            {{ s.is_active ? 'Pause' : 'Resume' }}
          </Button>
        </li>
      </ul>

      <p
        v-if="schedules.length && !anyActive"
        class="cw__warn"
      >
        Every slot is paused, so self check-in will never open.
      </p>
    </template>

    <!-- A weekly slot -->
    <template v-else-if="panel === 'weekly'">
      <Input
        v-model="weekly.label"
        label="Service name"
        required
        maxlength="60"
        placeholder="e.g. Sunday Service"
      />
      <!-- No .number modifier, and none is needed: `:value="index"` binds a
           real number, and Vue's select binding carries non-string option
           values through as themselves rather than as the DOM's string. That
           matters because weekday is an integer column and validateSchedule
           rejects anything else. (A .number modifier on a COMPONENT v-model
           would do nothing anyway — the child has to honour modelModifiers,
           and ui/Input does not.) -->
      <Input
        v-model="weekly.weekday"
        as="select"
        label="Day"
        required
      >
        <option
          v-for="(day, index) in WEEKDAY_LABELS"
          :key="day"
          :value="index"
        >
          {{ day }}
        </option>
      </Input>
      <div class="cw__pair">
        <Input
          v-model="weekly.startsAt"
          label="Opens"
          type="time"
          required
        />
        <Input
          v-model="weekly.endsAt"
          label="Closes"
          type="time"
          required
        />
      </div>
    </template>

    <!-- A one-off -->
    <template v-else>
      <Input
        v-model="adhoc.label"
        label="Service name"
        required
        maxlength="60"
        placeholder="e.g. Watchnight Service"
      />
      <Input
        v-model="adhoc.date"
        label="Date"
        type="date"
        required
      />
      <div class="cw__pair">
        <Input
          v-model="adhoc.startsAt"
          label="Opens"
          type="time"
          required
        />
        <Input
          v-model="adhoc.endsAt"
          label="Closes"
          type="time"
          required
        />
      </div>
    </template>

    <template #footer>
      <template v-if="panel === 'list'">
        <template v-if="canManage">
          <Button @click="show('adhoc')">
            + One-off service
          </Button>
          <Button
            variant="primary"
            @click="show('weekly')"
          >
            + Weekly slot
          </Button>
        </template>
        <Button
          v-else
          @click="$emit('update:open', false)"
        >
          Close
        </Button>
      </template>

      <template v-else>
        <Button
          :disabled="saving"
          @click="show('list')"
        >
          Back
        </Button>
        <Button
          variant="primary"
          :loading="saving"
          @click="panel === 'weekly' ? saveWeekly() : saveAdhoc()"
        >
          {{ panel === 'weekly' ? 'Add slot' : 'Create service' }}
        </Button>
      </template>
    </template>
  </Modal>
</template>

<style scoped>
.cw__error {
  padding: var(--sp-10) var(--sp-12);
  border-radius: var(--r-inset);
  background: var(--magenta-tint);
  border: 1px solid var(--magenta-border);
  font-size: var(--text-body-sm);
  color: var(--magenta-darkest);
}

.cw__warn {
  padding: var(--sp-10) var(--sp-12);
  border-radius: var(--r-inset);
  background: var(--warning-tint);
  border: 1px solid var(--warning-border);
  font-size: var(--text-body-sm);
  color: var(--warning-deep);
}

.cw__empty { font-size: var(--text-body-sm); color: var(--ink-5); }

.cw__list { list-style: none; display: flex; flex-direction: column; }

.cw__row {
  display: flex;
  align-items: center;
  gap: var(--sp-10);
  padding: var(--sp-10) 0;
  border-bottom: 1px solid var(--divider);
}
.cw__row:last-child { border-bottom: 0; }
.cw__row.is-paused .cw__label { color: var(--ink-4); }

.cw__when { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.cw__label { font-size: var(--text-body-sm); font-weight: 700; color: var(--ink); }
.cw__time { font-size: var(--text-meta); color: var(--ink-5); }

.tag {
  padding: 3px var(--sp-8);
  border-radius: var(--r-tag);
  font-size: var(--text-meta-sm);
  font-weight: 700;
}
.tag--paused { background: var(--warning-tint); color: var(--warning-deep); }

.cw__pair { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-12); }
</style>

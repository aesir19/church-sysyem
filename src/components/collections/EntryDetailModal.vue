<script setup>
import { computed, ref, watch } from 'vue'
import Modal from '../ui/Modal.vue'
import Button from '../ui/Button.vue'
import Input from '../ui/Input.vue'
import Badge from '../ui/Badge.vue'
import MemberAutocomplete from '../MemberAutocomplete.vue'
import { correctCollection, COLLECTION_REASONS } from '../../lib/data/finance'
import { formatPeso } from '../../utils/money'
import { showToast } from '../../composables/useToast'

// One logical contribution and the corrections on it. The ledger is APPEND-ONLY
// (migration 0039): nothing here edits or deletes a row. "Correct" writes a
// reversal of the live entry plus a fresh replacement; "Void" writes the reversal
// alone. Both go through the correct_collection RPC, which derives the reversal
// server-side — the client never sends a figure that could fail to cancel.

const props = defineProps({
  open: { type: Boolean, default: false },
  // A unit from buildUnits: { live, original, voided, corrected, history }.
  unit: { type: Object, default: null },
  // The roll for the contributor picker (directory_search, as ContributionForm).
  members: { type: Array, default: () => [] }
})

const emit = defineEmits(['update:open', 'changed'])

const mode = ref('view') // view | correct | void
const saving = ref(false)
const errorMessage = ref('')
const picker = ref(null)

// Correction form state.
const amount = ref('')
const type = ref('tithes')
const memberId = ref('')
const anonymous = ref(false)
const date = ref('')
const reason = ref('')
const note = ref('')

const live = computed(() => props.unit?.live || props.unit?.original || null)
const shown = computed(() => props.unit?.live || props.unit?.original || null)
const isVoided = computed(() => !!props.unit?.voided)
// A live, non-voided record can still be corrected or voided.
const actionable = computed(() => !!props.unit?.live && !isVoided.value)

const TYPES = [
  { key: 'tithes', label: 'Tithes' },
  { key: 'offering', label: 'Offering' }
]

const parsedAmount = computed(() => {
  const value = Number(String(amount.value).replace(/,/g, ''))
  return Number.isFinite(value) ? value : NaN
})

const needsNote = computed(() => reason.value === 'other')

const title = computed(() => {
  if (!shown.value) return ''
  if (mode.value === 'correct') return 'Correct this record'
  if (mode.value === 'void') return 'Void this record?'
  return formatPeso(shown.value.amount)
})

const description = computed(() => {
  if (!shown.value || mode.value !== 'view') return ''
  const who = shown.value.anonymous ? 'Anonymous' : shown.value.name
  return `${shown.value.typeLabel} · ${who} · ${shown.value.dateLabel}`
})

function reasonLabel (value) {
  return COLLECTION_REASONS.find((r) => r.value === value)?.label || value
}

watch(anonymous, (on) => {
  if (!on) return
  memberId.value = ''
  picker.value?.reset()
})

function startCorrect () {
  const l = live.value
  amount.value = l ? String(l.amount) : ''
  type.value = l?.isTithes ? 'tithes' : 'offering'
  anonymous.value = !!l?.anonymous
  memberId.value = l?.anonymous ? '' : (l?.memberId || '')
  date.value = l?.date || ''
  reason.value = ''
  note.value = ''
  errorMessage.value = ''
  mode.value = 'correct'
}

function startVoid () {
  reason.value = ''
  note.value = ''
  errorMessage.value = ''
  mode.value = 'void'
}

watch(() => props.open, (open) => {
  if (!open) return
  mode.value = 'view'
  saving.value = false
  errorMessage.value = ''
})

function validReason () {
  if (!reason.value) { errorMessage.value = 'Choose a reason.'; return false }
  if (needsNote.value && !note.value.trim()) { errorMessage.value = 'Add a note for “Other”.'; return false }
  return true
}

async function submitCorrect () {
  errorMessage.value = ''
  if (!Number.isFinite(parsedAmount.value) || parsedAmount.value <= 0) {
    errorMessage.value = 'Enter an amount greater than zero.'
    return
  }
  if (!anonymous.value && !memberId.value) {
    errorMessage.value = 'Choose a contributor, or tick Anonymous.'
    return
  }
  if (!date.value) { errorMessage.value = 'Choose the service date.'; return }
  if (!validReason()) return

  saving.value = true
  const result = await correctCollection({
    targetId: live.value.id,
    reason: reason.value,
    note: needsNote.value ? note.value.trim() : null,
    replace: true,
    replacement: {
      amount: parsedAmount.value,
      from: anonymous.value ? null : memberId.value,
      isTithes: type.value === 'tithes',
      collectedOn: date.value,
      eventId: live.value.eventId ?? null
    }
  })
  saving.value = false

  if (!result.ok) { errorMessage.value = result.message; return }
  showToast('Record corrected.')
  emit('changed')
}

async function submitVoid () {
  errorMessage.value = ''
  if (!validReason()) return

  saving.value = true
  const result = await correctCollection({
    targetId: live.value.id,
    reason: reason.value,
    note: needsNote.value ? note.value.trim() : null,
    replace: false
  })
  saving.value = false

  if (!result.ok) { errorMessage.value = result.message; return }
  showToast('Record voided.')
  emit('changed')
}
</script>

<template>
  <Modal
    v-if="unit && shown"
    :open="open"
    :title="title"
    :description="description"
    width="sm"
    :layout="mode === 'view' ? 'row' : 'stack'"
    :close-on-outside-click="mode === 'view'"
    @update:open="$emit('update:open', $event)"
  >
    <p
      v-if="errorMessage"
      class="ed__error"
      role="alert"
    >
      {{ errorMessage }}
    </p>

    <!-- VIEW -->
    <template v-if="mode === 'view'">
      <dl class="ed__rows">
        <div class="ed__row">
          <dt>Contributor</dt>
          <dd>
            <span
              v-if="shown.anonymous"
              class="ed__anon"
            >Anonymous</span>
            <template v-else>
              {{ shown.name }}
            </template>
          </dd>
        </div>
        <div class="ed__row">
          <dt>Type</dt>
          <dd>
            <Badge :tone="shown.isTithes ? 'accent' : 'magenta'">
              {{ shown.typeLabel }}
            </Badge>
          </dd>
        </div>
        <div class="ed__row">
          <dt>Service date</dt>
          <dd>{{ shown.dateLabel }}</dd>
        </div>
        <div class="ed__row">
          <dt>Recorded</dt>
          <dd>{{ shown.recordedLabel }}</dd>
        </div>
        <div
          v-if="isVoided"
          class="ed__row"
        >
          <dt>Status</dt>
          <dd>
            <Badge tone="magenta">
              Voided
            </Badge>
          </dd>
        </div>
      </dl>

      <!-- History of corrections, newest step first. -->
      <div
        v-if="unit.history.length"
        class="ed__history"
      >
        <p class="ed__history-title">
          Correction history
        </p>
        <ol class="ed__history-list">
          <li
            v-for="(h, i) in unit.history"
            :key="i"
            class="ed__history-item"
          >
            <span class="ed__history-reason">{{ reasonLabel(h.reversal.reason) }}</span>
            <span class="ed__history-amt">{{ formatPeso(h.step.amount) }}</span>
            <span
              v-if="h.reversal.reasonNote"
              class="ed__history-note"
            >“{{ h.reversal.reasonNote }}”</span>
            <span class="ed__history-when">{{ h.reversal.recordedLabel }}</span>
          </li>
        </ol>
      </div>

      <p
        v-if="!actionable"
        class="ed__locked"
      >
        This record is settled. Corrections stay in the history above; the ledger
        keeps every version.
      </p>
    </template>

    <!-- CORRECT -->
    <template v-else-if="mode === 'correct'">
      <p class="ed__hint">
        This does not edit the original. It reverses it and records the corrected
        figures as a new entry, keeping the full history.
      </p>

      <Input
        v-model="amount"
        label="Amount"
        required
        prefix="₱"
        size="lg"
        type="number"
        min="0.01"
        step="0.01"
        inputmode="decimal"
      />

      <div class="ed__field">
        <MemberAutocomplete
          v-if="!anonymous"
          ref="picker"
          v-model="memberId"
          :members="members"
          input-id="correct-member"
          label="Contributor"
          placeholder="Search a registered member"
        />
        <p
          v-else
          class="ed__anon-hint"
        >
          Recorded without a name.
        </p>
        <label class="ed__check">
          <input
            v-model="anonymous"
            type="checkbox"
          >
          <span>Record as Anonymous instead</span>
        </label>
      </div>

      <div class="ed__field">
        <span class="ed__field-label">Type</span>
        <div
          class="ed__seg"
          role="group"
          aria-label="Contribution type"
        >
          <button
            v-for="t in TYPES"
            :key="t.key"
            type="button"
            class="ed__seg-btn"
            :class="{ 'is-on': type === t.key }"
            :aria-pressed="type === t.key"
            @click="type = t.key"
          >
            {{ t.label }}
          </button>
        </div>
      </div>

      <Input
        v-model="date"
        type="date"
        label="Service date"
        required
      />

      <div class="ed__field">
        <label
          class="ed__field-label"
          for="correct-reason"
        >Reason</label>
        <select
          id="correct-reason"
          v-model="reason"
          class="ed__select"
        >
          <option
            value=""
            disabled
          >
            Choose a reason
          </option>
          <option
            v-for="r in COLLECTION_REASONS"
            :key="r.value"
            :value="r.value"
          >
            {{ r.label }}
          </option>
        </select>
      </div>

      <Input
        v-if="needsNote"
        v-model="note"
        label="Note"
        required
        placeholder="Say what was wrong"
      />
    </template>

    <!-- VOID -->
    <template v-else>
      <p class="ed__hint">
        {{ formatPeso(shown.amount) }} from
        {{ shown.anonymous ? 'an anonymous giver' : shown.name }}, received
        {{ shown.dateLabel }}. Voiding reverses it to zero; the record stays in the
        ledger, struck through.
      </p>

      <div class="ed__field">
        <label
          class="ed__field-label"
          for="void-reason"
        >Reason</label>
        <select
          id="void-reason"
          v-model="reason"
          class="ed__select"
        >
          <option
            value=""
            disabled
          >
            Choose a reason
          </option>
          <option
            v-for="r in COLLECTION_REASONS"
            :key="r.value"
            :value="r.value"
          >
            {{ r.label }}
          </option>
        </select>
      </div>

      <Input
        v-if="needsNote"
        v-model="note"
        label="Note"
        required
        placeholder="Say why"
      />
    </template>

    <template #footer>
      <template v-if="mode === 'view'">
        <Button
          v-if="actionable"
          class="footer-left"
          variant="dangerQuiet"
          @click="startVoid"
        >
          Void
        </Button>
        <Button @click="$emit('update:open', false)">
          Close
        </Button>
        <Button
          v-if="actionable"
          variant="primary"
          @click="startCorrect"
        >
          Correct
        </Button>
      </template>

      <template v-else-if="mode === 'correct'">
        <Button
          :disabled="saving"
          @click="mode = 'view'"
        >
          Back
        </Button>
        <Button
          variant="primary"
          :loading="saving"
          @click="submitCorrect"
        >
          Save correction
        </Button>
      </template>

      <template v-else>
        <Button
          block
          :disabled="saving"
          @click="mode = 'view'"
        >
          Keep record
        </Button>
        <Button
          block
          variant="danger"
          :loading="saving"
          @click="submitVoid"
        >
          Void record
        </Button>
      </template>
    </template>
  </Modal>
</template>

<style scoped>
.ed__error {
  padding: var(--sp-10) var(--sp-12);
  border-radius: var(--r-inset);
  background: var(--magenta-tint);
  border: 1px solid var(--magenta-border);
  font-size: var(--text-body-sm);
  color: var(--magenta-darkest);
}

.ed__rows { display: flex; flex-direction: column; }

.ed__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-12);
  padding: var(--sp-9) 0;
  border-bottom: 1px solid var(--divider);
}
.ed__row:last-child { border-bottom: 0; }

.ed__row dt { font-size: var(--text-body-sm); color: var(--ink-5); }
.ed__row dd { font-size: var(--text-body-sm); font-weight: 700; color: var(--ink); text-align: right; }

.ed__anon { color: var(--ink-4); font-style: italic; font-weight: 600; }

.ed__history {
  margin-top: var(--sp-12);
  padding: var(--sp-10) var(--sp-12);
  border-radius: var(--r-inset);
  background: var(--surface-subtle);
  border: 1px solid var(--border);
}
.ed__history-title { font-size: var(--text-meta-sm); font-weight: 700; color: var(--ink-4); margin-bottom: var(--sp-6); }
.ed__history-list { display: flex; flex-direction: column; gap: var(--sp-6); margin: 0; padding: 0; list-style: none; }
.ed__history-item { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--sp-6); font-size: var(--text-meta); color: var(--ink-5); }
.ed__history-reason { font-weight: 700; color: var(--ink-3); }
.ed__history-amt { font-variant-numeric: tabular-nums; }
.ed__history-note { font-style: italic; }
.ed__history-when { margin-left: auto; color: var(--ink-6, var(--ink-5)); }

.ed__locked {
  margin-top: var(--sp-10);
  padding: var(--sp-10) var(--sp-12);
  border-radius: var(--r-inset);
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  font-size: var(--text-meta);
  color: var(--ink-5);
  line-height: 1.5;
}

.ed__hint {
  padding: var(--sp-10) var(--sp-12);
  border-radius: var(--r-inset);
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  font-size: var(--text-meta);
  color: var(--ink-4);
  line-height: 1.5;
}

.ed__field { display: flex; flex-direction: column; gap: var(--sp-8); min-width: 0; }
.ed__field-label { font-size: var(--text-field); font-weight: 700; color: var(--ink-3); }

.ed__anon-hint {
  padding: var(--sp-10) var(--sp-12);
  border-radius: var(--r-inset);
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  font-size: var(--text-body-sm);
  color: var(--ink-4);
}

.ed__check { display: flex; align-items: center; gap: var(--sp-8); font-size: var(--text-body-sm); color: var(--ink-4); cursor: pointer; }
.ed__check input { width: 15px; height: 15px; accent-color: var(--accent); cursor: pointer; }

.ed__select {
  padding: var(--sp-10) var(--sp-12);
  border: 1px solid var(--border-strong);
  border-radius: var(--r-control);
  background: var(--surface);
  font-family: var(--font-sans);
  font-size: var(--text-body-sm);
  color: var(--ink);
  cursor: pointer;
}
.ed__select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.ed__seg { display: flex; gap: 2px; padding: 3px; border-radius: var(--r-control); background: var(--divider); }
.ed__seg-btn {
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
.ed__seg-btn.is-on { background: var(--surface); color: var(--accent-darkest); font-weight: 800; box-shadow: 0 1px 3px rgba(16, 24, 40, .1); }
.ed__seg-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>

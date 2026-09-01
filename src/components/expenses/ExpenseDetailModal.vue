<script setup>
import { computed, ref, watch } from 'vue'
import Modal from '../ui/Modal.vue'
import Button from '../ui/Button.vue'
import Input from '../ui/Input.vue'
import Badge from '../ui/Badge.vue'
import { correctExpense, EXPENSE_REASONS } from '../../lib/data/finance'
import { formatPeso } from '../../utils/money'
import { showToast } from '../../composables/useToast'

// One recorded expense and the corrections on it. Append-only (0039): "Correct"
// reverses the live entry and records the corrected figures as a new row; "Void"
// reverses it alone. The correct_expense RPC derives the reversal server-side.

const props = defineProps({
  open: { type: Boolean, default: false },
  // A unit from buildUnits: { live, original, voided, corrected, history }.
  unit: { type: Object, default: null }
})

const emit = defineEmits(['update:open', 'changed'])

const mode = ref('view')
const saving = ref(false)
const errorMessage = ref('')

const amount = ref('')
const description = ref('')
const spentOn = ref('')
const notes = ref('')
const reason = ref('')
const note = ref('')

const live = computed(() => props.unit?.live || props.unit?.original || null)
const shown = computed(() => props.unit?.live || props.unit?.original || null)
const isVoided = computed(() => !!props.unit?.voided)
const actionable = computed(() => !!props.unit?.live && !isVoided.value)

const parsedAmount = computed(() => {
  const value = Number(String(amount.value).replace(/,/g, ''))
  return Number.isFinite(value) ? value : NaN
})
const needsNote = computed(() => reason.value === 'other')

const title = computed(() => {
  if (!shown.value) return ''
  if (mode.value === 'correct') return 'Correct this expense'
  if (mode.value === 'void') return 'Void this expense?'
  return formatPeso(shown.value.amount)
})

const viewDescription = computed(() => {
  if (!shown.value || mode.value !== 'view') return ''
  return `${shown.value.description} · ${shown.value.dateLabel}`
})

function reasonLabel (value) {
  return EXPENSE_REASONS.find((r) => r.value === value)?.label || value
}

function startCorrect () {
  const l = live.value
  amount.value = l ? String(l.amount) : ''
  description.value = l?.description || ''
  spentOn.value = l?.spentOn || ''
  notes.value = l?.notes || ''
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
  if (!description.value.trim()) { errorMessage.value = 'Enter a description.'; return }
  if (!spentOn.value) { errorMessage.value = 'Choose the date.'; return }
  if (!validReason()) return

  saving.value = true
  const result = await correctExpense({
    targetId: live.value.id,
    reason: reason.value,
    note: needsNote.value ? note.value.trim() : null,
    replace: true,
    replacement: {
      amount: parsedAmount.value,
      description: description.value.trim(),
      spentOn: spentOn.value,
      notes: notes.value.trim() || null
    }
  })
  saving.value = false

  if (!result.ok) { errorMessage.value = result.message; return }
  showToast('Expense corrected.')
  emit('changed')
}

async function submitVoid () {
  errorMessage.value = ''
  if (!validReason()) return

  saving.value = true
  const result = await correctExpense({
    targetId: live.value.id,
    reason: reason.value,
    note: needsNote.value ? note.value.trim() : null,
    replace: false
  })
  saving.value = false

  if (!result.ok) { errorMessage.value = result.message; return }
  showToast('Expense voided.')
  emit('changed')
}
</script>

<template>
  <Modal
    v-if="unit && shown"
    :open="open"
    :title="title"
    :description="viewDescription"
    width="sm"
    :layout="mode === 'view' ? 'row' : 'stack'"
    :close-on-outside-click="mode === 'view'"
    @update:open="$emit('update:open', $event)"
  >
    <p
      v-if="errorMessage"
      class="ex-ed__error"
      role="alert"
    >
      {{ errorMessage }}
    </p>

    <!-- VIEW -->
    <template v-if="mode === 'view'">
      <dl class="ex-ed__rows">
        <div class="ex-ed__row">
          <dt>Description</dt>
          <dd>{{ shown.description }}</dd>
        </div>
        <div class="ex-ed__row">
          <dt>Date</dt>
          <dd>{{ shown.dateLabel }}</dd>
        </div>
        <div
          v-if="shown.notes"
          class="ex-ed__row"
        >
          <dt>Notes</dt>
          <dd>{{ shown.notes }}</dd>
        </div>
        <div class="ex-ed__row">
          <dt>Recorded</dt>
          <dd>{{ shown.recordedLabel }}</dd>
        </div>
        <div
          v-if="isVoided"
          class="ex-ed__row"
        >
          <dt>Status</dt>
          <dd>
            <Badge tone="magenta">
              Voided
            </Badge>
          </dd>
        </div>
      </dl>

      <div
        v-if="unit.history.length"
        class="ex-ed__history"
      >
        <p class="ex-ed__history-title">
          Correction history
        </p>
        <ol class="ex-ed__history-list">
          <li
            v-for="(h, i) in unit.history"
            :key="i"
            class="ex-ed__history-item"
          >
            <span class="ex-ed__history-reason">{{ reasonLabel(h.reversal.reason) }}</span>
            <span class="ex-ed__history-amt">{{ formatPeso(h.step.amount) }}</span>
            <span
              v-if="h.reversal.reasonNote"
              class="ex-ed__history-note"
            >“{{ h.reversal.reasonNote }}”</span>
            <span class="ex-ed__history-when">{{ h.reversal.recordedLabel }}</span>
          </li>
        </ol>
      </div>

      <p
        v-if="!actionable"
        class="ex-ed__locked"
      >
        This expense is settled. Corrections stay in the history above; the ledger
        keeps every version.
      </p>
    </template>

    <!-- CORRECT -->
    <template v-else-if="mode === 'correct'">
      <p class="ex-ed__hint">
        This does not edit the original. It reverses it and records the corrected
        figures as a new entry, keeping the full history.
      </p>

      <Input
        v-model="description"
        label="Description"
        required
      />
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
      <Input
        v-model="spentOn"
        type="date"
        label="Date"
        required
      />
      <Input
        v-model="notes"
        label="Notes"
        placeholder="Optional"
      />

      <div class="ex-ed__field">
        <label
          class="ex-ed__field-label"
          for="ex-correct-reason"
        >Reason</label>
        <select
          id="ex-correct-reason"
          v-model="reason"
          class="ex-ed__select"
        >
          <option
            value=""
            disabled
          >
            Choose a reason
          </option>
          <option
            v-for="r in EXPENSE_REASONS"
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
      <p class="ex-ed__hint">
        {{ formatPeso(shown.amount) }} · {{ shown.description }}, {{ shown.dateLabel }}.
        Voiding reverses it to zero; the record stays in the ledger, struck through.
      </p>

      <div class="ex-ed__field">
        <label
          class="ex-ed__field-label"
          for="ex-void-reason"
        >Reason</label>
        <select
          id="ex-void-reason"
          v-model="reason"
          class="ex-ed__select"
        >
          <option
            value=""
            disabled
          >
            Choose a reason
          </option>
          <option
            v-for="r in EXPENSE_REASONS"
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
          Keep expense
        </Button>
        <Button
          block
          variant="danger"
          :loading="saving"
          @click="submitVoid"
        >
          Void expense
        </Button>
      </template>
    </template>
  </Modal>
</template>

<style scoped>
.ex-ed__error {
  padding: var(--sp-10) var(--sp-12);
  border-radius: var(--r-inset);
  background: var(--magenta-tint);
  border: 1px solid var(--magenta-border);
  font-size: var(--text-body-sm);
  color: var(--magenta-darkest);
}

.ex-ed__rows { display: flex; flex-direction: column; }
.ex-ed__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-12);
  padding: var(--sp-9) 0;
  border-bottom: 1px solid var(--divider);
}
.ex-ed__row:last-child { border-bottom: 0; }
.ex-ed__row dt { font-size: var(--text-body-sm); color: var(--ink-5); }
.ex-ed__row dd { font-size: var(--text-body-sm); font-weight: 700; color: var(--ink); text-align: right; }

.ex-ed__history {
  margin-top: var(--sp-12);
  padding: var(--sp-10) var(--sp-12);
  border-radius: var(--r-inset);
  background: var(--surface-subtle);
  border: 1px solid var(--border);
}
.ex-ed__history-title { font-size: var(--text-meta-sm); font-weight: 700; color: var(--ink-4); margin-bottom: var(--sp-6); }
.ex-ed__history-list { display: flex; flex-direction: column; gap: var(--sp-6); margin: 0; padding: 0; list-style: none; }
.ex-ed__history-item { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--sp-6); font-size: var(--text-meta); color: var(--ink-5); }
.ex-ed__history-reason { font-weight: 700; color: var(--ink-3); }
.ex-ed__history-amt { font-variant-numeric: tabular-nums; }
.ex-ed__history-note { font-style: italic; }
.ex-ed__history-when { margin-left: auto; }

.ex-ed__locked,
.ex-ed__hint {
  margin-top: var(--sp-10);
  padding: var(--sp-10) var(--sp-12);
  border-radius: var(--r-inset);
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  font-size: var(--text-meta);
  color: var(--ink-4);
  line-height: 1.5;
}
.ex-ed__hint { margin-top: 0; }

.ex-ed__field { display: flex; flex-direction: column; gap: var(--sp-8); min-width: 0; }
.ex-ed__field-label { font-size: var(--text-field); font-weight: 700; color: var(--ink-3); }

.ex-ed__select {
  padding: var(--sp-10) var(--sp-12);
  border: 1px solid var(--border-strong);
  border-radius: var(--r-control);
  background: var(--surface);
  font-family: var(--font-sans);
  font-size: var(--text-body-sm);
  color: var(--ink);
  cursor: pointer;
}
.ex-ed__select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>

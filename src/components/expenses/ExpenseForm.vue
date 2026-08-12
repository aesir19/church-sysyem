<script setup>
import { computed, ref } from 'vue'
import Input from '../ui/Input.vue'
import Button from '../ui/Button.vue'
import { supabase } from '../../lib/supabase'
import { write } from '../../lib/data/write'
import { showToast } from '../../composables/useToast'

// The "Record expense" card — the mockup's left column, and this screen's only
// write.
//
// A CARD, NOT DIALOG 09. Same reasoning as Collections: the handoff draws both
// an inline card and a dialog with the same fields, and bills are entered in a
// sitting. Dialog 09 also carries "Attach the receipt", which needs Supabase
// Storage — a bucket, its own RLS, and an egress line item. That is a feature,
// not a restyle, so it goes to future planning (rule 1, and the scope rule).
//
// THE DESCRIPTION IS FREE TEXT WITH CHIPS, not the old <select> plus a
// conditional "New description" input. Same two jobs — reuse last month's
// wording, or type something new — in one control, and no '__new__' sentinel
// that has to be translated back into a string before saving.

const EXPENSE_COLUMNS = 'id, spent_on, description, amount, notes, created_at'

const props = defineProps({
  churchId: { type: String, default: '' },
  createdBy: { type: String, default: '' },
  // Descriptions already used by this church, most-used first. Sourced by the
  // view from a wider window than the visible month — a fresh month starts
  // empty, which is exactly when the reminder of last month's wording matters.
  recentDescriptions: { type: Array, default: () => [] }
})

const emit = defineEmits(['saved'])

function today () {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  // Built from local parts, not toISOString(): that is UTC, and it names
  // yesterday for the first eight hours of every Manila day (D8).
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

const spentOn = ref(today())
const amount = ref('')
const description = ref('')
const notes = ref('')
const saving = ref(false)
const submitted = ref(false)
const errorMessage = ref('')

// Held as a string and parsed once. A number input bound with .number gives
// NaN for a half-typed value, and NaN fails every `> 0` test silently.
const parsedAmount = computed(() => {
  const value = Number(String(amount.value).replace(/,/g, ''))
  return Number.isFinite(value) ? value : NaN
})

const trimmedDescription = computed(() => description.value.trim())

// Field-level errors stay on their field; anything else goes to the panel at
// the top of the card. An error about the date printed under the amount sends
// the eye to the wrong control.
const amountError = computed(() => {
  if (!submitted.value) return ''
  if (Number.isFinite(parsedAmount.value) && parsedAmount.value > 0) return ''
  return 'Enter an amount greater than zero.'
})

const descriptionError = computed(() => {
  if (!submitted.value || trimmedDescription.value) return ''
  return 'Give the expense a description.'
})

function useDescription (label) {
  // A second tap on the active chip clears it, so a chip picked by mistake does
  // not have to be deleted character by character.
  description.value = trimmedDescription.value === label ? '' : label
}

function isActive (label) {
  return trimmedDescription.value.toLowerCase() === label.toLowerCase()
}

async function submit () {
  errorMessage.value = ''
  submitted.value = true

  if (!props.churchId) {
    errorMessage.value = 'Cannot determine your church. Please reload.'
    return
  }
  if (!spentOn.value) {
    errorMessage.value = 'Choose the date this was spent.'
    return
  }
  // Both messages are on their fields; these only stop the write.
  if (!Number.isFinite(parsedAmount.value) || parsedAmount.value <= 0) return
  if (!trimmedDescription.value) return

  saving.value = true
  const result = await write(
    supabase.from('expenses').insert({
      from_church: props.churchId,
      spent_on: spentOn.value,
      description: trimmedDescription.value,
      amount: parsedAmount.value,
      notes: notes.value.trim() || null,
      created_by: props.createdBy || null
    }),
    {
      columns: EXPENSE_COLUMNS,
      messages: { blocked: 'That expense could not be saved. It may belong to another church.' }
    }
  )
  saving.value = false

  if (!result.ok) {
    errorMessage.value = result.message
    showToast('Could not save the expense.', 'error')
    return
  }

  emit('saved', result.rows[0])

  // The date stays put; the amount, description and notes clear. Several bills
  // are typically entered from one day's paperwork, and re-picking the date
  // each time is the entry job's whole cost.
  amount.value = ''
  description.value = ''
  notes.value = ''
  submitted.value = false
  showToast('Expense recorded.')
}
</script>

<template>
  <!-- novalidate, deliberately. The fields keep `required` — it is what tells a
       screen reader the field is mandatory, and what draws the asterisk — but
       the browser's own validation would otherwise swallow the submit event and
       replace the mockup's error state (1.5px magenta border, icon, message)
       with an unstyled OS bubble that vanishes on the next click. The checks in
       submit() are the same checks; this just lets us draw them. -->
  <form
    class="ef"
    novalidate
    @submit.prevent="submit"
  >
    <div class="ef__head">
      <h2 class="ef__title">
        Record expense
      </h2>
      <p class="ef__note">
        Descriptions are reused so the report stays tidy
      </p>
    </div>

    <p
      v-if="errorMessage"
      class="ef__error"
      role="alert"
    >
      {{ errorMessage }}
    </p>

    <Input
      v-model="spentOn"
      type="date"
      label="Date spent"
      required
    />

    <!-- The wrapper is load-bearing. ui/Input sets inheritAttrs: false and binds
         $attrs to the inner <input>, so a class written on <Input> lands on the
         control itself — where `.ef__amount :deep(.field__box)` can never reach
         the box. Styling a field from outside has to hang off an element we
         own. -->
    <div class="ef__amount">
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
        placeholder="0.00"
        :error="amountError"
      />
    </div>

    <div class="ef__field">
      <Input
        v-model="description"
        label="Description"
        required
        maxlength="120"
        placeholder="e.g. Electricity"
        :error="descriptionError"
      />

      <div
        v-if="recentDescriptions.length"
        class="ef__chips"
      >
        <button
          v-for="label in recentDescriptions"
          :key="label"
          type="button"
          class="ef__chip"
          :class="{ 'is-on': isActive(label) }"
          :aria-pressed="isActive(label)"
          @click="useDescription(label)"
        >
          {{ label }}
        </button>
      </div>
    </div>

    <Input
      v-model="notes"
      as="textarea"
      label="Notes"
      optional
      maxlength="240"
      :rows="2"
      placeholder="e.g. Meralco, July billing"
    />

    <Button
      type="submit"
      variant="primary"
      size="lg"
      block
      :loading="saving"
    >
      Save expense
    </Button>

    <p class="ef__foot">
      Recorded expenses cannot be edited or deleted. Check the amount before saving.
    </p>
  </form>
</template>

<style scoped>
.ef {
  display: flex;
  flex-direction: column;
  gap: var(--sp-16);
  padding: var(--card-pad);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-card);
  box-shadow: var(--shadow-card);
}

.ef__head { display: flex; flex-direction: column; gap: var(--sp-3); }
.ef__title { font-size: var(--text-h2); font-weight: 800; letter-spacing: var(--tracking-h2); color: var(--ink); }
.ef__note { font-size: var(--text-meta); color: var(--ink-5); }

.ef__error {
  padding: var(--sp-10) var(--sp-12);
  border-radius: var(--r-inset);
  background: var(--magenta-tint);
  border: 1px solid var(--magenta-border);
  font-size: var(--text-body-sm);
  color: var(--magenta-darkest);
}

.ef__field { display: flex; flex-direction: column; gap: var(--sp-8); min-width: 0; }

/* Money out is magenta on this screen, the way money in is cyan on Collections.
   The amount is the one figure worth colouring while it is being typed — and at
   17px it is also the only field readable from across a desk.

   :not(.is-error) is doing real work. Both this rule and ui/Input's
   `.is-error .field__box` have the same specificity, so the later-injected one
   wins — which was this one, quietly repainting the invalid field's strong
   magenta border back to the pale resting tint. Excluding the error state here
   settles it by intent rather than by injection order. */
.ef__amount :deep(.field:not(.is-error) .field__box) { border-color: var(--magenta-border); }
.ef__amount :deep(.field__input),
.ef__amount :deep(.field__prefix) {
  font-size: 17px;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--magenta-darkest);
}
.ef__amount :deep(.field__input::placeholder) { font-weight: 600; color: var(--ink-5); }

.ef__chips { display: flex; flex-wrap: wrap; gap: var(--sp-6); }

.ef__chip {
  padding: var(--sp-5) var(--sp-10);
  border: 1px solid var(--border);
  border-radius: var(--r-tag);
  background: var(--surface-subtle);
  font-family: var(--font-sans);
  font-size: var(--text-meta-sm);
  font-weight: 600;
  color: var(--ink-4);
  cursor: pointer;
  transition: background-color var(--dur-state) ease, border-color var(--dur-state) ease, color var(--dur-state) ease;
}
.ef__chip:hover { border-color: var(--accent-border-hi); color: var(--ink-2); }
/* --accent-darkest, not --accent-deep: the latter stays a mid cyan in the dark
   theme and disappears into the tint it sits on. */
.ef__chip.is-on {
  background: var(--accent-tint);
  border-color: var(--accent-border-hi);
  color: var(--accent-darkest);
  font-weight: 700;
}
.ef__chip:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.ef__foot { font-size: var(--text-field); color: var(--ink-5); line-height: 1.5; }
</style>

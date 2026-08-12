<script setup>
import { computed, ref, watch } from 'vue'
import Input from '../ui/Input.vue'
import Button from '../ui/Button.vue'
import MemberAutocomplete from '../MemberAutocomplete.vue'
import { supabase } from '../../lib/supabase'
import { write } from '../../lib/data/write'
import { buildCollectionPayload } from '../../utils/collectionPayload'
import {
  getDefaultServiceDate,
  formatServiceDateShort,
  recentServiceDates
} from '../../utils/collectionsDate'
import { showToast } from '../../composables/useToast'

// The "New contribution" card — the mockup's left column, and the screen's
// only write.
//
// A CARD, NOT A DIALOG. The mockups draw both: this inline card on the
// Collections screen, and dialog 08 with the same fields. The card is the one
// built, because entering a service's giving is a sitting-down job of twenty
// entries in a row, and a dialog that has to be reopened for each one is
// twenty extra clicks. The dialog's job — recording one entry from somewhere
// else in the app — has no other entry point today.

const COLLECTION_SELECT =
  'id, from, amount, is_tithes, collectedOn, created_at, members!collections_from_fkey(first_name, middle_name, last_name)'

const props = defineProps({
  churchId: { type: String, default: '' },
  // The roll, fetched once by the view through directory_search. A Finance
  // ministry member cannot read `members` under RLS (0015), which is why it is
  // the directory RPC and not a table select.
  members: { type: Array, default: () => [] }
})

const emit = defineEmits(['saved'])

const date = ref(getDefaultServiceDate())
const amount = ref('')
const memberId = ref('')
const anonymous = ref(false)
const type = ref('tithes')
const saving = ref(false)
const submitted = ref(false)
const errorMessage = ref('')
const picker = ref(null)

// Computed once per mount rather than per render: it reads the clock, and a
// value that changes underneath a render is how a pill stops matching what was
// clicked.
const pills = recentServiceDates({ count: 4 })

const TYPES = [
  { key: 'tithes', label: 'Tithes' },
  { key: 'offering', label: 'Offering' }
]

// The amount is held as a STRING and parsed once here. A number input bound
// with .number gives NaN for a half-typed value, and NaN silently fails every
// `> 0` test it is put through — including the one guarding the insert.
const parsedAmount = computed(() => {
  const value = Number(String(amount.value).replace(/,/g, ''))
  return Number.isFinite(value) ? value : NaN
})

// The amount gets its own inline error; everything else goes to the panel at
// the top of the card. Splitting them is the point — an error about the giver
// printed under the amount field sends the eye to the wrong control.
const amountError = computed(() => {
  if (!submitted.value) return ''
  if (Number.isFinite(parsedAmount.value) && parsedAmount.value > 0) return ''
  return 'Enter an amount greater than zero.'
})

// Anonymous and a named giver are mutually exclusive, so ticking the box
// releases the picker rather than leaving a selection that will not be sent.
watch(anonymous, (on) => {
  if (!on) return
  memberId.value = ''
  picker.value?.reset()
})

function pickDate (value) {
  date.value = value
}

async function submit () {
  errorMessage.value = ''
  submitted.value = true

  if (!props.churchId) {
    errorMessage.value = 'Cannot determine your church. Please reload.'
    return
  }
  if (!date.value) {
    errorMessage.value = 'Choose the service date this was received on.'
    return
  }
  // The message is on the field itself; this only stops the write.
  if (!Number.isFinite(parsedAmount.value) || parsedAmount.value <= 0) return
  if (!anonymous.value && !memberId.value) {
    errorMessage.value = 'Choose a contributor, or tick Anonymous.'
    return
  }

  saving.value = true
  const result = await write(
    supabase.from('collections').insert(
      buildCollectionPayload(
        {
          memberId: anonymous.value ? '' : memberId.value,
          amount: parsedAmount.value,
          type: type.value,
          date: date.value
        },
        props.churchId
      )
    ),
    {
      columns: COLLECTION_SELECT,
      messages: { blocked: 'That contribution could not be saved. It may belong to another church.' }
    }
  )
  saving.value = false

  if (!result.ok) {
    errorMessage.value = result.message
    showToast('Could not save the contribution.', 'error')
    return
  }

  emit('saved', result.rows[0])

  // The date and the type stay put; the giver and the amount clear. Twenty
  // entries from one service share a date and mostly share a type, and
  // re-picking both each time is the entry job's whole cost.
  amount.value = ''
  memberId.value = ''
  anonymous.value = false
  submitted.value = false
  picker.value?.reset()
  showToast('Contribution recorded.')
}
</script>

<template>
  <!-- novalidate: the fields keep `required` for the asterisk and for screen
       readers, but native validation would swallow the submit event and replace
       the mockup's error state with an unstyled OS bubble. submit() runs the
       same checks and can draw them. -->
  <form
    class="cf"
    novalidate
    @submit.prevent="submit"
  >
    <div class="cf__head">
      <h2 class="cf__title">
        New contribution
      </h2>
      <p class="cf__note">
        Saves against the selected service date
      </p>
    </div>

    <p
      v-if="errorMessage"
      class="cf__error"
      role="alert"
    >
      {{ errorMessage }}
    </p>

    <fieldset class="cf__field">
      <legend class="cf__label">
        Service date
      </legend>
      <div class="cf__pills">
        <button
          v-for="p in pills"
          :key="p"
          type="button"
          class="cf__pill"
          :class="{ 'is-on': date === p }"
          :aria-pressed="date === p"
          @click="pickDate(p)"
        >
          {{ formatServiceDateShort(p) }}
        </button>
      </div>
      <!-- The pills are a shortcut, not a constraint: money is occasionally
           received on a day that is neither.

           The wrapper is load-bearing: ui/Input sets inheritAttrs: false and
           binds $attrs to the inner <input>, so a class written on <Input>
           lands on the control and never reaches .field__label from outside. -->
      <div class="cf__date">
        <Input
          v-model="date"
          type="date"
          label="Another date"
        />
      </div>
    </fieldset>

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

    <div class="cf__field">
      <MemberAutocomplete
        v-if="!anonymous"
        ref="picker"
        v-model="memberId"
        :members="members"
        input-id="contribution-member"
        label="Contributor"
        placeholder="Search a registered member"
      />
      <p
        v-else
        class="cf__anon"
      >
        Recorded without a name. The amount still counts towards the month.
      </p>

      <label class="cf__check">
        <input
          v-model="anonymous"
          type="checkbox"
        >
        <span>Record as Anonymous instead</span>
      </label>
    </div>

    <div class="cf__field">
      <span class="cf__label">Type</span>
      <div
        class="cf__seg"
        role="group"
        aria-label="Contribution type"
      >
        <button
          v-for="t in TYPES"
          :key="t.key"
          type="button"
          class="cf__seg-btn"
          :class="{ 'is-on': type === t.key }"
          :aria-pressed="type === t.key"
          @click="type = t.key"
        >
          {{ t.label }}
        </button>
      </div>
    </div>

    <Button
      type="submit"
      variant="primary"
      size="lg"
      block
      :loading="saving"
    >
      Save contribution
    </Button>

    <p class="cf__foot">
      Only the Finance role can save here. Pastors see the totals, not this form.
    </p>
  </form>
</template>

<style scoped>
.cf {
  display: flex;
  flex-direction: column;
  gap: var(--sp-16);
  padding: var(--card-pad);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-card);
  box-shadow: var(--shadow-card);
}

.cf__head { display: flex; flex-direction: column; gap: var(--sp-3); }
.cf__title { font-size: var(--text-h2); font-weight: 800; letter-spacing: var(--tracking-h2); color: var(--ink); }
.cf__note { font-size: var(--text-meta); color: var(--ink-5); }

.cf__error {
  padding: var(--sp-10) var(--sp-12);
  border-radius: var(--r-inset);
  background: var(--magenta-tint);
  border: 1px solid var(--magenta-border);
  font-size: var(--text-body-sm);
  color: var(--magenta-darkest);
}

.cf__field { display: flex; flex-direction: column; gap: var(--sp-8); border: 0; min-width: 0; }

.cf__label {
  font-size: var(--text-field);
  font-weight: 700;
  color: var(--ink-3);
  padding: 0;
}

.cf__pills { display: flex; flex-wrap: wrap; gap: var(--sp-6); }

.cf__pill {
  padding: var(--sp-7) var(--sp-12);
  border: 1px solid var(--border-strong);
  border-radius: var(--r-tag);
  background: var(--surface);
  font-family: var(--font-sans);
  font-size: var(--text-meta);
  font-weight: 700;
  color: var(--ink-2);
  cursor: pointer;
  transition: background-color var(--dur-state) ease, border-color var(--dur-state) ease, color var(--dur-state) ease;
}
.cf__pill:hover { border-color: var(--accent-border-hi); }
.cf__pill.is-on { background: var(--accent-tint); border-color: var(--accent-border-hi); color: var(--accent-darkest); }
.cf__pill:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

/* The escape hatch sits under the pills and reads as secondary to them. */
.cf__date :deep(.field__label) { color: var(--ink-5); font-weight: 500; }

.cf__anon {
  padding: var(--sp-10) var(--sp-12);
  border-radius: var(--r-inset);
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  font-size: var(--text-body-sm);
  color: var(--ink-4);
}

.cf__check { display: flex; align-items: center; gap: var(--sp-8); font-size: var(--text-body-sm); color: var(--ink-4); cursor: pointer; }
.cf__check input { width: 15px; height: 15px; accent-color: var(--accent); cursor: pointer; }

.cf__seg { display: flex; gap: 2px; padding: 3px; border-radius: var(--r-control); background: var(--divider); }

.cf__seg-btn {
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
/* --accent-darkest, not --accent-deep. Both read as "the accent, darker", but
   --accent-deep stays a mid cyan (#0e6480) in the dark theme and lands on the
   dark surface as blue-on-black; --accent-darkest inverts with the theme
   (#004961 light, #a8e6ff dark) and is legible on either. */
.cf__seg-btn.is-on {
  background: var(--surface);
  color: var(--accent-darkest);
  font-weight: 800;
  box-shadow: 0 1px 3px rgba(16, 24, 40, .1);
}
.cf__seg-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.cf__foot { font-size: var(--text-field); color: var(--ink-5); line-height: 1.5; }
</style>

<script setup>
import { computed, ref, watch } from 'vue'
import Modal from '../ui/Modal.vue'
import Button from '../ui/Button.vue'
import Input from '../ui/Input.vue'
import Badge from '../ui/Badge.vue'
import { supabase } from '../../lib/supabase'
import { write } from '../../lib/data/write'
import { isWithinEditWindow } from '../../utils/collectionsDate'
import { formatPeso } from '../../utils/money'
import { showToast } from '../../composables/useToast'

// One recorded contribution: what it was, and — for three hours — the two
// corrections allowed on it.
//
// THE THREE-HOUR WINDOW IS THE DATABASE'S RULE, not this dialog's. RLS
// (0008_funds_write_policies) enforces it by FILTERING the row out of the
// UPDATE or DELETE, which PostgREST reports as success with zero rows changed.
// So there are two guards and they do different jobs: isWithinEditWindow
// decides whether to offer the buttons, and `write` catches the refusal when a
// tab has been open past the boundary and the offer was stale.

const props = defineProps({
  open: { type: Boolean, default: false },
  entry: { type: Object, default: null }
})

const emit = defineEmits(['update:open', 'updated', 'deleted'])

const LOCKED_MESSAGE =
  'This entry is locked. Entries can only be changed within 3 hours of being recorded.'

const mode = ref('view')
const amount = ref('')
const saving = ref(false)
const errorMessage = ref('')

const editable = computed(() =>
  !!props.entry?.createdAt && isWithinEditWindow(props.entry.createdAt)
)

const parsedAmount = computed(() => {
  const value = Number(String(amount.value).replace(/,/g, ''))
  return Number.isFinite(value) ? value : NaN
})

const title = computed(() => (props.entry ? formatPeso(props.entry.amount) : ''))

const description = computed(() => {
  if (!props.entry) return ''
  const who = props.entry.anonymous ? 'Anonymous' : props.entry.name
  return `${props.entry.typeLabel} · ${who} · ${props.entry.dateLabel}`
})

watch(() => props.open, (open) => {
  if (!open) return
  mode.value = 'view'
  amount.value = props.entry ? String(props.entry.amount) : ''
  saving.value = false
  errorMessage.value = ''
})

async function saveAmount () {
  errorMessage.value = ''
  if (!Number.isFinite(parsedAmount.value) || parsedAmount.value <= 0) {
    errorMessage.value = 'Enter an amount greater than zero.'
    return
  }

  saving.value = true
  const result = await write(
    supabase.from('collections').update({ amount: parsedAmount.value }).eq('id', props.entry.id),
    { columns: 'id, amount', messages: { blocked: LOCKED_MESSAGE } }
  )
  saving.value = false

  if (!result.ok) {
    errorMessage.value = result.message
    return
  }

  emit('updated', { id: props.entry.id, amount: parsedAmount.value })
  emit('update:open', false)
  showToast('Amount corrected.')
}

async function remove () {
  saving.value = true
  const result = await write(
    supabase.from('collections').delete().eq('id', props.entry.id),
    { columns: 'id', messages: { blocked: LOCKED_MESSAGE } }
  )
  saving.value = false

  if (!result.ok) {
    errorMessage.value = result.message
    return
  }

  emit('deleted', props.entry.id)
  emit('update:open', false)
  showToast('Entry deleted.')
}
</script>

<template>
  <Modal
    v-if="entry"
    :open="open"
    :title="mode === 'delete' ? 'Delete this entry?' : title"
    :description="mode === 'delete'
      ? `${title} from ${entry.anonymous ? 'an anonymous giver' : entry.name}, received ${entry.dateLabel}. Deleting it changes the month’s totals and cannot be undone.`
      : description"
    width="sm"
    :layout="mode === 'delete' ? 'stack' : 'row'"
    :icon="mode === 'delete' ? 'archive' : ''"
    icon-tone="magenta"
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

    <template v-if="mode === 'view'">
      <dl class="ed__rows">
        <div class="ed__row">
          <dt>Contributor</dt>
          <dd>
            <template v-if="entry.anonymous">
              <span class="ed__anon">Anonymous</span>
            </template>
            <template v-else>
              {{ entry.name }}
            </template>
          </dd>
        </div>
        <div class="ed__row">
          <dt>Type</dt>
          <dd>
            <Badge :tone="entry.isTithes ? 'accent' : 'magenta'">
              {{ entry.typeLabel }}
            </Badge>
          </dd>
        </div>
        <div class="ed__row">
          <dt>Service date</dt>
          <dd>{{ entry.dateLabel }}</dd>
        </div>
        <div class="ed__row">
          <dt>Recorded</dt>
          <dd>{{ entry.recordedLabel }}</dd>
        </div>
      </dl>

      <p
        v-if="!editable"
        class="ed__locked"
      >
        Locked. Entries can be corrected for three hours after they are
        recorded; after that the month's record stands.
      </p>
    </template>

    <Input
      v-else-if="mode === 'edit'"
      v-model="amount"
      label="Amount"
      required
      prefix="₱"
      size="amount"
      type="number"
      min="0.01"
      step="0.01"
      inputmode="decimal"
    />

    <template #footer>
      <template v-if="mode === 'view'">
        <Button
          v-if="editable"
          class="footer-left"
          variant="dangerQuiet"
          @click="mode = 'delete'"
        >
          Delete
        </Button>
        <Button @click="$emit('update:open', false)">
          Close
        </Button>
        <Button
          v-if="editable"
          variant="primary"
          @click="mode = 'edit'"
        >
          Correct amount
        </Button>
      </template>

      <template v-else-if="mode === 'edit'">
        <Button
          :disabled="saving"
          @click="mode = 'view'"
        >
          Back
        </Button>
        <Button
          variant="primary"
          :loading="saving"
          @click="saveAmount"
        >
          Save amount
        </Button>
      </template>

      <template v-else>
        <Button
          block
          :disabled="saving"
          @click="mode = 'view'"
        >
          Keep entry
        </Button>
        <Button
          block
          variant="danger"
          :loading="saving"
          @click="remove"
        >
          Delete entry
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

.ed__locked {
  padding: var(--sp-10) var(--sp-12);
  border-radius: var(--r-inset);
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  font-size: var(--text-meta);
  color: var(--ink-5);
  line-height: 1.5;
}
</style>

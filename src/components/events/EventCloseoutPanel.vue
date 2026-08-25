<script setup>
// Post-event closeout (frame 7o). Spec #87, the second rule-3 surface: the write boundary
// shown as an interface. Appears once the event has happened. Events Team may record THIS
// event's attendance and expense; the collection is Finance-owned and shows as a total only
// (never who gave, story 33) and never blocks closing. Marking "Closed" is the explicit act
// that ends closeout (Q15); until then a passed event is excluded from the closed statistics.

import { ref, computed, onMounted } from 'vue'
import Card from '../ui/Card.vue'
import Button from '../ui/Button.vue'
import Badge from '../ui/Badge.vue'
import Input from '../ui/Input.vue'
import Alert from '../ui/Alert.vue'
import { useToast } from '../../composables/useToast'
import {
  ensureEventService, attendanceCount, listEventExpenses, addEventExpense,
  collectionTotal, saveReview, markClosed, deriveCloseout,
} from '../../lib/data/eventCloseout'

const props = defineProps({
  event: { type: Object, required: true },
  canManage: { type: Boolean, default: false },
})
const emit = defineEmits(['updated'])

const { showToast } = useToast()
const loading = ref(true)
const service = ref(null)
const count = ref(0)
const expenses = ref([])
const collTotal = ref(0)
const busy = ref(false)

const expenseDraft = ref({ description: '', amount: '', spentOn: todayYmd() })
const review = ref({
  wentWell: props.event.review_went_well || '',
  wentWrong: props.event.review_went_wrong || '',
  followups: props.event.review_followups || '',
})

const state = computed(() => deriveCloseout({
  event: props.event, attendanceCount: count.value, expenses: expenses.value, collectionTotal: collTotal.value,
}))

async function load() {
  loading.value = true
  const [exp, coll] = await Promise.all([
    listEventExpenses({ eventId: props.event.id }),
    collectionTotal({ eventId: props.event.id }),
  ])
  expenses.value = exp.ok ? exp.expenses : []
  collTotal.value = coll
  if (props.event.attendance_tracked) {
    const svc = await ensureEventService({ event: props.event })
    if (svc.ok) { service.value = svc.rows[0]; count.value = await attendanceCount({ serviceId: service.value.id }) }
  }
  loading.value = false
}
onMounted(load)

async function refreshCount() {
  if (service.value) count.value = await attendanceCount({ serviceId: service.value.id })
}

const expenseValid = computed(() => expenseDraft.value.description.trim() && Number(expenseDraft.value.amount) > 0)
async function doAddExpense() {
  if (!expenseValid.value) return
  busy.value = true
  const res = await addEventExpense({
    event: props.event,
    description: expenseDraft.value.description.trim(),
    amount: Number(expenseDraft.value.amount),
    spentOn: expenseDraft.value.spentOn,
  })
  busy.value = false
  if (!res.ok) { showToast(res.message, 'error'); return }
  expenseDraft.value = { description: '', amount: '', spentOn: todayYmd() }
  const exp = await listEventExpenses({ eventId: props.event.id })
  expenses.value = exp.ok ? exp.expenses : []
}

async function doSaveReview() {
  busy.value = true
  const res = await saveReview(props.event.id, review.value)
  busy.value = false
  if (!res.ok) { showToast(res.message, 'error'); return }
  showToast('Review saved')
  emit('updated')
}

async function doClose(closed) {
  busy.value = true
  const res = await markClosed(props.event.id, closed)
  busy.value = false
  if (!res.ok) { showToast(res.message, 'error'); return }
  showToast(closed ? 'Event closed' : 'Event reopened')
  emit('updated')
}

function todayYmd() { return new Date().toISOString().slice(0, 10) }
function peso(n) { return `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }
</script>

<template>
  <Card>
    <div class="clo__head">
      <h2 class="clo__title">
        Closeout
      </h2>
      <Badge
        v-if="state.closed"
        tone="success"
      >
        Closed
      </Badge>
      <Badge
        v-else
        tone="warning"
      >
        Awaiting closeout
      </Badge>
    </div>
    <p class="clo__muted">
      This event has happened. Record its numbers, then mark it closed. Until it is closed it stays out of the “done” statistics.
    </p>

    <template v-if="!loading">
      <!-- Attendance -->
      <section class="clo__rec">
        <div class="clo__rec-head">
          <span class="clo__rec-name">Attendance</span>
          <Badge :tone="state.records.attendance.open ? 'warning' : 'success'">
            {{ event.attendance_tracked ? (state.records.attendance.open ? 'None yet' : count + ' recorded') : 'Not tracked' }}
          </Badge>
        </div>
        <p
          v-if="event.attendance_tracked"
          class="clo__rec-note"
        >
          Check-in opened 2 hours before and closed 1 hour after the event.
          <button
            class="clo__link"
            @click="refreshCount"
          >
            Refresh count
          </button>
        </p>
        <p
          v-else
          class="clo__rec-note"
        >
          Attendance tracking was off for this event.
        </p>
      </section>

      <!-- Expense (event-scoped; Events Team may add) -->
      <section class="clo__rec">
        <div class="clo__rec-head">
          <span class="clo__rec-name">Expenses</span>
          <Badge :tone="expenses.length ? 'success' : 'neutral'">
            {{ expenses.length ? peso(state.records.expense.total) : 'None' }}
          </Badge>
        </div>
        <ul
          v-if="expenses.length"
          class="clo__lines"
        >
          <li
            v-for="x in expenses"
            :key="x.id"
            class="clo__line"
          >
            <span>{{ x.description }}</span>
            <span class="clo__line-val">{{ peso(x.amount) }}</span>
          </li>
        </ul>
        <div
          v-if="canManage"
          class="clo__addexp"
        >
          <div class="clo__addexp-grid">
            <Input
              v-model="expenseDraft.description"
              label="Expense"
              placeholder="e.g. Sound rental"
            />
            <Input
              v-model="expenseDraft.amount"
              label="Amount"
              type="number"
              prefix="₱"
            />
            <Input
              v-model="expenseDraft.spentOn"
              label="Date"
              type="date"
            />
          </div>
          <Button
            variant="secondary"
            size="sm"
            :loading="busy"
            :disabled="!expenseValid"
            @click="doAddExpense"
          >
            Add expense
          </Button>
        </div>
      </section>

      <!-- Collection (Finance-owned; total only) -->
      <section class="clo__rec">
        <div class="clo__rec-head">
          <span class="clo__rec-name">Collection</span>
          <Badge :tone="collTotal ? 'success' : 'neutral'">
            {{ collTotal ? peso(collTotal) : 'With Finance' }}
          </Badge>
        </div>
        <p class="clo__rec-note">
          Recorded and tagged by Finance. You see the total only — never who gave.
        </p>
      </section>

      <!-- Review (Q16) -->
      <section
        v-if="canManage"
        class="clo__review"
      >
        <h3 class="clo__sub">
          Review
        </h3>
        <label class="clo__field"><span class="clo__label">What went well</span>
          <textarea
            v-model="review.wentWell"
            class="clo__textarea"
            rows="2"
          /></label>
        <label class="clo__field"><span class="clo__label">What went wrong</span>
          <textarea
            v-model="review.wentWrong"
            class="clo__textarea"
            rows="2"
          /></label>
        <label class="clo__field"><span class="clo__label">Follow-ups</span>
          <textarea
            v-model="review.followups"
            class="clo__textarea"
            rows="2"
          /></label>
        <Button
          variant="secondary"
          size="sm"
          :loading="busy"
          @click="doSaveReview"
        >
          Save review
        </Button>
      </section>

      <Alert
        v-if="state.records.attendance.open || state.records.expense.open"
        tone="accent"
      >
        Some records are still open. You can still close the event — the review is prompted, not required.
      </Alert>

      <div
        v-if="canManage"
        class="clo__foot"
      >
        <Button
          v-if="!state.closed"
          variant="primary"
          :loading="busy"
          @click="doClose(true)"
        >
          Mark event closed
        </Button>
        <Button
          v-else
          variant="secondary"
          :loading="busy"
          @click="doClose(false)"
        >
          Reopen event
        </Button>
      </div>
    </template>
  </Card>
</template>

<style scoped>
.clo__head { display: flex; align-items: center; gap: var(--sp-8); margin-bottom: var(--sp-6); }
.clo__title { margin: 0; font-size: var(--text-h3); font-weight: 800; letter-spacing: -0.02em; }
.clo__muted { margin: 0 0 var(--sp-14); font-size: var(--text-body-sm); color: var(--ink-5); line-height: 1.5; }
.clo__rec { padding: var(--sp-12) 0; border-top: 1px solid var(--border-subtle, var(--border)); }
.clo__rec-head { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-8); }
.clo__rec-name { font-size: var(--text-body-sm); font-weight: 700; }
.clo__rec-note { margin: var(--sp-6) 0 0; font-size: var(--text-meta); color: var(--ink-5); }
.clo__link { border: none; background: none; color: var(--accent); font: inherit; font-size: var(--text-meta); font-weight: 700; cursor: pointer; padding: 0 0 0 var(--sp-5); }
.clo__lines { list-style: none; margin: var(--sp-8) 0 0; padding: 0; display: flex; flex-direction: column; gap: var(--sp-6); }
.clo__line { display: flex; justify-content: space-between; gap: var(--sp-10); font-size: var(--text-body-sm); }
.clo__line-val { font-weight: 700; font-variant-numeric: tabular-nums; }
.clo__addexp { margin-top: var(--sp-10); display: flex; flex-direction: column; gap: var(--sp-8); }
.clo__addexp-grid { display: grid; grid-template-columns: 1fr 120px 150px; gap: var(--sp-8); }
.clo__review { padding: var(--sp-12) 0; border-top: 1px solid var(--border-subtle, var(--border)); display: flex; flex-direction: column; gap: var(--sp-8); }
.clo__sub { margin: 0 0 var(--sp-5); font-size: var(--text-body-sm); font-weight: 800; }
.clo__field { display: flex; flex-direction: column; gap: var(--sp-5); }
.clo__label { font-size: var(--text-meta); font-weight: 700; color: var(--ink-3); }
.clo__textarea { padding: 10px 12px; border: 1px solid var(--border-strong); border-radius: var(--r-control); background: var(--surface); font-family: inherit; font-size: var(--text-body-sm); color: var(--ink); resize: vertical; }
.clo__foot { margin-top: var(--sp-14); }
@media (max-width: 620px) { .clo__addexp-grid { grid-template-columns: 1fr; } }
</style>

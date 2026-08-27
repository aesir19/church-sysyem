<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { supabase } from '../lib/supabase'
import ExpenseForm from '../components/expenses/ExpenseForm.vue'
import ExpenseDetailModal from '../components/expenses/ExpenseDetailModal.vue'
import Badge from '../components/ui/Badge.vue'
import { defaultMonthKey, getMonthRange, monthKeyFromDate } from '../utils/expensesMonth'
import { summariseByDescription, largestLine, rankDescriptions } from '../utils/expenseStats'
import { SHARE_OF_TOTAL_FUNDS } from '../utils/collectivesReport'
import { formatPeso, formatPesoWhole, formatShare } from '../utils/money'
import { netSum } from '../utils/financeSign'
import { buildUnits } from '../utils/financeCorrections'
import { useActiveChurch } from '../composables/useActiveChurch'

// Expenses — what the church spent, charged against its share of the month's
// allocation.
//
// Same shape as Collections, deliberately: form left, month right. They are tabs of
// the same Finance workspace and are used by the same person on the same afternoon; a
// treasurer should not have to relearn the screen because the money is going the other
// way. The month stepper and the page title live in FinanceView's shared header now;
// the active month arrives as a `month` v-model prop.
//
// ROW DETAIL + CORRECTIONS (0039). Expenses used to be insert-only, so the rows
// did not open. They are append-only now: a click opens the record, and "Correct"
// or "Void" writes a reversal (+ replacement) through correct_expense — the
// original is never mutated. A reversed/voided record stays in the ledger.

const { activeChurchId, ensureLoaded } = useActiveChurch()

const EXPENSE_COLUMNS =
  'id, spent_on, description, amount, notes, created_at, kind, corrects_id, reason, reason_note'

// How far back the description chips look. Six months of one church's expenses
// is a couple of hundred rows of a single short column — the cheapest way to
// have last month's wording on hand in a month that is still empty.
const CHIP_MONTHS = 6

const props = defineProps({
  // "YYYY-MM". Owned by FinanceView so the whole workspace shares one month.
  month: { type: String, default: () => defaultMonthKey() },
})
const emit = defineEmits(['update:month'])

const month = computed(() => props.month)
const entries = ref([])
const descriptionHistory = ref([])
const collectionsTotal = ref(null)
const currentUserId = ref('')
const loading = ref(true)
const errorMessage = ref('')

const detailOpen = ref(false)
const selected = ref(null)

// Collapse the raw rows into logical records; stats read the live entries so a
// reversed or voided expense neither double-counts nor shows as its own line.
const units = computed(() => buildUnits(entries.value))
const liveEntries = computed(() => units.value.filter((u) => u.live).map((u) => u.live))
const recordCount = computed(() => units.value.length)

const monthLabel = computed(() => {
  const [year, m] = month.value.split('-')
  if (!year || !m) return ''
  return new Date(Number(year), Number(m) - 1, 1)
    .toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })
})

// netSum over raw rows equals the sum of the live entries — reversals subtracted.
const total = computed(() => netSum(entries.value))

const byDescription = computed(() => summariseByDescription(liveEntries.value))

const recentDescriptions = computed(() => rankDescriptions(descriptionHistory.value))

// The church's own share of the month, against which these expenses are drawn:
// 40% of total funds collected. NOMINAL, per the note in collectivesReport —
// the realised share drifts with the student-programme draw, and the tile is
// describing the rule, not one month's rounding.
const churchShare = computed(() =>
  collectionsTotal.value === null ? null : collectionsTotal.value * SHARE_OF_TOTAL_FUNDS.church
)

const top = computed(() => largestLine(liveEntries.value))

const kpis = computed(() => {
  const descriptions = byDescription.value.length
  const share = churchShare.value

  return [
    {
      key: 'spent',
      label: 'Spent this month',
      value: formatPesoWhole(total.value),
      sub: `${recordCount.value} ${recordCount.value === 1 ? 'record' : 'records'} · ${descriptions} ${descriptions === 1 ? 'description' : 'descriptions'}`,
      tone: 'ink'
    },
    {
      key: 'allocation',
      label: 'Against allocation',
      // An em dash, not "0.0%": with nothing collected there is no allocation
      // to be a fraction of, and 0% would read as "nothing has been spent".
      value: share && share > 0 ? formatShare(total.value, share) : '—',
      sub: share && share > 0
        ? `of the ${formatPesoWhole(share)} church share`
        : 'No collections recorded this month',
      // Magenta is the colour of a figure here; a lone magenta em dash reads as
      // an error rather than as "nothing to measure yet".
      tone: share && share > 0 ? 'magenta' : 'ink'
    },
    {
      key: 'largest',
      label: 'Largest line',
      value: top.value ? top.value.description : '—',
      sub: top.value ? `${formatPeso(top.value.amount)} · ${(top.value.share * 100).toFixed(1)}%` : '',
      tone: 'ink',
      text: true
    }
  ]
})

function formatDate (value) {
  if (!value) return ''
  // Explicit local midnight — the bare string parses as UTC and renders the day
  // before for the first eight hours of every Manila day (D8).
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric'
  })
}

function formatStamp (value) {
  if (!value) return ''
  return new Date(value).toLocaleString('en-PH', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  })
}

function normalise (row) {
  return {
    id: row.id,
    spentOn: row.spent_on,
    dateLabel: formatDate(row.spent_on),
    description: row.description,
    amount: Number(row.amount || 0),
    notes: row.notes || '',
    createdAt: row.created_at,
    recordedLabel: formatStamp(row.created_at),
    // Append-only correction fields (0039).
    kind: row.kind ?? 'entry',
    correctsId: row.corrects_id ?? null,
    reason: row.reason ?? null,
    reasonNote: row.reason_note ?? null
  }
}

function openEntry (unit) {
  selected.value = unit
  detailOpen.value = true
}

// A correction writes new rows and can move a record to another month; reload.
async function onChanged () {
  detailOpen.value = false
  await loadEntries()
}

async function fetchCurrentUser () {
  const { data } = await supabase.auth.getUser()
  currentUserId.value = data?.user?.id || ''
}

async function loadEntries () {
  loading.value = true
  errorMessage.value = ''

  const range = getMonthRange(month.value)
  if (!range || !activeChurchId.value) {
    entries.value = []
    loading.value = false
    return
  }

  const { data, error } = await supabase
    .from('expenses')
    .select(EXPENSE_COLUMNS)
    // Explicit church filter: RLS returns every church's rows to a SuperAdmin,
    // so the scope has to be stated here as well.
    .eq('from_church', activeChurchId.value)
    .gte('spent_on', range.start)
    .lt('spent_on', range.endExclusive)
    .order('spent_on', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) {
    errorMessage.value = 'Failed to load this month’s expenses. Please try again.'
    entries.value = []
    loading.value = false
    return
  }

  entries.value = (data || []).map(normalise)
  loading.value = false
}

// Only the amounts, and only for the visible month: enough to size the church
// share, without pulling a month of contributor rows onto a screen that never
// shows a name.
async function loadCollectionsTotal () {
  const range = getMonthRange(month.value)
  if (!range || !activeChurchId.value) {
    collectionsTotal.value = null
    return
  }

  const { data, error } = await supabase
    .from('collections')
    .select('amount, kind')
    .eq('from_church', activeChurchId.value)
    .gte('collectedOn', range.start)
    .lt('collectedOn', range.endExclusive)

  // null, not 0 — an unreadable month and an empty one are different facts, and
  // the tile says so. netSum subtracts reversals (0039).
  collectionsTotal.value = error ? null : netSum(data || [])
}

async function loadDescriptionHistory () {
  if (!activeChurchId.value) {
    descriptionHistory.value = []
    return
  }

  const since = new Date()
  since.setMonth(since.getMonth() - CHIP_MONTHS)
  const start = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, '0')}-01`

  const { data, error } = await supabase
    .from('expenses')
    .select('description')
    .eq('from_church', activeChurchId.value)
    .gte('spent_on', start)

  descriptionHistory.value = error ? [] : (data || [])
}

function onSaved (row) {
  // An expense saved into another month is not dropped silently — the month
  // follows the entry, so what was just typed is visible where it landed. The
  // shell owns the month, so ask it to move; its prop change reloads this list.
  if (monthKeyFromDate(row.spent_on) !== month.value) {
    emit('update:month', monthKeyFromDate(row.spent_on))
  } else {
    entries.value = [normalise(row), ...entries.value]
  }
  descriptionHistory.value = [{ description: row.description }, ...descriptionHistory.value]
}

onMounted(async () => {
  await ensureLoaded()
  await Promise.all([
    fetchCurrentUser(),
    loadEntries(),
    loadCollectionsTotal(),
    loadDescriptionHistory()
  ])
})

watch(month, async () => {
  await Promise.all([loadEntries(), loadCollectionsTotal()])
})

watch(activeChurchId, async () => {
  if (!activeChurchId.value) return
  await Promise.all([loadEntries(), loadCollectionsTotal(), loadDescriptionHistory()])
})
</script>

<template>
  <div class="exp">
    <div class="exp__grid">
      <div
        class="anim-rise"
        style="--i: 1"
      >
        <ExpenseForm
          :church-id="activeChurchId"
          :created-by="currentUserId"
          :recent-descriptions="recentDescriptions"
          @saved="onSaved"
        />
      </div>

      <div class="exp__right">
        <div class="exp__kpis">
          <div
            v-for="(k, i) in kpis"
            :key="k.key"
            class="exp__kpi anim-rise"
            :style="`--i: ${i + 2}`"
          >
            <span class="exp__kpi-label">{{ k.label }}</span>
            <span
              class="exp__kpi-value"
              :class="[`exp__kpi-value--${k.tone}`, { 'exp__kpi-value--text': k.text }]"
            >{{ k.value }}</span>
            <span class="exp__kpi-sub">{{ k.sub }}</span>
          </div>
        </div>

        <section
          v-if="byDescription.length"
          class="exp__card exp__card--pad anim-rise"
          style="--i: 5"
        >
          <h2 class="exp__card-title">
            By description
          </h2>
          <ul class="exp__bars">
            <li
              v-for="(line, i) in byDescription"
              :key="line.description"
              class="exp__bar-row"
            >
              <span class="exp__bar-label">{{ line.description }}</span>
              <span class="exp__bar-track">
                <span
                  class="exp__bar-fill anim-grow"
                  :style="`width: ${line.width}; --i: ${i}`"
                />
              </span>
              <span class="exp__bar-amount">{{ formatPeso(line.amount) }}</span>
            </li>
          </ul>
        </section>

        <section
          class="exp__card anim-rise"
          style="--i: 6"
        >
          <div class="exp__card-head">
            <h2 class="exp__card-title">
              Monthly expenses
            </h2>
            <span class="exp__card-meta">
              {{ recordCount }} {{ recordCount === 1 ? 'record' : 'records' }} · {{ formatPeso(total) }}
            </span>
          </div>

          <p
            v-if="errorMessage"
            class="exp__error"
            role="alert"
          >
            {{ errorMessage }}
          </p>

          <div
            v-else-if="loading"
            class="exp__rows"
          >
            <div
              v-for="n in 5"
              :key="n"
              class="skeleton exp__row-skeleton"
            />
          </div>

          <p
            v-else-if="!units.length"
            class="exp__empty"
          >
            Nothing recorded for {{ monthLabel }} yet.
          </p>

          <table
            v-else
            class="exp__table"
          >
            <thead>
              <tr>
                <th scope="col">
                  Date
                </th>
                <th scope="col">
                  Description
                </th>
                <th scope="col">
                  Notes
                </th>
                <th
                  scope="col"
                  class="exp__num"
                >
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="unit in units"
                :key="unit.rootId"
                class="exp__row"
                :class="{ 'exp__row--voided': unit.voided }"
                tabindex="0"
                role="button"
                :aria-label="`Open ${(unit.live || unit.original).description}, ${formatPeso((unit.live || unit.original).amount)}${unit.voided ? ', voided' : unit.corrected ? ', corrected' : ''}`"
                @click="openEntry(unit)"
                @keydown.enter.prevent="openEntry(unit)"
                @keydown.space.prevent="openEntry(unit)"
              >
                <td class="exp__date">
                  {{ (unit.live || unit.original).dateLabel }}
                </td>
                <td class="exp__desc">
                  {{ (unit.live || unit.original).description }}
                  <Badge
                    v-if="unit.voided"
                    tone="magenta"
                  >
                    Voided
                  </Badge>
                  <Badge
                    v-else-if="unit.corrected"
                    tone="neutral"
                  >
                    Corrected
                  </Badge>
                </td>
                <td :class="{ 'exp__no-note': !(unit.live || unit.original).notes }">
                  {{ (unit.live || unit.original).notes || '—' }}
                </td>
                <td
                  class="exp__num exp__amount"
                  :class="{ 'exp__amount--voided': unit.voided }"
                >
                  {{ formatPeso((unit.live || unit.original).amount) }}
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>
    </div>

    <ExpenseDetailModal
      v-model:open="detailOpen"
      :unit="selected"
      @changed="onChanged"
    />
  </div>
</template>

<style scoped>
.exp { display: flex; flex-direction: column; gap: var(--sp-20); }

/* --- Layout ------------------------------------------------------------- */
.exp__grid { display: grid; grid-template-columns: 344px 1fr; gap: var(--sp-18); align-items: start; }
.exp__right { display: flex; flex-direction: column; gap: var(--sp-18); min-width: 0; }

.exp__kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--sp-14); }

.exp__kpi {
  display: flex;
  flex-direction: column;
  gap: var(--sp-8);
  padding: var(--sp-16);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-inset);
  box-shadow: var(--shadow-card);
}

.exp__kpi-label { font-size: var(--text-meta-sm); font-weight: 700; color: var(--ink-4); }

.exp__kpi-value {
  font-size: 20px;
  font-weight: 800;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
}
.exp__kpi-value--ink { color: var(--ink); }
.exp__kpi-value--magenta { color: var(--magenta); }
/* "Electricity" is a word, not a figure: tabular digits and tight tracking are
   for numbers, and a long description has to be allowed to wrap. */
.exp__kpi-value--text {
  font-variant-numeric: normal;
  letter-spacing: var(--tracking-h2);
  overflow-wrap: anywhere;
}

.exp__kpi-sub { font-size: var(--text-meta-sm); color: var(--ink-5); min-height: 1em; }

/* --- Cards -------------------------------------------------------------- */
.exp__card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-card);
  box-shadow: var(--shadow-card);
  overflow: hidden;
}
.exp__card--pad { padding: var(--sp-20); }

.exp__card-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--sp-12);
  padding: var(--sp-14) var(--sp-20);
  border-bottom: 1px solid var(--divider);
}

.exp__card-title { font-size: var(--text-h2); font-weight: 800; letter-spacing: var(--tracking-h2); }
.exp__card-meta { font-size: var(--text-meta); color: var(--ink-5); }

/* --- By description ----------------------------------------------------- */
.exp__bars { list-style: none; margin: var(--sp-14) 0 0; padding: 0; display: flex; flex-direction: column; }

.exp__bar-row { display: flex; align-items: center; gap: var(--sp-12); padding: var(--sp-6) 0; }

.exp__bar-label {
  width: 96px;
  flex: none;
  font-size: var(--text-body-sm);
  font-weight: 600;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.exp__bar-track {
  flex: 1;
  min-width: 0;
  height: 9px;
  border-radius: var(--r-pill);
  background: var(--divider);
  overflow: hidden;
}

.exp__bar-fill { display: block; height: 100%; background: var(--magenta); transform-origin: left; }

.exp__bar-amount {
  width: 88px;
  flex: none;
  text-align: right;
  font-size: var(--text-body-sm);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: var(--ink);
}

/* --- The table ---------------------------------------------------------- */
.exp__table { width: 100%; border-collapse: collapse; }

.exp__table th {
  text-align: left;
  padding: var(--sp-10) var(--sp-20);
  background: var(--surface-subtle);
  border-bottom: 1px solid var(--divider);
  font-size: var(--text-meta-sm);
  font-weight: 700;
  letter-spacing: .05em;
  text-transform: uppercase;
  color: var(--ink-5);
}

.exp__table td {
  padding: var(--sp-10) var(--sp-20);
  border-bottom: 1px solid var(--divider);
  font-size: var(--text-body-sm);
  color: var(--ink-4);
}
.exp__table tr:last-child td { border-bottom: 0; }

.exp__row { cursor: pointer; transition: background-color var(--dur-state) ease; }
.exp__row:hover { background: var(--surface-subtle-2); }
.exp__row:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.exp__row--voided td { color: var(--ink-5); }

.exp__date { color: var(--ink-4); white-space: nowrap; }
.exp__desc { font-weight: 700; color: var(--ink); display: flex; align-items: center; gap: var(--sp-8); }
.exp__no-note { color: var(--ink-6); }

.exp__num { text-align: right; }
.exp__amount { font-weight: 800; font-variant-numeric: tabular-nums; white-space: nowrap; color: var(--magenta-darkest); }
.exp__amount--voided { text-decoration: line-through; color: var(--ink-5); }

.exp__rows { display: flex; flex-direction: column; }
.exp__row-skeleton { height: 46px; border-radius: 0; }

.exp__empty { padding: var(--sp-22) var(--sp-20); font-size: var(--text-body-sm); color: var(--ink-5); }

.exp__error {
  margin: var(--sp-16) var(--sp-20);
  padding: var(--sp-10) var(--sp-12);
  border-radius: var(--r-inset);
  background: var(--magenta-tint);
  border: 1px solid var(--magenta-border);
  font-size: var(--text-body-sm);
  color: var(--magenta-darkest);
}

@media (max-width: 900px) {
  .exp__grid { grid-template-columns: 1fr; }
}

@media (max-width: 620px) {
  .exp__kpis { grid-template-columns: 1fr; }
  .exp__bar-label { width: 72px; }
  .exp__bar-amount { width: 76px; }
  /* The note is the first thing to go on a phone: the date, what it was and
     how much are the row. */
  .exp__table th:nth-child(3),
  .exp__table td:nth-child(3) { display: none; }
}
</style>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { supabase } from '../lib/supabase'
import Icon from '../components/ui/icons/Icon.vue'
import ExpenseForm from '../components/expenses/ExpenseForm.vue'
import { defaultMonthKey, getMonthRange, monthKeyFromDate } from '../utils/expensesMonth'
import { summariseByDescription, largestLine, rankDescriptions } from '../utils/expenseStats'
import { SHARE_OF_TOTAL_FUNDS } from '../utils/collectivesReport'
import { formatPeso, formatPesoWhole, formatShare } from '../utils/money'
import { useActiveChurch } from '../composables/useActiveChurch'

// Expenses — what the church spent, charged against its share of the month's
// allocation.
//
// Same shape as Collections, deliberately: form left, month right, one stepper
// in the header. They are siblings in the flat nine and they are used by the
// same person on the same afternoon; a treasurer should not have to relearn the
// screen because the money is going the other way.
//
// FundsTabs is gone here too — see the note in CollectionsInputView.
//
// NO ROW DETAIL DIALOG, and that is a deliberate omission rather than an
// oversight. The mockup draws the rows with a pointer cursor, but 0009 grants
// `expenses` SELECT and INSERT only: there is no UPDATE grant and no DELETE
// policy at all. An expense, once recorded, is permanent. Offering a row that
// opens would promise a correction the database will refuse, so the rows do not
// invite a click and the form says so before the money is saved instead.

const { activeChurchId, ensureLoaded } = useActiveChurch()

const EXPENSE_COLUMNS = 'id, spent_on, description, amount, notes, created_at'

// How far back the description chips look. Six months of one church's expenses
// is a couple of hundred rows of a single short column — the cheapest way to
// have last month's wording on hand in a month that is still empty.
const CHIP_MONTHS = 6

const month = ref(defaultMonthKey())
const entries = ref([])
const descriptionHistory = ref([])
const collectionsTotal = ref(null)
const currentUserId = ref('')
const loading = ref(true)
const errorMessage = ref('')

const monthLabel = computed(() => {
  const [year, m] = month.value.split('-')
  if (!year || !m) return ''
  return new Date(Number(year), Number(m) - 1, 1)
    .toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })
})

const total = computed(() => entries.value.reduce((sum, row) => sum + Number(row.amount || 0), 0))

const byDescription = computed(() => summariseByDescription(entries.value))

const recentDescriptions = computed(() => rankDescriptions(descriptionHistory.value))

// The church's own share of the month, against which these expenses are drawn:
// 40% of total funds collected. NOMINAL, per the note in collectivesReport —
// the realised share drifts with the student-programme draw, and the tile is
// describing the rule, not one month's rounding.
const churchShare = computed(() =>
  collectionsTotal.value === null ? null : collectionsTotal.value * SHARE_OF_TOTAL_FUNDS.church
)

const top = computed(() => largestLine(entries.value))

const kpis = computed(() => {
  const descriptions = byDescription.value.length
  const share = churchShare.value

  return [
    {
      key: 'spent',
      label: 'Spent this month',
      value: formatPesoWhole(total.value),
      sub: `${entries.value.length} ${entries.value.length === 1 ? 'entry' : 'entries'} · ${descriptions} ${descriptions === 1 ? 'description' : 'descriptions'}`,
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

function shiftMonth (delta) {
  const [year, m] = month.value.split('-').map(Number)
  const date = new Date(year, m - 1 + delta, 1)
  month.value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function formatDate (value) {
  if (!value) return ''
  // Explicit local midnight — the bare string parses as UTC and renders the day
  // before for the first eight hours of every Manila day (D8).
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric'
  })
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

  entries.value = data || []
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
    .select('amount')
    .eq('from_church', activeChurchId.value)
    .gte('collectedOn', range.start)
    .lt('collectedOn', range.endExclusive)

  // null, not 0 — an unreadable month and an empty one are different facts, and
  // the tile says so.
  collectionsTotal.value = error ? null : (data || []).reduce((sum, r) => sum + Number(r.amount || 0), 0)
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
  // follows the entry, so what was just typed is visible where it landed.
  if (monthKeyFromDate(row.spent_on) !== month.value) {
    month.value = monthKeyFromDate(row.spent_on)
  } else {
    entries.value = [row, ...entries.value]
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
    <header
      class="exp__head anim-rise"
      style="--i: 0"
    >
      <div class="exp__title-block">
        <h1 class="exp__title">
          Expenses
        </h1>
        <p class="exp__sub">
          Charged against the church share of the allocation
        </p>
      </div>

      <div class="exp__month">
        <button
          type="button"
          class="exp__step"
          aria-label="Previous month"
          @click="shiftMonth(-1)"
        >
          <Icon
            name="chevronLeft"
            :size="15"
          />
        </button>
        <span class="exp__month-label">{{ monthLabel }}</span>
        <button
          type="button"
          class="exp__step"
          aria-label="Next month"
          @click="shiftMonth(1)"
        >
          <Icon
            name="chevronRight"
            :size="15"
          />
        </button>
      </div>
    </header>

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
              {{ entries.length }} {{ entries.length === 1 ? 'entry' : 'entries' }} · {{ formatPeso(total) }}
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
            v-else-if="!entries.length"
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
                v-for="entry in entries"
                :key="entry.id"
              >
                <td class="exp__date">
                  {{ formatDate(entry.spent_on) }}
                </td>
                <td class="exp__desc">
                  {{ entry.description }}
                </td>
                <td :class="{ 'exp__no-note': !entry.notes }">
                  {{ entry.notes || '—' }}
                </td>
                <td class="exp__num exp__amount">
                  {{ formatPeso(entry.amount) }}
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.exp { display: flex; flex-direction: column; gap: var(--sp-20); }

.exp__head { display: flex; align-items: flex-end; justify-content: space-between; gap: var(--sp-16); }
.exp__title-block { display: flex; flex-direction: column; gap: var(--sp-5); min-width: 0; }

.exp__title {
  font-size: var(--text-h1);
  font-weight: 800;
  letter-spacing: var(--tracking-h1);
  line-height: var(--leading-h1);
}

.exp__sub { font-size: var(--text-body); color: var(--ink-4); }

/* --- Month stepper ------------------------------------------------------ */
.exp__month {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--border-strong);
  border-radius: var(--r-control);
  background: var(--surface);
}

.exp__step {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: var(--r-tag);
  background: none;
  color: var(--ink-4);
  cursor: pointer;
  transition: background-color var(--dur-state) ease, color var(--dur-state) ease;
}
.exp__step:hover { background: var(--divider); color: var(--ink); }
.exp__step:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.exp__month-label { padding: 0 var(--sp-10); font-size: var(--text-body-sm); font-weight: 800; color: var(--ink); }

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

.exp__date { color: var(--ink-4); white-space: nowrap; }
.exp__desc { font-weight: 700; color: var(--ink); }
.exp__no-note { color: var(--ink-6); }

.exp__num { text-align: right; }
.exp__amount { font-weight: 800; font-variant-numeric: tabular-nums; white-space: nowrap; color: var(--magenta-darkest); }

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
  .exp__head { flex-direction: column; align-items: stretch; gap: var(--sp-12); }
  .exp__month { align-self: flex-start; }
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

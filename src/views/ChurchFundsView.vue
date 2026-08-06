<template>
  <div class="page-container">
    <main class="page-content">
      <!-- Header -->
      <div class="page-header">
        <div>
          <h2>Church Funds</h2>
          <p class="page-subtitle">Monthly collectives report</p>
        </div>
        <div class="page-header-actions">
          <span class="stat-badge">{{ report.weeks.length }} service dates</span>
          <button class="btn-secondary" @click="handlePrint" title="Print / Save as PDF">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 6 2 18 2 18 9"/>
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
              <rect x="6" y="14" width="12" height="8"/>
            </svg>
            Print
          </button>
        </div>
      </div>

      <FundsTabs />

      <p v-if="loadError" class="load-warning">{{ loadError }}</p>

      <!-- Month navigator -->
      <div class="report-toolbar card">
        <button class="btn-icon nav-btn" @click="prevMonth" aria-label="Previous month" title="Previous month">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <div class="report-title">
          <span class="report-title-main">{{ monthLabel }}</span>
          <span class="report-title-sub">Collectives Summary</span>
        </div>
        <button class="btn-icon nav-btn" @click="nextMonth" aria-label="Next month" title="Next month">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>
      </div>

      <!-- Loading / empty state. The empty state is gated on loading or it
           flashes "no collectives" on every month navigation. -->
      <div v-if="loading" class="card">
        <div class="state-message">
          <p>Loading {{ monthLabel }}…</p>
        </div>
      </div>

      <div v-else-if="report.weeks.length === 0" class="card">
        <div class="state-message">
          <p>No collectives recorded for {{ monthLabel }}.</p>
        </div>
      </div>

      <template v-else>
        <!-- KPI cards -->
        <div class="kpi-grid">
          <div class="kpi-card">
            <span class="kpi-label">Total Funds</span>
            <span class="kpi-value">{{ formatMoney(report.totals.totalFunds) }}</span>
            <span class="kpi-sub">Tithes + Offering + Others</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-label">Tithes</span>
            <span class="kpi-value">{{ formatMoney(report.totals.tithes) }}</span>
            <span class="kpi-sub">{{ percent(report.totals.tithes, report.totals.totalFunds) }} of total</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-label">Offering</span>
            <span class="kpi-value">{{ formatMoney(report.totals.offering) }}</span>
            <span class="kpi-sub">{{ percent(report.totals.offering, report.totals.totalFunds) }} of total</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-label">Expenses</span>
            <span class="kpi-value">{{ formatMoney(report.totals.expenses) }}</span>
            <span class="kpi-sub">{{ report.expenseSummary.length }} categories</span>
          </div>
          <div class="kpi-card kpi-card-accent">
            <span class="kpi-label">Closing Balance</span>
            <span class="kpi-value">{{ formatMoney(report.closingBalance) }}</span>
            <span class="kpi-sub">
              From {{ formatMoney(report.openingBalance) }}
            </span>
          </div>
        </div>

        <!-- Weekly breakdown -->
        <section class="card report-section section-weekly-breakdown">
          <header class="section-header">
            <div>
              <h3>Weekly Breakdown</h3>
              <span class="section-hint">Per-service totals for {{ monthLabel }}</span>
            </div>
            <button
              class="section-toggle"
              @click="weeklyExpanded = !weeklyExpanded"
              :aria-expanded="weeklyExpanded"
              aria-controls="weekly-breakdown-content"
            >
              <span class="section-toggle-label">{{ weeklyExpanded ? 'Collapse' : 'Expand' }}</span>
              <svg
                class="section-toggle-icon"
                :class="{ 'is-collapsed': !weeklyExpanded }"
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>
          </header>
          <Transition
            @before-enter="beforeExpand"
            @enter="expand"
            @after-enter="afterExpand"
            @before-leave="beforeCollapse"
            @leave="collapse"
            @after-leave="afterCollapse"
          >
            <div v-show="weeklyExpanded" id="weekly-breakdown-content" class="table-wrap section-content">
              <table class="report-table">
              <thead>
                <tr>
                  <th class="col-label">Metric</th>
                  <th v-for="w in report.weeks" :key="w.date" class="col-num">
                    {{ formatShortDate(w.date) }}
                  </th>
                  <th class="col-num col-total">Month</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td class="col-label">Tithes</td>
                  <td v-for="w in report.weeks" :key="w.date" class="col-num">{{ formatMoney(w.tithes) }}</td>
                  <td class="col-num col-total">{{ formatMoney(report.totals.tithes) }}</td>
                </tr>
                <tr>
                  <td class="col-label">Offering</td>
                  <td v-for="w in report.weeks" :key="w.date" class="col-num">{{ formatMoney(w.offering) }}</td>
                  <td class="col-num col-total">{{ formatMoney(report.totals.offering) }}</td>
                </tr>
                <!-- `collections` stores only is_tithes, so Others has no live
                     source and stays hidden until a category column exists. -->
                <tr v-if="hasOthers">
                  <td class="col-label">Others</td>
                  <td v-for="w in report.weeks" :key="w.date" class="col-num">{{ formatMoney(w.others) }}</td>
                  <td class="col-num col-total">{{ formatMoney(report.totals.others) }}</td>
                </tr>
                <tr class="row-subtotal">
                  <td class="col-label">Total Funds</td>
                  <td v-for="w in report.weeks" :key="w.date" class="col-num">{{ formatMoney(w.totalFunds) }}</td>
                  <td class="col-num col-total">{{ formatMoney(report.totals.totalFunds) }}</td>
                </tr>
                <tr>
                  <td class="col-label">Expenses</td>
                  <td v-for="w in report.weeks" :key="w.date" class="col-num neg">{{ formatMoney(w.totalExpenses) }}</td>
                  <td class="col-num col-total neg">{{ formatMoney(report.totals.expenses) }}</td>
                </tr>
                <tr>
                  <td class="col-label">Church Allocation</td>
                  <td v-for="w in report.weeks" :key="w.date" class="col-num">{{ formatMoney(w.churchAllocation) }}</td>
                  <td class="col-num col-total">{{ formatMoney(report.totals.churchAllocation) }}</td>
                </tr>
                <tr class="row-total">
                  <td class="col-label">Net Church Funds</td>
                  <td v-for="w in report.weeks" :key="w.date" :class="['col-num', w.netChurchFunds < 0 ? 'neg' : '']">
                    {{ formatMoney(w.netChurchFunds) }}
                  </td>
                  <td :class="['col-num', 'col-total', report.totals.netChurchFunds < 0 ? 'neg' : '']">
                    {{ formatMoney(report.totals.netChurchFunds) }}
                  </td>
                </tr>
                <tr>
                  <td class="col-label">Running Balance</td>
                  <td v-for="w in report.weeks" :key="w.date" class="col-num muted">
                    {{ formatMoney(w.closingBalance) }}
                  </td>
                  <td class="col-num col-total">{{ formatMoney(report.closingBalance) }}</td>
                </tr>
              </tbody>
              </table>
            </div>
          </Transition>
        </section>

        <!-- Two-column: Allocations + Expenses -->
        <div class="two-col section-alloc-expenses">
          <!-- Allocations breakdown -->
          <section class="card report-section">
            <header class="section-header">
              <h3>Allocations</h3>
              <span class="section-hint">How the {{ formatMoney(report.totals.totalFunds) }} is distributed</span>
            </header>
            <ul class="alloc-list">
              <li class="alloc-row alloc-header">
                <span>Total Funds Collected</span>
                <span class="alloc-amount">{{ formatMoney(report.totals.totalFunds) }}</span>
              </li>
              <li class="alloc-row">
                <span>
                  <span class="alloc-dot dot-orange"></span>
                  Tithes of Tithes <span class="alloc-pct">{{ ratePct.tithesOfTithes }}</span>
                </span>
                <span class="alloc-amount neg">− {{ formatMoney(report.totals.tithesOfTithes) }}</span>
              </li>
              <li class="alloc-row">
                <span>
                  <span class="alloc-dot dot-purple"></span>
                  Project Fund <span class="alloc-pct">{{ ratePct.project }}</span>
                </span>
                <span class="alloc-amount neg">− {{ formatMoney(report.totals.project) }}</span>
              </li>
              <li class="alloc-row">
                <span>
                  <span class="alloc-dot dot-teal"></span>
                  Student Program <span class="alloc-pct">{{ ratePct.studentProgram }}</span>
                </span>
                <span class="alloc-amount neg">− {{ formatMoney(report.totals.studentProgramGross) }}</span>
              </li>
              <!-- No column stores a per-service personal draw, so this stays
                   hidden with live data. Kept because the calculator supports
                   it and the paper report has the line. -->
              <li v-if="report.totals.studentProgramDeduction > 0" class="alloc-row alloc-nested">
                <span class="alloc-nested-label">Less: Personal draw</span>
                <span class="alloc-amount">+ {{ formatMoney(report.totals.studentProgramDeduction) }}</span>
              </li>
              <li class="alloc-row alloc-subtotal">
                <span>Remaining Funds</span>
                <span class="alloc-amount">{{ formatMoney(report.totals.remainingFunds) }}</span>
              </li>
              <li class="alloc-row">
                <span>
                  <span class="alloc-dot dot-blue"></span>
                  Pastor's Allowance <span class="alloc-pct">{{ ratePct.pastor }}</span>
                </span>
                <span class="alloc-amount">{{ formatMoney(report.totals.pastorAllowance) }}</span>
              </li>
              <li class="alloc-row">
                <span>
                  <span class="alloc-dot dot-green"></span>
                  Church Allocation <span class="alloc-pct">{{ ratePct.church }}</span>
                </span>
                <span class="alloc-amount">{{ formatMoney(report.totals.churchAllocation) }}</span>
              </li>
            </ul>

            <!-- Distribution bar -->
            <div class="alloc-bar" :aria-label="'Allocation distribution for ' + monthLabel">
              <span
                v-for="seg in allocationSegments"
                :key="seg.key"
                class="alloc-bar-seg"
                :style="{ width: seg.width, background: seg.color }"
                :title="seg.label + ' — ' + formatMoney(seg.amount)"
              ></span>
            </div>
            <div class="alloc-legend">
              <span v-for="seg in allocationSegments" :key="'legend-' + seg.key" class="alloc-legend-item">
                <span class="alloc-dot" :style="{ background: seg.color }"></span>
                {{ seg.label }}
              </span>
            </div>
          </section>

          <!-- Expenses -->
          <section class="card report-section">
            <header class="section-header">
              <h3>Expenses</h3>
              <span class="section-hint">Charged against the Church Allocation</span>
            </header>
            <div v-if="report.expenseSummary.length === 0" class="state-message small">
              <p>No expenses recorded this month.</p>
            </div>
            <table v-else class="report-table compact">
              <thead>
                <tr>
                  <th class="col-label">Description</th>
                  <th class="col-num">Amount</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="e in report.expenseSummary" :key="e.description">
                  <td class="col-label">{{ e.description }}</td>
                  <td class="col-num neg">{{ formatMoney(e.amount) }}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr class="row-total">
                  <td class="col-label">Total Expenses</td>
                  <td class="col-num neg">{{ formatMoney(report.totals.expenses) }}</td>
                </tr>
              </tfoot>
            </table>
          </section>
        </div>

        <!-- Contributors (finance staff / SuperAdmin only) -->
        <section v-if="canWriteFinance" class="card report-section section-contributors">
          <header class="section-header">
            <div>
              <h3>Contributors</h3>
              <span class="section-hint">
                {{ report.contributors.length }} rows ·
                each anonymous gift is listed separately
              </span>
            </div>
            <button
              class="section-toggle"
              @click="contributorsExpanded = !contributorsExpanded"
              :aria-expanded="contributorsExpanded"
              aria-controls="contributors-content"
            >
              <span class="section-toggle-label">{{ contributorsExpanded ? 'Collapse' : 'Expand' }}</span>
              <svg
                class="section-toggle-icon"
                :class="{ 'is-collapsed': !contributorsExpanded }"
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>
          </header>
          <Transition
            @before-enter="beforeExpand"
            @enter="expand"
            @after-enter="afterExpand"
            @before-leave="beforeCollapse"
            @leave="collapse"
            @after-leave="afterCollapse"
          >
            <div v-show="contributorsExpanded" id="contributors-content" class="table-wrap section-content">
              <table class="report-table">
              <thead>
                <tr>
                  <th class="col-label">Name</th>
                  <th class="col-num">Tithes</th>
                  <th class="col-num">Offering</th>
                  <th v-if="hasOthers" class="col-num">Others</th>
                  <th class="col-num col-total">Total</th>
                </tr>
              </thead>
              <tbody>
                <!-- Keyed on `key`, not `name`: several rows legitimately read
                     "Anonymous", one per gift. -->
                <tr v-for="c in report.contributors" :key="c.key">
                  <td class="col-label">{{ c.name }}</td>
                  <td class="col-num">{{ formatMoney(c.tithes) }}</td>
                  <td class="col-num">{{ formatMoney(c.offering) }}</td>
                  <td v-if="hasOthers" class="col-num">{{ formatMoney(c.others) }}</td>
                  <td class="col-num col-total">{{ formatMoney(c.total) }}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr class="row-total">
                  <td class="col-label">Total</td>
                  <td class="col-num">{{ formatMoney(report.totals.tithes) }}</td>
                  <td class="col-num">{{ formatMoney(report.totals.offering) }}</td>
                  <td v-if="hasOthers" class="col-num">{{ formatMoney(report.totals.others) }}</td>
                  <td class="col-num col-total">{{ formatMoney(report.totals.totalFunds) }}</td>
                </tr>
              </tfoot>
              </table>
            </div>
          </Transition>
        </section>

        <!-- Balance rollup -->
        <section class="card balance-card">
          <header class="section-header">
            <h3>Church Funds Balance</h3>
            <span class="section-hint">Rollup for {{ monthLabel }}</span>
          </header>
          <ul class="balance-list">
            <li>
              <span>Church Allocation (month)</span>
              <span class="mono">{{ formatMoney(report.totals.churchAllocation) }}</span>
            </li>
            <li>
              <span>Less: Total Expenses</span>
              <span class="mono neg">− {{ formatMoney(report.totals.expenses) }}</span>
            </li>
            <li class="balance-subtotal">
              <span>Net Church Funds (month)</span>
              <span :class="['mono', report.totals.netChurchFunds < 0 ? 'neg' : '']">
                {{ formatMoney(report.totals.netChurchFunds) }}
              </span>
            </li>
            <li>
              <span>Add: Opening Balance</span>
              <span class="mono">+ {{ formatMoney(report.openingBalance) }}</span>
            </li>
            <li class="balance-total">
              <span>Current Church Funds</span>
              <span class="mono">{{ formatMoney(report.closingBalance) }}</span>
            </li>
          </ul>
        </section>
      </template>
    </main>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { SHARE_OF_TOTAL_FUNDS, computeMonthlyReport } from '../utils/collectivesReport'
import FundsTabs from '../components/FundsTabs.vue'
import { supabase } from '../lib/supabase'
import { defaultMonthKey, getMonthRange, parseMonthKey } from '../utils/expensesMonth'
import { mergeMonthSourceWithLiveExpenses } from '../utils/reportExpenseMerge'
import { buildMonthSourceFromCollections, openingBalanceForMonth } from '../utils/collectivesSource'
import { useCurrentRole } from '../composables/useCurrentRole'
import { useActiveChurch } from '../composables/useActiveChurch'

// Contributor identity is finance-staff detail: shown to the Finance ministry and
// SuperAdmin (canWriteFinance). Pastor / Church Leader / Head Pastor see the report
// but not individual contributor names.
const { canWriteFinance } = useCurrentRole()

// Church scoping (own church, or the selected church for SuperAdmin / Head Pastor).
// RLS returns every church to those roles, so the report filters by from_church.
const { activeChurchId, ensureLoaded } = useActiveChurch()

// Narrower than COLLECTION_SELECT in CollectionsInputView: the report has no
// edit window to enforce, so it needs neither created_at nor middle_name.
// No from_church filter on any query here — RLS scopes every read to the
// caller's church, as it does in every other view.
const REPORT_COLLECTION_SELECT =
  'id, from, amount, is_tithes, collectedOn, members!collections_from_fkey(first_name, last_name)'

const cursor = ref(parseMonthKey(defaultMonthKey()))
const weeklyExpanded = ref(true)
const contributorsExpanded = ref(true)

// The whole ledger, one row per service date (see 0012_collectives_service_totals).
// Fetched once: it is month-independent and small, and re-fetching it on every
// navigation would trade a few KB for a round trip per click.
const serviceTotals = ref([])
const monthCollections = ref([])
const liveExpenses = ref([])

const loadingLedger = ref(true)
const loadingMonth = ref(true)
const loading = computed(() => loadingLedger.value || loadingMonth.value)

// Kept apart so a month that loads cleanly does not clear a standing ledger
// failure — the two fetches fail independently and mean different things.
const ledgerError = ref('')
const monthError = ref('')
const loadError = computed(() => monthError.value || ledgerError.value)

// Guards against out-of-order responses: clicking prev/next quickly can land an
// older month's rows after a newer one's, which would render figures under the
// wrong heading. Declared here rather than beside loadMonth() because the
// immediate watch below calls that function during setup, before a later `let`
// would have left its temporal dead zone.
let monthRequestId = 0

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const monthLabel = computed(() => `${MONTH_NAMES[cursor.value.month - 1]} ${cursor.value.year}`)
const cursorMonthKey = computed(() => `${cursor.value.year}-${String(cursor.value.month).padStart(2, '0')}`)

onMounted(async () => {
  // Resolve the active church, then load the ledger. loadServiceTotals runs here
  // (not only in the watch) because the active church may already be cached from a
  // prior view, in which case the watch would not fire. loadMonth's first run comes
  // from the immediate cursorMonthKey watch (fast paint; RLS scopes single-church).
  await ensureLoaded()
  loadServiceTotals()
})

watch(cursorMonthKey, loadMonth, { immediate: true })

// Reload the ledger and the current month once the active church resolves or changes.
watch(activeChurchId, () => {
  loadServiceTotals()
  loadMonth()
})

const report = computed(() => {
  const source = buildMonthSourceFromCollections(monthCollections.value, {
    year: cursor.value.year,
    month: cursor.value.month,
    // Derived from the ledger rather than stored, so a correction to an older
    // entry re-derives every balance after it with no month-close step.
    openingBalance: openingBalanceForMonth(serviceTotals.value, cursorMonthKey.value),
  })

  return computeMonthlyReport(mergeMonthSourceWithLiveExpenses(source, liveExpenses.value))
})

async function loadServiceTotals() {
  loadingLedger.value = true
  ledgerError.value = ''

  // Filter by the active church when it is known. RLS already scopes a single-church
  // user; the explicit filter is what stops a SuperAdmin's ledger merging churches
  // once a church is selected. The watch below re-runs this after the church resolves.
  let query = supabase
    .from('collectives_service_totals')
    .select('service_date, tithes, offering, expenses')
  if (activeChurchId.value) query = query.eq('from_church', activeChurchId.value)

  const { data, error } = await query.order('service_date', { ascending: true })

  if (error) {
    serviceTotals.value = []
    ledgerError.value = 'Unable to load the running balance. Opening balance is shown as zero, so Current Church Funds covers this month only.'
  } else {
    serviceTotals.value = data || []
  }

  loadingLedger.value = false
}

async function loadMonth() {
  const requestId = ++monthRequestId
  loadingMonth.value = true
  monthError.value = ''

  const range = getMonthRange(cursorMonthKey.value)
  if (!range) {
    monthCollections.value = []
    liveExpenses.value = []
    loadingMonth.value = false
    return
  }

  let collectionsQuery = supabase.from('collections').select(REPORT_COLLECTION_SELECT)
  if (activeChurchId.value) collectionsQuery = collectionsQuery.eq('from_church', activeChurchId.value)
  collectionsQuery = collectionsQuery
    .gte('collectedOn', range.start)
    .lt('collectedOn', range.endExclusive)
    .order('collectedOn', { ascending: true })

  let expensesQuery = supabase.from('expenses').select('spent_on, description, amount')
  if (activeChurchId.value) expensesQuery = expensesQuery.eq('from_church', activeChurchId.value)
  expensesQuery = expensesQuery
    .gte('spent_on', range.start)
    .lt('spent_on', range.endExclusive)
    .order('spent_on', { ascending: true })

  const [collectionsResult, expensesResult] = await Promise.all([collectionsQuery, expensesQuery])

  if (requestId !== monthRequestId) return

  monthCollections.value = collectionsResult.error ? [] : (collectionsResult.data || [])
  liveExpenses.value = expensesResult.error ? [] : (expensesResult.data || [])

  if (collectionsResult.error || expensesResult.error) {
    monthError.value = `Unable to load all records for ${monthLabel.value}. The figures below are incomplete.`
  }

  loadingMonth.value = false
}

// Rendered from the rate table rather than typed into the template. The two
// bottom lines used to read a hardcoded "50%" — true of the remainder, but
// alongside "10%" and "5%" of total funds it read as half the collection. Derive
// them and the column adds to 100% by construction.
const ratePct = Object.fromEntries(
  Object.entries(SHARE_OF_TOTAL_FUNDS).map(([key, rate]) => [key, formatRate(rate)]),
)

// Whole numbers for the rates in use; a decimal only if one ever needs it.
// Rounds before testing for a whole number: the derived shares carry binary
// float residue (1 − 0.10 − 0.05 − 0.05 is 0.7999999999999999), and the current
// rates only render cleanly because that residue happens to cancel. Do not rely
// on the luck — 40% must not become "39.999999999999996%" if a rate changes.
function formatRate(rate) {
  const pct = Math.round(rate * 1000) / 10
  return `${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`
}

// Nothing in `collections` can populate Others today, so the row and column are
// hidden rather than shown as a permanent ₱0.00. The calculator still sums the
// field, so adding a category column later needs no change here.
const hasOthers = computed(() => report.value.totals.others > 0)

const allocationSegments = computed(() => {
  const t = report.value.totals
  const base = t.totalFunds
  if (!base) return []
  const segs = [
    { key: 'tithesOfTithes', label: 'Tithes of Tithes', amount: t.tithesOfTithes, color: '#f97316' },
    { key: 'project', label: 'Project Fund', amount: t.project, color: '#a855f7' },
    { key: 'studentProgramNet', label: 'Student Program (net)', amount: t.studentProgramNet, color: '#14b8a6' },
    { key: 'pastor', label: "Pastor's Allowance", amount: t.pastorAllowance, color: '#1a56db' },
    { key: 'church', label: 'Church Allocation', amount: t.churchAllocation, color: '#10b981' },
  ]
  return segs.map((s) => ({ ...s, width: `${(s.amount / base) * 100}%` }))
})

function prevMonth() {
  const { year, month } = cursor.value
  cursor.value = month === 1
    ? { year: year - 1, month: 12 }
    : { year, month: month - 1 }
}

function nextMonth() {
  const { year, month } = cursor.value
  cursor.value = month === 12
    ? { year: year + 1, month: 1 }
    : { year, month: month + 1 }
}

function formatMoney(n) {
  const value = Number(n) || 0
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function percent(part, whole) {
  if (!whole) return '0%'
  return `${((part / whole) * 100).toFixed(1)}%`
}

function formatShortDate(iso) {
  const d = new Date(iso + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function handlePrint() {
  window.print()
}

function beforeExpand(el) {
  el.style.height = '0'
  el.style.opacity = '0'
  el.style.overflow = 'hidden'
}

function expand(el) {
  el.style.transition = 'height 280ms cubic-bezier(0.22, 1, 0.36, 1), opacity 220ms ease'
  requestAnimationFrame(() => {
    el.style.height = `${el.scrollHeight}px`
    el.style.opacity = '1'
  })
}

function afterExpand(el) {
  el.style.height = 'auto'
  el.style.overflow = 'visible'
  el.style.transition = ''
}

function beforeCollapse(el) {
  el.style.height = `${el.scrollHeight}px`
  el.style.opacity = '1'
  el.style.overflow = 'hidden'
}

function collapse(el) {
  el.style.transition = 'height 260ms cubic-bezier(0.4, 0, 0.2, 1), opacity 180ms ease'
  requestAnimationFrame(() => {
    el.style.height = '0'
    el.style.opacity = '0'
  })
}

function afterCollapse(el) {
  el.style.transition = ''
  el.style.height = ''
  el.style.opacity = ''
  el.style.overflow = ''
}
</script>

<style scoped>
.page-container {
  padding: 24px 32px;
  background: #f8fafc;
  min-height: 100vh;
}

.page-content {
  max-width: 1280px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.page-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.page-header h2 {
  font-size: 24px;
  font-weight: 700;
  color: #0f172a;
  letter-spacing: -0.02em;
}

.page-subtitle {
  color: #64748b;
  font-size: 14px;
  margin-top: 4px;
}

.page-header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.stat-badge {
  background: #e0edff;
  color: #1a56db;
  font-size: 12px;
  font-weight: 600;
  padding: 6px 10px;
  border-radius: 999px;
}

.btn-secondary {
  background: #ffffff;
  color: #1e293b;
  border: 1px solid #e2e8f0;
  padding: 8px 14px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: background 0.15s, border-color 0.15s;
}

.btn-secondary:hover {
  background: #f1f5f9;
  border-color: #cbd5e1;
}

.btn-collections {
  background: linear-gradient(135deg, #1a56db 0%, #1e40af 100%);
  color: #ffffff;
  border: 1px solid #1a56db;
  padding: 9px 16px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  text-decoration: none;
  box-shadow: 0 10px 24px rgba(37, 99, 235, 0.24);
  transition: transform 0.15s, box-shadow 0.15s, filter 0.15s;
}

.btn-collections:hover {
  filter: brightness(1.02);
  transform: translateY(-1px);
  box-shadow: 0 14px 28px rgba(37, 99, 235, 0.3);
}

.btn-icon {
  background: none;
  border: 1px solid #e2e8f0;
  padding: 6px;
  border-radius: 8px;
  cursor: pointer;
  color: #64748b;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: color 0.15s, background 0.15s, border-color 0.15s;
}

.btn-icon:hover {
  background: #f1f5f9;
  color: #1a56db;
  border-color: #cbd5e1;
}

.nav-btn {
  width: 36px;
  height: 36px;
}

.card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03);
  padding: 20px;
}

.state-message {
  text-align: center;
  padding: 40px 16px;
  color: #64748b;
}
.state-message.small { padding: 20px 12px; }

.load-warning {
  margin-top: -8px;
  color: #b45309;
  font-size: 12px;
}

/* Month navigator */
.report-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 20px;
}
.report-title {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
.report-title-main {
  font-size: 18px;
  font-weight: 700;
  color: #0f172a;
}
.report-title-sub {
  font-size: 12px;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* KPI grid */
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 14px;
}
.kpi-card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03);
}
.kpi-card-accent {
  background: linear-gradient(135deg, #1a56db 0%, #1e40af 100%);
  border-color: #1a56db;
  color: #ffffff;
}
.kpi-card-accent .kpi-label,
.kpi-card-accent .kpi-sub {
  color: #dbeafe;
}
.kpi-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #64748b;
}
.kpi-value {
  font-size: 22px;
  font-weight: 700;
  color: #0f172a;
  font-variant-numeric: tabular-nums;
}
.kpi-card-accent .kpi-value { color: #ffffff; }
.kpi-sub {
  font-size: 12px;
  color: #64748b;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

/* Sections */
.report-section { padding: 20px 22px; }
.section-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}
.section-header h3 {
  font-size: 15px;
  font-weight: 700;
  color: #0f172a;
  letter-spacing: -0.01em;
}
.section-hint {
  font-size: 12px;
  color: #64748b;
}

.section-toggle {
  border: 1px solid #dbe3ee;
  background: #ffffff;
  color: #334155;
  border-radius: 999px;
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.section-toggle:hover {
  background: #f8fafc;
  border-color: #cbd5e1;
}

.section-toggle-label {
  line-height: 1;
}

.section-toggle-icon {
  transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
}

.section-toggle-icon.is-collapsed {
  transform: rotate(-90deg);
}

.section-content {
  margin-top: 8px;
}

/* Section ordering in the monthly report */
.section-alloc-expenses { order: 1; }
.section-weekly-breakdown { order: 2; }
.section-contributors { order: 3; }
.balance-card { order: 4; }

/* Tables */
.table-wrap {
  overflow-x: auto;
}
.report-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.report-table.compact { font-size: 13px; }
.report-table th,
.report-table td {
  padding: 10px 12px;
  text-align: left;
  border-bottom: 1px solid #f1f5f9;
}
.report-table th {
  font-weight: 600;
  color: #475569;
  background: #f8fafc;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.report-table tbody tr:hover {
  background: #f8fafc;
}
.col-label {
  color: #0f172a;
  font-weight: 500;
  white-space: nowrap;
}
.col-num {
  text-align: right;
  color: #1e293b;
}
.col-total {
  background: #eff6ff;
  color: #1a56db;
  font-weight: 700;
}
.row-subtotal td {
  font-weight: 700;
  background: #f8fafc;
  border-top: 1px solid #e2e8f0;
}
.row-total td {
  font-weight: 700;
  background: #eff6ff;
  color: #0f172a;
  border-top: 2px solid #1a56db;
}
.neg { color: #dc2626; }
.muted { color: #64748b; }

/* Two column layout */
.two-col {
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 20px;
}
@media (max-width: 900px) {
  .two-col { grid-template-columns: 1fr; }
}

/* Allocations */
.alloc-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 18px;
}
.alloc-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 4px;
  font-size: 13px;
  color: #1e293b;
  border-bottom: 1px dashed #f1f5f9;
}
.alloc-row:last-child { border-bottom: none; }
.alloc-header {
  font-weight: 700;
  color: #0f172a;
  border-bottom: 1px solid #e2e8f0;
  padding-bottom: 10px;
  margin-bottom: 4px;
}
.alloc-subtotal {
  font-weight: 700;
  color: #0f172a;
  background: #f8fafc;
  padding: 10px 8px;
  border-radius: 6px;
  margin: 4px 0;
  border-bottom: none;
}
.alloc-nested {
  padding-left: 22px;
  color: #64748b;
  font-size: 12px;
}
.alloc-nested-label { color: #64748b; }
.alloc-amount {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
.alloc-pct {
  color: #94a3b8;
  font-weight: 500;
  font-size: 11px;
  margin-left: 4px;
}
.alloc-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-right: 8px;
  vertical-align: middle;
}
.dot-orange { background: #f97316; }
.dot-purple { background: #a855f7; }
.dot-teal { background: #14b8a6; }
.dot-blue { background: #1a56db; }
.dot-green { background: #10b981; }

.alloc-bar {
  display: flex;
  height: 12px;
  border-radius: 6px;
  overflow: hidden;
  background: #f1f5f9;
  margin-top: 6px;
}
.alloc-bar-seg {
  height: 100%;
  transition: filter 0.15s;
}
.alloc-bar-seg:hover { filter: brightness(1.1); }
.alloc-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 10px;
  font-size: 12px;
  color: #64748b;
}
.alloc-legend-item {
  display: inline-flex;
  align-items: center;
}

/* Balance card */
.balance-card { background: #0f172a; color: #e2e8f0; border-color: #0f172a; }
.balance-card .section-header h3 { color: #ffffff; }
.balance-card .section-hint { color: #94a3b8; }
.balance-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.balance-list li {
  display: flex;
  justify-content: space-between;
  padding: 10px 4px;
  border-bottom: 1px dashed #334155;
  font-size: 14px;
  color: #cbd5e1;
}
.balance-list li:last-child { border-bottom: none; }
.balance-subtotal {
  font-weight: 700;
  color: #ffffff !important;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 6px;
  padding: 10px 8px !important;
}
.balance-total {
  font-weight: 700;
  color: #ffffff !important;
  border-top: 2px solid #1a56db;
  margin-top: 4px;
  font-size: 16px !important;
  padding-top: 14px !important;
}
.mono {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
.balance-card .neg { color: #fca5a5; }

/* Print */
@media print {
  .page-container { background: #ffffff; padding: 0; }
  .report-toolbar .nav-btn,
  .page-header-actions { display: none !important; }
  .card { box-shadow: none; border-color: #cbd5e1; page-break-inside: avoid; }
  .balance-card { background: #ffffff; color: #0f172a; border-color: #cbd5e1; }
  .balance-card .section-header h3 { color: #0f172a; }
  .balance-card .section-hint,
  .balance-list li { color: #334155; border-color: #e2e8f0; }
  .balance-subtotal,
  .balance-total { color: #0f172a !important; }
  .balance-card .neg { color: #dc2626; }
}
</style>

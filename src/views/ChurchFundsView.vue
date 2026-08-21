<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { SHARE_OF_TOTAL_FUNDS, computeMonthlyReport } from '../utils/collectivesReport'
import Icon from '../components/ui/icons/Icon.vue'
import Button from '../components/ui/Button.vue'
import { supabase } from '../lib/supabase'
import { defaultMonthKey, getMonthRange, parseMonthKey } from '../utils/expensesMonth'
import { mergeMonthSourceWithLiveExpenses } from '../utils/reportExpenseMerge'
import { buildLedgerWeeks, buildMonthSourceFromCollections, openingBalanceForMonth } from '../utils/collectivesSource'
import { formatPeso, formatPesoWhole, formatShare } from '../utils/money'
import { useCurrentRole } from '../composables/useCurrentRole'
import { useActiveChurch } from '../composables/useActiveChurch'

// Church funds — the monthly collectives report.
//
// This is the one screen that computes rather than records, and the arithmetic
// is not this file's: collectivesReport.js holds the allocation rules and is
// tested against the paper workbook. Everything here is presentation.
//
// FundsTabs is gone — the last of the three screens that carried it. Delete the
// component.
//
// The mockup's Contributors table and balance rollup are not drawn in the
// handoff, but both exist today and both are kept: the rollup is the one place
// the closing balance shows its working, and the contributor list is the report
// a treasurer actually reconciles against. They are restyled, not redesigned.

// Contributor identity is finance-staff detail: shown to the Finance ministry and
// SuperAdmin. Pastor / Church Leader / Head Pastor see the report but not individual
// contributor names. canSeeContributorIdentity mirrors the SQL predicate that gates
// the collections SELECT policy (0031) — it is now a real authorization boundary, not
// just a hidden section: the identity-bearing giving rows are only fetched, and only
// returned by the database, for these roles. The report's aggregates come from the
// names-free collectives_service_totals view, so everyone else still gets the totals.
const { canSeeContributorIdentity } = useCurrentRole()

// Church scoping (own church, or the selected church for SuperAdmin / Head Pastor).
// RLS returns every church to those roles, so the report filters by from_church.
const { activeChurchId, ensureLoaded } = useActiveChurch()

// Narrower than COLLECTION_SELECT in CollectionsInputView: the report has no
// edit window to enforce, so it needs neither created_at nor middle_name.
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
  'July', 'August', 'September', 'October', 'November', 'December'
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

// Permissions resolve asynchronously, usually AFTER the immediate loadMonth above
// has already run. The month's aggregates don't depend on them, but the raw giving
// rows (for the Contributors table) are fetched only when the caller may see
// identity — so once that right resolves for a finance user, re-run loadMonth to
// pull the rows it skipped. Only fires on the false->true edge; a viewer never
// triggers it, and it costs at most one extra fetch per session.
watch(canSeeContributorIdentity, (now, was) => {
  if (now && !was) loadMonth()
})

// Reload the ledger and the current month once the active church resolves or changes.
watch(activeChurchId, () => {
  loadServiceTotals()
  loadMonth()
})

const report = computed(() => {
  // Aggregates (tithes/offering per service date) come from the names-free ledger
  // view, NOT from raw giving rows. This is what lets the report keep working for
  // the four viewer roles after 0031 locked the identity-bearing collections rows
  // to finance staff. The view is the whole history; take this month's rows.
  const range = getMonthRange(cursorMonthKey.value)
  const monthTotals = range
    ? serviceTotals.value.filter((r) => {
        const d = String(r?.service_date).slice(0, 10)
        return d >= range.start && d < range.endExclusive
      })
    : []

  const source = {
    year: cursor.value.year,
    month: cursor.value.month,
    // Derived from the ledger rather than stored, so a correction to an older
    // entry re-derives every balance after it with no month-close step.
    openingBalance: openingBalanceForMonth(serviceTotals.value, cursorMonthKey.value),
    // Strip the view's per-date expense sums; mergeMonthSourceWithLiveExpenses
    // re-adds expenses from liveExpenses (the by-description source of truth), and
    // leaving both in would double-count.
    weeks: buildLedgerWeeks(monthTotals).map((w) => ({ ...w, expenses: [] }))
  }

  const base = computeMonthlyReport(mergeMonthSourceWithLiveExpenses(source, liveExpenses.value))

  // Contributor identity is layered on from the raw giving rows, which only a caller
  // who may see identity ever fetches (loadMonth gates the query) and the database
  // only returns to them (0031). For everyone else the list is empty — and the
  // synthetic view-derived contributions above carry no name, so base.contributors
  // would be meaningless; we replace it wholesale rather than read it.
  const contributors = canSeeContributorIdentity.value
    ? computeMonthlyReport(buildMonthSourceFromCollections(monthCollections.value, {
        year: cursor.value.year,
        month: cursor.value.month
      })).contributors
    : []

  return { ...base, contributors }
})

async function loadServiceTotals () {
  loadingLedger.value = true
  ledgerError.value = ''

  // Filter by the active church when it is known. RLS already scopes a single-church
  // user; the explicit filter is what stops a SuperAdmin's ledger merging churches
  // once a church is selected. The watch above re-runs this after the church resolves.
  let query = supabase
    .from('collectives_service_totals')
    .select('service_date, tithes, offering, expenses')
  if (activeChurchId.value) query = query.eq('from_church', activeChurchId.value)

  const { data, error } = await query.order('service_date', { ascending: true })

  if (error) {
    serviceTotals.value = []
    ledgerError.value = 'Unable to load the running balance. The opening balance is shown as zero, so the closing balance covers this month only.'
  } else {
    serviceTotals.value = data || []
  }

  loadingLedger.value = false
}

async function loadMonth () {
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

  // The identity-bearing giving rows (names attached) are fetched ONLY when the
  // caller may see contributor identity. The database enforces this too (0031) —
  // for anyone else the query would return nothing — but skipping it entirely
  // saves a doomed round-trip. The month's aggregates come from serviceTotals (the
  // names-free view), so the report is complete without this query.
  const wantsContributors = canSeeContributorIdentity.value

  let collectionsQuery = null
  if (wantsContributors) {
    collectionsQuery = supabase.from('collections').select(REPORT_COLLECTION_SELECT)
    if (activeChurchId.value) collectionsQuery = collectionsQuery.eq('from_church', activeChurchId.value)
    collectionsQuery = collectionsQuery
      .gte('collectedOn', range.start)
      .lt('collectedOn', range.endExclusive)
      .order('collectedOn', { ascending: true })
  }

  let expensesQuery = supabase.from('expenses').select('spent_on, description, amount')
  if (activeChurchId.value) expensesQuery = expensesQuery.eq('from_church', activeChurchId.value)
  expensesQuery = expensesQuery
    .gte('spent_on', range.start)
    .lt('spent_on', range.endExclusive)
    .order('spent_on', { ascending: true })

  const [collectionsResult, expensesResult] = await Promise.all([
    collectionsQuery ?? Promise.resolve({ data: [], error: null }),
    expensesQuery
  ])

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
  Object.entries(SHARE_OF_TOTAL_FUNDS).map(([key, rate]) => [key, formatRate(rate)])
)

// Whole numbers for the rates in use; a decimal only if one ever needs it.
// Rounds before testing for a whole number: the derived shares carry binary
// float residue (1 − 0.10 − 0.05 − 0.05 is 0.7999999999999999), and the current
// rates only render cleanly because that residue happens to cancel. Do not rely
// on the luck — 40% must not become "39.999999999999996%" if a rate changes.
function formatRate (rate) {
  const pct = Math.round(rate * 1000) / 10
  return `${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`
}

// Nothing in `collections` can populate Others today, so the row and column are
// hidden rather than shown as a permanent ₱0.00. The calculator still sums the
// field, so adding a category column later needs no change here.
const hasOthers = computed(() => report.value.totals.others > 0)

// One list drives the stacked bar AND the rows beneath it — they are the same
// five figures, and letting them drift apart is how a legend stops matching its
// chart. `tone` marks the three that leave the church.
const allocations = computed(() => {
  const t = report.value.totals
  const base = t.totalFunds
  const rows = [
    { key: 'tithesOfTithes', label: 'Tithes of Tithes', amount: t.tithesOfTithes, pct: ratePct.tithesOfTithes, out: true },
    { key: 'project', label: 'Project Fund', amount: t.project, pct: ratePct.project, out: true },
    { key: 'studentProgram', label: 'Student Program', amount: t.studentProgramGross, pct: ratePct.studentProgram, out: true },
    { key: 'pastor', label: 'Pastor’s Allowance', amount: t.pastorAllowance, pct: ratePct.pastor, out: false },
    { key: 'church', label: 'Church Allocation', amount: t.churchAllocation, pct: ratePct.church, out: false }
  ]
  return rows.map((row, i) => ({
    ...row,
    step: i + 1,
    width: base > 0 ? `${(row.amount / base) * 100}%` : '0%'
  }))
})

// Bars measured against the largest line, matching the Expenses screen.
const expenseLines = computed(() => {
  const lines = report.value.expenseSummary
  const largest = lines.length ? Math.max(...lines.map((l) => l.amount)) : 0
  return lines.map((line) => ({
    ...line,
    width: largest > 0 ? `${Math.max((line.amount / largest) * 100, 2)}%` : '0%'
  }))
})

const kpis = computed(() => {
  const t = report.value.totals
  return [
    { key: 'total', label: 'Total funds', value: formatPesoWhole(t.totalFunds), sub: hasOthers.value ? 'Tithes + offering + others' : 'Tithes + offering', tint: 'plain' },
    { key: 'tithes', label: 'Tithes', value: formatPesoWhole(t.tithes), sub: shareOfTotal(t.tithes), tint: 'plain' },
    { key: 'offering', label: 'Offering', value: formatPesoWhole(t.offering), sub: shareOfTotal(t.offering), tint: 'plain' },
    {
      key: 'expenses',
      label: 'Expenses',
      value: formatPesoWhole(t.expenses),
      sub: `${report.value.expenseSummary.length} ${report.value.expenseSummary.length === 1 ? 'description' : 'descriptions'}`,
      tint: 'magenta'
    },
    {
      key: 'closing',
      label: 'Closing balance',
      value: formatPesoWhole(report.value.closingBalance),
      sub: `from ${formatPesoWhole(report.value.openingBalance)}`,
      tint: 'accent'
    }
  ]
})

function shareOfTotal (part) {
  const share = formatShare(part, report.value.totals.totalFunds)
  return share ? `${share} of total` : ''
}

function prevMonth () {
  const { year, month } = cursor.value
  cursor.value = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 }
}

function nextMonth () {
  const { year, month } = cursor.value
  cursor.value = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 }
}

function formatShortDate (iso) {
  // Explicit local midnight: the bare string parses as UTC and names the day
  // before for the first eight hours of every Manila day (D8).
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })
}

// window.print(), not a generated file. The browser's print dialog saves a PDF
// on every platform this church uses, and a hand-rolled export would be a new
// dependency and a new thing to keep in step with the report.
function handlePrint () {
  window.print()
}

// Height transitions on a table, done from JS because `height: auto` is not an
// animatable value. Unchanged from the previous implementation.
function beforeExpand (el) {
  el.style.height = '0'
  el.style.opacity = '0'
  el.style.overflow = 'hidden'
}

function expand (el) {
  el.style.transition = 'height 280ms cubic-bezier(0.22, 1, 0.36, 1), opacity 220ms ease'
  requestAnimationFrame(() => {
    el.style.height = `${el.scrollHeight}px`
    el.style.opacity = '1'
  })
}

function afterExpand (el) {
  el.style.height = 'auto'
  el.style.overflow = 'visible'
  el.style.transition = ''
}

function beforeCollapse (el) {
  el.style.height = `${el.scrollHeight}px`
  el.style.opacity = '1'
  el.style.overflow = 'hidden'
}

function collapse (el) {
  el.style.transition = 'height 260ms cubic-bezier(0.4, 0, 0.2, 1), opacity 180ms ease'
  requestAnimationFrame(() => {
    el.style.height = '0'
    el.style.opacity = '0'
  })
}

function afterCollapse (el) {
  el.style.transition = ''
  el.style.height = ''
  el.style.opacity = ''
  el.style.overflow = ''
}
</script>

<template>
  <div class="fun">
    <header
      class="fun__head anim-rise"
      style="--i: 0"
    >
      <div class="fun__title-block">
        <h1 class="fun__title">
          Church funds
        </h1>
        <p class="fun__sub">
          Collectives report · {{ report.weeks.length }}
          {{ report.weeks.length === 1 ? 'service date' : 'service dates' }}
        </p>
      </div>

      <div class="fun__actions">
        <div class="fun__month">
          <button
            type="button"
            class="fun__step"
            aria-label="Previous month"
            @click="prevMonth"
          >
            <Icon
              name="chevronLeft"
              :size="15"
            />
          </button>
          <span class="fun__month-label">{{ monthLabel }}</span>
          <button
            type="button"
            class="fun__step"
            aria-label="Next month"
            @click="nextMonth"
          >
            <Icon
              name="chevronRight"
              :size="15"
            />
          </button>
        </div>
        <Button @click="handlePrint">
          Print
        </Button>
      </div>
    </header>

    <p
      v-if="loadError"
      class="fun__warning"
      role="alert"
    >
      {{ loadError }}
    </p>

    <!-- The empty state is gated on `loading` or it flashes "nothing recorded"
         on every month navigation. -->
    <!-- role + aria-label, not just shapes. Skeletons say "something is coming"
         to the eye and nothing at all to a screen reader, and this replaced a
         state that used to read "Loading May 2026…" aloud. -->
    <div
      v-if="loading"
      class="fun__cards"
      role="status"
      :aria-label="`Loading ${monthLabel}`"
    >
      <div
        v-for="n in 5"
        :key="n"
        class="skeleton fun__kpi-skeleton"
      />
    </div>

    <section
      v-else-if="report.weeks.length === 0"
      class="fun__card fun__card--pad anim-rise"
      style="--i: 1"
    >
      <p class="fun__empty">
        No collectives recorded for {{ monthLabel }}.
      </p>
    </section>

    <template v-else>
      <div class="fun__kpis">
        <div
          v-for="(k, i) in kpis"
          :key="k.key"
          class="fun__kpi anim-rise"
          :class="`fun__kpi--${k.tint}`"
          :style="`--i: ${i + 1}`"
        >
          <span class="fun__kpi-label">{{ k.label }}</span>
          <span class="fun__kpi-value">{{ k.value }}</span>
          <span class="fun__kpi-sub">{{ k.sub }}</span>
        </div>
      </div>

      <div class="fun__split">
        <!-- Where the money went -->
        <section
          class="fun__card fun__card--pad anim-rise"
          style="--i: 6"
        >
          <h2 class="fun__card-title">
            Where the {{ formatPeso(report.totals.totalFunds) }} went
          </h2>
          <p class="fun__card-note">
            Fixed allocation rates, applied per service date
          </p>

          <div
            class="fun__alloc-bar anim-grow"
            role="img"
            :aria-label="`Allocation of ${formatPeso(report.totals.totalFunds)} for ${monthLabel}`"
          >
            <span
              v-for="seg in allocations"
              :key="seg.key"
              class="fun__alloc-seg"
              :class="`fun__alloc-seg--${seg.step}`"
              :style="{ width: seg.width }"
            />
          </div>

          <ul class="fun__alloc-rows">
            <li
              v-for="seg in allocations"
              :key="seg.key"
              class="fun__alloc-row"
            >
              <span
                class="fun__dot"
                :class="`fun__dot--${seg.step}`"
              />
              <span class="fun__alloc-label">{{ seg.label }}</span>
              <span class="fun__alloc-pct">{{ seg.pct }}</span>
              <span
                class="fun__alloc-amount"
                :class="{ 'is-out': seg.out }"
              >{{ seg.out ? '− ' : '' }}{{ formatPeso(seg.amount) }}</span>
            </li>

            <!-- No column stores a per-service personal draw, so this stays
                 hidden with live data. Kept because the calculator supports it
                 and the paper report has the line. -->
            <li
              v-if="report.totals.studentProgramDeduction > 0"
              class="fun__alloc-row fun__alloc-row--nested"
            >
              <span class="fun__alloc-label">Less: personal draw</span>
              <span class="fun__alloc-amount">+ {{ formatPeso(report.totals.studentProgramDeduction) }}</span>
            </li>
          </ul>
        </section>

        <!-- Expenses -->
        <section
          class="fun__card fun__card--pad anim-rise"
          style="--i: 7"
        >
          <h2 class="fun__card-title">
            Expenses
          </h2>
          <p class="fun__card-note">
            Charged against the church allocation
          </p>

          <p
            v-if="!expenseLines.length"
            class="fun__empty fun__empty--inset"
          >
            No expenses recorded this month.
          </p>

          <template v-else>
            <ul class="fun__bars">
              <li
                v-for="(line, i) in expenseLines"
                :key="line.description"
                class="fun__bar-row"
              >
                <span class="fun__bar-label">{{ line.description }}</span>
                <span class="fun__bar-track">
                  <span
                    class="fun__bar-fill anim-grow"
                    :style="`width: ${line.width}; --i: ${i}`"
                  />
                </span>
                <span class="fun__bar-amount">{{ formatPeso(line.amount) }}</span>
              </li>
            </ul>

            <div class="fun__bars-total">
              <span>Total expenses</span>
              <span class="fun__out">{{ formatPeso(report.totals.expenses) }}</span>
            </div>
          </template>
        </section>
      </div>

      <!-- Weekly breakdown -->
      <section
        class="fun__card anim-rise"
        style="--i: 8"
      >
        <div class="fun__card-head">
          <div class="fun__card-heading">
            <h2 class="fun__card-title">
              Weekly breakdown
            </h2>
            <span class="fun__card-meta">Per-service totals for {{ monthLabel }}</span>
          </div>
          <button
            type="button"
            class="fun__toggle"
            :aria-expanded="weeklyExpanded"
            aria-controls="weekly-breakdown-content"
            @click="weeklyExpanded = !weeklyExpanded"
          >
            {{ weeklyExpanded ? 'Collapse' : 'Expand' }}
            <Icon
              name="chevronDown"
              :size="14"
              class="fun__toggle-icon"
              :class="{ 'is-collapsed': !weeklyExpanded }"
            />
          </button>
        </div>

        <Transition
          @before-enter="beforeExpand"
          @enter="expand"
          @after-enter="afterExpand"
          @before-leave="beforeCollapse"
          @leave="collapse"
          @after-leave="afterCollapse"
        >
          <div
            v-show="weeklyExpanded"
            id="weekly-breakdown-content"
            class="fun__scroll"
          >
            <table class="fun__table">
              <thead>
                <tr>
                  <th scope="col">
                    Metric
                  </th>
                  <th
                    v-for="w in report.weeks"
                    :key="w.date"
                    scope="col"
                    class="fun__num"
                  >
                    {{ formatShortDate(w.date) }}
                  </th>
                  <th
                    scope="col"
                    class="fun__num fun__month-col"
                  >
                    Month
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">
                    Tithes
                  </th>
                  <td
                    v-for="w in report.weeks"
                    :key="w.date"
                    class="fun__num"
                  >
                    {{ formatPeso(w.tithes) }}
                  </td>
                  <td class="fun__num fun__month-col">
                    {{ formatPeso(report.totals.tithes) }}
                  </td>
                </tr>
                <tr>
                  <th scope="row">
                    Offering
                  </th>
                  <td
                    v-for="w in report.weeks"
                    :key="w.date"
                    class="fun__num"
                  >
                    {{ formatPeso(w.offering) }}
                  </td>
                  <td class="fun__num fun__month-col">
                    {{ formatPeso(report.totals.offering) }}
                  </td>
                </tr>
                <tr v-if="hasOthers">
                  <th scope="row">
                    Others
                  </th>
                  <td
                    v-for="w in report.weeks"
                    :key="w.date"
                    class="fun__num"
                  >
                    {{ formatPeso(w.others) }}
                  </td>
                  <td class="fun__num fun__month-col">
                    {{ formatPeso(report.totals.others) }}
                  </td>
                </tr>
                <tr class="fun__row--strong">
                  <th scope="row">
                    Total funds
                  </th>
                  <td
                    v-for="w in report.weeks"
                    :key="w.date"
                    class="fun__num"
                  >
                    {{ formatPeso(w.totalFunds) }}
                  </td>
                  <td class="fun__num fun__month-col">
                    {{ formatPeso(report.totals.totalFunds) }}
                  </td>
                </tr>
                <tr>
                  <th scope="row">
                    Expenses
                  </th>
                  <td
                    v-for="w in report.weeks"
                    :key="w.date"
                    class="fun__num fun__out"
                  >
                    {{ formatPeso(w.totalExpenses) }}
                  </td>
                  <td class="fun__num fun__month-col fun__out">
                    {{ formatPeso(report.totals.expenses) }}
                  </td>
                </tr>
                <tr>
                  <th scope="row">
                    Church allocation
                  </th>
                  <td
                    v-for="w in report.weeks"
                    :key="w.date"
                    class="fun__num"
                  >
                    {{ formatPeso(w.churchAllocation) }}
                  </td>
                  <td class="fun__num fun__month-col">
                    {{ formatPeso(report.totals.churchAllocation) }}
                  </td>
                </tr>
                <tr class="fun__row--strong">
                  <th scope="row">
                    Net church funds
                  </th>
                  <td
                    v-for="w in report.weeks"
                    :key="w.date"
                    class="fun__num"
                    :class="{ 'fun__out': w.netChurchFunds < 0 }"
                  >
                    {{ formatPeso(w.netChurchFunds) }}
                  </td>
                  <td
                    class="fun__num fun__month-col"
                    :class="{ 'fun__out': report.totals.netChurchFunds < 0 }"
                  >
                    {{ formatPeso(report.totals.netChurchFunds) }}
                  </td>
                </tr>
                <tr class="fun__row--muted">
                  <th scope="row">
                    Running balance
                  </th>
                  <td
                    v-for="w in report.weeks"
                    :key="w.date"
                    class="fun__num"
                  >
                    {{ formatPeso(w.closingBalance) }}
                  </td>
                  <td class="fun__num fun__month-col">
                    {{ formatPeso(report.closingBalance) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </Transition>
      </section>

      <!-- How the closing balance is reached -->
      <section
        class="fun__card fun__card--pad anim-rise"
        style="--i: 9"
      >
        <h2 class="fun__card-title">
          Church funds balance
        </h2>
        <p class="fun__card-note">
          Rollup for {{ monthLabel }}
        </p>

        <ul class="fun__balance">
          <li>
            <span>Church allocation (month)</span>
            <span class="fun__balance-amount">{{ formatPeso(report.totals.churchAllocation) }}</span>
          </li>
          <li>
            <span>Less: total expenses</span>
            <span class="fun__balance-amount fun__out">− {{ formatPeso(report.totals.expenses) }}</span>
          </li>
          <li class="fun__balance-sub">
            <span>Net church funds (month)</span>
            <span
              class="fun__balance-amount"
              :class="{ 'fun__out': report.totals.netChurchFunds < 0 }"
            >{{ formatPeso(report.totals.netChurchFunds) }}</span>
          </li>
          <li>
            <span>Add: opening balance</span>
            <span class="fun__balance-amount">+ {{ formatPeso(report.openingBalance) }}</span>
          </li>
          <li class="fun__balance-total">
            <span>Current church funds</span>
            <span class="fun__balance-amount">{{ formatPeso(report.closingBalance) }}</span>
          </li>
        </ul>
      </section>

      <!-- Contributors (finance staff / SuperAdmin only) -->
      <section
        v-if="canSeeContributorIdentity"
        class="fun__card anim-rise"
        style="--i: 10"
      >
        <div class="fun__card-head">
          <div class="fun__card-heading">
            <h2 class="fun__card-title">
              Contributors
            </h2>
            <span class="fun__card-meta">
              {{ report.contributors.length }}
              {{ report.contributors.length === 1 ? 'row' : 'rows' }} ·
              each anonymous gift is listed separately
            </span>
          </div>
          <button
            type="button"
            class="fun__toggle"
            :aria-expanded="contributorsExpanded"
            aria-controls="contributors-content"
            @click="contributorsExpanded = !contributorsExpanded"
          >
            {{ contributorsExpanded ? 'Collapse' : 'Expand' }}
            <Icon
              name="chevronDown"
              :size="14"
              class="fun__toggle-icon"
              :class="{ 'is-collapsed': !contributorsExpanded }"
            />
          </button>
        </div>

        <Transition
          @before-enter="beforeExpand"
          @enter="expand"
          @after-enter="afterExpand"
          @before-leave="beforeCollapse"
          @leave="collapse"
          @after-leave="afterCollapse"
        >
          <div
            v-show="contributorsExpanded"
            id="contributors-content"
            class="fun__scroll"
          >
            <table class="fun__table">
              <thead>
                <tr>
                  <th scope="col">
                    Name
                  </th>
                  <th
                    scope="col"
                    class="fun__num"
                  >
                    Tithes
                  </th>
                  <th
                    scope="col"
                    class="fun__num"
                  >
                    Offering
                  </th>
                  <th
                    v-if="hasOthers"
                    scope="col"
                    class="fun__num"
                  >
                    Others
                  </th>
                  <th
                    scope="col"
                    class="fun__num fun__month-col"
                  >
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                <!-- Keyed on `key`, not `name`: several rows legitimately read
                     "Anonymous", one per gift. -->
                <tr
                  v-for="c in report.contributors"
                  :key="c.key"
                >
                  <th scope="row">
                    {{ c.name }}
                  </th>
                  <td class="fun__num">
                    {{ formatPeso(c.tithes) }}
                  </td>
                  <td class="fun__num">
                    {{ formatPeso(c.offering) }}
                  </td>
                  <td
                    v-if="hasOthers"
                    class="fun__num"
                  >
                    {{ formatPeso(c.others) }}
                  </td>
                  <td class="fun__num fun__month-col">
                    {{ formatPeso(c.total) }}
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr class="fun__row--strong">
                  <th scope="row">
                    Total
                  </th>
                  <td class="fun__num">
                    {{ formatPeso(report.totals.tithes) }}
                  </td>
                  <td class="fun__num">
                    {{ formatPeso(report.totals.offering) }}
                  </td>
                  <td
                    v-if="hasOthers"
                    class="fun__num"
                  >
                    {{ formatPeso(report.totals.others) }}
                  </td>
                  <td class="fun__num fun__month-col">
                    {{ formatPeso(report.totals.totalFunds) }}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Transition>
      </section>
    </template>
  </div>
</template>

<style scoped>
/* The allocation ramp. Five steps of the brand cyan, because these five figures
   are one quantity being divided — five unrelated hues (the old orange /
   purple / teal / blue / green) read as five unrelated things.

   The dark theme shifts the whole ramp one step lighter: the darkest two steps
   are legible on white and invisible on #141d26. */
.fun {
  --seg-1: #99e0ff;
  --seg-2: #62c5ee;
  --seg-3: #38a6cf;
  --seg-4: #0088b0;
  --seg-5: #006786;

  display: flex;
  flex-direction: column;
  gap: var(--sp-18);
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) .fun {
    --seg-1: #e0f5ff;
    --seg-2: #a8e6ff;
    --seg-3: #7cd4fd;
    --seg-4: #38a6cf;
    --seg-5: #0088b0;
  }
}
:root[data-theme='dark'] .fun {
  --seg-1: #e0f5ff;
  --seg-2: #a8e6ff;
  --seg-3: #7cd4fd;
  --seg-4: #38a6cf;
  --seg-5: #0088b0;
}

/* --- Header ------------------------------------------------------------- */
.fun__head { display: flex; align-items: flex-end; justify-content: space-between; gap: var(--sp-16); }
.fun__title-block { display: flex; flex-direction: column; gap: var(--sp-5); min-width: 0; }

.fun__title {
  font-size: var(--text-h1);
  font-weight: 800;
  letter-spacing: var(--tracking-h1);
  line-height: var(--leading-h1);
}

.fun__sub { font-size: var(--text-body); color: var(--ink-4); }

.fun__actions { display: flex; align-items: center; gap: var(--sp-9); }

.fun__month {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--border-strong);
  border-radius: var(--r-control);
  background: var(--surface);
}

.fun__step {
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
.fun__step:hover { background: var(--divider); color: var(--ink); }
.fun__step:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.fun__month-label { padding: 0 var(--sp-10); font-size: var(--text-body-sm); font-weight: 800; color: var(--ink); white-space: nowrap; }

.fun__warning {
  padding: var(--sp-10) var(--sp-12);
  border-radius: var(--r-inset);
  background: var(--magenta-tint);
  border: 1px solid var(--magenta-border);
  font-size: var(--text-body-sm);
  color: var(--magenta-darkest);
}

/* --- KPI tiles ---------------------------------------------------------- */
.fun__kpis { display: grid; grid-template-columns: repeat(5, 1fr); gap: var(--sp-14); }

.fun__kpi {
  display: flex;
  flex-direction: column;
  gap: var(--sp-8);
  padding: var(--sp-16);
  border-radius: var(--r-inset);
  border: 1px solid var(--border);
  background: var(--surface);
  box-shadow: var(--shadow-card);
}

.fun__kpi-label { font-size: var(--text-meta-sm); font-weight: 700; color: var(--ink-4); }
.fun__kpi-value { font-size: 21px; font-weight: 800; letter-spacing: -0.03em; color: var(--ink); font-variant-numeric: tabular-nums; }
.fun__kpi-sub { font-size: var(--text-meta-sm); color: var(--ink-5); min-height: 1em; }

.fun__kpi--magenta { background: var(--magenta-tint); border-color: var(--magenta-border); }
.fun__kpi--magenta .fun__kpi-label { color: var(--magenta-deep); }
.fun__kpi--magenta .fun__kpi-value { color: var(--magenta-darkest); }
.fun__kpi--magenta .fun__kpi-sub { color: var(--magenta-deep); }

.fun__kpi--accent { background: var(--accent-tint); border-color: var(--accent-border); }
.fun__kpi--accent .fun__kpi-label { color: var(--accent-darkest); }
.fun__kpi--accent .fun__kpi-value { color: var(--accent-darkest); }
.fun__kpi--accent .fun__kpi-sub { color: var(--accent-darkest); opacity: .8; }

.fun__cards { display: grid; grid-template-columns: repeat(5, 1fr); gap: var(--sp-14); }
.fun__kpi-skeleton { height: 92px; border-radius: var(--r-inset); }

/* --- Cards -------------------------------------------------------------- */
.fun__split { display: grid; grid-template-columns: 1.35fr 1fr; gap: var(--sp-18); align-items: start; }

.fun__card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-card);
  box-shadow: var(--shadow-card);
  overflow: hidden;
  min-width: 0;
}
.fun__card--pad { padding: var(--sp-20); }

.fun__card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-12);
  padding: var(--sp-14) var(--sp-20);
  border-bottom: 1px solid var(--divider);
}

.fun__card-heading { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.fun__card-title { font-size: var(--text-h2); font-weight: 800; letter-spacing: var(--tracking-h2); color: var(--ink); }
.fun__card-note { margin-top: 3px; font-size: var(--text-meta); color: var(--ink-5); }
.fun__card-meta { font-size: var(--text-meta); color: var(--ink-5); }

.fun__toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-6);
  flex: none;
  padding: var(--sp-6) var(--sp-10);
  border: 1px solid var(--border);
  border-radius: var(--r-tag);
  background: var(--surface);
  font-family: var(--font-sans);
  font-size: var(--text-meta);
  font-weight: 700;
  color: var(--ink-3);
  cursor: pointer;
  transition: background-color var(--dur-state) ease, border-color var(--dur-state) ease;
}
.fun__toggle:hover { background: var(--surface-subtle); border-color: var(--border-strong); }
.fun__toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.fun__toggle-icon { transition: transform var(--dur-state) ease; }
.fun__toggle-icon.is-collapsed { transform: rotate(-90deg); }

/* --- Allocation --------------------------------------------------------- */
.fun__alloc-bar {
  display: flex;
  height: 32px;
  margin-top: var(--sp-16);
  border-radius: 9px;
  overflow: hidden;
  background: var(--divider);
}

.fun__alloc-seg { transition: filter var(--dur-state) ease; }
.fun__alloc-seg:hover { filter: brightness(1.08); }

.fun__alloc-seg--1, .fun__dot--1 { background: var(--seg-1); }
.fun__alloc-seg--2, .fun__dot--2 { background: var(--seg-2); }
.fun__alloc-seg--3, .fun__dot--3 { background: var(--seg-3); }
.fun__alloc-seg--4, .fun__dot--4 { background: var(--seg-4); }
.fun__alloc-seg--5, .fun__dot--5 { background: var(--seg-5); }

.fun__alloc-rows { list-style: none; margin: var(--sp-16) 0 0; padding: 0; }

.fun__alloc-row {
  display: flex;
  align-items: center;
  gap: var(--sp-10);
  padding: var(--sp-9) 0;
  border-bottom: 1px solid var(--divider);
}
.fun__alloc-row:last-child { border-bottom: 0; }
.fun__alloc-row--nested { padding-left: var(--sp-20); }

.fun__dot { width: 10px; height: 10px; flex: none; border-radius: 4px; }

.fun__alloc-label { font-size: var(--text-body-sm); font-weight: 600; color: var(--ink); }
.fun__alloc-pct { font-size: var(--text-meta); color: var(--ink-5); }

.fun__alloc-amount {
  margin-left: auto;
  font-size: var(--text-body-sm);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: var(--ink);
  white-space: nowrap;
}
.fun__alloc-amount.is-out { color: var(--magenta-darkest); }

/* --- Expense bars ------------------------------------------------------- */
.fun__bars { list-style: none; margin: var(--sp-16) 0 0; padding: 0; display: flex; flex-direction: column; }

.fun__bar-row { display: flex; align-items: center; gap: var(--sp-12); padding: var(--sp-6) 0; }

.fun__bar-label {
  width: 128px;
  flex: none;
  font-size: var(--text-body-sm);
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fun__bar-track {
  flex: 1;
  min-width: 0;
  height: 8px;
  border-radius: var(--r-pill);
  background: var(--divider);
  overflow: hidden;
}

.fun__bar-fill { display: block; height: 100%; background: var(--magenta); transform-origin: left; }

.fun__bar-amount {
  width: 78px;
  flex: none;
  text-align: right;
  font-size: var(--text-meta);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: var(--ink);
}

.fun__bars-total {
  display: flex;
  justify-content: space-between;
  gap: var(--sp-12);
  margin-top: var(--sp-16);
  padding-top: var(--sp-12);
  border-top: 1px solid var(--border);
  font-size: var(--text-body-sm);
  font-weight: 800;
  color: var(--ink);
}

.fun__out { color: var(--magenta-darkest); font-variant-numeric: tabular-nums; }

/* --- Tables ------------------------------------------------------------- */
.fun__scroll { overflow-x: auto; }

.fun__table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }

.fun__table th[scope='col'] {
  text-align: left;
  padding: var(--sp-10) var(--sp-20);
  background: var(--surface-subtle);
  border-bottom: 1px solid var(--divider);
  font-size: var(--text-meta-sm);
  font-weight: 700;
  letter-spacing: .05em;
  text-transform: uppercase;
  color: var(--ink-5);
  white-space: nowrap;
}

.fun__table th[scope='row'] {
  text-align: left;
  padding: var(--sp-10) var(--sp-20);
  border-bottom: 1px solid var(--divider);
  font-size: var(--text-body-sm);
  font-weight: 600;
  color: var(--ink);
  white-space: nowrap;
}

.fun__table td {
  padding: var(--sp-10) var(--sp-20);
  border-bottom: 1px solid var(--divider);
  font-size: var(--text-body-sm);
  color: var(--ink-3);
}

.fun__table tbody tr:hover th[scope='row'],
.fun__table tbody tr:hover td { background: var(--surface-subtle-2); }

/* The header selector has to be at least as specific as `.fun__table
   th[scope='col']`, which sets text-align: left for the Metric column. Without
   the th here, every money column's heading sat left while its figures sat
   right — the one alignment error a table of money cannot afford. */
.fun__num,
.fun__table th[scope='col'].fun__num { text-align: right; white-space: nowrap; }

/* The month column is the answer the whole row builds to. */
.fun__month-col { color: var(--accent-darkest); font-weight: 800; }
.fun__table th[scope='col'].fun__month-col { color: var(--accent-darkest); }

.fun__row--strong th[scope='row'],
.fun__row--strong td { font-weight: 800; color: var(--ink); }

.fun__row--muted td { color: var(--ink-5); }
.fun__row--muted th[scope='row'] { color: var(--ink-4); font-weight: 500; }

/* --- Balance rollup ----------------------------------------------------- */
.fun__balance { list-style: none; margin: var(--sp-16) 0 0; padding: 0; }

.fun__balance li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-12);
  padding: var(--sp-9) 0;
  border-bottom: 1px solid var(--divider);
  font-size: var(--text-body-sm);
  color: var(--ink-3);
}

.fun__balance-amount { font-weight: 700; font-variant-numeric: tabular-nums; color: var(--ink); white-space: nowrap; }

.fun__balance-sub { font-weight: 700; color: var(--ink); }

.fun__balance-total {
  border-bottom: 0;
  padding-top: var(--sp-12);
  border-top: 1px solid var(--border);
  font-weight: 800;
  color: var(--accent-darkest);
}
.fun__balance-total .fun__balance-amount { font-size: 15px; font-weight: 800; color: var(--accent-darkest); }

.fun__empty { font-size: var(--text-body-sm); color: var(--ink-5); }
.fun__empty--inset {
  margin-top: var(--sp-16);
  padding: var(--sp-16);
  border-radius: var(--r-inset);
  background: var(--surface-subtle);
  border: 1px solid var(--border);
}

/* --- Print: the report is a document before it is a screen -------------- */
@media print {
  .fun__actions,
  .fun__toggle { display: none; }
  .fun__card { box-shadow: none; break-inside: avoid; }
}

@media (max-width: 1200px) {
  .fun__kpis,
  .fun__cards { grid-template-columns: repeat(3, 1fr); }
}

@media (max-width: 1000px) {
  .fun__split { grid-template-columns: 1fr; }
}

@media (max-width: 700px) {
  .fun__kpis,
  .fun__cards { grid-template-columns: 1fr 1fr; }
  .fun__head { flex-direction: column; align-items: stretch; gap: var(--sp-12); }
  .fun__actions { justify-content: space-between; }
  .fun__bar-label { width: 96px; }
}
</style>

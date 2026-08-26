<script setup>
import { computed, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import Icon from '../components/ui/icons/Icon.vue'
import Button from '../components/ui/Button.vue'
import CollectionsInputView from './CollectionsInputView.vue'
import ExpensesInputView from './ExpensesInputView.vue'
import ChurchFundsView from './ChurchFundsView.vue'
import { defaultMonthKey } from '../utils/expensesMonth'
import { visibleFinanceTabs, resolveFinanceTab } from '../utils/financeTabs'
import { useActiveChurch } from '../composables/useActiveChurch'
import { useCurrentRole } from '../composables/useCurrentRole'

// The Finance workspace — one destination that gathers what were three sidebar items
// in the flat nine (9 - Finance.dc.html: "three sidebar items become one"). Nothing
// inside is new: the same Collections form, the same Expenses form, the same collectives
// Report, moved behind one item with a three-way switch.
//
// THE SHELL OWNS WHAT THE THREE USED TO EACH OWN: the "Finance" title, one month
// stepper shared across all three tabs, and the Print button (which only prints the
// Report — the one tab that is a document). Each tab is the existing view, taking the
// shared month as a v-model prop. Switching tabs keeps the month; saving an entry into
// another month moves the shared month, so the tab you land on shows what you just typed.
//
// THE SWITCH IS CAPABILITY-GATED, HIDDEN NOT LOCKED. Collections and Expenses need
// canWriteFinance; the Report needs only canViewFinance. A view-only oversight caller
// (Head Pastor / Pastor / Church Leader) sees a single "Funds Report" tab, not two entry
// forms they cannot use — and deep-linking /finance/collections redirects them to the
// report. The route gate (canViewFinance) is what lets them reach the workspace at all;
// this tab gate mirrors the per-screen gates the three always carried. RLS is the
// enforcement (migrations 0008/0009/0031); this is UI shaping only.

const COMPONENTS = {
  collections: CollectionsInputView,
  expenses: ExpensesInputView,
  report: ChurchFundsView,
}

const route = useRoute()
const router = useRouter()
const { caps, permissions } = useCurrentRole()
const { ensureLoaded } = useActiveChurch()
ensureLoaded()

// Permissions resolve asynchronously; until they do, caps read empty and would land
// everyone on the report. Gate the workspace on a resolved snapshot so a finance writer
// deep-linking /finance/collections is not flashed the report first. Usually already
// cached from a prior view, so this is instant in practice.
const ready = computed(() => permissions.value !== null)

const tabs = computed(() => visibleFinanceTabs(caps.value))
const activeTab = computed(() => resolveFinanceTab(route.params.tab, caps.value))
const subtitle = computed(() => {
  const tab = tabs.value.find((t) => t.key === activeTab.value)
  return tab ? tab.sub : ''
})
const activeComponent = computed(() => COMPONENTS[activeTab.value])
const showPrint = computed(() => activeTab.value === 'report')

// The one shared month, "YYYY-MM". Passed to whichever tab is mounted, so all three
// stay on the same month; a tab that saves into another month moves it via update:month.
const month = ref(defaultMonthKey())

const monthLabel = computed(() => {
  const [year, m] = month.value.split('-')
  if (!year || !m) return ''
  return new Date(Number(year), Number(m) - 1, 1)
    .toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })
})

function shiftMonth (delta) {
  const [year, m] = month.value.split('-').map(Number)
  const date = new Date(year, m - 1 + delta, 1)
  month.value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

// Keep the URL honest: correct a bare /finance, an unknown tab, or a tab the caller may
// not open, to the resolved tab — but only once permissions have resolved, so we never
// redirect a writer to the report on a stale empty caps snapshot.
watch(
  [() => route.params.tab, ready],
  ([requested, isReady]) => {
    if (!isReady) return
    const resolved = resolveFinanceTab(requested, caps.value)
    if (requested !== resolved) {
      router.replace({ name: 'Finance', params: { tab: resolved } })
    }
  },
  { immediate: true },
)

function printReport () {
  // window.print(), not a generated file — the browser's print dialog saves a PDF on
  // every platform this church uses. FinanceView's @media print rules hide this chrome;
  // the Report view strips its own.
  window.print()
}
</script>

<template>
  <div class="fin">
    <header
      class="fin__head anim-rise"
      style="--i: 0"
    >
      <div class="fin__title-block">
        <h1 class="fin__title">
          Finance
        </h1>
        <p class="fin__sub">
          {{ subtitle }}
        </p>
      </div>

      <div class="fin__actions">
        <div class="fin__month">
          <button
            type="button"
            class="fin__step"
            aria-label="Previous month"
            @click="shiftMonth(-1)"
          >
            <Icon
              name="chevronLeft"
              :size="15"
            />
          </button>
          <span class="fin__month-label">{{ monthLabel }}</span>
          <button
            type="button"
            class="fin__step"
            aria-label="Next month"
            @click="shiftMonth(1)"
          >
            <Icon
              name="chevronRight"
              :size="15"
            />
          </button>
        </div>
        <Button
          v-if="showPrint"
          @click="printReport"
        >
          Print
        </Button>
      </div>
    </header>

    <!-- The three-way switch. Only the tabs the caller may open are rendered — a
         view-only caller sees a single "Funds Report" tab. Each is a real link, so a
         tab is deep-linkable and the browser's back button walks the tabs. -->
    <nav
      v-if="tabs.length > 1"
      class="fin__tabs anim-rise"
      style="--i: 1"
      aria-label="Finance sections"
    >
      <RouterLink
        v-for="tab in tabs"
        :key="tab.key"
        :to="{ name: 'Finance', params: { tab: tab.key } }"
        class="fin__tab"
        :class="{ 'is-active': activeTab === tab.key }"
        :aria-current="activeTab === tab.key ? 'page' : undefined"
      >
        {{ tab.label }}
      </RouterLink>
    </nav>

    <component
      :is="activeComponent"
      v-if="ready"
      v-model:month="month"
    />
  </div>
</template>

<style scoped>
.fin { display: flex; flex-direction: column; gap: var(--sp-20); }

/* --- Header ------------------------------------------------------------- */
.fin__head { display: flex; align-items: flex-end; justify-content: space-between; gap: var(--sp-16); }
.fin__title-block { display: flex; flex-direction: column; gap: var(--sp-5); min-width: 0; }

.fin__title {
  font-size: var(--text-h1);
  font-weight: 800;
  letter-spacing: var(--tracking-h1);
  line-height: var(--leading-h1);
}

.fin__sub { font-size: var(--text-body); color: var(--ink-4); min-height: 1.2em; }

.fin__actions { display: flex; align-items: center; gap: var(--sp-9); }

/* --- Month stepper (shared across the three tabs) ----------------------- */
.fin__month {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--border-strong);
  border-radius: var(--r-control);
  background: var(--surface);
}

.fin__step {
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
.fin__step:hover { background: var(--divider); color: var(--ink); }
.fin__step:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.fin__month-label { padding: 0 var(--sp-10); font-size: var(--text-body-sm); font-weight: 800; color: var(--ink); white-space: nowrap; }

/* --- The three-way switch ----------------------------------------------- */
.fin__tabs {
  display: inline-flex;
  align-self: flex-start;
  gap: 4px;
  padding: 4px;
  background: var(--surface-subtle-2);
  border-radius: var(--r-control);
}

.fin__tab {
  padding: 9px 18px;
  border-radius: var(--r-tag);
  font-family: var(--font-sans);
  font-size: var(--text-body-sm);
  font-weight: 700;
  color: var(--ink-4);
  text-decoration: none;
  cursor: pointer;
  transition: background-color var(--dur-state) ease, color var(--dur-state) ease;
}
.fin__tab:hover { color: var(--ink); }
.fin__tab:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.fin__tab.is-active {
  background: var(--surface);
  color: var(--accent-darkest);
  box-shadow: var(--shadow-card);
}

/* --- Print: only the Report is a document, and its chrome is not part of it -- */
@media print {
  .fin__head,
  .fin__tabs { display: none; }
}

@media (max-width: 700px) {
  .fin__head { flex-direction: column; align-items: stretch; gap: var(--sp-12); }
  .fin__actions { justify-content: space-between; }
  .fin__tabs { align-self: stretch; }
  .fin__tab { flex: 1; text-align: center; }
}
</style>

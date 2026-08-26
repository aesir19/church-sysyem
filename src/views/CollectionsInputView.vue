<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { supabase } from '../lib/supabase'
import Avatar from '../components/ui/Avatar.vue'
import Badge from '../components/ui/Badge.vue'
import ContributionForm from '../components/collections/ContributionForm.vue'
import EntryDetailModal from '../components/collections/EntryDetailModal.vue'
import { defaultMonthKey, getMonthRange, monthKeyFromDate } from '../utils/expensesMonth'
import { contributorLabel, isAnonymousRow } from '../utils/collectionPayload'
import { formatPeso, formatPesoWhole, formatShare } from '../utils/money'
import { useActiveChurch } from '../composables/useActiveChurch'

// Collections — tithes and offering, entered per service date.
//
// The entry form is the left column and the month is the right one, which is
// the mockup's arrangement and also the working order: somebody sits down with
// the counting sheet, enters twenty rows, and watches the totals move. The old
// screen stacked them, so the totals were below the fold exactly when they were
// the thing being checked.
//
// A TAB OF THE FINANCE WORKSPACE, NOT A PAGE OF ITS OWN. Collections, Expenses and
// the Funds Report are one "Finance" destination now (9 - Finance.dc.html), so the
// month stepper and the page title live in FinanceView's shared header, not here.
// The active month arrives as a `month` v-model prop; saving into another month asks
// the shell to move it, so all three tabs stay on the same month.

const props = defineProps({
  // "YYYY-MM". Owned by FinanceView so the whole workspace shares one month.
  month: { type: String, default: () => defaultMonthKey() },
})
const emit = defineEmits(['update:month'])

const { activeChurchId, ensureLoaded } = useActiveChurch()

const COLLECTION_SELECT =
  'id, from, amount, is_tithes, collectedOn, created_at, members!collections_from_fkey(first_name, middle_name, last_name)'

const month = computed(() => props.month)
const entries = ref([])
const members = ref([])
const loading = ref(true)
const errorMessage = ref('')

const detailOpen = ref(false)
const selected = ref(null)

const monthLabel = computed(() => {
  const [year, m] = month.value.split('-')
  if (!year || !m) return ''
  return new Date(Number(year), Number(m) - 1, 1)
    .toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })
})

const totals = computed(() => {
  const all = entries.value
  const sum = (rows) => rows.reduce((t, r) => t + Number(r.amount || 0), 0)
  const tithes = all.filter((r) => r.isTithes)
  const offering = all.filter((r) => !r.isTithes)
  const anonymous = all.filter((r) => r.anonymous)
  return {
    total: sum(all),
    tithes: sum(tithes),
    offering: sum(offering),
    anonymous: sum(anonymous),
    anonymousCount: anonymous.length,
    // "86 entries across 4 service dates" — the second number is what tells a
    // treasurer whether a whole service is missing from the sheet.
    dates: new Set(all.map((r) => r.date)).size
  }
})

const kpis = computed(() => [
  {
    key: 'total',
    label: 'Recorded this month',
    value: formatPesoWhole(totals.value.total),
    sub: `${entries.value.length} ${entries.value.length === 1 ? 'entry' : 'entries'} across ${totals.value.dates} ${totals.value.dates === 1 ? 'service date' : 'service dates'}`,
    tone: 'ink'
  },
  {
    key: 'tithes',
    label: 'Tithes',
    value: formatPesoWhole(totals.value.tithes),
    sub: formatShare(totals.value.tithes, totals.value.total),
    tone: 'accent'
  },
  {
    key: 'offering',
    label: 'Offering',
    value: formatPesoWhole(totals.value.offering),
    sub: formatShare(totals.value.offering, totals.value.total),
    tone: 'magenta'
  },
  {
    key: 'anonymous',
    label: 'Anonymous',
    value: formatPesoWhole(totals.value.anonymous),
    sub: `${totals.value.anonymousCount} ${totals.value.anonymousCount === 1 ? 'entry' : 'entries'}`,
    tone: 'ink'
  }
])

function normalise (row) {
  return {
    id: row.id,
    memberId: row.from,
    // `from` is null for anonymous gifts since 0011_collections_anonymous_from.
    // contributorLabel keeps that distinct from a member the caller cannot read.
    anonymous: isAnonymousRow(row),
    name: contributorLabel(row),
    amount: Number(row.amount || 0),
    date: row.collectedOn,
    dateLabel: formatDate(row.collectedOn),
    createdAt: row.created_at,
    recordedLabel: formatStamp(row.created_at),
    isTithes: row.is_tithes,
    typeLabel: row.is_tithes ? 'Tithes' : 'Offering'
  }
}

function formatDate (value) {
  if (!value) return ''
  // Explicit local midnight — the bare string parses as UTC and renders the day
  // before for the first eight hours of every Manila day (D8).
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })
}

function formatStamp (value) {
  if (!value) return ''
  return new Date(value).toLocaleString('en-PH', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

async function loadMembers () {
  // The directory RPC, NOT the members table: a Finance ministry member has no
  // can_see_member_detail and cannot read `members` under RLS (0015), so a
  // table select would come back empty and break the contributor picker.
  const { data, error } = await supabase.rpc('directory_search', { p_church_id: activeChurchId.value })
  members.value = error
    ? []
    : (data || []).map((r) => ({ id: r.member_id, first_name: r.first_name, last_name: r.last_name }))
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
    .from('collections')
    .select(COLLECTION_SELECT)
    // Explicit church filter: RLS returns every church's rows to a SuperAdmin
    // or Head Pastor, so the scope has to be stated here as well.
    .eq('from_church', activeChurchId.value)
    .gte('collectedOn', range.start)
    .lt('collectedOn', range.endExclusive)
    .order('collectedOn', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) {
    errorMessage.value = 'Failed to load this month’s collections. Please try again.'
    entries.value = []
    loading.value = false
    return
  }

  entries.value = (data || []).map(normalise)
  loading.value = false
}

function onSaved (row) {
  const entry = normalise(row)
  // An entry saved against another month is not dropped silently — the month
  // follows the entry, so what was just typed is visible where it landed. The
  // shell owns the month, so ask it to move; its prop change reloads this list.
  if (monthKeyFromDate(entry.date) !== month.value) {
    emit('update:month', monthKeyFromDate(entry.date))
    return
  }
  entries.value = [entry, ...entries.value]
}

function openEntry (entry) {
  selected.value = entry
  detailOpen.value = true
}

function onUpdated ({ id, amount }) {
  const i = entries.value.findIndex((e) => e.id === id)
  if (i !== -1) entries.value[i] = { ...entries.value[i], amount }
}

function onDeleted (id) {
  entries.value = entries.value.filter((e) => e.id !== id)
}

onMounted(async () => {
  await ensureLoaded()
  await Promise.all([loadMembers(), loadEntries()])
})

watch(month, loadEntries)

watch(activeChurchId, async () => {
  if (!activeChurchId.value) return
  detailOpen.value = false
  await Promise.all([loadMembers(), loadEntries()])
})
</script>

<template>
  <div class="col">
    <div class="col__grid">
      <div
        class="anim-rise"
        style="--i: 1"
      >
        <ContributionForm
          :church-id="activeChurchId"
          :members="members"
          @saved="onSaved"
        />
      </div>

      <div class="col__right">
        <div class="col__kpis">
          <div
            v-for="(k, i) in kpis"
            :key="k.key"
            class="col__kpi anim-rise"
            :style="`--i: ${i + 2}`"
          >
            <span class="col__kpi-label">{{ k.label }}</span>
            <span
              class="col__kpi-value"
              :class="`col__kpi-value--${k.tone}`"
            >{{ k.value }}</span>
            <span class="col__kpi-sub">{{ k.sub }}</span>
          </div>
        </div>

        <section
          class="col__card anim-rise"
          style="--i: 6"
        >
          <div class="col__card-head">
            <h2 class="col__card-title">
              Monthly entries
            </h2>
            <span class="col__card-meta">
              {{ entries.length }} {{ entries.length === 1 ? 'record' : 'records' }} · newest first
            </span>
          </div>

          <p
            v-if="errorMessage"
            class="col__error"
            role="alert"
          >
            {{ errorMessage }}
          </p>

          <div
            v-else-if="loading"
            class="col__rows"
          >
            <div
              v-for="n in 5"
              :key="n"
              class="skeleton col__row-skeleton"
            />
          </div>

          <p
            v-else-if="!entries.length"
            class="col__empty"
          >
            Nothing recorded for {{ monthLabel }} yet.
          </p>

          <table
            v-else
            class="col__table"
          >
            <thead>
              <tr>
                <th scope="col">
                  Date
                </th>
                <th scope="col">
                  Contributor
                </th>
                <th scope="col">
                  Type
                </th>
                <th
                  scope="col"
                  class="col__num"
                >
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="entry in entries"
                :key="entry.id"
                class="col__row"
                tabindex="0"
                role="button"
                :aria-label="`Open ${formatPeso(entry.amount)} from ${entry.anonymous ? 'an anonymous giver' : entry.name}`"
                @click="openEntry(entry)"
                @keydown.enter.prevent="openEntry(entry)"
                @keydown.space.prevent="openEntry(entry)"
              >
                <td class="col__date">
                  {{ entry.dateLabel }}
                </td>
                <td>
                  <span class="col__who">
                    <Avatar
                      :name="entry.anonymous ? '' : entry.name"
                      :placeholder="entry.anonymous"
                      :size="28"
                    />
                    <span :class="{ 'col__anon': entry.anonymous }">{{ entry.name }}</span>
                  </span>
                </td>
                <td>
                  <Badge :tone="entry.isTithes ? 'accent' : 'magenta'">
                    {{ entry.typeLabel }}
                  </Badge>
                </td>
                <td class="col__num col__amount">
                  {{ formatPeso(entry.amount) }}
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>
    </div>

    <EntryDetailModal
      v-model:open="detailOpen"
      :entry="selected"
      @updated="onUpdated"
      @deleted="onDeleted"
    />
  </div>
</template>

<style scoped>
.col { display: flex; flex-direction: column; gap: var(--sp-20); }

/* --- Layout ------------------------------------------------------------- */
.col__grid { display: grid; grid-template-columns: 344px 1fr; gap: var(--sp-18); align-items: start; }
.col__right { display: flex; flex-direction: column; gap: var(--sp-18); min-width: 0; }

.col__kpis { display: grid; grid-template-columns: 1.35fr 1fr 1fr 1fr; gap: var(--sp-14); }

.col__kpi {
  display: flex;
  flex-direction: column;
  gap: var(--sp-8);
  padding: var(--sp-16);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-inset);
  box-shadow: var(--shadow-card);
}

.col__kpi-label { font-size: var(--text-meta-sm); font-weight: 700; color: var(--ink-4); }

.col__kpi-value {
  font-size: 20px;
  font-weight: 800;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
}
.col__kpi-value--ink { color: var(--ink); }
.col__kpi-value--accent { color: var(--accent); }
.col__kpi-value--magenta { color: var(--magenta); }

.col__kpi-sub { font-size: var(--text-meta-sm); color: var(--ink-5); min-height: 1em; }

/* --- The table ---------------------------------------------------------- */
.col__card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-card);
  box-shadow: var(--shadow-card);
  overflow: hidden;
}

.col__card-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--sp-12);
  padding: var(--sp-14) var(--sp-20);
  border-bottom: 1px solid var(--divider);
}

.col__card-title { font-size: var(--text-h2); font-weight: 800; letter-spacing: var(--tracking-h2); }
.col__card-meta { font-size: var(--text-meta); color: var(--ink-5); }

.col__table { width: 100%; border-collapse: collapse; }

.col__table th {
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

.col__table td {
  padding: var(--sp-10) var(--sp-20);
  border-bottom: 1px solid var(--divider);
  font-size: var(--text-body-sm);
  color: var(--ink);
}
.col__table tr:last-child td { border-bottom: 0; }

.col__row { cursor: pointer; transition: background-color var(--dur-state) ease; }
.col__row:hover { background: var(--surface-subtle-2); }
.col__row:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

.col__date { color: var(--ink-4); white-space: nowrap; }
.col__who { display: flex; align-items: center; gap: var(--sp-10); font-weight: 700; }
.col__anon { color: var(--ink-5); font-style: italic; }

.col__num { text-align: right; }
.col__amount { font-weight: 800; font-variant-numeric: tabular-nums; white-space: nowrap; }

.col__rows { display: flex; flex-direction: column; }
.col__row-skeleton { height: 46px; border-radius: 0; }

.col__empty { padding: var(--sp-22) var(--sp-20); font-size: var(--text-body-sm); color: var(--ink-5); }

.col__error {
  margin: var(--sp-16) var(--sp-20);
  padding: var(--sp-10) var(--sp-12);
  border-radius: var(--r-inset);
  background: var(--magenta-tint);
  border: 1px solid var(--magenta-border);
  font-size: var(--text-body-sm);
  color: var(--magenta-darkest);
}

@media (max-width: 1100px) {
  .col__kpis { grid-template-columns: 1fr 1fr; }
}

@media (max-width: 900px) {
  .col__grid { grid-template-columns: 1fr; }
}

@media (max-width: 620px) {
  .col__kpis { grid-template-columns: 1fr; }
  .col__date { display: none; }
  .col__table th:first-child { display: none; }
}
</style>

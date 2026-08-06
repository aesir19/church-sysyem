<template>
  <div class="page-container">
    <main class="page-content">
      <div class="page-header">
        <div>
          <h2>Collections</h2>
          <p class="page-subtitle">Record tithes and offerings from registered members</p>
        </div>
      </div>

      <FundsTabs />

      <section class="card form-card">
        <div class="form-heading">
          <div>
            <h3 class="form-title">New Contribution</h3>
            <p class="form-copy">Choose a member from the church list to avoid unverified contributor names.</p>
          </div>
          <div class="month-filter">
            <label for="collections-month">Month</label>
            <input id="collections-month" v-model="selectedMonth" type="month" />
          </div>
        </div>

        <form @submit.prevent="handleSubmit" class="contribution-form">
          <div class="form-row">
            <div class="form-group">
              <label for="service-date">Service Date</label>
              <input
                id="service-date"
                v-model="form.date"
                type="date"
                required
                @change="syncMonthToDate"
              />
            </div>

            <div class="form-group">
              <label for="contribution-amount">Amount</label>
              <input
                id="contribution-amount"
                v-model.number="form.amount"
                type="number"
                min="1"
                step="0.01"
                placeholder="0.00"
                required
              />
            </div>
          </div>

          <div class="form-row">
            <div class="form-group autocomplete-group">
              <label for="contributor-name">Contributor Name</label>
              <div class="autocomplete-shell" :class="{ 'is-open': showSuggestions }">
                <input
                  id="contributor-name"
                  v-model.trim="form.memberQuery"
                  type="text"
                  placeholder="Search a registered member or type Anonymous"
                  required
                  autocomplete="off"
                  @focus="handleMemberFocus"
                  @input="handleMemberInput"
                  @blur="handleMemberBlur"
                />
                <button
                  v-if="form.memberQuery"
                  type="button"
                  class="clear-btn"
                  aria-label="Clear contributor"
                  @mousedown.prevent
                  @click="clearSelectedMember"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
              <ul v-if="showSuggestions" class="suggestions-list" role="listbox">
                <li
                  v-for="member in filteredMembers"
                  :key="member.id"
                  class="suggestion-item"
                  @mousedown.prevent="selectMember(member)"
                >
                  <span class="suggestion-name">{{ member.fullName }}</span>
                </li>
                <li v-if="filteredMembers.length === 0" class="suggestion-empty">
                  No matching member found.
                </li>
              </ul>
              <p class="field-note">
                <template v-if="selectedMemberName">Selected: {{ selectedMemberName }}</template>
                <template v-else-if="isAnonymous">Contributor: Anonymous</template>
                <template v-else>Select from the members list or type "Anonymous".</template>
              </p>
            </div>

            <div class="form-group">
              <label for="contribution-type">Type</label>
              <select id="contribution-type" v-model="form.type" required>
                <option value="tithes">Tithes</option>
                <option value="offering">Offering</option>
              </select>
            </div>
          </div>

          <div class="form-actions">
            <button type="submit" class="btn-primary" :disabled="saving || !myChurchId">
              {{ saving ? 'Saving...' : 'Add Contribution' }}
            </button>
          </div>

          <p v-if="formError" class="form-error">{{ formError }}</p>
          <p v-if="formSuccess" class="form-success">{{ formSuccess }}</p>
        </form>
      </section>

      <section class="card">
        <header class="section-header">
          <div>
            <h3>Monthly Entries</h3>
            <span class="section-hint">{{ entries.length }} entries · {{ monthLabel }}</span>
          </div>
          <div class="month-total">Total: {{ formatMoney(monthTotal) }}</div>
        </header>
        <div class="table-wrap">
          <table v-if="entries.length > 0" class="collections-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Name</th>
                <th>Type</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="entry in entries"
                :key="entry.id"
                class="entry-row"
                @click="openDetail(entry)"
              >
                <td class="col-date">{{ formatDisplayDate(entry.date) }}</td>
                <td>{{ entry.name }}</td>
                <td>
                  <span :class="['type-badge', entry.typeClass]">{{ entry.typeLabel }}</span>
                </td>
                <td class="amount-cell">{{ formatMoney(entry.amount) }}</td>
              </tr>
            </tbody>
          </table>
          <div v-else class="state-message">
            <p>No contributions recorded for this month yet.</p>
          </div>
        </div>
      </section>

      <Teleport to="body">
        <div v-if="selectedEntry" class="modal-overlay" @click.self="closeDetail">
          <div class="modal-card">
            <header class="modal-header">
              <h3>Contribution Detail</h3>
              <button class="btn-icon" @click="closeDetail" aria-label="Close">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </header>
            <div class="modal-body">
              <div class="detail-grid">
                <div class="detail-item">
                  <span class="detail-label">Contributor</span>
                  <span class="detail-value">{{ selectedEntry.name }}</span>
                </div>
                <div class="detail-item">
                  <span class="detail-label">Type</span>
                  <span class="detail-value">
                    <span :class="['type-badge', selectedEntry.typeClass]">{{ selectedEntry.typeLabel }}</span>
                  </span>
                </div>
                <div class="detail-item">
                  <span class="detail-label">Date</span>
                  <span class="detail-value">{{ formatDisplayDate(selectedEntry.date) }}</span>
                </div>
                <div class="detail-item">
                  <span class="detail-label">Amount</span>
                  <span class="detail-value amount-value">
                    <template v-if="!editing">
                      {{ formatMoney(selectedEntry.amount) }}
                    </template>
                    <input
                      v-else
                      v-model.number="editAmount"
                      type="number"
                      min="1"
                      step="0.01"
                      class="edit-amount-input"
                    />
                  </span>
                </div>
              </div>

              <div v-if="isEditable(selectedEntry)" class="modal-actions">
                <template v-if="!editing">
                  <button class="btn-secondary" @click="startEdit">Edit Amount</button>
                  <button class="btn-danger" @click="handleDelete">Delete</button>
                </template>
                <template v-else>
                  <button class="btn-primary" @click="saveEdit" :disabled="editSaving">
                    {{ editSaving ? 'Saving...' : 'Save' }}
                  </button>
                  <button class="btn-secondary" @click="cancelEdit">Cancel</button>
                </template>
              </div>
              <div v-else class="modal-locked-notice">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
                <span>Editing locked — more than 3 hours since entry.</span>
              </div>
              <p v-if="editError" class="form-error">{{ editError }}</p>
            </div>
          </div>
        </div>
      </Teleport>
    </main>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { supabase } from '../lib/supabase'
import { getDefaultServiceDate, isWithinEditWindow } from '../utils/collectionsDate'
import FundsTabs from '../components/FundsTabs.vue'
import { defaultMonthKey, getMonthRange, monthKeyFromDate } from '../utils/expensesMonth'
import { interpretMutation } from '../utils/mutationResult'
import { buildCollectionPayload, contributorLabel, isAnonymousRow } from '../utils/collectionPayload'
import { useActiveChurch } from '../composables/useActiveChurch'

// Church scoping (own church, or the church selected by SuperAdmin / Head Pastor).
// RLS returns every church's rows to those roles, so the reads filter explicitly.
const { activeChurchId, ensureLoaded } = useActiveChurch()

const COLLECTION_SELECT = 'id, from, amount, is_tithes, collectedOn, created_at, members!collections_from_fkey(first_name, middle_name, last_name)'

// The 3-hour window is enforced by RLS (0008_funds_write_policies), which filters
// the row out rather than raising an error, so this is what the user sees when a
// locked entry is edited or deleted — including from a stale open tab.
const EDIT_WINDOW_CLOSED_MESSAGE =
  'This entry is locked. Entries can only be changed within 3 hours of being recorded.'

const form = ref({
  memberQuery: '',
  memberId: '',
  type: 'tithes',
  amount: null,
  date: getDefaultServiceDate()
})
const saving = ref(false)
const formError = ref('')
const formSuccess = ref('')
const memberOptions = ref([])
const showSuggestions = ref(false)
const myChurchId = activeChurchId
const entries = ref([])
const selectedEntry = ref(null)
const editing = ref(false)
const editAmount = ref(0)
const editSaving = ref(false)
const editError = ref('')
const selectedMonth = ref(defaultMonthKey())

const monthLabel = computed(() => {
  const [year, month] = selectedMonth.value.split('-')
  if (!year || !month) return ''
  const monthDate = new Date(Number(year), Number(month) - 1, 1)
  return monthDate.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })
})

const monthTotal = computed(() => {
  return entries.value.reduce((sum, row) => sum + Number(row.amount || 0), 0)
})

const isAnonymous = computed(() => {
  return form.value.memberQuery.toLowerCase() === 'anonymous'
})

const selectedMemberName = computed(() => {
  const match = memberOptions.value.find((member) => member.id === form.value.memberId)
  return match ? match.fullName : ''
})

const filteredMembers = computed(() => {
  const query = form.value.memberQuery.trim().toLowerCase()
  const base = memberOptions.value
  const filtered = query
    ? base.filter((member) => member.fullName.toLowerCase().includes(query)).slice(0, 8)
    : base.slice(0, 8)

  const hasAnonymous = filtered.some((member) => member.id === 'anonymous')
  const allowAnonymous = !query || 'anonymous'.includes(query)
  if (allowAnonymous && !hasAnonymous) {
    filtered.unshift({
      id: 'anonymous',
      fullName: 'Anonymous'
    })
  }

  return filtered
})

onMounted(async () => {
  document.addEventListener('keydown', onKeydown)
  // Resolve the active church before scoping the reads.
  await ensureLoaded()
  await Promise.all([loadMembers(), loadMonthEntries()])
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
})

watch(selectedMonth, async () => {
  await loadMonthEntries()
})

// Reload the picker + entries when the active church changes (church selector).
watch(activeChurchId, async () => {
  if (!activeChurchId.value) return
  await Promise.all([loadMembers(), loadMonthEntries()])
})

function onKeydown(event) {
  if (event.key === 'Escape') {
    showSuggestions.value = false
    if (selectedEntry.value) closeDetail()
  }
}

function fullName(member) {
  if (!member) return 'Unknown'
  return `${member.first_name} ${member.last_name}`
}

function normalizeEntry(row) {
  return {
    id: row.id,
    memberId: row.from,
    // `from` is null for anonymous gifts since 0011_collections_anonymous_from.
    // contributorLabel keeps that distinct from a member the caller can't read.
    anonymous: isAnonymousRow(row),
    name: contributorLabel(row),
    amount: row.amount,
    date: row.collectedOn,
    createdAt: row.created_at,
    typeLabel: row.is_tithes ? 'Tithes' : 'Offering',
    typeClass: row.is_tithes ? 'type-tithes' : 'type-offering'
  }
}


async function loadMembers() {
  // Load id + name through the directory RPC, NOT the members table. A Finance
  // ministry member has no can_see_member_detail and so cannot read `members`
  // under RLS (0015) — the table select would come back empty and break this
  // picker. directory_search returns the caller's own church, archived excluded,
  // to any authenticated user. (middle_name is not exposed by the directory.)
  const { data, error } = await supabase.rpc('directory_search', { p_church_id: myChurchId.value })

  if (error) {
    formError.value = `Failed to load members: ${error.message}`
    return
  }

  memberOptions.value = (data || [])
    .map((row) => {
      const member = { id: row.member_id, first_name: row.first_name, last_name: row.last_name }
      return { ...member, fullName: fullName(member) }
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName))
}

async function loadMonthEntries() {
  formError.value = ''
  const range = getMonthRange(selectedMonth.value)
  if (!range) {
    entries.value = []
    return
  }

  if (!myChurchId.value) {
    entries.value = []
    return
  }

  const { data, error } = await supabase
    .from('collections')
    .select(COLLECTION_SELECT)
    .eq('from_church', myChurchId.value)
    .gte('collectedOn', range.start)
    .lt('collectedOn', range.endExclusive)
    .order('collectedOn', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) {
    formError.value = `Failed to load collections: ${error.message}`
    return
  }

  entries.value = (data || []).map(normalizeEntry)
}

function handleMemberFocus() {
  showSuggestions.value = true
}

function handleMemberInput() {
  form.value.memberId = ''
  showSuggestions.value = true
}

function handleMemberBlur() {
  window.setTimeout(() => {
    showSuggestions.value = false
  }, 120)
}

function selectMember(member) {
  if (member.id === 'anonymous') {
    form.value.memberId = ''
    form.value.memberQuery = 'Anonymous'
    showSuggestions.value = false
    return
  }

  form.value.memberId = member.id
  form.value.memberQuery = member.fullName
  showSuggestions.value = false
}

function clearSelectedMember() {
  form.value.memberId = ''
  form.value.memberQuery = ''
  showSuggestions.value = false
}

function syncMonthToDate() {
  const monthFromDate = monthKeyFromDate(form.value.date)
  if (monthFromDate) {
    selectedMonth.value = monthFromDate
  }
}

async function handleSubmit() {
  formError.value = ''
  formSuccess.value = ''

  if (!form.value.memberId && !isAnonymous.value) {
    formError.value = 'Select a contributor from the member list or type "Anonymous".'
    return
  }

  if (!form.value.amount || !form.value.date || !myChurchId.value) {
    formError.value = 'All fields are required.'
    return
  }

  saving.value = true
  const { data, error } = await supabase
    .from('collections')
    .insert(buildCollectionPayload(form.value, myChurchId.value))
    .select(COLLECTION_SELECT)
    .single()

  saving.value = false

  if (error) {
    formError.value = error.message
    return
  }

  const insertedEntry = normalizeEntry(data)
  const insertedMonth = monthKeyFromDate(insertedEntry.date)
  if (insertedMonth === selectedMonth.value) {
    entries.value.unshift(insertedEntry)
  }
  const contributionLabel = insertedEntry.typeLabel.toLowerCase()
  formSuccess.value = insertedEntry.anonymous
    ? `Added an anonymous ${contributionLabel}.`
    : `Added ${insertedEntry.name}'s ${contributionLabel}.`
  form.value.memberId = ''
  form.value.memberQuery = ''
  form.value.amount = null
  window.setTimeout(() => {
    formSuccess.value = ''
  }, 3000)
}

function openDetail(entry) {
  selectedEntry.value = entry
  editing.value = false
  editError.value = ''
}

function closeDetail() {
  selectedEntry.value = null
  editing.value = false
  editError.value = ''
}

function isEditable(entry) {
  return !!entry.createdAt && isWithinEditWindow(entry.createdAt)
}

function startEdit() {
  editAmount.value = selectedEntry.value.amount
  editing.value = true
  editError.value = ''
}

function cancelEdit() {
  editing.value = false
  editError.value = ''
}

async function saveEdit() {
  editError.value = ''
  if (!editAmount.value || editAmount.value <= 0) {
    editError.value = 'Amount must be greater than 0.'
    return
  }

  editSaving.value = true
  // `.select()` is required: RLS enforces the 3-hour window by filtering the row
  // out, which PostgREST reports as success with zero rows. See mutationResult.js.
  const result = await supabase
    .from('collections')
    .update({ amount: editAmount.value })
    .eq('id', selectedEntry.value.id)
    .select()

  editSaving.value = false

  const outcome = interpretMutation(result, EDIT_WINDOW_CLOSED_MESSAGE)
  if (!outcome.ok) {
    editError.value = outcome.message
    return
  }

  selectedEntry.value.amount = editAmount.value
  const idx = entries.value.findIndex((entry) => entry.id === selectedEntry.value.id)
  if (idx !== -1) {
    entries.value[idx].amount = editAmount.value
  }
  editing.value = false
}

async function handleDelete() {
  if (!window.confirm('Are you sure you want to delete this entry?')) return

  const result = await supabase
    .from('collections')
    .delete()
    .eq('id', selectedEntry.value.id)
    .select()

  const outcome = interpretMutation(result, EDIT_WINDOW_CLOSED_MESSAGE)
  if (!outcome.ok) {
    editError.value = outcome.message
    return
  }

  entries.value = entries.value.filter((entry) => entry.id !== selectedEntry.value.id)
  closeDetail()
}

function formatMoney(value) {
  if (value == null) return 'PHP 0.00'
  return 'PHP ' + Number(value).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}

function formatDisplayDate(dateStr) {
  if (!dateStr) return ''
  const date = new Date(`${dateStr}T00:00:00`)
  return date.toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })
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
  gap: 8px;
  align-items: center;
}

/* Card */
.card {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06), 0 1px 2px rgba(15, 23, 42, 0.04);
  padding: 24px;
}

/* Form */
.form-card {
  border-left: 4px solid #1a56db;
}

.form-heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 18px;
}

.form-title {
  font-size: 1rem;
  font-weight: 600;
  color: #1e293b;
}

.form-copy {
  margin-top: 4px;
  font-size: 0.8125rem;
  color: #64748b;
}

.month-filter {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.month-filter label {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #64748b;
  font-weight: 700;
}

.month-filter input {
  border: 1px solid #dbe3ef;
  border-radius: 8px;
  padding: 8px 10px;
  background: #f8fafc;
}

.contribution-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  position: relative;
}

.form-group label {
  font-size: 0.8125rem;
  font-weight: 600;
  color: #475569;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.form-group input,
.form-group select {
  padding: 10px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 0.9375rem;
  color: #1e293b;
  background: #f8fafc;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.form-group input:focus,
.form-group select:focus {
  outline: none;
  border-color: #1a56db;
  box-shadow: 0 0 0 3px rgba(26, 86, 219, 0.1);
}

.form-group input::placeholder {
  color: #94a3b8;
}

.autocomplete-group {
  z-index: 2;
  flex: 1;
  min-width: 0;
}

.autocomplete-shell {
  position: relative;
}

.autocomplete-shell input {
  width: 100%;
  box-sizing: border-box;
  padding-right: 40px;
}

.clear-btn {
  position: absolute;
  top: 50%;
  right: 10px;
  transform: translateY(-50%);
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 999px;
  background: #e2e8f0;
  color: #64748b;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.clear-btn:hover {
  background: #cbd5e1;
  color: #334155;
}

.suggestions-list {
  list-style: none;
  margin: 8px 0 0;
  padding: 6px;
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: #ffffff;
  border: 1px solid #dbe3ef;
  border-radius: 12px;
  box-shadow: 0 18px 40px rgba(15, 23, 42, 0.12);
  max-height: 280px;
  overflow-y: auto;
}

.suggestion-item,
.suggestion-empty {
  padding: 10px 12px;
  border-radius: 8px;
}

.suggestion-item {
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
}

.suggestion-item:hover {
  background: #eff6ff;
}

.suggestion-name {
  font-size: 0.875rem;
  color: #0f172a;
  font-weight: 600;
}

.suggestion-empty,
.field-note {
  font-size: 0.75rem;
  color: #64748b;
}

.field-note {
  margin-top: 2px;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
}

.btn-primary {
  padding: 10px 20px;
  background: #1a56db;
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}

.btn-primary:hover:not(:disabled) {
  background: #1e40af;
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-secondary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  background: #f1f5f9;
  color: #475569;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 0.8125rem;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
  transition: background 0.15s;
}

.btn-secondary:hover {
  background: #e2e8f0;
}

.btn-danger {
  padding: 8px 14px;
  background: #fef2f2;
  color: #dc2626;
  border: 1px solid #fecaca;
  border-radius: 8px;
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}

.btn-danger:hover {
  background: #fee2e2;
}

.btn-icon {
  background: none;
  border: none;
  cursor: pointer;
  color: #64748b;
  padding: 4px;
  border-radius: 6px;
  display: flex;
  align-items: center;
}

.btn-icon:hover {
  background: #f1f5f9;
  color: #1e293b;
}

.form-error {
  font-size: 0.8125rem;
  color: #dc2626;
  margin-top: 4px;
}

.form-success {
  font-size: 0.8125rem;
  color: #16a34a;
  margin-top: 4px;
}

/* Section header */
.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.section-header h3 {
  font-size: 1rem;
  font-weight: 600;
  color: #1e293b;
}

.section-hint {
  font-size: 0.75rem;
  color: #94a3b8;
  margin-top: 2px;
}

.month-total {
  font-size: 0.875rem;
  font-weight: 700;
  color: #1e293b;
}

/* Table */
.table-wrap {
  overflow-x: auto;
}

.collections-table {
  width: 100%;
  border-collapse: collapse;
}

.collections-table th {
  text-align: left;
  font-size: 0.75rem;
  font-weight: 600;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 10px 12px;
  border-bottom: 1px solid #e2e8f0;
}

.collections-table td {
  padding: 12px;
  font-size: 0.875rem;
  color: #334155;
  border-bottom: 1px solid #f1f5f9;
}

.entry-row {
  cursor: pointer;
  transition: background 0.1s;
}

.entry-row:hover {
  background: #f8fafc;
}

.col-date {
  white-space: nowrap;
  color: #64748b;
}

.amount-cell {
  font-variant-numeric: tabular-nums;
  color: #dc2626;
  font-weight: 700;
}

.type-badge {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 99px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: capitalize;
}

.type-tithes {
  background: #eff6ff;
  color: #1d4ed8;
}

.type-offering {
  background: #f0fdf4;
  color: #16a34a;
}

.state-message {
  text-align: center;
  padding: 32px 16px;
  color: #94a3b8;
  font-size: 0.875rem;
}

/* Modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.4);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 16px;
}

.modal-card {
  background: #fff;
  border-radius: 14px;
  width: 100%;
  max-width: 440px;
  box-shadow: 0 20px 60px rgba(15, 23, 42, 0.18);
  overflow: hidden;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px 16px;
  border-bottom: 1px solid #f1f5f9;
}

.modal-header h3 {
  font-size: 1.05rem;
  font-weight: 700;
  color: #1e293b;
}

.modal-body {
  padding: 24px;
}

.detail-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  margin-bottom: 20px;
}

.detail-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.detail-label {
  font-size: 0.6875rem;
  font-weight: 600;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.detail-value {
  font-size: 0.9375rem;
  color: #1e293b;
  font-weight: 500;
}

.amount-value {
  font-size: 1.125rem;
  font-weight: 700;
  color: #1a56db;
}

.edit-amount-input {
  padding: 6px 10px;
  border: 1px solid #1a56db;
  border-radius: 6px;
  font-size: 1rem;
  width: 140px;
  color: #1e293b;
}

.edit-amount-input:focus {
  outline: none;
  box-shadow: 0 0 0 3px rgba(26, 86, 219, 0.1);
}

.modal-actions {
  display: flex;
  gap: 10px;
  padding-top: 12px;
  border-top: 1px solid #f1f5f9;
}

.modal-locked-notice {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: #f8fafc;
  border-radius: 8px;
  font-size: 0.8125rem;
  color: #64748b;
  border: 1px solid #e2e8f0;
}

/* Responsive */
@media (max-width: 600px) {
  .page-container {
    padding: 20px 12px;
  }

  .form-row {
    grid-template-columns: 1fr;
  }

  .detail-grid {
    grid-template-columns: 1fr;
  }
}
</style>

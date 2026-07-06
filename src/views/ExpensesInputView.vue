<template>
  <div class="page-container">
    <main class="page-content">
      <div class="page-header">
        <div>
          <h2>Expenses</h2>
          <p class="page-subtitle">Track church expenses by month</p>
        </div>
      </div>

      <FundsTabs />

      <section class="card form-card">
        <div class="form-heading">
          <div>
            <h3 class="form-title">Record Expense</h3>
            <p class="form-copy">Choose an existing description from this month or create a new one.</p>
          </div>
          <div class="month-filter">
            <label for="expense-month">Month</label>
            <input id="expense-month" v-model="selectedMonth" type="month" />
          </div>
        </div>

        <form class="expense-form" @submit.prevent="handleSubmit">
          <div class="form-row">
            <div class="form-group">
              <label for="spent-on">Date Spent</label>
              <input id="spent-on" v-model="form.spentOn" type="date" required @change="syncMonthToSpentOn" />
            </div>

            <div class="form-group">
              <label for="expense-amount">Amount</label>
              <input
                id="expense-amount"
                v-model.number="form.amount"
                type="number"
                min="0.01"
                step="0.01"
                placeholder="0.00"
                required
              />
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="expense-description-select">Description</label>
              <select id="expense-description-select" v-model="form.descriptionChoice" required>
                <option value="__new__">Create new description</option>
                <option v-for="label in existingDescriptions" :key="label" :value="label">
                  {{ label }}
                </option>
              </select>
            </div>

            <div class="form-group" v-if="form.descriptionChoice === '__new__'">
              <label for="expense-description-new">New Description</label>
              <input
                id="expense-description-new"
                v-model.trim="form.newDescription"
                type="text"
                maxlength="120"
                placeholder="e.g. Electricity"
                required
              />
            </div>
          </div>

          <div class="form-group">
            <label for="expense-notes">Notes (optional)</label>
            <input
              id="expense-notes"
              v-model.trim="form.notes"
              type="text"
              maxlength="240"
              placeholder="Optional context"
            />
          </div>

          <div class="form-actions">
            <button class="btn-primary" type="submit" :disabled="saving || !myChurchId">
              {{ saving ? 'Saving...' : 'Add Expense' }}
            </button>
          </div>

          <p v-if="formError" class="form-error">{{ formError }}</p>
          <p v-if="formSuccess" class="form-success">{{ formSuccess }}</p>
        </form>
      </section>

      <section class="card">
        <header class="section-header">
          <div>
            <h3>Monthly Expenses</h3>
            <span class="section-hint">{{ entries.length }} entries · {{ monthLabel }}</span>
          </div>
          <div class="month-total">Total: {{ formatMoney(monthTotal) }}</div>
        </header>

        <div class="table-wrap">
          <table v-if="entries.length > 0" class="expenses-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Amount</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="entry in entries" :key="entry.id">
                <td>{{ formatDisplayDate(entry.spent_on) }}</td>
                <td>{{ entry.description }}</td>
                <td class="amount-cell">{{ formatMoney(entry.amount) }}</td>
                <td>{{ entry.notes || '—' }}</td>
              </tr>
            </tbody>
          </table>
          <div v-else class="state-message">
            <p>No expenses recorded for this month yet.</p>
          </div>
        </div>
      </section>
    </main>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { supabase } from '../lib/supabase'
import FundsTabs from '../components/FundsTabs.vue'
import { defaultMonthKey, getMonthRange, monthKeyFromDate } from '../utils/expensesMonth'

const EXPENSE_COLUMNS = 'id, spent_on, description, amount, notes, created_at'

const selectedMonth = ref(defaultMonthKey())
const myChurchId = ref('')
const currentUserId = ref('')
const entries = ref([])
const saving = ref(false)
const formError = ref('')
const formSuccess = ref('')

const form = ref({
  spentOn: new Date().toISOString().slice(0, 10),
  amount: null,
  descriptionChoice: '__new__',
  newDescription: '',
  notes: '',
})

const monthLabel = computed(() => {
  const [year, month] = selectedMonth.value.split('-')
  if (!year || !month) return ''
  const monthIndex = Number(month) - 1
  const monthDate = new Date(Number(year), monthIndex, 1)
  return monthDate.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })
})

const existingDescriptions = computed(() => {
  const labels = new Set()
  for (const entry of entries.value) {
    const text = String(entry.description || '').trim()
    if (text) labels.add(text)
  }
  return Array.from(labels.values()).sort((a, b) => a.localeCompare(b))
})

const monthTotal = computed(() => {
  return entries.value.reduce((sum, row) => sum + Number(row.amount || 0), 0)
})

watch(selectedMonth, async () => {
  await loadMonthEntries()

  if (form.value.descriptionChoice !== '__new__' && !existingDescriptions.value.includes(form.value.descriptionChoice)) {
    form.value.descriptionChoice = '__new__'
  }
})

onMounted(async () => {
  await Promise.all([fetchMyChurch(), fetchCurrentUser()])
  await loadMonthEntries()
})

async function fetchMyChurch() {
  const { data, error } = await supabase.rpc('get_my_church').single()
  if (error || !data) {
    formError.value = error?.message || 'Unable to resolve church context.'
    return
  }
  myChurchId.value = data.id
}

async function fetchCurrentUser() {
  const { data: authData } = await supabase.auth.getUser()
  currentUserId.value = authData?.user?.id || ''
}

async function loadMonthEntries() {
  formError.value = ''
  const range = getMonthRange(selectedMonth.value)
  if (!range) {
    entries.value = []
    return
  }

  const { data, error } = await supabase
    .from('expenses')
    .select(EXPENSE_COLUMNS)
    .gte('spent_on', range.start)
    .lt('spent_on', range.endExclusive)
    .order('spent_on', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) {
    formError.value = `Failed to load expenses: ${error.message}`
    return
  }

  entries.value = data || []
}

function syncMonthToSpentOn() {
  const monthFromDate = monthKeyFromDate(form.value.spentOn)
  if (monthFromDate) {
    selectedMonth.value = monthFromDate
  }
}

function resolveDescription() {
  if (form.value.descriptionChoice === '__new__') {
    return form.value.newDescription.trim()
  }
  return form.value.descriptionChoice.trim()
}

async function handleSubmit() {
  formError.value = ''
  formSuccess.value = ''

  const description = resolveDescription()
  const amount = Number(form.value.amount)

  if (!form.value.spentOn || !description) {
    formError.value = 'Date and description are required.'
    return
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    formError.value = 'Amount must be greater than 0.'
    return
  }

  if (!myChurchId.value) {
    formError.value = 'Unable to save expense without church context.'
    return
  }

  saving.value = true
  const payload = {
    from_church: myChurchId.value,
    spent_on: form.value.spentOn,
    description,
    amount,
    notes: form.value.notes ? form.value.notes.trim() : null,
    created_by: currentUserId.value || null,
  }

  const { data, error } = await supabase
    .from('expenses')
    .insert(payload)
    .select(EXPENSE_COLUMNS)
    .single()

  saving.value = false

  if (error) {
    formError.value = error.message
    return
  }

  const insertedMonth = monthKeyFromDate(data.spent_on)
  if (insertedMonth === selectedMonth.value) {
    entries.value.unshift(data)
  }

  formSuccess.value = `Added expense: ${data.description}.`
  form.value.amount = null
  form.value.notes = ''

  if (form.value.descriptionChoice === '__new__') {
    form.value.newDescription = ''
  }

  window.setTimeout(() => {
    formSuccess.value = ''
  }, 2500)
}

function formatMoney(value) {
  const amount = Number(value || 0)
  return 'PHP ' + amount.toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function formatDisplayDate(dateStr) {
  if (!dateStr) return ''
  const date = new Date(`${dateStr}T00:00:00`)
  if (Number.isNaN(date.getTime())) return dateStr
  return date.toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
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

.card {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06), 0 1px 2px rgba(15, 23, 42, 0.04);
  padding: 24px;
}

.form-card {
  border-left: 4px solid #1a56db;
}

.form-heading {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 18px;
}

.form-title {
  font-size: 1rem;
  font-weight: 700;
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

.expense-form {
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
}

.form-group label {
  font-size: 0.8125rem;
  font-weight: 700;
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
}

.form-group input:focus,
.form-group select:focus {
  outline: none;
  border-color: #1a56db;
  box-shadow: 0 0 0 3px rgba(26, 86, 219, 0.1);
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
  font-weight: 700;
  cursor: pointer;
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}

.section-header h3 {
  font-size: 1rem;
  font-weight: 700;
  color: #1e293b;
}

.section-hint {
  font-size: 0.8125rem;
  color: #64748b;
}

.month-total {
  font-size: 0.875rem;
  font-weight: 700;
  color: #1e293b;
}

.table-wrap {
  overflow-x: auto;
}

.expenses-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}

.expenses-table th,
.expenses-table td {
  border-bottom: 1px solid #e2e8f0;
  padding: 10px 8px;
  text-align: left;
}

.expenses-table th {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #64748b;
}

.amount-cell {
  font-variant-numeric: tabular-nums;
  color: #dc2626;
  font-weight: 700;
}

.state-message {
  text-align: center;
  color: #64748b;
  padding: 22px 8px;
}

.form-error {
  color: #dc2626;
  font-size: 0.8125rem;
}

.form-success {
  color: #0f766e;
  font-size: 0.8125rem;
}

@media (max-width: 720px) {
  .page-container {
    padding: 20px 12px;
  }

  .form-row {
    grid-template-columns: 1fr;
  }
}
</style>

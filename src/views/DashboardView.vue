<template>
  <div class="dashboard-container">
    <header class="dashboard-header">
      <h1>UDFC Dashboard</h1>
      <button @click="handleLogout" class="btn-logout">Sign Out</button>
    </header>

    <main class="dashboard-content">
      <div class="page-header">
        <div>
          <h2>{{ pageTitle }}</h2>
          <p class="page-subtitle">View and manage church members</p>
        </div>
        <span class="stat-badge">{{ members.length }} total</span>
      </div>

      <div class="card">
        <div v-if="loading" class="state-message">
          <div class="spinner"></div>
          <p>Loading members...</p>
        </div>

        <div v-else-if="error" class="state-message error">
          <p>{{ error }}</p>
        </div>

        <div v-else-if="members.length === 0" class="state-message">
          <p>No members found. Add records to the <code>members</code> table in Supabase to get started.</p>
        </div>

        <div v-else class="table-wrapper">
          <table class="members-table">
            <thead>
              <tr>
                <th @click="setSort('last_name')" :class="{ active: sortKey === 'last_name' }">
                  Last Name <span class="sort-icon">{{ sortIcon('last_name') }}</span>
                </th>
                <th @click="setSort('first_name')" :class="{ active: sortKey === 'first_name' }">
                  First Name <span class="sort-icon">{{ sortIcon('first_name') }}</span>
                </th>
                <th @click="setSort('age')" :class="{ active: sortKey === 'age' }">
                  Age <span class="sort-icon">{{ sortIcon('age') }}</span>
                </th>
                <th @click="setSort('gender')" :class="{ active: sortKey === 'gender' }">
                  Gender <span class="sort-icon">{{ sortIcon('gender') }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="member in sortedMembers"
                :key="member.id"
                @click="openDetails(member)"
                class="member-row"
              >
                <td>{{ member.last_name }}</td>
                <td>{{ member.first_name }}</td>
                <td>{{ computeAge(member.birthdate) }}</td>
                <td>{{ member.gender }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </main>

    <!-- Member Details Modal -->
    <div v-if="selectedMember" class="modal-overlay" @click.self="closeDetails">
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-header">
          <h3>Member Details</h3>
          <button @click="closeDetails" class="btn-close" aria-label="Close">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div class="modal-body">
          <div class="detail-row">
            <span class="detail-label">Full Name</span>
            <span class="detail-value">{{ selectedMember.first_name }} {{ selectedMember.last_name }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Age</span>
            <span class="detail-value">{{ computeAge(selectedMember.birthdate) }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Gender</span>
            <span class="detail-value">{{ selectedMember.gender }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Member Of</span>
            <span class="detail-value">{{ selectedMember.churches?.name || '—' }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Contact Number</span>
            <span class="detail-value">{{ selectedMember.contact_number || '—' }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Email</span>
            <span class="detail-value">{{ selectedMember.email || '—' }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Date Joined</span>
            <span class="detail-value">{{ formatDate(selectedMember.date_joined) }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'

const router = useRouter()

const members = ref([])
const loading = ref(true)
const error = ref('')
const selectedMember = ref(null)

const sortKey = ref('last_name')
const sortDir = ref('asc')

const pageTitle = computed(() => {
  const churchName = members.value[0]?.churches?.name
  return churchName ? `UDFC ${churchName} Members` : 'Members'
})

async function fetchMembers() {
  loading.value = true
  error.value = ''

  const { data, error: fetchError } = await supabase
    .from('members')
    .select('*, churches(name)')

  if (fetchError) {
    error.value = `Failed to load members: ${fetchError.message}`
  } else {
    members.value = data || []
  }

  loading.value = false
}

function computeAge(birthdate) {
  if (!birthdate) return '—'
  const dob = new Date(birthdate)
  const today = new Date()
  let age = today.getFullYear() - dob.getFullYear()
  const monthDiff = today.getMonth() - dob.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age--
  }
  return age
}

function formatDate(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function setSort(key) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = key
    sortDir.value = 'asc'
  }
}

function sortIcon(key) {
  if (sortKey.value !== key) return '↕'
  return sortDir.value === 'asc' ? '↑' : '↓'
}

const sortedMembers = computed(() => {
  const list = [...members.value]
  const dir = sortDir.value === 'asc' ? 1 : -1

  list.sort((a, b) => {
    let valA, valB

    if (sortKey.value === 'age') {
      valA = computeAge(a.birthdate)
      valB = computeAge(b.birthdate)
    } else {
      valA = a[sortKey.value] ?? ''
      valB = b[sortKey.value] ?? ''
    }

    if (typeof valA === 'string') {
      return valA.localeCompare(valB) * dir
    }
    return (valA - valB) * dir
  })

  return list
})

function openDetails(member) {
  selectedMember.value = member
}

function closeDetails() {
  selectedMember.value = null
}

function handleEsc(e) {
  if (e.key === 'Escape') closeDetails()
}

async function handleLogout() {
  await supabase.auth.signOut()
  router.push('/login')
}

onMounted(() => {
  fetchMembers()
  window.addEventListener('keydown', handleEsc)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleEsc)
})
</script>

<style scoped>
.dashboard-container {
  min-height: 100vh;
  background: #f8fafc;
}

.dashboard-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 2rem;
  background: #ffffff;
  border-bottom: 1px solid #e2e8f0;
  position: sticky;
  top: 0;
  z-index: 10;
}

.dashboard-header h1 {
  font-size: 1.25rem;
  color: #1e293b;
  font-weight: 700;
}

.btn-logout {
  padding: 0.5rem 1rem;
  background: transparent;
  color: #64748b;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 0.85rem;
  cursor: pointer;
  transition: background 0.2s;
}

.btn-logout:hover {
  background: #f1f5f9;
}

.dashboard-content {
  padding: 2rem;
  max-width: 1200px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  margin-bottom: 1.5rem;
  flex-wrap: wrap;
  gap: 1rem;
}

.page-header h2 {
  font-size: 1.5rem;
  color: #1e293b;
  margin-bottom: 0.25rem;
}

.page-subtitle {
  color: #64748b;
  font-size: 0.9rem;
}

.stat-badge {
  display: inline-block;
  padding: 0.4rem 0.9rem;
  background: #eff6ff;
  color: #1a56db;
  border-radius: 999px;
  font-size: 0.85rem;
  font-weight: 600;
}

.card {
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04), 0 4px 12px rgba(26, 86, 219, 0.04);
  overflow: hidden;
}

.state-message {
  padding: 3rem 2rem;
  text-align: center;
  color: #64748b;
}

.state-message.error {
  color: #dc2626;
}

.state-message code {
  background: #f1f5f9;
  padding: 0.15rem 0.4rem;
  border-radius: 4px;
  font-size: 0.85em;
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid #e2e8f0;
  border-top-color: #1a56db;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
  margin: 0 auto 1rem;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.table-wrapper {
  overflow-x: auto;
}

.members-table {
  width: 100%;
  border-collapse: collapse;
}

.members-table thead {
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
}

.members-table th {
  padding: 0.85rem 1.25rem;
  text-align: left;
  font-size: 0.8rem;
  font-weight: 600;
  color: #475569;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  transition: background 0.15s;
}

.members-table th:hover {
  background: #f1f5f9;
}

.members-table th.active {
  color: #1a56db;
}

.sort-icon {
  display: inline-block;
  margin-left: 0.35rem;
  font-size: 0.8rem;
  opacity: 0.6;
}

.members-table th.active .sort-icon {
  opacity: 1;
}

.members-table tbody tr {
  border-bottom: 1px solid #f1f5f9;
  cursor: pointer;
  transition: background 0.15s;
}

.members-table tbody tr:last-child {
  border-bottom: none;
}

.members-table tbody tr:hover {
  background: #f0f7ff;
}

.members-table td {
  padding: 0.95rem 1.25rem;
  color: #1e293b;
  font-size: 0.92rem;
}

/* Modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  z-index: 100;
  animation: fadeIn 0.15s ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.modal {
  background: #ffffff;
  border-radius: 12px;
  width: 100%;
  max-width: 460px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
  animation: slideUp 0.2s ease-out;
}

@keyframes slideUp {
  from { transform: translateY(20px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid #e2e8f0;
}

.modal-header h3 {
  font-size: 1.1rem;
  color: #1e293b;
  font-weight: 700;
}

.btn-close {
  background: transparent;
  border: none;
  color: #64748b;
  cursor: pointer;
  padding: 0.4rem;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
}

.btn-close:hover {
  background: #f1f5f9;
  color: #1e293b;
}

.modal-body {
  padding: 1rem 1.5rem 1.5rem;
}

.detail-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  padding: 0.75rem 0;
  border-bottom: 1px solid #f1f5f9;
}

.detail-row:last-child {
  border-bottom: none;
}

.detail-label {
  font-size: 0.82rem;
  font-weight: 600;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  flex-shrink: 0;
}

.detail-value {
  font-size: 0.95rem;
  color: #1e293b;
  text-align: right;
  word-break: break-word;
}

@media (max-width: 600px) {
  .dashboard-content {
    padding: 1rem;
  }

  .members-table th,
  .members-table td {
    padding: 0.75rem 0.85rem;
    font-size: 0.85rem;
  }
}
</style>

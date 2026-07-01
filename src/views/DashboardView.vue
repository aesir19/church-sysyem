<template>
  <div class="dashboard-container">
    <!-- Toast Notification -->
    <Transition name="toast">
      <div v-if="toast.visible" :class="['toast', toast.type]" role="alert">
        {{ toast.message }}
      </div>
    </Transition>
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
        <div class="page-header-actions">
          <span class="stat-badge">{{ members.length }} total</span>
          <button @click="openCreate" class="btn-primary" :disabled="!myChurchId">
            <span aria-hidden="true">+</span> Add Member
          </button>
        </div>
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

    <!-- Member Modal (view / create / edit / archive-confirm) -->
    <div v-if="modalMode" class="modal-overlay" @click.self="closeModal">
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-header">
          <h3>{{ modalTitle }}</h3>
          <div class="modal-header-actions">
            <button
              v-if="modalMode === 'view'"
              @click="startEdit"
              class="btn-icon"
              aria-label="Edit member"
              title="Edit"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            <button @click="closeModal" class="btn-close" aria-label="Close">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>

        <!-- Body: VIEW mode -->
        <div v-if="modalMode === 'view' && selectedMember" class="modal-body">
          <div class="detail-row">
            <span class="detail-label">Full Name</span>
            <span class="detail-value">{{ fullName(selectedMember) }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Birthdate</span>
            <span class="detail-value">{{ formatDate(selectedMember.birthdate) }}</span>
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
            <span class="detail-label">Marital Status</span>
            <span class="detail-value">{{ selectedMember.marital_status }}</span>
          </div>
          <div v-if="selectedMember.marital_status === 'Married'" class="detail-row">
            <span class="detail-label">Wedding Anniversary</span>
            <span class="detail-value">{{ formatDate(selectedMember.wedding_anniversarry) }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Address</span>
            <span class="detail-value">{{ selectedMember.address || '—' }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Member Of</span>
            <span class="detail-value">{{ myChurchName || '—' }}</span>
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
            <span class="detail-label">Facebook</span>
            <span class="detail-value">{{ selectedMember.facebook_link || '—' }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Date Joined</span>
            <span class="detail-value">{{ formatDate(selectedMember.date_joined) }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Baptized</span>
            <span class="detail-value">{{ selectedMember.is_baptized ? 'Yes' : 'No' }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">One-to-One Completed</span>
            <span class="detail-value">{{ selectedMember.is_one_to_one_completed ? 'Yes' : 'No' }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Turning Point Completed</span>
            <span class="detail-value">{{ selectedMember.is_turning_point_completed ? 'Yes' : 'No' }}</span>
          </div>
        </div>

        <!-- Body: CREATE / EDIT form -->
        <form
          v-else-if="modalMode === 'create' || modalMode === 'edit'"
          class="modal-body modal-form"
          @submit.prevent="modalMode === 'create' ? handleCreate() : handleUpdate()"
        >
          <p v-if="formError" class="form-error" role="alert">{{ formError }}</p>

          <div class="form-grid">
            <label class="form-field">
              <span class="form-label">First Name <em>*</em></span>
              <input v-model="formData.first_name" type="text" required maxlength="100" />
            </label>
            <label class="form-field">
              <span class="form-label">Last Name <em>*</em></span>
              <input v-model="formData.last_name" type="text" required maxlength="100" />
            </label>
            <label class="form-field form-field-full">
              <span class="form-label">Middle Name</span>
              <input v-model="formData.middle_name" type="text" maxlength="100" />
            </label>
            <label class="form-field">
              <span class="form-label">Birthdate <em>*</em></span>
              <input v-model="formData.birthdate" type="date" required :max="todayIso" />
            </label>
            <label class="form-field">
              <span class="form-label">Gender <em>*</em></span>
              <select v-model="formData.gender" required>
                <option value="" disabled>Select…</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
              </select>
            </label>
            <label class="form-field">
              <span class="form-label">Marital Status <em>*</em></span>
              <select v-model="formData.marital_status" required>
                <option value="" disabled>Select…</option>
                <option value="Single">Single</option>
                <option value="Married">Married</option>
                <option value="Widowed">Widowed</option>
                <option value="Separated">Separated</option>
              </select>
            </label>
            <label v-if="formData.marital_status === 'Married'" class="form-field">
              <span class="form-label">Wedding Anniversary</span>
              <input v-model="formData.wedding_anniversarry" type="date" :max="todayIso" />
            </label>
            <label class="form-field form-field-full">
              <span class="form-label">Address</span>
              <input v-model="formData.address" type="text" maxlength="255" />
            </label>
            <label class="form-field">
              <span class="form-label">Date Joined</span>
              <input v-model="formData.date_joined" type="date" :max="todayIso" />
            </label>
            <label class="form-field">
              <span class="form-label">Contact Number</span>
              <input v-model="formData.contact_number" type="tel" maxlength="32" />
            </label>
            <label class="form-field">
              <span class="form-label">Email</span>
              <input v-model="formData.email" type="email" maxlength="255" />
            </label>
            <label class="form-field">
              <span class="form-label">Facebook Link</span>
              <input v-model="formData.facebook_link" type="url" maxlength="255" placeholder="https://facebook.com/..." />
            </label>
            <label class="form-field form-field-full">
              <span class="form-label">Member Of</span>
              <input :value="myChurchName || myChurchId || '—'" type="text" disabled readonly />
            </label>
            <div class="form-field form-field-full form-checkboxes">
              <label class="checkbox-field">
                <input v-model="formData.is_baptized" type="checkbox" />
                <span>Baptized</span>
              </label>
              <label class="checkbox-field">
                <input v-model="formData.is_one_to_one_completed" type="checkbox" />
                <span>One-to-One Completed</span>
              </label>
              <label class="checkbox-field">
                <input v-model="formData.is_turning_point_completed" type="checkbox" />
                <span>Turning Point Completed</span>
              </label>
            </div>
          </div>

          <div class="modal-footer">
            <div class="modal-footer-left"></div>
            <div class="modal-footer-right">
              <button type="button" class="btn-secondary" @click="cancelForm" :disabled="formSaving">
                Cancel
              </button>
              <button type="submit" class="btn-primary" :disabled="formSaving">
                {{ formSaving ? 'Saving…' : (modalMode === 'create' ? 'Create Member' : 'Save Changes') }}
              </button>
            </div>
          </div>
        </form>

        <!-- Body: ARCHIVE confirmation -->
        <div v-else-if="modalMode === 'archive-confirm' && selectedMember" class="modal-body archive-panel">
          <p v-if="formError" class="form-error" role="alert">{{ formError }}</p>
          <h4 class="archive-heading">
            Archive {{ fullName(selectedMember) }}?
          </h4>
          <p class="archive-description">
            This member will no longer appear on the dashboard. Their record is preserved in the database and can be restored later by a database admin.
          </p>
          <label class="form-field form-field-full">
            <span class="form-label">Reason for leaving (optional)</span>
            <textarea
              v-model="archiveReason"
              rows="3"
              maxlength="500"
              placeholder="e.g. moved to another congregation"
            ></textarea>
          </label>

          <div class="modal-footer">
            <div class="modal-footer-left"></div>
            <div class="modal-footer-right">
              <button type="button" class="btn-secondary" @click="cancelArchive" :disabled="formSaving">
                Cancel
              </button>
              <button type="button" class="btn-danger" @click="handleArchive" :disabled="formSaving">
                {{ formSaving ? 'Archiving…' : 'Confirm Archive' }}
              </button>
            </div>
          </div>
        </div>

        <!-- Footer for VIEW mode (Archive button on the left) -->
        <div v-if="modalMode === 'view' && selectedMember" class="modal-footer view-footer">
          <button type="button" class="btn-link-danger" @click="startArchive">
            Archive member
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'
import { buildMemberPayload } from '../utils/memberPayload'

const router = useRouter()

const members = ref([])
const loading = ref(true)
const error = ref('')

// Modal state — drives view / create / edit / archive-confirm
const modalMode = ref(null) // 'view' | 'create' | 'edit' | 'archive-confirm' | null
const selectedMember = ref(null)

// Form state (shared by create + edit)
const blankForm = () => ({
  first_name: '',
  last_name: '',
  middle_name: '',
  birthdate: '',
  gender: '',
  address: '',
  date_joined: '',
  contact_number: '',
  email: '',
  marital_status: '',
  wedding_anniversarry: '',
  facebook_link: '',
  is_one_to_one_completed: false,
  is_turning_point_completed: false,
  is_baptized: false,
})
const formData = ref(blankForm())
const formError = ref('')
const formSaving = ref(false)

// Archive state
const archiveReason = ref('')

// Toast notification state
const toast = ref({ visible: false, message: '', type: 'success' })
let toastTimeout = null

function showToast(message, type = 'success') {
  if (toastTimeout) clearTimeout(toastTimeout)
  toast.value = { visible: true, message, type }
  toastTimeout = setTimeout(() => {
    toast.value.visible = false
  }, 3000)
}

// Caller's church (resolved via RPC; required for create)
// Shared explicit column list — used by fetchMembers, handleCreate, handleUpdate.
// docs/ARCHITECTURE.md §12.3 rule 1: select only what we render.
const MEMBER_COLUMNS = `
  id,
  first_name,
  last_name,
  middle_name,
  birthdate,
  gender,
  address,
  contact_number,
  email,
  date_joined,
  member_of,
  marital_status,
  wedding_anniversarry,
  facebook_link,
  is_one_to_one_completed,
  is_turning_point_completed,
  is_baptized
`

// localStorage cache for the user's church name — lets the page title render
// pre-fetch on cold open. docs/ARCHITECTURE.md §12.5 #5.
const CHURCH_NAME_KEY = 'udfc.myChurchName'
function readCachedChurchName() {
  try { return localStorage.getItem(CHURCH_NAME_KEY) } catch { return null }
}
function writeCachedChurchName(name) {
  try {
    if (name) localStorage.setItem(CHURCH_NAME_KEY, name)
    else localStorage.removeItem(CHURCH_NAME_KEY)
  } catch { /* localStorage unavailable (e.g. private mode) — no-op */ }
}

const myChurchId = ref(null)
const myChurchName = ref(readCachedChurchName())

const sortKey = ref('last_name')
const sortDir = ref('asc')

const todayIso = computed(() => new Date().toISOString().slice(0, 10))

const pageTitle = computed(() => {
  // myChurchName is hydrated from localStorage synchronously; falls back to
  // "Members" until the RPC resolves on cold first run.
  return myChurchName.value ? `UDFC ${myChurchName.value} Members` : 'Members'
})

const modalTitle = computed(() => {
  switch (modalMode.value) {
    case 'create': return 'Add Member'
    case 'edit': return 'Edit Member'
    case 'archive-confirm': return 'Archive Member'
    case 'view':
    default: return 'Member Details'
  }
})

function fullName(m) {
  if (!m) return ''
  const mid = m.middle_name ? ` ${m.middle_name}` : ''
  return `${m.first_name}${mid} ${m.last_name}`
}

async function fetchMyChurch() {
  // Single round-trip: returns { id, name } via the public.get_my_church() RPC.
  // Replaces the prior two-call sequence (rpc('get_my_church_id') + churches.select).
  const { data, error: rpcError } = await supabase
    .rpc('get_my_church')
    .single()
  if (rpcError || !data) return
  myChurchId.value = data.id
  myChurchName.value = data.name
  writeCachedChurchName(data.name)
}

async function fetchMembers() {
  loading.value = true
  error.value = ''

  // RLS already filters to the caller's church AND archived_at IS NULL.
  const { data, error: fetchError } = await supabase
    .from('members')
    .select(MEMBER_COLUMNS)

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

// ── Modal openers / closers ───────────────────────────────────────

function openDetails(member) {
  selectedMember.value = member
  modalMode.value = 'view'
  formError.value = ''
}

function openCreate() {
  if (!myChurchId.value) {
    error.value = 'Cannot determine your church. Please reload.'
    return
  }
  selectedMember.value = null
  formData.value = blankForm()
  formError.value = ''
  modalMode.value = 'create'
}

function startEdit() {
  if (!selectedMember.value) return
  const m = selectedMember.value
  formData.value = {
    first_name: m.first_name ?? '',
    last_name: m.last_name ?? '',
    middle_name: m.middle_name ?? '',
    birthdate: m.birthdate ?? '',
    gender: m.gender ?? '',
    address: m.address ?? '',
    date_joined: m.date_joined ?? '',
    contact_number: m.contact_number != null ? String(m.contact_number) : '',
    email: m.email ?? '',
    marital_status: m.marital_status ?? '',
    wedding_anniversarry: m.wedding_anniversarry ?? '',
    facebook_link: m.facebook_link ?? '',
    is_one_to_one_completed: m.is_one_to_one_completed ?? false,
    is_turning_point_completed: m.is_turning_point_completed ?? false,
    is_baptized: m.is_baptized ?? false,
  }
  formError.value = ''
  modalMode.value = 'edit'
}

function startArchive() {
  archiveReason.value = ''
  formError.value = ''
  modalMode.value = 'archive-confirm'
}

function cancelArchive() {
  // Return to view mode without closing
  formError.value = ''
  modalMode.value = 'view'
}

function cancelForm() {
  // Edit → return to view; Create → close entirely
  formError.value = ''
  if (modalMode.value === 'edit' && selectedMember.value) {
    modalMode.value = 'view'
  } else {
    closeModal()
  }
}

function closeModal() {
  modalMode.value = null
  selectedMember.value = null
  formData.value = blankForm()
  formError.value = ''
  archiveReason.value = ''
  formSaving.value = false
}

// ── Mutations ─────────────────────────────────────────────────────

function buildPayload() {
  return buildMemberPayload(formData.value)
}

async function handleCreate() {
  formError.value = ''
  formSaving.value = true

  const payload = {
    ...buildPayload(),
    member_of: myChurchId.value, // RLS will reject any other value anyway
  }

  const { data, error: insertError } = await supabase
    .from('members')
    .insert(payload)
    .select(MEMBER_COLUMNS)
    .single()

  formSaving.value = false

  if (insertError) {
    formError.value = insertError.message
    showToast('Failed to create member.', 'error')
    return
  }
  members.value = [data, ...members.value]
  closeModal()
  showToast('Member created successfully.', 'success')
}

async function handleUpdate() {
  if (!selectedMember.value) return
  formError.value = ''
  formSaving.value = true

  const { data, error: updateError } = await supabase
    .from('members')
    .update(buildPayload())
    .eq('id', selectedMember.value.id)
    .select(MEMBER_COLUMNS)
    .single()

  formSaving.value = false

  if (updateError) {
    formError.value = updateError.message
    showToast('Failed to update member.', 'error')
    return
  }
  const idx = members.value.findIndex(m => m.id === data.id)
  if (idx !== -1) members.value.splice(idx, 1, data)
  selectedMember.value = data
  modalMode.value = 'view'
  showToast('Member updated successfully.', 'success')
}

async function handleArchive() {
  if (!selectedMember.value) return
  formError.value = ''
  formSaving.value = true

  const { error: archiveError } = await supabase
    .from('members')
    .update({
      archived_at: new Date().toISOString(),
      archived_reason: archiveReason.value.trim() || null,
    })
    .eq('id', selectedMember.value.id)

  formSaving.value = false

  if (archiveError) {
    formError.value = archiveError.message
    showToast('Failed to archive member.', 'error')
    return
  }
  // Drop from local list — RLS will hide it on next reload too.
  members.value = members.value.filter(m => m.id !== selectedMember.value.id)
  closeModal()
  showToast('Member archived successfully.', 'success')
}

function handleEsc(e) {
  if (e.key === 'Escape' && modalMode.value) closeModal()
}

async function handleLogout() {
  // Clear the localStorage church-name cache so a different user signing in
  // on the same browser doesn't briefly see the previous church's title.
  writeCachedChurchName(null)
  await supabase.auth.signOut()
  router.push('/login')
}

onMounted(() => {
  fetchMyChurch()
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
  max-width: 520px;
  max-height: 90vh;
  overflow-y: auto;
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

/* Page-header actions (badge + add button) */
.page-header-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

/* Buttons */
.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.55rem 1rem;
  background: #1a56db;
  color: #ffffff;
  border: 1px solid #1a56db;
  border-radius: 8px;
  font-size: 0.88rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, opacity 0.15s;
}

.btn-primary:hover:not(:disabled) {
  background: #1947b8;
  border-color: #1947b8;
}

.btn-primary:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.btn-secondary {
  padding: 0.55rem 1rem;
  background: #ffffff;
  color: #475569;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 0.88rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}

.btn-secondary:hover:not(:disabled) {
  background: #f1f5f9;
}

.btn-secondary:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.btn-danger {
  padding: 0.55rem 1rem;
  background: #dc2626;
  color: #ffffff;
  border: 1px solid #dc2626;
  border-radius: 8px;
  font-size: 0.88rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}

.btn-danger:hover:not(:disabled) {
  background: #b91c1c;
  border-color: #b91c1c;
}

.btn-danger:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.btn-link-danger {
  background: transparent;
  border: none;
  color: #b91c1c;
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  padding: 0.4rem 0.5rem;
  border-radius: 6px;
  transition: background 0.15s;
}

.btn-link-danger:hover {
  background: #fef2f2;
}

.btn-icon {
  background: transparent;
  border: none;
  color: #64748b;
  cursor: pointer;
  padding: 0.4rem;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
}

.btn-icon:hover {
  background: #eff6ff;
  color: #1a56db;
}

/* Modal header actions wrapper */
.modal-header-actions {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

/* Form */
.modal-form {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.85rem 1rem;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 0;
}

.form-field-full {
  grid-column: 1 / -1;
}

.form-label {
  font-size: 0.78rem;
  font-weight: 600;
  color: #475569;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.form-label em {
  color: #dc2626;
  font-style: normal;
  margin-left: 0.15rem;
}

.form-field input,
.form-field select,
.form-field textarea {
  width: 100%;
  padding: 0.55rem 0.75rem;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 0.92rem;
  color: #1e293b;
  background: #ffffff;
  font-family: inherit;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.form-field input:focus,
.form-field select:focus,
.form-field textarea:focus {
  outline: none;
  border-color: #1a56db;
  box-shadow: 0 0 0 3px rgba(26, 86, 219, 0.12);
}

.form-field input:disabled,
.form-field input[readonly] {
  background: #f8fafc;
  color: #64748b;
  cursor: not-allowed;
}

.form-field textarea {
  resize: vertical;
  min-height: 72px;
}

.form-checkboxes {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  padding-top: 0.5rem;
}

.checkbox-field {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  cursor: pointer;
  font-size: 0.88rem;
  color: #1e293b;
}

.checkbox-field input[type="checkbox"] {
  width: 16px;
  height: 16px;
  accent-color: #1a56db;
  cursor: pointer;
}

.form-error {
  background: #fef2f2;
  color: #b91c1c;
  border: 1px solid #fecaca;
  padding: 0.6rem 0.85rem;
  border-radius: 8px;
  font-size: 0.85rem;
  margin-bottom: 0.5rem;
}

/* Modal footer */
.modal-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem 1.5rem;
  border-top: 1px solid #f1f5f9;
  margin-top: 1rem;
  margin-left: -1.5rem;
  margin-right: -1.5rem;
  margin-bottom: -1.5rem;
}

.modal-footer-right {
  display: flex;
  gap: 0.5rem;
  margin-left: auto;
}

/* View-mode footer (Archive on left) — sits outside the body */
.view-footer {
  margin: 0;
  padding: 0.85rem 1.5rem;
  border-top: 1px solid #e2e8f0;
}

/* Archive confirmation panel */
.archive-panel .archive-heading {
  font-size: 1rem;
  color: #1e293b;
  font-weight: 700;
  margin-bottom: 0.4rem;
}

.archive-panel .archive-description {
  font-size: 0.88rem;
  color: #64748b;
  line-height: 1.45;
  margin-bottom: 1rem;
}

/* Toast Notification */
.toast {
  position: fixed;
  top: 1.25rem;
  right: 1.25rem;
  padding: 0.75rem 1.25rem;
  border-radius: 8px;
  font-size: 0.88rem;
  font-weight: 600;
  z-index: 200;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
}

.toast.success {
  background: #ecfdf5;
  color: #065f46;
  border: 1px solid #a7f3d0;
}

.toast.error {
  background: #fef2f2;
  color: #991b1b;
  border: 1px solid #fecaca;
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.3s, transform 0.3s;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-10px);
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

  .form-grid {
    grid-template-columns: 1fr;
  }

  .page-header-actions {
    width: 100%;
    justify-content: space-between;
  }
}
</style>

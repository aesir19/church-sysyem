<template>
  <div class="page-container">
    <!-- Toast Notification -->
    <Transition name="toast">
      <div v-if="toast.visible" :class="['toast', toast.type]" role="alert">
        {{ toast.message }}
      </div>
    </Transition>

    <main class="page-content">
      <div class="page-header">
        <div>
          <h2>Ministries &amp; Small Groups</h2>
          <p class="page-subtitle">Manage ministries, small groups, and their members</p>
        </div>
        <div class="page-header-actions">
          <span class="stat-badge">{{ filteredGroups.length }} total</span>
          <button v-if="canManageSmallGroups" @click="openCreateGroup" class="btn-primary" :disabled="!myChurchId">
            <span aria-hidden="true">+</span> Add Small Group
          </button>
        </div>
      </div>

      <!-- Tabs + Search -->
      <div class="toolbar">
        <div class="tab-bar">
          <button
            :class="['tab-btn', { active: activeTab === 'all' }]"
            @click="activeTab = 'all'"
          >All</button>
          <button
            :class="['tab-btn', { active: activeTab === 'Ministry' }]"
            @click="activeTab = 'Ministry'"
          >Ministries</button>
          <button
            :class="['tab-btn', { active: activeTab === 'Small Group' }]"
            @click="activeTab = 'Small Group'"
          >Small Groups</button>
        </div>
        <div class="search-wrapper">
          <svg class="search-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Search groups…"
            class="search-input"
          />
        </div>
      </div>

      <!-- Member Search Section -->
      <div class="member-search-section card">
        <div class="member-search-header">
          <h4>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
            </svg>
            Member Lookup
          </h4>
          <span class="member-search-hint">Find which groups a member belongs to</span>
        </div>
        <div class="member-search-bar">
          <svg class="search-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            v-model="memberSearchQuery"
            type="text"
            placeholder="Search by member name…"
            class="search-input member-search-input"
          />
        </div>
        <!-- Member Search Results -->
        <div v-if="memberSearchQuery.length >= 2" class="member-search-results">
          <div v-if="memberSearchLoading" class="state-message small">
            <div class="spinner"></div>
          </div>
          <div v-else-if="memberSearchResults.length === 0" class="member-search-empty">
            No members found matching "{{ memberSearchQuery }}".
          </div>
          <div v-else class="member-results-list">
            <div
              v-for="result in memberSearchResults"
              :key="result.member.id"
              class="member-result-card"
            >
              <div class="member-result-header">
                <span class="member-avatar">{{ result.member.first_name?.[0] }}{{ result.member.last_name?.[0] }}</span>
                <span class="member-result-name">{{ result.member.first_name }} {{ result.member.last_name }}</span>
              </div>
              <div v-if="result.groups.length === 0" class="member-result-nogroups">
                Not a member of any group.
              </div>
              <div v-else class="member-result-groups">
                <span
                  v-for="g in result.groups"
                  :key="g.id"
                  :class="['member-group-tag', g.type === 'Ministry' ? 'tag-ministry' : 'tag-smallgroup']"
                >
                  {{ g.name }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="card">
        <div class="state-message">
          <div class="spinner"></div>
          <p>Loading groups…</p>
        </div>
      </div>

      <!-- Error -->
      <div v-else-if="error" class="card">
        <div class="state-message error">
          <p>{{ error }}</p>
        </div>
      </div>

      <!-- Empty -->
      <div v-else-if="filteredGroups.length === 0" class="card">
        <div class="state-message">
          <p v-if="searchQuery || activeTab !== 'all'">No groups match your filter.</p>
          <p v-else>No ministries or small groups are available yet.</p>
        </div>
      </div>

      <!-- Group Cards Grid -->
      <div v-else class="group-grid">
        <button
          v-for="group in filteredGroups"
          :key="group.id"
          type="button"
          class="group-card"
          :style="getGroupAccentStyle(group.color_slot)"
          @click="openGroupDetail(group)"
        >
          <div class="group-card-header">
            <span class="group-type-label">{{ group.type === 'Ministry' ? 'Ministry' : 'Small Group' }}</span>
          </div>
          <h3 class="group-card-name">{{ group.name }}</h3>
          <div class="group-card-meta">
            <span class="meta-item">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
              </svg>
              {{ group.member_count }} {{ group.member_count === 1 ? 'member' : 'members' }}
            </span>
          </div>
        </button>
      </div>
    </main>

    <!-- ─── Group Detail Modal ─── -->
    <div v-if="detailModal.open" class="modal-overlay" @click.self="closeDetailModal">
      <div class="modal modal-wide" role="dialog" aria-modal="true">
        <div class="modal-header">
          <h3>{{ detailModal.group?.name }}</h3>
          <div class="modal-header-actions">
            <button
              v-if="detailModal.group?.type === 'Small Group' && canManageSmallGroups"
              @click="openEditGroup(detailModal.group)"
              class="btn-icon"
              aria-label="Edit small group"
              title="Edit"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            <button @click="closeDetailModal" class="btn-close" aria-label="Close">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>

        <div class="modal-body">
          <span class="detail-type-badge">{{ detailModal.group?.type }}</span>
          <!-- Members Section -->
          <div class="members-section">
            <div class="members-section-header">
              <h4>Members ({{ detailModal.members.length }})</h4>
              <button v-if="canManageCurrentGroup" @click="showMemberPicker = true" class="btn-primary btn-sm">
                <span aria-hidden="true">+</span> Add
              </button>
            </div>

            <!-- Add Member Picker (inline) -->
            <div v-if="showMemberPicker" class="member-picker">
              <div class="picker-search-wrapper">
                <input
                  v-model="pickerSearch"
                  type="text"
                  placeholder="Search members to add…"
                  class="picker-search"
                  ref="pickerInput"
                />
              </div>
              <div class="picker-results" v-if="pickerResults.length > 0">
                <div
                  v-for="m in pickerResults"
                  :key="m.id"
                  class="picker-item"
                  @click="addMemberToGroup(m)"
                >
                  <span class="picker-avatar">{{ m.first_name?.[0] }}{{ m.last_name?.[0] }}</span>
                  <span class="picker-name">{{ m.first_name }} {{ m.last_name }}</span>
                </div>
              </div>
              <div v-else-if="pickerSearch.length >= 2" class="picker-empty">
                No matching members found.
              </div>
              <button @click="showMemberPicker = false; pickerSearch = ''" class="btn-link-muted picker-cancel">Cancel</button>
            </div>

            <!-- Member List -->
            <div v-if="detailModal.membersLoading" class="state-message small">
              <div class="spinner"></div>
            </div>
            <div v-else-if="detailModal.members.length === 0 && !showMemberPicker" class="state-message small">
              <p>No members in this group yet.</p>
            </div>
            <ul v-else class="member-list">
              <li v-for="gm in detailModal.members" :key="gm.id" class="member-list-item">
                <div class="member-info">
                  <span class="member-avatar">{{ gm.members?.first_name?.[0] }}{{ gm.members?.last_name?.[0] }}</span>
                  <span class="member-name">{{ gm.members?.first_name }} {{ gm.members?.last_name }}</span>
                </div>
                <button
                  v-if="!gm.confirmRemove && canManageCurrentGroup"
                  @click.stop="gm.confirmRemove = true"
                  class="btn-remove"
                  aria-label="Remove member"
                  title="Remove"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
                <span v-else class="confirm-remove">
                  <span class="confirm-text">Remove?</span>
                  <button @click.stop="removeMemberFromGroup(gm)" class="btn-confirm-yes">Yes</button>
                  <button @click.stop="gm.confirmRemove = false" class="btn-confirm-no">No</button>
                </span>
              </li>
            </ul>
          </div>
        </div>

        <div v-if="detailModal.group?.type === 'Small Group' && canManageSmallGroups" class="modal-footer view-footer">
          <button type="button" class="btn-link-danger" @click="startDeleteGroup">Delete small group</button>
        </div>

      </div>
    </div>

    <!-- ─── Delete Group Confirmation Modal ─── -->
    <div v-if="deleteModal.open" class="modal-overlay" @click.self="closeDeleteModal">
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-header">
          <h3>Delete Small Group</h3>
          <button @click="closeDeleteModal" class="btn-close" aria-label="Close">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div class="modal-body">
          <p v-if="formError" class="form-error" role="alert">{{ formError }}</p>
          <h4 class="archive-heading">Delete "{{ deleteModal.group?.name }}"?</h4>
          <p class="archive-description">
            This will permanently remove the small group and all its member associations. Individual member records will not be affected.
          </p>
        </div>
        <div class="modal-footer">
          <div class="modal-footer-left"></div>
          <div class="modal-footer-right">
            <button type="button" class="btn-secondary" @click="closeDeleteModal" :disabled="formSaving">Cancel</button>
            <button type="button" class="btn-danger" @click="handleDeleteGroup" :disabled="formSaving">
              {{ formSaving ? 'Deleting…' : 'Confirm Delete' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ─── Create / Edit Group Modal ─── -->
    <div v-if="groupFormModal.open" class="modal-overlay" @click.self="closeGroupFormModal">
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-header">
          <h3>{{ groupFormModal.mode === 'create' ? 'Add Small Group' : 'Edit Small Group' }}</h3>
          <button @click="closeGroupFormModal" class="btn-close" aria-label="Close">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <form class="modal-body modal-form" @submit.prevent="handleGroupFormSubmit">
          <p v-if="formError" class="form-error" role="alert">{{ formError }}</p>

          <div class="form-grid">
            <label class="form-field form-field-full">
              <span class="form-label">Name <em>*</em></span>
              <input v-model="groupForm.name" type="text" required maxlength="100" />
            </label>
            <div class="form-field form-field-full">
              <span class="form-label">Type</span>
              <span class="form-static-value">Small Group</span>
            </div>
          </div>

          <div class="modal-footer">
            <div class="modal-footer-left"></div>
            <div class="modal-footer-right">
              <button type="button" class="btn-secondary" @click="closeGroupFormModal" :disabled="formSaving">Cancel</button>
              <button type="submit" class="btn-primary" :disabled="formSaving">
                {{ formSaving ? 'Saving…' : (groupFormModal.mode === 'create' ? 'Create Small Group' : 'Save Changes') }}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { supabase } from '../lib/supabase'
import { write } from '../lib/data/write'
import { getGroupAccentStyle } from '../utils/groupPresentation'
import { buildSmallGroupCreatePayload, buildSmallGroupUpdatePayload } from '../utils/groupPayload'
import { useCurrentRole } from '../composables/useCurrentRole'
import { useActiveChurch } from '../composables/useActiveChurch'

// Explicit projections — select only what the cards and the detail modal render.
const GROUP_COLUMNS = 'id, name, type, church_id, color_slot'
const GROUP_MEMBER_COLUMNS = 'id, member_id, members!inner(first_name, last_name, member_of)'

// RBAC (presentation; RLS enforces). canManageSmallGroups → create/edit/delete small
// groups. Membership management is group-specific: the Finance ministry is Pastor-only.
const { canManageSmallGroups, canManageGroupMembers, isCrossChurch } = useCurrentRole()

// Church scoping (own church, or the selected church for SuperAdmin / Head Pastor).
const { activeChurchId, ensureLoaded } = useActiveChurch()

// ── State ──────────────────────────────────────────────────────

const groups = ref([])
const loading = ref(true)
const error = ref('')
// Alias to the shared active church so the rest of the view is unchanged.
const myChurchId = activeChurchId

const activeTab = ref('all')
const searchQuery = ref('')

// Member search
const memberSearchQuery = ref('')
const memberSearchResults = ref([])
const memberSearchLoading = ref(false)
let memberSearchTimeout = null

// Toast
const toast = ref({ visible: false, message: '', type: 'success' })
let toastTimeout = null

function showToast(message, type = 'success') {
  if (toastTimeout) clearTimeout(toastTimeout)
  toast.value = { visible: true, message, type }
  toastTimeout = setTimeout(() => { toast.value.visible = false }, 3000)
}

// Group form modal (create / edit)
const groupFormModal = ref({ open: false, mode: 'create', groupId: null })
const groupForm = ref({ name: '' })
const formError = ref('')
const formSaving = ref(false)

// Detail modal
const detailModal = reactive({
  open: false,
  group: null,
  members: [],
  membersLoading: false,
})

// Whether the caller may add/remove members for the currently open group. The
// Finance ministry is Pastor-only; canManageGroupMembers encodes that rule.
const canManageCurrentGroup = computed(() =>
  canManageGroupMembers({ isFinanceGroup: detailModal.group?.ministry_key === 'finance' })
)

// Delete modal
const deleteModal = reactive({ open: false, group: null })

// Member picker
const showMemberPicker = ref(false)
const pickerSearch = ref('')
const pickerInput = ref(null)
const allMembers = ref([])

// ── Computed ───────────────────────────────────────────────────

const filteredGroups = computed(() => {
  let list = groups.value
  if (activeTab.value !== 'all') {
    list = list.filter(g => g.type === activeTab.value)
  }
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.trim().toLowerCase()
    list = list.filter(g => g.name.toLowerCase().includes(q))
  }
  return list
})

const pickerResults = computed(() => {
  if (pickerSearch.value.length < 2) return []
  const q = pickerSearch.value.toLowerCase()
  const currentIds = new Set(detailModal.members.map(gm => gm.member_id))
  return allMembers.value
    .filter(m =>
      !currentIds.has(m.id) &&
      (`${m.first_name} ${m.last_name}`.toLowerCase().includes(q) ||
       `${m.last_name}, ${m.first_name}`.toLowerCase().includes(q))
    )
    .slice(0, 8)
})

// Auto-focus the picker input when it opens
watch(showMemberPicker, async (val) => {
  if (val) {
    await nextTick()
    pickerInput.value?.focus()
  }
})

// Member search debounce
watch(memberSearchQuery, (val) => {
  if (memberSearchTimeout) clearTimeout(memberSearchTimeout)
  if (val.trim().length < 2) {
    memberSearchResults.value = []
    return
  }
  memberSearchLoading.value = true
  memberSearchTimeout = setTimeout(() => {
    searchMemberGroups(val.trim())
  }, 300)
})

async function searchMemberGroups(query) {
  memberSearchLoading.value = true

  // Use directory_search rather than the members table: baseline users cannot read
  // `members` under RLS (0015), but "search a person, see their ministries/small
  // groups" is an explicit baseline feature. The RPC returns exactly that — names
  // plus the member's ministry and small-group names — scoped to the caller's
  // church (all churches for SuperAdmin/Head Pastor), archived excluded.
  const { data, error: dirError } = await supabase.rpc('directory_search', {
    p_query: query,
    p_church_id: activeChurchId.value,
  })

  if (dirError || !data) {
    memberSearchResults.value = []
    memberSearchLoading.value = false
    return
  }

  memberSearchResults.value = data.map((row) => ({
    member: { id: row.member_id, first_name: row.first_name, last_name: row.last_name },
    groups: [
      ...(row.ministries || []).map((name) => ({ id: `m:${name}`, name, type: 'Ministry' })),
      ...(row.small_groups || []).map((name) => ({ id: `sg:${name}`, name, type: 'Small Group' })),
    ],
  }))
  memberSearchLoading.value = false
}

// ── Data Fetching ──────────────────────────────────────────────

async function fetchGroups() {
  loading.value = true
  error.value = ''

  const churchId = myChurchId.value

  // Groups (global ministries + this church's small groups) and the per-church
  // member counts, in parallel. The count must be scoped to the active church:
  // a Ministry is GLOBAL, so its group_members span every church, and an embedded
  // group_members(count) would report the all-church total that never changes when
  // the church selector switches (the bug this fixes).
  //
  // For a single-church user, group_members RLS already scopes to their church, so
  // a plain group_id select counts correctly. A cross-church user (SuperAdmin) sees
  // every church under RLS, so the count is filtered by the member's church via an
  // inner join to members.
  const countSelect = isCrossChurch.value ? 'group_id, members!inner(member_of)' : 'group_id'
  let countQuery = supabase.from('group_members').select(countSelect)
  if (isCrossChurch.value) countQuery = countQuery.eq('members.member_of', churchId)

  const [groupsRes, countsRes] = await Promise.all([
    supabase
      .from('groups')
      .select('id, name, type, church_id, color_slot, ministry_key')
      .or(`and(type.eq.Ministry,church_id.is.null),and(type.eq.Small Group,church_id.eq.${churchId})`),
    countQuery,
  ])

  if (groupsRes.error) {
    error.value = `Failed to load groups: ${groupsRes.error.message}`
  } else {
    const counts = {}
    for (const row of countsRes.data || []) {
      counts[row.group_id] = (counts[row.group_id] || 0) + 1
    }
    groups.value = (groupsRes.data || []).map(g => ({
      ...g,
      member_count: counts[g.id] ?? 0,
    }))
  }
  loading.value = false
}

async function fetchGroupMembers(groupId) {
  detailModal.membersLoading = true
  const { data, error: fetchError } = await supabase
    .from('group_members')
    .select('id, member_id, members!inner(first_name, last_name, member_of)')
    .eq('group_id', groupId)
    .eq('members.member_of', myChurchId.value)

  if (fetchError) {
    showToast(`Failed to load members: ${fetchError.message}`, 'error')
    detailModal.members = []
  } else {
    detailModal.members = (data || []).map(gm => ({ ...gm, confirmRemove: false }))
  }
  detailModal.membersLoading = false
}

async function fetchAllMembers() {
  if (allMembers.value.length > 0) return
  const { data } = await supabase
    .from('members')
    .select('id, first_name, last_name')
    .eq('member_of', myChurchId.value)
    // Required since 0010_members_select_allow_archived — see the search query above.
    .is('archived_at', null)
  allMembers.value = data || []
}

// ── Group CRUD ─────────────────────────────────────────────────

function openCreateGroup() {
  if (!myChurchId.value) return
  groupForm.value = { name: '' }
  formError.value = ''
  groupFormModal.value = { open: true, mode: 'create', groupId: null }
}

function openEditGroup(group) {
  if (group?.type !== 'Small Group' || group.church_id !== myChurchId.value) return
  groupForm.value = { name: group.name }
  formError.value = ''
  groupFormModal.value = { open: true, mode: 'edit', groupId: group.id }
}

function closeGroupFormModal() {
  groupFormModal.value = { open: false, mode: 'create', groupId: null }
  formError.value = ''
  formSaving.value = false
}

async function handleGroupFormSubmit() {
  formError.value = ''
  formSaving.value = true

  if (groupFormModal.value.mode === 'create') {
    const payload = buildSmallGroupCreatePayload(groupForm.value, myChurchId.value)
    const result = await write(
      supabase.from('groups').insert(payload),
      {
        columns: GROUP_COLUMNS,
        messages: { blocked: 'That group could not be created. It may belong to another church.' },
      }
    )

    formSaving.value = false
    if (!result.ok) {
      formError.value = result.message
      showToast('Failed to create group.', 'error')
      return
    }
    groups.value = [{ ...result.rows[0], member_count: 0 }, ...groups.value]
    closeGroupFormModal()
    showToast('Small group created successfully.')
  } else {
    const payload = buildSmallGroupUpdatePayload(groupForm.value)
    const result = await write(
      supabase
        .from('groups')
        .update(payload)
        .eq('id', groupFormModal.value.groupId)
        .eq('church_id', myChurchId.value)
        .eq('type', 'Small Group'),
      {
        columns: GROUP_COLUMNS,
        messages: { blocked: 'That group could not be updated. It may belong to another church.' },
      }
    )

    formSaving.value = false
    if (!result.ok) {
      formError.value = result.message
      showToast('Failed to update group.', 'error')
      return
    }
    const saved = result.rows[0]
    const idx = groups.value.findIndex(g => g.id === saved.id)
    if (idx !== -1) {
      groups.value.splice(idx, 1, { ...saved, member_count: groups.value[idx].member_count })
    }
    // Sync detail modal if open
    if (detailModal.open && detailModal.group?.id === saved.id) {
      detailModal.group = { ...detailModal.group, ...saved }
    }
    closeGroupFormModal()
    showToast('Small group updated successfully.')
  }
}

// ── Detail Modal ───────────────────────────────────────────────

async function openGroupDetail(group) {
  detailModal.open = true
  detailModal.group = group
  detailModal.members = []
  showMemberPicker.value = false
  pickerSearch.value = ''
  formError.value = ''
  fetchGroupMembers(group.id)
  fetchAllMembers()
}

function closeDetailModal() {
  detailModal.open = false
  detailModal.group = null
  detailModal.members = []
  showMemberPicker.value = false
  pickerSearch.value = ''
}

// ── Delete Group ───────────────────────────────────────────────

function startDeleteGroup() {
  if (detailModal.group?.type !== 'Small Group' || detailModal.group.church_id !== myChurchId.value) return
  deleteModal.open = true
  deleteModal.group = detailModal.group
  formError.value = ''
}

function closeDeleteModal() {
  deleteModal.open = false
  deleteModal.group = null
  formError.value = ''
  formSaving.value = false
}

async function handleDeleteGroup() {
  if (
    !deleteModal.group ||
    deleteModal.group.type !== 'Small Group' ||
    deleteModal.group.church_id !== myChurchId.value
  ) return
  formError.value = ''
  formSaving.value = true

  // Previously issued with no `.select()`, so a delete RLS refused came back as
  // success and the group vanished from the list until the next reload.
  const result = await write(
    supabase
      .from('groups')
      .delete()
      .eq('id', deleteModal.group.id)
      .eq('church_id', myChurchId.value)
      .eq('type', 'Small Group'),
    { columns: 'id', messages: { blocked: 'That group could not be deleted. It may belong to another church.' } }
  )

  formSaving.value = false
  if (!result.ok) {
    formError.value = result.message
    showToast('Failed to delete group.', 'error')
    return
  }

  groups.value = groups.value.filter(g => g.id !== deleteModal.group.id)
  closeDeleteModal()
  closeDetailModal()
  showToast('Small group deleted successfully.')
}

// ── Add / Remove Members ───────────────────────────────────────

async function addMemberToGroup(member) {
  const targetGroup = groups.value.find(group => group.id === detailModal.group?.id)
  if (
    !myChurchId.value ||
    !targetGroup ||
    !allMembers.value.some(candidate => candidate.id === member.id)
  ) return
  const result = await write(
    supabase.from('group_members').insert({ group_id: detailModal.group.id, member_id: member.id }),
    {
      columns: GROUP_MEMBER_COLUMNS,
      messages: {
        blocked: 'That member could not be added to this group.',
        conflict: 'That member is already in this group.',
      },
    }
  )

  if (!result.ok) {
    showToast(result.message, 'error')
    return
  }

  detailModal.members.push({ ...result.rows[0], confirmRemove: false })
  // Update count in card
  const g = groups.value.find(g => g.id === detailModal.group.id)
  if (g) g.member_count++
  pickerSearch.value = ''
  showToast(`${member.first_name} ${member.last_name} added.`)
}

async function removeMemberFromGroup(gm) {
  // Also previously issued with no `.select()` — a refused removal reported
  // success and dropped the member from the modal list.
  const result = await write(
    supabase
      .from('group_members')
      .delete()
      .eq('id', gm.id)
      .eq('group_id', detailModal.group.id)
      .eq('member_id', gm.member_id),
    { columns: 'id', messages: { blocked: 'That member could not be removed from this group.' } }
  )

  if (!result.ok) {
    showToast(result.message, 'error')
    return
  }

  detailModal.members = detailModal.members.filter(m => m.id !== gm.id)
  const g = groups.value.find(g => g.id === detailModal.group.id)
  if (g) g.member_count = Math.max(0, g.member_count - 1)
  showToast('Member removed.')
}

// ── Keyboard ───────────────────────────────────────────────────

function handleEsc(e) {
  if (e.key !== 'Escape') return
  if (deleteModal.open) { closeDeleteModal(); return }
  if (groupFormModal.value.open) { closeGroupFormModal(); return }
  if (detailModal.open) { closeDetailModal(); return }
}

// Re-load groups when the active church changes (church selector).
watch(activeChurchId, () => {
  if (!activeChurchId.value) return
  closeDetailModal()
  memberSearchResults.value = []
  memberSearchQuery.value = ''
  allMembers.value = []
  fetchGroups()
})

onMounted(async () => {
  await ensureLoaded()
  if (activeChurchId.value) await fetchGroups()
  window.addEventListener('keydown', handleEsc)
})

onUnmounted(() => {
  if (memberSearchTimeout) clearTimeout(memberSearchTimeout)
  if (toastTimeout) clearTimeout(toastTimeout)
  window.removeEventListener('keydown', handleEsc)
})
</script>

<style scoped>
.page-container {
  min-height: 100vh;
  background: #f8fafc;
}

.page-content {
  padding: 2rem;
  max-width: 1200px;
  margin: 0 auto;
}

/* Page Header */
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

.page-header-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
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

/* Toolbar */
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.25rem;
  gap: 1rem;
  flex-wrap: wrap;
}

.tab-bar {
  display: flex;
  gap: 0.25rem;
  background: #e2e8f0;
  border-radius: 8px;
  padding: 3px;
}

.tab-btn {
  padding: 0.45rem 1rem;
  border: none;
  background: transparent;
  color: #475569;
  font-size: 0.85rem;
  font-weight: 600;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.tab-btn.active {
  background: #ffffff;
  color: #1a56db;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}

.tab-btn:hover:not(.active) {
  color: #1e293b;
}

.search-wrapper {
  position: relative;
}

.search-icon {
  position: absolute;
  left: 0.7rem;
  top: 50%;
  transform: translateY(-50%);
  color: #94a3b8;
  pointer-events: none;
}

.search-input {
  padding: 0.5rem 0.75rem 0.5rem 2.1rem;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 0.88rem;
  color: #1e293b;
  background: #ffffff;
  font-family: inherit;
  width: 220px;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.search-input:focus {
  outline: none;
  border-color: #1a56db;
  box-shadow: 0 0 0 3px rgba(26, 86, 219, 0.12);
}

/* Cards */
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

.state-message.small {
  padding: 1.5rem 1rem;
}

.state-message.error {
  color: #dc2626;
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

/* Group Grid */
.group-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 1rem;
}

.group-card {
  appearance: none;
  width: 100%;
  text-align: left;
  font: inherit;
  background: #ffffff;
  border-radius: 12px;
  padding: 1.25rem;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04), 0 4px 12px rgba(26, 86, 219, 0.04);
  cursor: pointer;
  transition: box-shadow 0.2s, transform 0.15s, background 0.15s;
  border: 1px solid #e2e8f0;
  border-left: 4px solid var(--group-accent, #1d4ed8);
}

.group-card:hover {
  box-shadow: 0 4px 16px color-mix(in srgb, var(--group-accent, #1d4ed8) 16%, transparent);
  transform: translateY(-2px);
  background: #f8fafc;
}

.group-card:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--group-accent, #1d4ed8) 32%, transparent);
  outline-offset: 3px;
}

.group-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.75rem;
}

.group-type-label {
  display: inline-flex;
  padding: 0.25rem 0.55rem;
  border-radius: 999px;
  background: #f1f5f9;
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #475569;
}

.group-card-name {
  font-size: 1.05rem;
  font-weight: 700;
  color: #1e293b;
  margin-bottom: 0.65rem;
}

.group-card-meta {
  display: flex;
  gap: 1rem;
}

.meta-item {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.82rem;
  color: #64748b;
}

/* ── Modals ── */
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

.modal-wide {
  max-width: 580px;
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

.modal-header-actions {
  display: flex;
  align-items: center;
  gap: 0.25rem;
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

.modal-body {
  padding: 1rem 1.5rem 1.5rem;
}

.detail-type-badge {
  display: inline-flex;
  padding: 0.25rem 0.6rem;
  border-radius: 999px;
  background: #f1f5f9;
  color: #475569;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
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

/* Members Section */
.members-section {
  margin-top: 1rem;
}

.members-section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid #e2e8f0;
}

.members-section-header h4 {
  font-size: 0.92rem;
  font-weight: 700;
  color: #1e293b;
}

.btn-sm {
  padding: 0.35rem 0.7rem;
  font-size: 0.8rem;
}

/* Member picker */
.member-picker {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 0.75rem;
  margin-bottom: 0.75rem;
}

.picker-search-wrapper {
  margin-bottom: 0.5rem;
}

.picker-search {
  width: 100%;
  padding: 0.5rem 0.75rem;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 0.88rem;
  color: #1e293b;
  background: #ffffff;
  font-family: inherit;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.picker-search:focus {
  outline: none;
  border-color: #1a56db;
  box-shadow: 0 0 0 3px rgba(26, 86, 219, 0.12);
}

.picker-results {
  max-height: 180px;
  overflow-y: auto;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: #ffffff;
}

.picker-item {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.55rem 0.75rem;
  font-size: 0.88rem;
  color: #1e293b;
  cursor: pointer;
  transition: background 0.1s;
  border-bottom: 1px solid #f1f5f9;
}

.picker-item:last-child {
  border-bottom: none;
}

.picker-item:hover {
  background: #eff6ff;
}

.picker-item:hover .picker-name {
  color: #1a56db;
}

.picker-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: #e2e8f0;
  color: #475569;
  font-size: 0.68rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  text-transform: uppercase;
  letter-spacing: -0.02em;
}

.picker-name {
  font-size: 0.88rem;
  color: #1e293b;
  transition: color 0.1s;
}

.picker-empty {
  font-size: 0.82rem;
  color: #94a3b8;
  text-align: center;
  padding: 0.75rem;
}

.picker-cancel {
  margin-top: 0.5rem;
  font-size: 0.82rem;
}

.btn-link-muted {
  background: transparent;
  border: none;
  color: #64748b;
  font-size: 0.85rem;
  cursor: pointer;
  padding: 0.25rem 0;
  transition: color 0.15s;
}

.btn-link-muted:hover {
  color: #1e293b;
}

/* Member list */
.member-list {
  list-style: none;
  background: #f8fafc;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
  overflow: hidden;
}

.member-list-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.65rem 0.85rem;
  border-bottom: 1px solid #e2e8f0;
  background: #ffffff;
  transition: background 0.1s;
}

.member-list-item:last-child {
  border-bottom: none;
}

.member-list-item:hover {
  background: #f8fafc;
}

.member-info {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  min-width: 0;
}

.member-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: #eff6ff;
  color: #1a56db;
  font-size: 0.72rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  text-transform: uppercase;
  letter-spacing: -0.02em;
}

.member-name {
  font-size: 0.9rem;
  color: #1e293b;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.btn-remove {
  background: transparent;
  border: none;
  color: #94a3b8;
  cursor: pointer;
  padding: 0.3rem;
  border-radius: 4px;
  display: flex;
  align-items: center;
  transition: color 0.15s, background 0.15s;
  opacity: 0;
  flex-shrink: 0;
}

.member-list-item:hover .btn-remove {
  opacity: 1;
}

.btn-remove:hover {
  color: #dc2626;
  background: #fef2f2;
}

.confirm-remove {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8rem;
}

.confirm-text {
  color: #b91c1c;
  font-weight: 600;
}

.btn-confirm-yes,
.btn-confirm-no {
  border: none;
  border-radius: 4px;
  padding: 0.2rem 0.5rem;
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}

.btn-confirm-yes {
  background: #dc2626;
  color: #ffffff;
}

.btn-confirm-yes:hover {
  background: #b91c1c;
}

.btn-confirm-no {
  background: #e2e8f0;
  color: #475569;
}

.btn-confirm-no:hover {
  background: #cbd5e1;
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

.form-static-value {
  padding: 0.55rem 0.75rem;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
  color: #475569;
  font-size: 0.92rem;
}

.form-field input,
.form-field select {
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
.form-field select:focus {
  outline: none;
  border-color: #1a56db;
  box-shadow: 0 0 0 3px rgba(26, 86, 219, 0.12);
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

.view-footer {
  margin: 0;
  padding: 0.85rem 1.5rem;
  border-top: 1px solid #e2e8f0;
}

/* Archive / delete confirmation */
.archive-heading {
  font-size: 1rem;
  color: #1e293b;
  font-weight: 700;
  margin-bottom: 0.4rem;
}

.archive-description {
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

/* Member Search Section */
.member-search-section {
  margin-bottom: 1.5rem;
  padding: 1.25rem;
}

.member-search-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.85rem;
}

.member-search-header h4 {
  font-size: 0.92rem;
  font-weight: 700;
  color: #1e293b;
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.member-search-hint {
  font-size: 0.82rem;
  color: #94a3b8;
}

.member-search-bar {
  position: relative;
  max-width: 360px;
}

.member-search-input {
  width: 100% !important;
}

.member-search-results {
  margin-top: 1rem;
}

.member-search-empty {
  font-size: 0.85rem;
  color: #94a3b8;
  padding: 0.5rem 0;
}

.member-results-list {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.member-result-card {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 0.85rem 1rem;
}

.member-result-header {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-bottom: 0.5rem;
}

.member-result-name {
  font-size: 0.92rem;
  font-weight: 600;
  color: #1e293b;
}

.member-result-nogroups {
  font-size: 0.82rem;
  color: #94a3b8;
  font-style: italic;
}

.member-result-groups {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.member-group-tag {
  display: inline-flex;
  align-items: center;
  padding: 0.3rem 0.7rem;
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 600;
}

.tag-ministry {
  background: #eff6ff;
  color: #1a56db;
}

.tag-smallgroup {
  background: #f0fdf4;
  color: #15803d;
}

@media (max-width: 600px) {
  .page-content {
    padding: 1rem;
  }

  .member-search-bar {
    max-width: 100%;
  }

  .member-search-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.25rem;
  }

  .toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .search-input {
    width: 100%;
  }

  .group-grid {
    grid-template-columns: 1fr;
  }

  .form-grid {
    grid-template-columns: 1fr;
  }

  .page-header-actions {
    width: 100%;
    justify-content: space-between;
  }

  .modal {
    max-width: 100%;
    max-height: 100vh;
    border-radius: 0;
  }
}
</style>

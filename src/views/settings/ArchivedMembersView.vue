<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useCurrentRole } from '../../composables/useCurrentRole'
import { useActiveChurch } from '../../composables/useActiveChurch'
import { listArchivedMembers, getArchivedMember, restoreMember, enableAccount } from '../../lib/data/archives'
import Avatar from '../../components/ui/Avatar.vue'
import Badge from '../../components/ui/Badge.vue'
import Button from '../../components/ui/Button.vue'
import NotYoursPanel from '../../components/settings/NotYoursPanel.vue'
import Modal from '../../components/ui/Modal.vue'

const { caps } = useCurrentRole()
const { activeChurchId, activeChurchName, churches, setActiveChurch } = useActiveChurch()
const canRead = computed(() => !!caps.value.canSeeMemberDetail)
const awaiting = ref(false)
const search = ref('')
const page = ref(1)
const rows = ref([])
const total = ref(0)
const archivedCount = ref(null)
const awaitingCount = ref(null)
const loading = ref(false)
const error = ref('')
const detail = ref(null)
const selectedId = ref(null)
const detailLoading = ref(false)
const detailError = ref('')
const restoreOpen = ref(false)
const restoreReason = ref('')
const restoring = ref(false)
const restoreError = ref('')
const enabling = ref(false)
const enableError = ref('')
const checked = ref([])
let listVersion = 0
let detailVersion = 0
let timer
const pages = computed(() => Math.max(1, Math.ceil(total.value / 25)))
const fullName = member => [member?.first_name, member?.middle_name, member?.last_name].filter(Boolean).join(' ')
const groups = computed(() => (detail.value?.assignments || []).filter(a => a.kind !== 'Role'))
function date(value, time = false) {
  if (!value) return 'Not recorded'
  return new Date(value).toLocaleString('en-PH', { year: 'numeric', month: 'short', day: 'numeric',
    timeZone: 'Asia/Manila', ...(time ? { hour: 'numeric', minute: '2-digit' } : {}) })
}

function clearDetail() {
  detailVersion++
  detail.value = null
  selectedId.value = null
  detailLoading.value = false
  detailError.value = ''
  checked.value = []
}

async function load() {
  const version = ++listVersion
  clearDetail()
  rows.value = []
  error.value = ''
  if (!activeChurchId.value || !canRead.value) { loading.value = false; return }
  loading.value = true
  const result = await listArchivedMembers({ churchId: activeChurchId.value, canRead: canRead.value,
    query: search.value, page: page.value, awaiting: awaiting.value, isSuperAdmin: caps.value.isSuperAdmin })
  if (version !== listVersion) return
  loading.value = false
  if (!result.ok) { error.value = result.message; return }
  // Restoring the only record on the last page empties it; step back to the new last page.
  if (!result.rows.length && page.value > 1 && result.total > 0) {
    page.value = Math.ceil(result.total / 25)
    return load()
  }
  rows.value = result.rows
  total.value = result.total
  archivedCount.value = result.archivedCount
  awaitingCount.value = result.awaitingCount
}

async function select(member) {
  const version = ++detailVersion
  selectedId.value = member.id
  detail.value = null
  detailError.value = ''
  detailLoading.value = true
  const result = await getArchivedMember({ id: member.id, canRead: canRead.value })
  if (version !== detailVersion) return
  detailLoading.value = false
  if (!result.ok) { detailError.value = result.message; return }
  detail.value = result.member
  checked.value = []
}

function askRestore() {
  restoreReason.value = ''
  restoreError.value = ''
  restoreOpen.value = true
}

async function confirmRestore() {
  if (!detail.value || restoring.value) return
  restoring.value = true
  restoreError.value = ''
  const result = await restoreMember({ id: detail.value.id, reason: restoreReason.value })
  restoring.value = false
  if (!result.ok) { restoreError.value = result.message; return }
  restoreOpen.value = false
  await load()
}

async function confirmEnable() {
  if (!detail.value || !caps.value.isSuperAdmin || enabling.value) return
  enabling.value = true
  enableError.value = ''
  const result = await enableAccount({ id: detail.value.id, assignments: detail.value.assignments, confirmedKeys: checked.value })
  enabling.value = false
  if (!result.ok) { enableError.value = result.message; return }
  await load()
}

function toggleAssignment(key, checkedValue) {
  checked.value = checkedValue ? [...checked.value, key] : checked.value.filter(item => item !== key)
}

function switchTab(value) {
  if (value && !caps.value.isSuperAdmin) return
  awaiting.value = value
  page.value = 1
  clearTimeout(timer)
  load()
}

watch([activeChurchId, canRead, () => caps.value.isSuperAdmin], () => {
  clearTimeout(timer)
  archivedCount.value = null
  awaitingCount.value = null
  if (!caps.value.isSuperAdmin) awaiting.value = false
  page.value = 1
  load()
}, { immediate: true })
watch(search, () => {
  clearTimeout(timer)
  listVersion++
  clearDetail()
  rows.value = []
  loading.value = true
  page.value = 1
  timer = setTimeout(load, 250)
})
onBeforeUnmount(() => { clearTimeout(timer); listVersion++; detailVersion++ })
</script>

<template>
  <section class="archive-page">
    <p class="archive-page__crumb">
      Settings <span aria-hidden="true">/</span> Archived members
    </p>
    <header class="archive-page__header">
      <div>
        <h1>Archived members</h1>
        <p>Records that left the active roll. Nothing here is deleted — attendance and giving stay attached.<br>Archived records are read-only; restore one to change it.</p>
      </div>
      <label
        v-if="canRead"
        class="archive-page__church"
      >
        Church
        <select
          v-if="caps.isSuperAdmin && churches.length > 1"
          :value="activeChurchId"
          @change="setActiveChurch($event.target.value)"
        >
          <option
            v-for="church in churches"
            :key="church.id"
            :value="church.id"
          >{{ church.name }}</option>
        </select>
        <strong v-else>{{ activeChurchName || 'Loading…' }}</strong>
      </label>
    </header>
    <NotYoursPanel
      v-if="!canRead"
      detail="Archived records are available to your church’s Pastor, Secretariat and Church Leader, and to SuperAdmin."
    />
    <template v-else>
      <div class="archive-page__tools">
        <div
          class="archive-tabs"
          aria-label="Archive sections"
        >
          <button
            type="button"
            :aria-pressed="!awaiting"
            @click="switchTab(false)"
          >
            Archived <span v-if="archivedCount !== null">{{ archivedCount }}</span>
          </button>
          <button
            v-if="caps.isSuperAdmin"
            type="button"
            :aria-pressed="awaiting"
            @click="switchTab(true)"
          >
            Awaiting access <Badge
              v-if="awaitingCount"
              tone="magenta"
            >
              {{ awaitingCount }}
            </Badge>
          </button>
        </div>
        <label class="archive-search">
          <span class="sr-only">Search archived members</span>
          <input
            v-model="search"
            type="search"
            maxlength="200"
            placeholder="Search name, record ID or reason"
          >
        </label>
      </div>
      <p
        v-if="awaiting"
        class="archive-page__explanation"
      >
        Restored records whose sign-in is still off. Confirm each role and assignment they kept before turning access back on — restoring the record never does this on its own.
      </p>
      <p
        v-if="error"
        class="archive-error"
        role="alert"
      >
        {{ error }} <Button
          size="sm"
          @click="load"
        >
          Retry
        </Button>
      </p>
      <div
        v-else
        class="archive-layout"
      >
        <div
          class="archive-list"
          :aria-busy="loading"
        >
          <p
            v-if="loading"
            class="archive-state"
            role="status"
          >
            Loading records…
          </p>
          <p
            v-else-if="!rows.length"
            class="archive-state"
          >
            {{ search ? 'No members match your search.' : awaiting ? 'No restored accounts are awaiting access.' : 'No archived members in this church.' }}
          </p>
          <template v-else>
            <div
              class="archive-list__head"
              aria-hidden="true"
            >
              <span>Member</span><span>{{ awaiting ? 'Restored' : 'Archived' }}</span><span>{{ awaiting ? 'Restore reason' : 'Reason' }}</span><span>Account</span>
            </div>
            <button
              v-for="member in rows"
              :key="member.id"
              class="archive-row"
              type="button"
              :class="{ 'is-selected': member.id === selectedId }"
              :aria-pressed="member.id === selectedId"
              :aria-label="`View ${fullName(member)}`"
              @click="select(member)"
            >
              <span class="archive-row__identity"><Avatar
                :name="fullName(member)"
                :size="30"
              /><span><strong>{{ fullName(member) }}</strong><small>Record {{ member.id.slice(0, 8) }}</small></span></span>
              <span class="archive-row__date">{{ date(awaiting ? member.restored_at : member.archived_at) }}</span>
              <span class="archive-row__reason">{{ (awaiting ? member.restored_reason : member.archived_reason) || 'No reason recorded' }}</span>
              <span><Badge :tone="member.account_id ? 'magenta' : 'neutral'">{{ member.account_id ? 'Sign-in disabled' : 'No account' }}</Badge></span>
            </button>
          </template>
          <footer
            v-if="!loading && total > 25"
            class="archive-pagination"
          >
            <Button
              size="sm"
              :disabled="page === 1"
              @click="page--; load()"
            >
              Previous
            </Button>
            <span>Page {{ page }} of {{ pages }} · {{ total }} records</span>
            <Button
              size="sm"
              :disabled="page >= pages"
              @click="page++; load()"
            >
              Next
            </Button>
          </footer>
        </div>
        <aside
          class="archive-detail"
          aria-label="Selected member record"
          :aria-busy="detailLoading"
        >
          <p
            v-if="detailLoading"
            class="archive-state"
            role="status"
          >
            Loading record…
          </p>
          <p
            v-else-if="detailError"
            class="archive-error"
            role="alert"
          >
            {{ detailError }} <Button
              size="sm"
              @click="select({ id: selectedId })"
            >
              Retry
            </Button>
          </p>
          <p
            v-else-if="!detail"
            class="archive-state"
          >
            Select a member to read their record.
          </p>
          <template v-else>
            <header class="archive-detail__header">
              <Avatar
                :name="fullName(detail)"
                :size="40"
              />
              <div>
                <h2>{{ fullName(detail) }}</h2><div class="archive-tags">
                  <Badge tone="magenta">
                    {{ awaiting ? 'Sign-in off' : 'Archived' }}
                  </Badge><Badge>{{ activeChurchName }}</Badge><Badge>Read-only</Badge>
                </div>
              </div>
            </header>
            <div class="archive-note">
              <h3>{{ awaiting ? 'Restored' : 'Archived' }} {{ date(awaiting ? detail.restored_at : detail.archived_at, true) }}</h3>
              <p>{{ (awaiting ? detail.restored_reason : detail.archived_reason) || 'No reason recorded' }}</p>
              <small>{{ (awaiting ? detail.restored_by : detail.archived_by) ? `By ${awaiting ? detail.restored_by : detail.archived_by}` : 'Staff member not recorded' }}</small>
            </div>
            <h3>Record</h3>
            <dl class="archive-record">
              <dt>Born</dt><dd>{{ date(detail.birthdate) }}</dd>
              <dt>Member since</dt><dd>{{ date(detail.date_joined) }}</dd>
              <dt>Phone</dt><dd>{{ detail.contact_number || 'Not recorded' }}</dd>
              <dt>Address</dt><dd>{{ detail.address || 'Not recorded' }}</dd>
              <dt>Email</dt><dd>{{ detail.email || 'Not recorded' }}</dd>
            </dl>
            <h3>Group assignments kept</h3>
            <div class="archive-tags">
              <Badge
                v-for="group in groups"
                :key="group.key"
                tone="accent"
              >
                {{ group.label }}
              </Badge><span v-if="!groups.length">No group assignments</span>
            </div>
            <p class="archive-detail__hint">
              {{ awaiting ? 'These assignments returned with the member record.' : 'These return if the record is restored.' }}
            </p>
            <h3>Linked account</h3>
            <template v-if="detail.account_id">
              <strong class="archive-account">{{ detail.account_email || 'Linked account' }}</strong><p class="archive-detail__hint">
                Sign-in disabled since {{ date(detail.disabled_at, true) }}. Existing sessions are refused on their next request.
              </p>
            </template>
            <p
              v-else
              class="archive-detail__hint"
            >
              No linked account.
            </p>
            <div
              v-if="!awaiting && (caps.isSuperAdmin || caps.isPastor || caps.isSecretariat)"
              class="archive-detail__footer"
            >
              <span>Restores this one record. A reason is required.</span>
              <Button
                variant="primary"
                @click="askRestore"
              >
                Restore {{ detail.first_name }}
              </Button>
            </div>
            <div
              v-if="awaiting && caps.isSuperAdmin"
              class="archive-recovery"
            >
              <h3>Confirm retained access</h3>
              <p>Tick each role and assignment this account should keep. Change any you do not approve in Roles first.</p>
              <label
                v-for="assignment in detail.assignments"
                :key="assignment.key"
                class="archive-recovery__choice"
              >
                <input
                  type="checkbox"
                  :checked="checked.includes(assignment.key)"
                  @change="toggleAssignment(assignment.key, $event.target.checked)"
                >
                <span><strong>{{ assignment.label }}</strong><small>{{ assignment.kind }} · retained from before archiving</small></span>
              </label>
              <p
                v-if="enableError"
                role="alert"
                class="archive-error"
              >
                {{ enableError }}
              </p>
              <div class="archive-detail__footer">
                <span>{{ checked.length }} of {{ detail.assignments.length }} confirmed. Anything unticked blocks re-enabling.</span>
                <Button
                  variant="primary"
                  :disabled="!detail.assignments.length || checked.length !== detail.assignments.length"
                  :loading="enabling"
                  @click="confirmEnable"
                >
                  Re-enable access
                </Button>
              </div>
            </div>
          </template>
        </aside>
      </div>
    </template>
    <Modal
      :open="restoreOpen"
      :title="`Restore ${fullName(detail)}?`"
      description="Restoring returns this record to the active roll and makes its retained group assignments visible again. Sign-in stays disabled until a SuperAdmin separately re-enables it."
      width="sm"
      :close-on-outside-click="false"
      @update:open="restoreOpen = $event"
    >
      <label class="archive-restore__label">Reason for restoring
        <textarea
          v-model="restoreReason"
          rows="3"
          maxlength="500"
          placeholder="Why is this member returning?"
        />
      </label>
      <p
        v-if="restoreError"
        role="alert"
        class="archive-error"
      >
        {{ restoreError }}
      </p>
      <template #footer>
        <Button
          :disabled="restoring"
          @click="restoreOpen = false"
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          :disabled="!restoreReason.trim()"
          :loading="restoring"
          @click="confirmRestore"
        >
          Restore member
        </Button>
      </template>
    </Modal>
  </section>
</template>

<style scoped>
.archive-page { color: var(--ink); }
.archive-page__crumb { margin: 0 0 16px; font-size: var(--text-meta); color: var(--ink-4); }
.archive-page__crumb span { margin: 0 7px; }
.archive-page__header { display: flex; justify-content: space-between; align-items: end; gap: 24px; margin-bottom: 24px; }
h1 { margin: 0 0 6px; font-size: var(--text-h1); letter-spacing: -.035em; }
.archive-page__header p, .archive-page__explanation { margin: 0; color: var(--ink-4); font-size: var(--text-body-sm); line-height: 1.65; }
.archive-page__explanation { margin: 0 0 18px; max-width: 660px; }
.archive-page__church { display: flex; align-items: center; gap: 10px; color: var(--ink-4); font-size: var(--text-body-sm); }
.archive-page__church select, .archive-search input { min-height: 42px; border: 1px solid var(--border); border-radius: var(--r-control); padding: 8px 12px; background: var(--surface); color: var(--ink); font: inherit; }
.archive-page__church strong { color: var(--ink-2); }
.archive-page__tools { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 16px; }
.archive-tabs { display: inline-flex; padding: 4px; border-radius: 10px; background: var(--divider); }
.archive-tabs button { display: inline-flex; align-items: center; gap: 7px; min-height: 40px; padding: 8px 12px; border: 0; border-radius: 7px; background: transparent; color: var(--ink-3); cursor: pointer; font: inherit; font-size: var(--text-body-sm); }
.archive-tabs button[aria-pressed=true] { background: var(--surface); color: var(--ink); box-shadow: var(--shadow-card); }
.archive-tabs button span { color: var(--ink-4); }
.archive-search { max-width: 100%; }
.archive-search input { width: 280px; max-width: 100%; font-size: var(--text-body-sm); }
.archive-layout { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(300px, 1fr); gap: 18px; align-items: start; }
.archive-list, .archive-detail { border: 1px solid var(--border); border-radius: 15px; background: var(--surface); box-shadow: var(--shadow-card); min-width: 0; }
.archive-list { overflow: hidden; }
.archive-list__head, .archive-row { display: grid; grid-template-columns: minmax(130px, 1.4fr) minmax(72px, .8fr) minmax(90px, 1fr) minmax(84px, .9fr); gap: 10px; align-items: center; padding: 14px 16px; }
.archive-list__head { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: var(--ink-4); background: var(--surface-subtle); }
.archive-row { width: 100%; text-align: left; border: 0; border-top: 1px solid var(--divider); background: var(--surface); color: var(--ink-3); cursor: pointer; font: inherit; font-size: var(--text-meta); }
.archive-row:hover { background: var(--surface-subtle); }
.archive-row.is-selected { background: var(--row-selected); box-shadow: inset 3px 0 var(--accent); }
.archive-row__identity { display: flex; align-items: center; gap: 9px; min-width: 0; }
.archive-row__identity strong { display: block; color: var(--ink); font-size: var(--text-body-sm); }
.archive-row__identity small { color: var(--ink-4); }
.archive-row__reason { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.archive-detail { padding: 22px; }
.archive-detail__header { display: flex; gap: 12px; align-items: center; margin-bottom: 20px; }
.archive-detail h2 { margin: 0 0 5px; font-size: var(--text-h3); }
.archive-detail h3 { color: var(--ink-4); font-size: var(--text-eyebrow); text-transform: uppercase; letter-spacing: .06em; margin: 22px 0 9px; }
.archive-tags { display: flex; flex-wrap: wrap; gap: 6px; font-size: var(--text-body-sm); }
.archive-tags :deep(.badge) { white-space: normal; overflow-wrap: anywhere; }
.archive-note { padding: 14px; border-radius: 10px; background: var(--surface-subtle); font-size: var(--text-body-sm); }
.archive-note h3 { margin: 0 0 7px; }
.archive-note p { margin: 0 0 6px; white-space: pre-wrap; overflow-wrap: anywhere; }
.archive-note small { color: var(--ink-4); }
.archive-record { display: grid; grid-template-columns: 100px minmax(0, 1fr); gap: 9px 12px; font-size: var(--text-body-sm); }
.archive-record dt { color: var(--ink-4); }
.archive-record dd { margin: 0; overflow-wrap: anywhere; }
.archive-detail__hint { font-size: var(--text-meta); line-height: 1.6; color: var(--ink-4); }
.archive-account { font-size: var(--text-body-sm); overflow-wrap: anywhere; }
.archive-detail__footer { display: flex; justify-content: space-between; align-items: center; gap: 12px; border-top: 1px solid var(--divider); margin-top: 20px; padding-top: 16px; color: var(--ink-4); font-size: var(--text-meta); }
.archive-recovery p { color: var(--ink-4); font-size: var(--text-body-sm); line-height: 1.6; }
.archive-recovery__choice { display: flex; gap: 10px; align-items: center; min-height: 54px; border: 1px solid var(--border); border-radius: 9px; padding: 10px; margin-top: 7px; cursor: pointer; }
.archive-recovery__choice input { width: 17px; height: 17px; accent-color: var(--accent); }
.archive-recovery__choice strong, .archive-recovery__choice small { display: block; }
.archive-recovery__choice small { color: var(--ink-4); }
.archive-restore__label { display: block; color: var(--ink-2); font-size: var(--text-body-sm); font-weight: 700; }
.archive-restore__label textarea { display: block; width: 100%; margin-top: 8px; padding: 10px; border: 1px solid var(--border-strong); border-radius: var(--r-control); background: var(--surface); color: var(--ink); font: inherit; resize: vertical; }
.archive-state { padding: 28px 18px; margin: 0; color: var(--ink-4); font-size: var(--text-body-sm); }
.archive-error { color: var(--magenta-deep); padding: 12px; font-size: var(--text-body-sm); }
.archive-pagination { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 12px; font-size: var(--text-meta); }
button:focus-visible, input:focus-visible, select:focus-visible { outline: var(--ring-focus); outline-offset: 2px; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@media (max-width: 1200px) { .archive-layout { grid-template-columns: 1fr; } }
@media (max-width: 600px) {
  .archive-page__header { display: block; }
  .archive-page__church { margin-top: 12px; }
  .archive-page__tools { align-items: stretch; flex-direction: column; }
  .archive-search input { width: 100%; }
  .archive-list__head { display: none; }
  .archive-row { grid-template-columns: minmax(0, 1fr) auto; gap: 8px 10px; }
  .archive-row__date { text-align: right; }
  .archive-row__reason { white-space: normal; overflow-wrap: anywhere; }
  .archive-detail { padding: 18px; }
  .archive-pagination { flex-wrap: wrap; }
  .archive-detail__footer { align-items: stretch; flex-direction: column; }
}
</style>

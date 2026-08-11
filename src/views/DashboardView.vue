<script setup>
/**
 * Members — REDESIGN.md Stage 2, the restyle half.
 *
 * Amendment 13 lists five changes here and says to land them as two commits,
 * because a data-flow change and a repaint in one diff makes both unreviewable.
 * This is the first: everything except `.range()` pagination and server-side
 * search, which follow.
 *
 * What changed beyond the paint:
 *
 * - THE DUPLICATE HEADER IS GONE. This view rendered its own "UDFC Dashboard"
 *   title and its own Sign Out button on top of the ones `DashboardLayout` and
 *   `AppSidebar` already draw. That second sign-out path is the whole reason
 *   D12 existed; Phase 1b made the two paths agree, and deleting the header
 *   removes the second path's reason to exist.
 *
 * - D11's second and third sub-fixes land. Sorting was `<th @click>` — a `<th>`
 *   is not focusable and not activatable, so the table could not be sorted from
 *   a keyboard at all, and `aria-sort` was never announced. Rows were
 *   `<tr @click>`, same problem. Both now carry real `<button>` elements, which
 *   is the pattern `MinistrySmallGroupView`'s group cards already use.
 *
 * - SORTING IS NAMES-ONLY, an accepted regression recorded in Amendment 13. Age
 *   is `computeAge(birthdate)` in the browser and does not exist to order on; it
 *   would have to become `birthdate` descending, which is correct but inverted
 *   and easy to get backwards. Do not "restore" Age and Gender sorting without
 *   re-deciding it.
 *
 * - THE DETAIL MODAL BECAME A PANEL that is empty until a row is chosen. PII
 *   still appears only after a deliberate click, which is the property the modal
 *   had and the one worth keeping. Below 1024px it is `ui/Modal` instead —
 *   Amendment 13 says the row navigates on mobile, and there is no member detail
 *   route to navigate to (it is on the deferred list), so the accessible dialog
 *   we already ship is the honest substitute rather than an invented route.
 *
 * - `facebook_link` IS A LINK, under all four of Amendment 14's conditions. The
 *   host allowlist and scheme check are `src/utils/memberLink.js`, applied at
 *   render — see MemberDetailPanel.
 *
 * The four hand-rolled modals here are now `ui/Modal` call sites, and the local
 * toast implementation is gone in favour of the one queue in `useToast`.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  listDirectory,
  listRecords,
  create as createMember,
  update as updateMember,
  archive as archiveMember,
  MEMBER_PAGE_SIZE,
} from '../lib/data/members'
import { clampPage, pageCount, pageNumbers, rangeLabel } from '../utils/pagination'
import { isMemberFormDirty, snapshotMemberForm } from '../utils/memberFormDirty'
import { buildMemberPayload } from '../utils/memberPayload'
import { useCurrentRole } from '../composables/useCurrentRole'
import { useActiveChurch } from '../composables/useActiveChurch'
import { useMediaQuery } from '../composables/useMediaQuery'
import { useSortState } from '../composables/useSortState'
import { showToast } from '../composables/useToast'
import MemberDetailPanel from '../components/MemberDetailPanel.vue'
import Badge from '../components/ui/Badge.vue'
import Button from '../components/ui/Button.vue'
import Card from '../components/ui/Card.vue'
import Input from '../components/ui/Input.vue'
import Modal from '../components/ui/Modal.vue'
import Spinner from '../components/ui/Spinner.vue'
import TableSortHeader from '../components/ui/TableSortHeader.vue'
import Icon from '../components/ui/icons/Icon.vue'

// RBAC. canSeeMemberDetail → the full PII table + the detail panel. Everyone
// else (baseline, Head Pastor) gets the safe name/group DIRECTORY via
// directory_search and no detail at all. canWriteMembers gates
// create/edit/archive. RLS enforces all of this server-side; this is
// presentation (ADR-0001).
const { canSeeMemberDetail, canWriteMembers } = useCurrentRole()
const directoryMode = computed(() => !canSeeMemberDetail.value)

// Church scoping. For a single-church user this is their own church; for a
// SuperAdmin / Head Pastor it is the church chosen in the selector. The list is
// filtered by this id explicitly, since RLS returns all churches to those roles.
const { activeChurchId, activeChurchName, ensureLoaded } = useActiveChurch()
const myChurchId = activeChurchId
const myChurchName = activeChurchName

// The detail panel needs room beside the table; below this the same content is
// a dialog. The card breakpoint is Amendment 12's — a five-column table on a
// phone scrolls sideways, which is how a member gets missed.
const isWide = useMediaQuery('(min-width: 1024px)')
const isCompact = useMediaQuery('(max-width: 767px)')

const members = ref([])
const loading = ref(true)
const error = ref('')

// ── Paging and search (Amendment 13) ──────────────────────────────────────
// The record path is paginated server-side. The directory path is not — its
// RPC takes a limit but no offset, and adding one is a migration against a
// SECURITY DEFINER function (Amendment 15). It caps honestly instead.
const page = ref(1)
const total = ref(0)
const directoryCapped = ref(false)

/**
 * What is typed, and what has been asked for. They are separate because every
 * keystroke would otherwise be a round trip — the search runs against Postgres
 * now, not against an array already in the browser.
 */
const searchInput = ref('')
const searchTerm = ref('')
let searchTimer = null

/** The row whose record fills the panel. Null is the panel's empty state. */
const selectedMember = ref(null)

const formMode = ref(null) // 'create' | 'edit' | null
const archiveOpen = ref(false)

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
const initialFormData = ref(snapshotMemberForm(formData.value))
const formError = ref('')
const discardWarning = ref('')
const formSaving = ref(false)
const archiveReason = ref('')

const formIsDirty = computed(() => !!formMode.value && isMemberFormDirty(formData.value, initialFormData.value))

const formOpen = computed({
  get: () => formMode.value !== null,
  set: (open) => {
    if (!open) requestCloseForm()
  },
})

/**
 * The detail dialog, below the panel's breakpoint.
 *
 * Derived from the selection rather than held separately: two sources of truth
 * for "is a member on screen" is how a dialog ends up showing someone who is no
 * longer in the list.
 *
 * It also yields to the form and archive dialogs. Editing from the detail
 * dialog would otherwise stack a dialog on a dialog — two focus traps fighting
 * for the same Escape key, which is the failure ADR-0011's primitive exists to
 * avoid rather than to reproduce. The selection survives, so dismissing the
 * form brings the record straight back.
 */
const detailModalOpen = computed({
  get: () =>
    !!selectedMember.value
    && !isWide.value
    && canSeeMemberDetail.value
    && !formMode.value
    && !archiveOpen.value,
  set: (open) => {
    if (!open) selectedMember.value = null
  },
})

const formTitle = computed(() => (formMode.value === 'create' ? 'Add member' : 'Edit member'))

const todayIso = computed(() => new Date().toISOString().slice(0, 10))

const pageTitle = computed(() =>
  // myChurchName is hydrated from localStorage synchronously; falls back to
  // "Members" until the RPC resolves on cold first run.
  myChurchName.value ? `${myChurchName.value} members` : 'Members',
)

// ── Sorting ───────────────────────────────────────────────────────────────
// Names only, deliberately. See the header note.
const { sort, toggleSort, ariaSortFor } = useSortState('last_name')

/**
 * The rows to render.
 *
 * The record path is ordered by Postgres — it has to be, because `.range()`
 * over an unordered query can repeat a row on one page and skip it on the next,
 * and no amount of client sorting fixes a page that was sliced wrong. Sorting
 * it again here would also be a lie: it would order the fifty rows on screen,
 * not the list.
 *
 * The directory path is different and is sorted here on purpose: it is not
 * paginated, so the whole (capped) list is already in the browser and sorting
 * it locally costs nothing and saves a round trip.
 */
const displayMembers = computed(() => {
  if (!directoryMode.value) return members.value

  const key = sort.value?.key
  if (!key) return members.value
  const direction = sort.value.direction === 'descending' ? -1 : 1
  return [...members.value].sort(
    (a, b) => String(a[key] ?? '').localeCompare(String(b[key] ?? '')) * direction,
  )
})

const lastPage = computed(() => pageCount(total.value, MEMBER_PAGE_SIZE))
const pagerSlots = computed(() => pageNumbers(page.value, total.value, MEMBER_PAGE_SIZE))
const pagerLabel = computed(() => rangeLabel(page.value, MEMBER_PAGE_SIZE, total.value))
const showPager = computed(() => !directoryMode.value && lastPage.value > 1)

/** The header count: a real total on the record path, what is on screen on the directory path. */
const countLabel = computed(() =>
  directoryMode.value ? `${members.value.length} listed` : `${total.value} active`,
)

function fullName(member) {
  if (!member) return ''
  const middle = member.middle_name ? ` ${member.middle_name}` : ''
  return `${member.first_name}${middle} ${member.last_name}`
}

function groupList(values) {
  return values && values.length ? values.join(', ') : ''
}

/**
 * Age is computed in the browser and is not a column. That is exactly why the
 * table can no longer sort by it — see the note at the top of this file.
 */
function memberAge(member) {
  if (!member?.birthdate) return ''
  const dob = new Date(member.birthdate)
  const today = new Date()
  let age = today.getFullYear() - dob.getFullYear()
  const monthDiff = today.getMonth() - dob.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) age--
  return String(age)
}

// ── Reads ─────────────────────────────────────────────────────────────────

async function fetchMembers() {
  loading.value = true
  error.value = ''

  // Amendment 13: the selection clears on any refetch. It is the only behaviour
  // where what is on screen always matches the table, and it means a member's
  // address never lingers in a panel beside results it has nothing to do with.
  selectedMember.value = null

  const churchId = myChurchId.value

  // Clamped against the total we already hold rather than re-queried: asking
  // for page 9 of a one-page result and then correcting would be two round
  // trips for one intent.
  page.value = clampPage(page.value, total.value, MEMBER_PAGE_SIZE)

  // Two different reads, asked for by name. The directory is safe for every
  // role; the record list carries PII and refuses without canSeeMemberDetail.
  const result = directoryMode.value
    ? await listDirectory(churchId, { query: searchTerm.value })
    : await listRecords({
      churchId,
      canSeeDetail: canSeeMemberDetail.value,
      page: page.value,
      search: searchTerm.value,
      sortKey: sort.value?.key,
      sortDirection: sort.value?.direction,
    })

  members.value = result.rows
  total.value = directoryMode.value ? result.rows.length : (result.total ?? 0)
  directoryCapped.value = directoryMode.value && !!result.capped

  // A church that has not resolved yet is not an error the user should see —
  // ensureLoaded() runs first on mount, and the watch re-fetches once it lands.
  if (!result.ok && churchId) error.value = result.message

  loading.value = false
}

/** Any change to what is being asked for starts at page 1. */
function refetchFromFirstPage() {
  page.value = 1
  total.value = 0
  fetchMembers()
}

function goToPage(next) {
  const target = clampPage(next, total.value, MEMBER_PAGE_SIZE)
  if (target === page.value) return
  page.value = target
  fetchMembers()
}

function onSort(key) {
  toggleSort(key)
  // The directory sorts in the browser and needs no round trip; the record path
  // is ordered by Postgres, so a new order is a new query.
  if (!directoryMode.value) refetchFromFirstPage()
}

// Debounced, because the search runs against Postgres now rather than against
// an array already in the browser — a query per keystroke is egress spent on
// results nobody read.
watch(searchInput, (value) => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    searchTerm.value = value
    refetchFromFirstPage()
  }, 300)
})

onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer)
})

// ── Selection ─────────────────────────────────────────────────────────────

function selectMember(member) {
  // Defence in depth: directory rows carry no detail and are not interactive,
  // but never surface the PII panel for a caller without the capability even if
  // this is reached some other way.
  if (!canSeeMemberDetail.value) return
  selectedMember.value = member
}

// ── Create / edit ─────────────────────────────────────────────────────────

function openCreate() {
  if (!myChurchId.value) {
    error.value = 'Cannot determine your church. Please reload.'
    return
  }
  formData.value = blankForm()
  initialFormData.value = snapshotMemberForm(formData.value)
  formError.value = ''
  discardWarning.value = ''
  formMode.value = 'create'
}

function startEdit() {
  const m = selectedMember.value
  if (!m) return
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
  initialFormData.value = snapshotMemberForm(formData.value)
  formError.value = ''
  discardWarning.value = ''
  formMode.value = 'edit'
}

/**
 * Every way of closing the form dialog arrives here — the close button, the
 * Cancel button and Escape, which `ui/Modal` hands to the platform.
 *
 * `window.confirm` is gone. A browser-chrome dialog on top of an application
 * dialog is the one thing in the app that steals focus without any of the
 * guarantees ADR-0011's Dialog buys, and it cannot be styled, translated or
 * dismissed from the keyboard consistently. The in-dialog warning carries the
 * discard action instead, so refusing to close is visible in the place the
 * typing is.
 */
function requestCloseForm() {
  if (formSaving.value) return
  if (formIsDirty.value) {
    discardWarning.value = 'You have unsaved entries. Use "Discard changes" if you meant to lose them.'
    return
  }
  closeForm()
}

function closeForm() {
  formMode.value = null
  formData.value = blankForm()
  initialFormData.value = snapshotMemberForm(formData.value)
  formError.value = ''
  discardWarning.value = ''
  formSaving.value = false
}

// ── Mutations ─────────────────────────────────────────────────────────────

async function handleCreate() {
  formError.value = ''
  formSaving.value = true

  const result = await createMember({ payload: buildMemberPayload(formData.value), churchId: myChurchId.value })

  formSaving.value = false

  if (!result.ok) {
    formError.value = result.message
    showToast('Failed to create member.', 'error')
    return
  }
  members.value = [result.rows[0], ...members.value]
  closeForm()
  showToast('Member created.', 'success')
}

async function handleUpdate() {
  const target = selectedMember.value
  if (!target) return
  formError.value = ''
  formSaving.value = true

  const result = await updateMember({ id: target.id, payload: buildMemberPayload(formData.value) })

  formSaving.value = false

  if (!result.ok) {
    formError.value = result.message
    showToast('Failed to update member.', 'error')
    return
  }
  const saved = result.rows[0]
  const index = members.value.findIndex((m) => m.id === saved.id)
  if (index !== -1) members.value.splice(index, 1, saved)
  selectedMember.value = saved
  closeForm()
  showToast('Member updated.', 'success')
}

async function handleArchive() {
  const target = selectedMember.value
  if (!target) return
  formError.value = ''
  formSaving.value = true

  const result = await archiveMember({ id: target.id, reason: archiveReason.value })

  formSaving.value = false

  // This used to drop the member from the list unconditionally. RLS refuses an
  // archive by filtering, so a refusal arrived as success and the row vanished
  // until the next reload brought it back. `rows` is empty whenever ok is false,
  // so the list can only be patched from a write the database actually accepted.
  if (!result.ok) {
    formError.value = result.message
    showToast('Failed to archive member.', 'error')
    return
  }
  members.value = members.value.filter((m) => m.id !== target.id)
  selectedMember.value = null
  archiveOpen.value = false
  archiveReason.value = ''
  showToast('Member archived.', 'success')
}

function openArchive() {
  archiveReason.value = ''
  formError.value = ''
  archiveOpen.value = true
}

// Re-fetch whenever the active church changes (SuperAdmin / Head Pastor
// switching churches in the selector).
// Back to page 1, not to whichever page was open: page 3 of one church is not
// page 3 of another, and landing there would show a stranger's records under a
// pager that still reads "101–150".
watch(activeChurchId, () => {
  if (activeChurchId.value) refetchFromFirstPage()
})

onMounted(async () => {
  // ensureLoaded resolves capabilities AND the active church, so directoryMode
  // and the church filter are both correct before the first fetch.
  await ensureLoaded()
  fetchMembers()
})
</script>

<template>
  <div class="members-page">
    <header class="page-header">
      <div class="page-heading">
        <h1>{{ pageTitle }}</h1>
        <p class="page-subtitle">View and manage church members</p>
      </div>
      <div class="page-actions">
        <!-- The rarer second accent's one surface today (Amendment 17). -->
        <Badge variant="accent-secondary">{{ countLabel }}</Badge>
        <Button v-if="canWriteMembers" :disabled="!myChurchId" @click="openCreate">
          <Icon name="plus" :size="16" />
          Add member
        </Button>
      </div>
    </header>

    <div class="members-layout" :class="{ 'has-panel': isWide && canSeeMemberDetail }">
      <Card padding="none" class="list-card">
        <!-- Search is what stops pagination being a downgrade: today the whole
             list is on the page precisely because it is unbounded, so you can
             Ctrl-F it. Fifty rows at a time without a search field would take
             that away and give nothing back. -->
        <div class="list-toolbar">
          <Input
            v-model="searchInput"
            label="Search members"
            type="search"
            class="search-field"
            placeholder="First or last name"
            autocomplete="off"
          />
        </div>

        <div v-if="loading" class="state">
          <Spinner size="lg" />
          <p>Loading members…</p>
        </div>

        <p v-else-if="error" class="state state-error" role="alert">{{ error }}</p>

        <p v-else-if="members.length === 0 && searchTerm" class="state">
          No members match “{{ searchTerm }}”.
        </p>

        <p v-else-if="members.length === 0" class="state">
          No members yet. Add the first one to get started.
        </p>

        <!-- Cards below 768px. Amendment 12: a five-column table on a phone
             scrolls sideways, which is how a member gets missed. -->
        <ul v-else-if="isCompact" class="member-cards">
          <li v-for="member in displayMembers" :key="member.id">
            <!-- A real <button> where the card is selectable and a plain <div>
                 where it is not. A div with a click handler is invisible to a
                 keyboard, and a button that does nothing is a lie about what is
                 available — the directory has no detail to open. -->
            <button
              v-if="canSeeMemberDetail"
              type="button"
              class="member-card is-selectable"
              :class="{ 'is-selected': selectedMember?.id === member.id }"
              :aria-current="selectedMember?.id === member.id ? 'true' : undefined"
              @click="selectMember(member)"
            >
              <span class="member-card-name">{{ fullName(member) }}</span>
              <span class="member-card-meta">{{ member.gender || '—' }}</span>
            </button>
            <div v-else class="member-card">
              <span class="member-card-name">{{ fullName(member) }}</span>
              <span class="member-card-meta" :class="{ 'is-empty': !groupList(member.ministries) && !groupList(member.small_groups) }">
                {{ [groupList(member.ministries), groupList(member.small_groups)].filter(Boolean).join(' · ') || '—' }}
              </span>
            </div>
          </li>
        </ul>

        <div v-else class="table-scroll">
          <table class="members-table">
            <thead>
              <tr>
                <TableSortHeader
                  sort-key="last_name"
                  :aria-sort="ariaSortFor('last_name')"
                  @sort="onSort"
                >
                  Last name
                </TableSortHeader>
                <TableSortHeader
                  sort-key="first_name"
                  :aria-sort="ariaSortFor('first_name')"
                  @sort="onSort"
                >
                  First name
                </TableSortHeader>
                <!-- The two capability-split column sets stay split (Amendment
                     13): merging them needs group membership on the detail
                     path, which listRecords() does not fetch. -->
                <template v-if="!directoryMode">
                  <th scope="col">Age</th>
                  <th scope="col">Gender</th>
                </template>
                <template v-else>
                  <th scope="col">Ministries</th>
                  <th scope="col">Small groups</th>
                </template>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="member in displayMembers"
                :key="member.id"
                :class="{ 'is-selected': selectedMember?.id === member.id }"
              >
                <th scope="row" class="name-cell">
                  <!-- D11's third sub-fix. The row-opening action is on a real
                       interactive element, which is what makes it reachable by
                       Tab and activatable by Enter and Space — not tabindex and
                       role bolted onto the <tr>. -->
                  <button
                    v-if="canSeeMemberDetail"
                    type="button"
                    class="row-button"
                    :aria-current="selectedMember?.id === member.id ? 'true' : undefined"
                    @click="selectMember(member)"
                  >
                    {{ member.last_name }}
                  </button>
                  <template v-else>{{ member.last_name }}</template>
                </th>
                <td>{{ member.first_name }}</td>
                <template v-if="!directoryMode">
                  <td :class="{ 'is-empty': !memberAge(member) }">{{ memberAge(member) || '—' }}</td>
                  <td>{{ member.gender }}</td>
                </template>
                <template v-else>
                  <td :class="{ 'is-empty': !groupList(member.ministries) }">
                    {{ groupList(member.ministries) || '—' }}
                  </td>
                  <td :class="{ 'is-empty': !groupList(member.small_groups) }">
                    {{ groupList(member.small_groups) || '—' }}
                  </td>
                </template>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Amendment 15: directory_search takes a limit but no offset, so this
             path caps rather than pages. Saying so is the whole fix — the list
             was already truncated at 200, silently, before this. -->
        <p v-if="directoryCapped && !loading" class="list-note" role="status">
          Showing the first {{ members.length }} members. Search to narrow the list.
        </p>

        <nav v-if="showPager && !loading" class="pager" aria-label="Member list pages">
          <p class="pager-label" role="status">{{ pagerLabel }}</p>
          <div class="pager-controls">
            <Button
              variant="ghost"
              size="sm"
              aria-label="Previous page"
              :disabled="page <= 1"
              @click="goToPage(page - 1)"
            >
              <Icon name="chevron-left" :size="16" />
            </Button>

            <template v-for="(slot, index) in pagerSlots" :key="`${slot}-${index}`">
              <!-- An elided stretch is not a page and must not be a button —
                   aria-hidden keeps it out of the count a screen reader reads. -->
              <span v-if="slot === '…'" class="pager-gap" aria-hidden="true">…</span>
              <Button
                v-else
                :variant="slot === page ? 'primary' : 'ghost'"
                size="sm"
                :aria-label="`Page ${slot}`"
                :aria-current="slot === page ? 'page' : undefined"
                @click="goToPage(slot)"
              >
                {{ slot }}
              </Button>
            </template>

            <Button
              variant="ghost"
              size="sm"
              aria-label="Next page"
              :disabled="page >= lastPage"
              @click="goToPage(page + 1)"
            >
              <Icon name="chevron-right" :size="16" />
            </Button>
          </div>
        </nav>
      </Card>

      <!-- Empty until a row is chosen, which is what keeps PII off the screen
           until someone deliberately asks for it. -->
      <aside v-if="isWide && canSeeMemberDetail" class="detail-column" aria-labelledby="detail-heading">
        <Card padding="md" class="detail-card">
          <h2 id="detail-heading" class="detail-heading">Member record</h2>

          <template v-if="selectedMember">
            <MemberDetailPanel :member="selectedMember" :church-name="myChurchName || ''" />
            <div class="detail-actions">
              <Button v-if="canWriteMembers" variant="secondary" size="sm" @click="startEdit">
                <Icon name="pencil" :size="14" />
                Edit
              </Button>
              <Button v-if="canWriteMembers" variant="ghost" size="sm" @click="openArchive">
                <Icon name="archive" :size="14" />
                Archive
              </Button>
            </div>
          </template>

          <p v-else class="detail-empty">Choose a member to see their record.</p>
        </Card>
      </aside>
    </div>

    <!-- Detail, below the panel's breakpoint. -->
    <Modal v-model:open="detailModalOpen" title="Member record">
      <MemberDetailPanel
        v-if="selectedMember"
        :member="selectedMember"
        :church-name="myChurchName || ''"
      />
      <template v-if="canWriteMembers" #footer>
        <Button variant="ghost" size="sm" @click="openArchive">
          <Icon name="archive" :size="14" />
          Archive
        </Button>
        <Button variant="secondary" size="sm" @click="startEdit">
          <Icon name="pencil" :size="14" />
          Edit
        </Button>
      </template>
    </Modal>

    <!-- Create / edit. Outside-click dismissal is off: a stray click beside a
         half-filled member form should not discard it. -->
    <Modal
      v-model:open="formOpen"
      :title="formTitle"
      size="wide"
      :close-on-outside-click="false"
    >
      <form id="member-form" class="member-form" @submit.prevent="formMode === 'create' ? handleCreate() : handleUpdate()" @input="discardWarning = ''">
        <div v-if="discardWarning" class="form-notice form-notice-warning" role="alert">
          <span>{{ discardWarning }}</span>
          <Button variant="ghost" size="sm" @click="closeForm">Discard changes</Button>
        </div>
        <p v-if="formError" class="form-notice form-notice-error" role="alert">{{ formError }}</p>

        <div class="form-grid">
          <Input v-model="formData.first_name" label="First name" required maxlength="100" />
          <Input v-model="formData.last_name" label="Last name" required maxlength="100" />
          <Input v-model="formData.middle_name" label="Middle name" class="span-2" maxlength="100" />
          <Input v-model="formData.birthdate" label="Birthdate" type="date" required :max="todayIso" />
          <Input v-model="formData.gender" label="Gender" as="select" required>
            <option value="" disabled>Select…</option>
            <option value="Male">Male</option>
            <option value="Female">Female</option>
          </Input>
          <Input v-model="formData.marital_status" label="Marital status" as="select" required>
            <option value="" disabled>Select…</option>
            <option value="Single">Single</option>
            <option value="Married">Married</option>
            <option value="Widowed">Widowed</option>
            <option value="Separated">Separated</option>
          </Input>
          <Input
            v-if="formData.marital_status === 'Married'"
            v-model="formData.wedding_anniversarry"
            label="Wedding anniversary"
            type="date"
            :max="todayIso"
          />
          <Input v-model="formData.address" label="Address" class="span-2" maxlength="255" />
          <Input v-model="formData.date_joined" label="Date joined" type="date" :max="todayIso" />
          <Input v-model="formData.contact_number" label="Contact number" type="tel" maxlength="32" />
          <Input v-model="formData.email" label="Email" type="email" maxlength="255" />
          <!-- Amendment 14's write-time half. It only ever buys a better error
               message — the check that protects is the one at render, since
               nobody has audited what is in this column already. -->
          <Input
            v-model="formData.facebook_link"
            label="Facebook link"
            type="url"
            maxlength="255"
            placeholder="https://facebook.com/…"
            pattern="https://(www\.)?(facebook\.com|m\.facebook\.com|fb\.com)/.*"
            hint="An https:// link to facebook.com, m.facebook.com or fb.com. Anything else is shown as plain text."
          />
          <Input
            :model-value="myChurchName || myChurchId || '—'"
            label="Member of"
            class="span-2"
            disabled
            readonly
          />

          <fieldset class="form-checkboxes span-2">
            <legend>Journey</legend>
            <label><input v-model="formData.is_baptized" type="checkbox" /> Baptized</label>
            <label><input v-model="formData.is_one_to_one_completed" type="checkbox" /> One-to-one completed</label>
            <label><input v-model="formData.is_turning_point_completed" type="checkbox" /> Turning point completed</label>
          </fieldset>
        </div>
      </form>

      <template #footer>
        <Button variant="secondary" :disabled="formSaving" @click="requestCloseForm">Cancel</Button>
        <Button type="submit" form="member-form" :loading="formSaving">
          {{ formMode === 'create' ? 'Create member' : 'Save changes' }}
        </Button>
      </template>
    </Modal>

    <Modal v-model:open="archiveOpen" title="Archive member">
      <p v-if="formError" class="form-notice form-notice-error" role="alert">{{ formError }}</p>
      <p class="archive-copy">
        <strong>{{ fullName(selectedMember) }}</strong> will no longer appear on the dashboard.
        The record is preserved and can be restored later by a database admin.
      </p>
      <Input
        v-model="archiveReason"
        label="Reason for leaving (optional)"
        as="textarea"
        rows="3"
        maxlength="500"
        placeholder="e.g. moved to another congregation"
      />

      <template #footer>
        <Button variant="secondary" :disabled="formSaving" @click="archiveOpen = false">Cancel</Button>
        <Button variant="danger" :loading="formSaving" @click="handleArchive">Confirm archive</Button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.members-page {
  padding: var(--space-8);
  max-width: 1400px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: var(--space-4);
  margin-bottom: var(--space-6);
}

.page-header h1 {
  font-size: var(--text-2xl);
  font-weight: var(--font-weight-extrabold);
  color: var(--color-text-primary);
  line-height: var(--leading-tight);
}

.page-subtitle {
  margin-top: var(--space-1);
  font-size: var(--text-base);
  color: var(--color-text-secondary);
}

.page-actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.members-layout {
  display: grid;
  gap: var(--space-6);
  align-items: start;
}

.members-layout.has-panel {
  grid-template-columns: minmax(0, 1fr) 340px;
}

.list-card {
  overflow: hidden;
}

.list-toolbar {
  padding: var(--space-4);
  border-bottom: 1px solid var(--color-border-subtle);
}

.search-field {
  max-width: 320px;
}

.list-note {
  padding: var(--space-3) var(--space-4);
  border-top: 1px solid var(--color-border-subtle);
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-top: 1px solid var(--color-border-subtle);
}

.pager-label {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.pager-controls {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

.pager-gap {
  padding: 0 var(--space-1);
  color: var(--color-text-placeholder);
}

.state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-12) var(--space-6);
  text-align: center;
  color: var(--color-text-secondary);
  font-size: var(--text-base);
}

.state-error {
  color: var(--color-danger);
}

/* ── Table ─────────────────────────────────────────────────────────────── */
.table-scroll {
  overflow-x: auto;
}

.members-table {
  width: 100%;
  border-collapse: collapse;
}

.members-table thead th {
  background: var(--color-bg-subtle);
  border-bottom: 1px solid var(--color-border-default);
  padding: var(--space-3) var(--space-4);
  text-align: left;
  font-size: var(--text-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-secondary);
  white-space: nowrap;
}

.members-table tbody tr {
  border-bottom: 1px solid var(--color-border-subtle);
}

.members-table tbody tr:last-child {
  border-bottom: none;
}

.members-table tbody tr:hover {
  background: var(--color-bg-subtle);
}

.members-table tbody tr.is-selected {
  background: var(--color-bg-selected);
}

.members-table td,
.members-table tbody th {
  padding: var(--space-3) var(--space-4);
  font-size: var(--text-base);
  font-weight: var(--font-weight-normal);
  color: var(--color-text-primary);
  text-align: left;
}

.members-table .is-empty {
  color: var(--color-text-placeholder);
}

/* The button below supplies the padding, so the cell must not add its own. */
.members-table tbody th.name-cell {
  padding: 0;
}

.row-button {
  width: 100%;
  padding: var(--space-3) var(--space-4);
  /* Amendment 12's touch floor, which a text cell would otherwise miss. */
  min-height: 44px;
  background: none;
  border: none;
  font: inherit;
  font-weight: var(--font-weight-medium);
  color: var(--color-accent-text);
  text-align: left;
  cursor: pointer;
}

.row-button:hover {
  text-decoration: underline;
}

.row-button:focus-visible {
  outline: 2px solid var(--color-focus-ring);
  outline-offset: -2px;
}

/* ── Cards, below 768px ────────────────────────────────────────────────── */
.member-cards {
  list-style: none;
}

.member-cards li {
  border-bottom: 1px solid var(--color-border-subtle);
}

.member-cards li:last-child {
  border-bottom: none;
}

.member-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  width: 100%;
  min-height: 44px;
  padding: var(--space-3) var(--space-4);
  background: none;
  border: none;
  font: inherit;
  text-align: left;
}

.member-card.is-selectable {
  cursor: pointer;
}

.member-card.is-selected {
  background: var(--color-bg-selected);
}

.member-card:focus-visible {
  outline: 2px solid var(--color-focus-ring);
  outline-offset: -2px;
}

.member-card-name {
  font-size: var(--text-lg);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
}

.member-card-meta {
  font-size: var(--text-base);
  color: var(--color-text-secondary);
}

/* ── Detail panel ──────────────────────────────────────────────────────── */
/* Sticky so the record stays beside the row it belongs to while a long list
   scrolls past. Without it the panel is only readable at the top of the page. */
.detail-column {
  position: sticky;
  top: var(--space-6);
}

.detail-heading {
  font-size: var(--text-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: var(--space-4);
}

.detail-empty {
  padding: var(--space-8) 0;
  text-align: center;
  font-size: var(--text-base);
  color: var(--color-text-placeholder);
}

.detail-actions {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-5);
  padding-top: var(--space-4);
  border-top: 1px solid var(--color-border-subtle);
}

/* ── Form ──────────────────────────────────────────────────────────────── */
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
}

/* No :deep() needed — a class passed to a child component lands on that
   component's root element, which already carries this file's scope id. */
.form-grid .span-2 {
  grid-column: 1 / -1;
}

.form-notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  border: 1px solid transparent;
  font-size: var(--text-base);
  margin-bottom: var(--space-4);
}

.form-notice-warning {
  background: var(--color-warning-bg);
  border-color: var(--color-warning-border);
  color: var(--color-warning-text);
}

.form-notice-error {
  background: var(--color-danger-bg);
  border-color: var(--color-danger-border);
  color: var(--color-danger-text);
}

.form-checkboxes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  border: none;
}

.form-checkboxes legend {
  font-size: var(--text-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  margin-bottom: var(--space-2);
}

.form-checkboxes label {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 44px;
  font-size: var(--text-base);
  color: var(--color-text-primary);
  cursor: pointer;
}

.form-checkboxes input[type='checkbox'] {
  width: 18px;
  height: 18px;
  accent-color: var(--color-accent);
  cursor: pointer;
}

.archive-copy {
  margin-bottom: var(--space-4);
  font-size: var(--text-base);
  color: var(--color-text-secondary);
  line-height: var(--leading-normal);
}

@media (max-width: 767px) {
  .members-page {
    padding: var(--space-4);
  }

  .page-actions {
    width: 100%;
    justify-content: space-between;
  }

  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>

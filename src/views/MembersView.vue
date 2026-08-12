<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import Card from '../components/ui/Card.vue'
import Button from '../components/ui/Button.vue'
import Avatar from '../components/ui/Avatar.vue'
import Icon from '../components/ui/icons/Icon.vue'
import Modal from '../components/ui/Modal.vue'
import JourneyTrack from '../components/ui/JourneyTrack.vue'
import MemberDetailPanel from '../components/MemberDetailPanel.vue'
import MemberFormModal from '../components/members/MemberFormModal.vue'
import ArchiveMemberModal from '../components/members/ArchiveMemberModal.vue'
import { useActiveChurch } from '../composables/useActiveChurch'
import { useCurrentRole } from '../composables/useCurrentRole'
import { useCurrentUser } from '../composables/useCurrentUser'
import { useMediaQuery } from '../composables/useMediaQuery'
import { listRecords, countArchived, MEMBER_PAGE_SIZE } from '../lib/data/members'
import { journeyProgress } from '../utils/journey'

// The members roll.
//
// SELECTION IS THE POINT OF THIS SCREEN. A row click tints the row and fills
// the 360px panel on the right; nothing navigates. Below the panel's breakpoint
// the same click opens the record as a sheet instead, because a 360px panel
// beside a table does not exist on a phone.
//
// THE FILTER PILLS ARE CLIENT-SIDE, ON PURPOSE, AND ONLY FOR NOW. Search and
// paging are server-side (listRecords) because 250 rows per church across
// eleven churches is not a thing to hold in a browser. The four pills filter
// the CURRENT PAGE only, which is honest for "No group" and "Not baptized" at
// this roster size but will start lying the moment a church outgrows one page.
// When that happens they move into the query. Flagged here rather than
// discovered later.

const { activeChurchId, activeChurchName } = useActiveChurch()
const { canSeeMemberDetail, canWriteMembers } = useCurrentRole()
const { displayName, load: loadUser } = useCurrentUser()
const isWide = useMediaQuery('(min-width: 1180px)')

const rows = ref([])
const total = ref(0)
const archived = ref(0)
const page = ref(1)
const search = ref('')
const loading = ref(true)
const errorMessage = ref('')
const selectedId = ref(null)
const activeFilter = ref('all')
const detailOpen = ref(false)

// The dialogs. `formMode` decides which of dialog 01 / 02 the one form renders.
const formOpen = ref(false)
const formMode = ref('create')
const archiveOpen = ref(false)

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'follow-up', label: 'Needs follow-up' },
  { key: 'not-baptized', label: 'Not baptized' },
  { key: 'no-group', label: 'No group' }
]

let searchTimer = null

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / MEMBER_PAGE_SIZE)))

const visible = computed(() => {
  const list = rows.value
  switch (activeFilter.value) {
    case 'follow-up':
      // Nobody has begun a journey with this person.
      return list.filter(m => journeyProgress(m) === 0)
    case 'not-baptized':
      return list.filter(m => !m.is_baptized)
    case 'no-group':
      return list.filter(m => !(m.group_members || []).length)
    default:
      return list
  }
})

const selected = computed(() => rows.value.find(m => m.id === selectedId.value) || null)

// The rail is open only when there is a record to put in it. It is deliberately
// derived rather than a second flag: one source of truth for "is a record
// open" is what stops the rail and the row highlight disagreeing.
const railOpen = computed(() => isWide.value && canSeeMemberDetail.value && !!selected.value)

function nameOf (m) {
  const middle = m.middle_name ? `${m.middle_name.trim()[0]}. ` : ''
  return `${m.first_name} ${middle}${m.last_name}`.replace(/\s+/g, ' ').trim()
}

function ageOf (m) {
  if (!m.birthdate) return null
  const b = new Date(m.birthdate)
  const now = new Date()
  let a = now.getFullYear() - b.getFullYear()
  const mo = now.getMonth() - b.getMonth()
  if (mo < 0 || (mo === 0 && now.getDate() < b.getDate())) a--
  return a
}

function phoneOf (m) {
  if (m.contact_number == null || m.contact_number === '') return null
  const digits = String(m.contact_number).replace(/\D/g, '')
  const padded = digits.length === 10 ? `0${digits}` : digits
  return padded.replace(/^(\d{4})(\d{3})(\d{4})$/, '$1 $2 $3')
}

function groupsOf (m) {
  return (m.group_members || []).map(gm => gm.groups).filter(Boolean)
}

async function load () {
  if (!activeChurchId.value) return
  loading.value = true
  errorMessage.value = ''

  const [result, archivedCount] = await Promise.all([
    listRecords({
      churchId: activeChurchId.value,
      canSeeDetail: canSeeMemberDetail.value,
      page: page.value,
      search: search.value
    }),
    countArchived(activeChurchId.value)
  ])
  archived.value = archivedCount

  if (!result.ok) {
    errorMessage.value = result.message
    rows.value = []
    total.value = 0
  } else {
    rows.value = result.rows
    total.value = result.total
    // A selection that is no longer on the page is not a selection.
    if (selectedId.value && !result.rows.some(m => m.id === selectedId.value)) {
      selectedId.value = null
    }
  }
  loading.value = false
}

/**
 * A row click.
 *
 * On a wide screen this TOGGLES: clicking the row whose record is already open
 * closes the rail. The row is the only affordance for opening it, so it has to
 * be the affordance for closing it too — otherwise the only way back to a
 * full-width table is to find a piece of empty page to click.
 *
 * Below the breakpoint the record is a dialog rather than a rail, and a dialog
 * has its own close. Toggling there would mean the second tap of a
 * double-tap-ish gesture opened an empty sheet, so the narrow path always
 * selects.
 */
function selectMember (m) {
  if (!isWide.value) {
    selectedId.value = m.id
    detailOpen.value = true
    return
  }
  selectedId.value = selectedId.value === m.id ? null : m.id
}

function closeRail () {
  selectedId.value = null
}

/**
 * Clicking away from the table closes the rail.
 *
 * Bound to the scrolling column, so clicks inside the rail never reach it. A
 * click that lands on a row or on any control is somebody doing something else
 * — searching, filtering, paging, adding — and must not be read as "dismiss".
 * Everything left is background.
 */
function onColumnClick (event) {
  if (!railOpen.value) return
  if (event.target.closest('.tbl__row, button, a, input, select, textarea, [role="button"]')) return
  closeRail()
}

// --- Dialogs ------------------------------------------------------------
function openCreate () {
  if (!activeChurchId.value) {
    errorMessage.value = 'Cannot determine your church. Please reload.'
    return
  }
  formMode.value = 'create'
  formOpen.value = true
}

function openEdit (m) {
  selectedId.value = m.id
  formMode.value = 'edit'
  formOpen.value = true
}

function openArchive (m) {
  selectedId.value = m.id
  // Never two dialogs at once — the edit form's "Archive record" hands over
  // rather than stacking. Two focus traps competing for one Escape key is the
  // failure the shared Dialog primitive exists to remove, not to reproduce.
  formOpen.value = false
  archiveOpen.value = true
}

function onSaved (row) {
  const i = rows.value.findIndex(m => m.id === row.id)
  if (i !== -1) {
    // An edit: the row is on this page by definition, so patch it and keep the
    // panel showing the record that was just saved.
    rows.value.splice(i, 1, row)
    selectedId.value = row.id
    return
  }
  // A create. Prepending would be a lie — the list is ordered by Postgres and
  // paginated, so a new surname does not belong at the top of whatever page
  // happens to be open. Re-read instead, and select the new record if it landed
  // on this page. One round-trip, and the counts come back correct with it.
  load().then(() => {
    if (rows.value.some(m => m.id === row.id)) selectedId.value = row.id
  })
}

function onArchived (m) {
  rows.value = rows.value.filter(r => r.id !== m.id)
  if (selectedId.value === m.id) selectedId.value = null
  detailOpen.value = false
  // Corrected locally rather than re-queried: archiving moves exactly one
  // record from one count to the other, and that is cheaper than two more
  // round-trips to be told so.
  total.value = Math.max(0, total.value - 1)
  archived.value += 1
}

function onSearch (value) {
  search.value = value
  clearTimeout(searchTimer)
  // Debounced because every keystroke is a round-trip otherwise, and the point
  // of server-side search is to move work off the browser, not onto the network.
  searchTimer = setTimeout(() => { page.value = 1; load() }, 280)
}

/**
 * Escape closes the rail.
 *
 * Click-away is not reachable from a keyboard, so without this the rail could
 * be opened with Enter on a row and then only closed by tabbing back to that
 * exact row. It defers to the dialogs: while one is open, Escape belongs to it,
 * and closing the record underneath as well would leave somebody looking at a
 * table they did not ask to return to.
 */
function onKeydown (event) {
  if (event.key !== 'Escape') return
  if (formOpen.value || archiveOpen.value || detailOpen.value) return
  if (railOpen.value) closeRail()
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  load()
  // For "record created by …" on the add dialog. Module-scoped and already
  // resolved by the sidebar in practice, so this is a no-op on a warm cache.
  loadUser()
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  clearTimeout(searchTimer)
})

watch(activeChurchId, () => { page.value = 1; selectedId.value = null; load() })
watch(page, load)
</script>

<template>
  <div class="mem">
    <!-- The scrolling column. The page padding lives HERE rather than on the
         shell, because the rail beside it is not page content — it is part of
         the frame, and it has to reach the top and bottom edges. -->
    <div
      class="mem__col"
      @click="onColumnClick"
    >
      <!-- Header -->
      <header
        class="mem__head anim-rise"
        style="--i: 0"
      >
        <div class="mem__title-block">
          <h1 class="mem__title">
            Members
          </h1>
          <p class="mem__sub">
            {{ total }} active record{{ total === 1 ? '' : 's' }}
            <template v-if="archived">
              · {{ archived }} archived
            </template>
          </p>
        </div>
        <Button
          v-if="canWriteMembers"
          variant="primary"
          size="lg"
          @click="openCreate"
        >
          + Add member
        </Button>
      </header>

      <!-- Search + filters -->
      <div
        class="mem__controls anim-rise"
        style="--i: 1"
      >
        <div class="mem__search">
          <Icon
            name="search"
            :size="16"
            class="mem__search-icon"
          />
          <input
            :value="search"
            class="mem__search-input"
            type="search"
            placeholder="Search by name, number or address…"
            aria-label="Search members"
            @input="onSearch($event.target.value)"
          >
        </div>

        <div
          class="mem__pills"
          role="group"
          aria-label="Filter members"
        >
          <button
            v-for="f in FILTERS"
            :key="f.key"
            type="button"
            class="pill"
            :class="{ 'is-on': activeFilter === f.key }"
            :aria-pressed="activeFilter === f.key"
            @click="activeFilter = f.key"
          >
            {{ f.label }}
          </button>
        </div>
      </div>

      <Card
        :padded="false"
        class="mem__table-card anim-rise"
        style="--i: 2"
      >
        <!-- Loading: skeleton bars, never a spinner -->
        <div
          v-if="loading"
          class="skel"
        >
          <div
            v-for="n in 8"
            :key="n"
            class="skeleton skel__row"
          />
        </div>

        <p
          v-else-if="errorMessage"
          class="mem__error"
        >
          {{ errorMessage }}
        </p>

        <!-- No results -->
        <div
          v-else-if="!visible.length"
          class="empty"
        >
          <span class="empty__tile"><Icon
            name="searchEmpty"
            :size="22"
          /></span>
          <h2 class="empty__title">
            <template v-if="search">
              Nothing matches “{{ search }}”
            </template>
            <template v-else-if="activeFilter !== 'all'">
              Nobody on this page matches that filter
            </template>
            <template v-else>
              No members yet
            </template>
          </h2>
          <p class="empty__body">
            <template v-if="activeFilter !== 'all'">
              The filter applies to the page you are on. Clear it to see all
              {{ total }} records.
            </template>
            <template v-else-if="search">
              Check the spelling, or add them to the roll.
            </template>
            <template v-else>
              Add the first record to get started.
            </template>
          </p>
          <div class="empty__actions">
            <Button
              v-if="activeFilter !== 'all'"
              @click="activeFilter = 'all'"
            >
              Clear filter
            </Button>
            <Button
              v-if="canWriteMembers"
              variant="primary"
              @click="openCreate"
            >
              + Add member
            </Button>
          </div>
        </div>

        <table
          v-else
          class="tbl"
        >
          <thead>
            <tr>
              <th scope="col">
                Member
              </th>
              <th
                scope="col"
                class="tbl__num"
              >
                Age
              </th>
              <th scope="col">
                Groups
              </th>
              <th scope="col">
                Journey
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(m, i) in visible"
              :key="m.id"
              class="tbl__row"
              :class="{ 'is-selected': m.id === selectedId }"
              :style="`--i: ${i}`"
              tabindex="0"
              :aria-selected="m.id === selectedId"
              @click="selectMember(m)"
              @keydown.enter.prevent="selectMember(m)"
              @keydown.space.prevent="selectMember(m)"
            >
              <td>
                <div class="who">
                  <Avatar
                    :name="nameOf(m)"
                    :size="32"
                  />
                  <div class="who__text">
                    <span class="who__name">{{ nameOf(m) }}</span>
                    <span
                      v-if="phoneOf(m)"
                      class="who__phone"
                    >{{ phoneOf(m) }}</span>
                    <span
                      v-else
                      class="who__phone who__phone--empty"
                    >No number on record</span>
                  </div>
                </div>
              </td>
              <td class="tbl__num">
                {{ ageOf(m) ?? '—' }}
              </td>
              <td>
                <span v-if="groupsOf(m).length">{{ groupsOf(m).map(g => g.name).join(', ') }}</span>
                <span
                  v-else
                  class="tbl__empty"
                >—</span>
              </td>
              <td><JourneyTrack :member="m" /></td>
            </tr>
          </tbody>
        </table>

        <!-- Pager -->
        <div
          v-if="!loading && totalPages > 1"
          class="pager"
        >
          <span class="pager__label">
            Page {{ page }} of {{ totalPages }} · {{ total }} records
          </span>
          <div class="pager__buttons">
            <Button
              size="sm"
              :disabled="page === 1"
              @click="page = Math.max(1, page - 1)"
            >
              <Icon
                name="chevronLeft"
                :size="14"
              /> Previous
            </Button>
            <Button
              size="sm"
              :disabled="page === totalPages"
              @click="page = Math.min(totalPages, page + 1)"
            >
              Next <Icon
                name="chevronRight"
                :size="14"
              />
            </Button>
          </div>
        </div>
      </Card>
    </div>

    <!-- The detail rail.
         A column of the frame, not a card in the page: it reaches the top and
         bottom edges, carries a single left border instead of a card's own
         chrome and shadow, and scrolls independently of the table beside it —
         so a long record does not push the roll around, and paging the table
         does not move the record you are reading.

         IT ONLY EXISTS WHILE A RECORD IS OPEN. There is no empty state: an
         empty 360px column is 360px the table could have had, and a permanent
         "choose a member" placeholder is a caption on a blank wall. It is
         dismissed by clicking the open row again, by clicking away from the
         table, or by Escape. -->
    <aside
      v-if="isWide && canSeeMemberDetail"
      class="mem__rail"
      :class="{ 'is-open': railOpen }"
      aria-label="Member record"
    >
      <!-- The inner column holds the fixed 360px and the padding; the rail
           itself only animates its width. Without this split the content
           re-wraps on every frame of the collapse, which is both ugly and a
           lot of layout work for an animation nobody asked to watch.

           Nothing is rendered inside while closed, so the 0-width box can
           never hold a focusable element — a tab stop inside a collapsed
           panel is a keyboard trap with no visible cause. -->
      <div class="mem__rail-inner">
        <MemberDetailPanel
          v-if="selected"
          :key="selected.id"
          :member="selected"
          :church-name="activeChurchName"
          :can-write="canWriteMembers"
          @edit="openEdit"
          @archive="openArchive"
        />
      </div>
    </aside>

    <!-- The same record, below the panel's breakpoint. A 360px column beside a
         table does not exist on a phone, and without this the row click would
         set a flag that renders nothing — leaving no route to Edit or Archive
         at all on a narrow screen.

         It yields to the form and archive dialogs rather than stacking beneath
         them. The selection survives, so dismissing the form brings the record
         straight back. -->
    <Modal
      v-if="!isWide && canSeeMemberDetail"
      :open="detailOpen && !formOpen && !archiveOpen"
      :title="selected ? `${selected.first_name} ${selected.last_name}` : 'Member record'"
      width="md"
      @update:open="detailOpen = $event"
    >
      <MemberDetailPanel
        v-if="selected"
        :key="selected.id"
        :member="selected"
        :church-name="activeChurchName"
        :can-write="canWriteMembers"
        @edit="openEdit"
        @archive="openArchive"
      />
    </Modal>

    <!-- Dialogs 01 / 02 and 03. Mounted at the view root, not inside the panel:
         the panel is conditional on the wide breakpoint, and a dialog whose
         ancestor unmounts when the window narrows takes the work in it with
         it. -->
    <MemberFormModal
      v-if="canWriteMembers"
      v-model:open="formOpen"
      :mode="formMode"
      :member="selected"
      :church-id="activeChurchId"
      :church-name="activeChurchName"
      :actor-name="displayName"
      @saved="onSaved"
      @request-archive="openArchive"
    />

    <ArchiveMemberModal
      v-if="canWriteMembers"
      v-model:open="archiveOpen"
      :member="selected"
      @archived="onArchived"
    />
  </div>
</template>

<style scoped>
/* The screen is a row: a scrolling column, and the rail. Both are full height;
   neither scrolls the other. The shell hands this view the whole content frame
   (router meta `framed`), which is what lets the rail touch both edges. */
.mem { flex: 1; display: flex; min-height: 0; min-width: 0; }

.mem__col {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-16);
  overflow-y: auto;
  /* The page padding the shell no longer applies. The extra 2px at the bottom
     is the mockup's own 28/28/30. */
  padding: var(--page-pad) var(--page-pad) calc(var(--page-pad) + 2px);
}

/* --- Header ----------------------------------------------------------- */
.mem__head { display: flex; align-items: flex-end; justify-content: space-between; gap: var(--sp-16); }

.mem__title-block { display: flex; flex-direction: column; gap: var(--sp-5); min-width: 0; }

.mem__title {
  font-size: var(--text-h1);
  font-weight: 800;
  letter-spacing: var(--tracking-h1);
  line-height: var(--leading-h1);
}

.mem__sub { font-size: var(--text-body); color: var(--ink-4); }

/* --- Controls --------------------------------------------------------- */
.mem__controls { display: flex; align-items: center; gap: var(--sp-10); flex-wrap: wrap; }

.mem__search {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 260px;
  max-width: 420px;
}

.mem__search-icon {
  position: absolute;
  left: var(--sp-12);
  color: var(--ink-5);
  pointer-events: none;
}

/* 35px of left padding is the mockup's value — it is what keeps the caret clear
   of the magnifier at this icon size. */
.mem__search-input {
  width: 100%;
  padding: 10px var(--sp-14) 10px 35px;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: var(--r-control);
  font-family: var(--font-sans);
  font-size: var(--text-body);
  color: var(--ink);
  transition: border-color var(--dur-state) ease, box-shadow var(--dur-state) ease;
}
.mem__search-input::placeholder { color: var(--ink-5); }
.mem__search-input:focus {
  outline: 0;
  border-color: var(--accent-border-hi);
  box-shadow: var(--ring-focus);
}

.mem__pills { display: flex; gap: var(--sp-8); flex-wrap: wrap; }

.pill {
  padding: var(--sp-9) var(--sp-14);
  border: 1px solid var(--border-strong);
  border-radius: var(--r-pill);
  background: var(--surface);
  font-family: var(--font-sans);
  font-size: var(--text-label);
  font-weight: 700;
  color: var(--ink-2);
  cursor: pointer;
  transition: background-color var(--dur-state) ease, border-color var(--dur-state) ease, color var(--dur-state) ease;
}
.pill:hover { background: var(--surface-subtle-2); }
.pill.is-on {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.mem__table-card { overflow: hidden; }

/* --- Table ------------------------------------------------------------ */
.tbl { width: 100%; border-collapse: collapse; }

.tbl thead th {
  padding: var(--sp-10) var(--sp-16);
  background: var(--surface-subtle);
  border-bottom: 1px solid var(--border);
  text-align: left;
  font-size: var(--text-eyebrow);
  font-weight: 800;
  letter-spacing: var(--tracking-eyebrow);
  text-transform: uppercase;
  color: var(--ink-5);
  white-space: nowrap;
}

.tbl__num { text-align: right; font-variant-numeric: tabular-nums; }
.tbl thead th.tbl__num { text-align: right; }

.tbl__row {
  cursor: pointer;
  animation: rise var(--dur-rise) var(--ease-entrance) both;
  animation-delay: calc(var(--i, 0) * .04s);
  transition: background-color var(--dur-state) ease;
}
.tbl__row:hover { background: var(--surface-subtle-2); }
.tbl__row:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

/* The selected row. --row-selected is a token precisely so this stays a LIGHT
   tint in light mode and a DARK one in dark; a light tint on a dark surface is
   the documented regression. */
.tbl__row.is-selected { background: var(--row-selected); }

.tbl td {
  padding: var(--sp-12) var(--sp-16);
  border-bottom: 1px solid var(--divider);
  font-size: var(--text-body-sm);
  color: var(--ink-3);
  vertical-align: middle;
}
.tbl tbody tr:last-child td { border-bottom: 0; }

.tbl__empty { color: var(--ink-6); }

.who { display: flex; align-items: center; gap: var(--sp-12); min-width: 0; }
.who__text { display: flex; flex-direction: column; min-width: 0; line-height: 1.35; }
.who__name { font-size: var(--text-body); font-weight: 700; color: var(--ink); }
.who__phone { font-size: var(--text-meta); color: var(--ink-5); font-variant-numeric: tabular-nums; }
.who__phone--empty { color: var(--ink-6); font-style: italic; }

/* --- Pager ------------------------------------------------------------ */
.pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-12);
  padding: var(--sp-12) var(--sp-16);
  border-top: 1px solid var(--border);
  background: var(--surface-subtle);
}
.pager__label { font-size: var(--text-meta); color: var(--ink-5); }
.pager__buttons { display: flex; gap: var(--sp-8); }

/* --- Skeleton --------------------------------------------------------- */
.skel { display: flex; flex-direction: column; gap: var(--sp-12); padding: var(--sp-16); }
.skel__row { height: 44px; }

/* --- Empty ------------------------------------------------------------ */
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-12);
  padding: var(--sp-32) var(--sp-22);
  text-align: center;
}

.empty__tile {
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  border-radius: var(--r-inset);
  background: var(--accent-tint);
  color: var(--accent);
}

.empty__title { font-size: var(--text-h3); font-weight: 800; letter-spacing: var(--tracking-h3); }
.empty__body { font-size: var(--text-body-sm); color: var(--ink-4); max-width: 34ch; }
.empty__actions { display: flex; gap: var(--sp-8); flex-wrap: wrap; justify-content: center; }

/* --- The detail rail --------------------------------------------------- */
/* Collapsed by default; `is-open` gives it its width.
   Width rather than a transform, because the table has to actually reclaim the
   space — a rail that slid away leaving a 360px hole would be the same problem
   with an animation on top. It stays mounted so the width has something to
   transition between; at zero it is invisible, unscrollable and empty. */
.mem__rail {
  width: 0;
  flex: none;
  min-height: 0;
  overflow: hidden;
  background: var(--surface);
  /* One border, on the inner edge only. A card's ring and shadow would make it
     read as content floating in the page; this is the frame. */
  border-left: 0 solid var(--border);
  transition:
    width var(--dur-slide) var(--ease-entrance),
    border-left-width var(--dur-slide) var(--ease-entrance);
}

.mem__rail.is-open {
  width: 360px;
  border-left-width: 1px;
}

.mem__rail-inner {
  width: 360px;
  height: 100%;
  box-sizing: border-box;
  overflow-y: auto;
  /* The mockup's own 26 / 24 / 30. */
  padding: var(--sp-26) 24px 30px;
}

@media (prefers-reduced-motion: reduce) {
  .mem__rail { transition: none; }
}


.mem__error {
  padding: var(--sp-22);
  font-size: var(--text-body-sm);
  color: var(--magenta-deep);
}

@media (max-width: 900px) {
  /* Matches the shell's own mobile padding, which this view now applies
     itself. */
  .mem__col { padding: var(--sp-16); }
}

@media (max-width: 760px) {
  .mem__head { flex-direction: column; align-items: stretch; }
  .mem__search { max-width: none; }
  /* Age and Groups are the two columns a phone can live without; the name,
     number and journey are what the roll is actually read for. */
  .tbl thead th:nth-child(2),
  .tbl thead th:nth-child(3),
  .tbl td:nth-child(2),
  .tbl td:nth-child(3) { display: none; }
}
</style>

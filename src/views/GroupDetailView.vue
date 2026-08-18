<script setup>
import { computed, onMounted, onServerPrefetch, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Badge from '../components/ui/Badge.vue'
import Button from '../components/ui/Button.vue'
import Avatar from '../components/ui/Avatar.vue'
import Card from '../components/ui/Card.vue'
import Spinner from '../components/ui/Spinner.vue'
import Modal from '../components/ui/Modal.vue'
import AddMembersDialog from '../components/groups/AddMembersDialog.vue'
import GroupFormModal from '../components/groups/GroupFormModal.vue'
import { supabase } from '../lib/supabase'
import { write } from '../lib/data/write'
import { showToast } from '../composables/useToast'
import { MEMBERSHIP_TABLES, MEMBERSHIP_PARENT_KEY } from '../lib/data/groups'
import { useActiveChurch } from '../composables/useActiveChurch'
import { useCurrentRole } from '../composables/useCurrentRole'
import { fetchGroupBySlug, fetchRoster, fetchLeader, fetchLeaderCandidates, journeyFor, recordJourney, fetchMyLedGroupIds, slugify } from '../lib/data/group'
import { assignSmallGroupLeader, unassignSmallGroupLeader } from '../lib/data/admin'

// The group page — frame 3a. Replaces GroupDetailModal, whose own comment recorded the
// compromise this page exists to pay off: "there is no group page — the card opens
// this — so a second dialog would be a dialog on top of a dialog". There is now.
//
// HALF OF 3a WAS A DIFFERENT FEATURE WEARING THIS PAGE'S CLOTHES, AND IT IS NOT BUILT.
// The frame draws a meetings apparatus — a Record-meeting action, a six-week chart, a
// next-meeting line, an average-attendance tile, a missed-three tile, and a six-dot
// strip per roster row. None of it has data behind it: `attendance` records attendance
// at church SERVICES, keyed to `services` and `service_schedules`, and there is no such
// thing as a group meeting in this system. Rather than stand these surfaces up as empty
// placeholders, they were removed — the two tiles, the roster column, the button and the
// Meetings card. When a group-meeting table exists, they are a feature to design against
// real data, not a layout to un-grey.
//
// WHAT IS OMITTED because it is not a feature either:
//   * "Assistant" in the Role column — a second group role nobody has decided on.
//     The column shows Leader or Member.
//   * "#1042"-style member numbers — a data format.
//   * A group approval line ("Approved · 2 Jun 2021") — a workflow nobody has agreed.

const route = useRoute()
const router = useRouter()
const { activeChurchId, churches, ensureLoaded, setActiveChurch } = useActiveChurch()
const {
  canSeeMemberDetail, canManageSmallGroups, isSmallGroupLeader, canManageGroupMembers,
  canRecordJourney, isSuperAdmin, isHeadPastor, isPastor
} = useCurrentRole()

const group = ref(null)
const roster = ref([])
const rosterCount = ref(0)
const rosterDetail = ref('count')
const leader = ref(null)
const leaderUnknown = ref(false)
const loading = ref(true)
const notFound = ref(false)
const errorMessage = ref('')
const rosterError = ref('')
const showAll = ref(false)
// The small groups this caller leads. The journey toggles below appear only for the
// group they actually lead — set_member_journey() (0028) is the real gate, but an
// action that would bounce should not be offered.
const ledGroupIds = ref([])

// What the roster shows before "Show all", matching the mockup's "Showing 5 of 27".
const PREVIEW_ROWS = 5

const isMinistry = computed(() => group.value?.type === 'Ministry')

// May this caller record the two journey milestones on THIS group's roster? Only a
// small-group leader of this very group (or, in principle, a SuperAdmin who leads it).
const canRecordJourneyHere = computed(() =>
  canRecordJourney.value && !!group.value && ledGroupIds.value.includes(group.value.id)
)

const journey = computed(() =>
  journeyFor({ rows: roster.value, detail: rosterDetail.value })
)

const visibleRoster = computed(() =>
  showAll.value ? roster.value : roster.value.slice(0, PREVIEW_ROWS)
)

// A ministry has no leader, so the line is absent rather than empty — the page must not
// imply a concept ministries do not have. A leader whose account is not yet linked to a
// member has no name to print, which is "assigned" rather than "nobody".
const leaderName = computed(() => leader.value?.name || null)
const hasLeader = computed(() => !!leader.value)

// The roster is a way into the person, except for a Small Group Leader: their account
// is restricted from member detail elsewhere and this page must not become the way
// around that.
const rosterRowsAreLinks = computed(() => canSeeMemberDetail.value && !isSmallGroupLeader.value)

// Group-specific, because the Finance ministry is Pastor-only — a Church Leader who
// may add members to every other group may not add them to that one. Controls the
// caller cannot use are absent rather than disabled: the nav advertises what the
// product contains, but an action bar on a page should offer only what will work.
const canAddMembers = computed(() =>
  !!group.value && canManageGroupMembers({ isFinanceGroup: group.value.ministry_key === 'finance' })
)

async function load () {
  loading.value = true
  notFound.value = false
  errorMessage.value = ''
  rosterError.value = ''
  showAll.value = false

  await ensureLoaded()

  // THE URL IS AUTHORITATIVE, not the church selector. A link to another church's group
  // has to land on that group, so the church segment switches the active church before
  // anything is fetched. Without this, following a shared link while pointed at a
  // different church would silently show "not found" for a group that plainly exists.
  //
  // A church slug the caller cannot see matches nothing, so they get the same not-found
  // as any other invisible group — the selector only ever holds churches RLS allowed.
  const wantedChurch = (churches.value || []).find(c => slugify(c.name) === slugify(route.params.church))
  if (wantedChurch && wantedChurch.id !== activeChurchId.value) {
    setActiveChurch(wantedChurch.id)
  }

  if (!wantedChurch) {
    notFound.value = true
    loading.value = false
    return
  }

  const found = await fetchGroupBySlug({
    churchId: wantedChurch.id,
    groupSlug: route.params.group
  })

  if (!found.ok) {
    errorMessage.value = found.message
    loading.value = false
    return
  }

  // No row means "no such group" or "a group you may not see", and the page renders
  // them identically on purpose: confirming another church's small group exists is a
  // leak, however small.
  if (!found.group) {
    notFound.value = true
    loading.value = false
    return
  }

  group.value = found.group

  const [rosterResult, leaderResult, ledResult] = await Promise.all([
    fetchRoster({
      group: found.group,
      churchId: activeChurchId.value,
      canSeeMemberDetail: canSeeMemberDetail.value
    }),
    fetchLeader({ group: found.group }),
    // Only a potential journey-recorder needs to know what they lead; everyone else
    // skips the round-trip entirely.
    canRecordJourney.value ? fetchMyLedGroupIds() : Promise.resolve({ ok: true, ids: [] })
  ])

  ledGroupIds.value = ledResult.ids || []

  leader.value = leaderResult.leader
  // A failed lookup is not an absent leader. Without this the page states "No leader
  // assigned" whenever the query breaks — which is what a PGRST201 on the leader embed
  // looked like from the outside, and it took the contract suite to notice.
  leaderUnknown.value = !leaderResult.ok

  if (rosterResult.ok) {
    // The leader is stored account-side and the roster is member-side, so the row is
    // marked here, once the two are both in hand.
    roster.value = rosterResult.rows.map(row => ({
      ...row,
      isLeader: !!leaderResult.leader && row.memberId === leaderResult.leader.memberId
    }))
    rosterCount.value = rosterResult.count
    rosterDetail.value = rosterResult.detail
  } else {
    // "We could not fetch the members" is not "no members", and the page says which.
    rosterError.value = rosterResult.message
    roster.value = []
    rosterCount.value = 0
    rosterDetail.value = rosterResult.detail
  }

  loading.value = false
}

onMounted(load)
// Inert in this app, which never server-renders — but it is the documented way to let a
// render await the component's own data, and it is what makes the page assertable in
// tests without pulling in a DOM implementation just to fire onMounted.
onServerPrefetch(load)
watch(() => [route.params.church, route.params.group], load)
// No watcher on activeChurchId: the church is in the path, and load() sets the selector
// from it. Reloading on the selector too would fight that — the URL wins here, and
// changing church from this page is a navigation, not a filter.

function openMember (row) {
  if (!rosterRowsAreLinks.value) return
  router.push({ name: 'Members', query: { member: row.memberId } })
}

// --- The dialogs the page can now open, because it is a page ----------------
const leaderOpen = ref(false)
const leaderCandidates = ref([])
const chosenLeader = ref('')
const savingLeader = ref(false)
const leaderError = ref('')

// Mirrors can_assign_small_group_leader() in 0026: Super Admin, Head Pastor, or the
// church's own Pastor — and only for a small group, because a ministry has no leader.
// The database is still the authority; this only decides whether to offer the control.
const canAssignLeader = computed(() =>
  !!group.value && !isMinistry.value &&
  (isSuperAdmin.value || isHeadPastor.value || isPastor.value)
)

async function openLeaderDialog () {
  leaderError.value = ''
  chosenLeader.value = leader.value?.accountId || ''
  leaderOpen.value = true

  const result = await fetchLeaderCandidates({ group: group.value })
  leaderCandidates.value = result.candidates
  if (!result.ok) leaderError.value = result.message
}

async function saveLeader () {
  if (!chosenLeader.value) return
  savingLeader.value = true
  leaderError.value = ''

  const result = await assignSmallGroupLeader({ accountId: chosenLeader.value, groupId: group.value.id })
  savingLeader.value = false

  if (!result.ok) {
    leaderError.value = result.message
    return
  }

  leaderOpen.value = false
  showToast('Leader assigned.')
  load()
}

async function removeLeader () {
  if (!leader.value) return
  savingLeader.value = true
  leaderError.value = ''

  const result = await unassignSmallGroupLeader({
    accountId: leader.value.accountId,
    groupId: group.value.id
  })
  savingLeader.value = false

  if (!result.ok) {
    leaderError.value = result.message
    return
  }

  leaderOpen.value = false
  showToast('Leader unassigned.')
  load()
}

const addOpen = ref(false)
const renameOpen = ref(false)
const deleteOpen = ref(false)
const deleting = ref(false)

const existingMemberIds = computed(() => roster.value.map(r => r.memberId))

// Renaming and deleting are small-group work, and only in the caller's own church.
const canEditGroup = computed(() =>
  canManageSmallGroups.value && !isMinistry.value && group.value?.church_id === activeChurchId.value
)

function onAdded () {
  // Re-read rather than splice the new rows in: the count, the journey panel and the
  // roster all derive from the same fetch, and correcting three things by hand is how
  // they drift apart.
  load()
}

function onRenamed ({ row }) {
  showToast('Group saved.')
  // The name is in the URL, so a rename is a navigation — staying put would leave the
  // address bar naming a group that no longer exists under that name.
  router.replace({
    name: 'GroupDetail',
    params: { church: route.params.church, group: slugify(row.name) }
  })
}

async function removeMember (row) {
  const result = await write(
    supabase
      .from(MEMBERSHIP_TABLES[group.value.type])
      .delete()
      .eq('id', row.membershipId)
      .eq(MEMBERSHIP_PARENT_KEY[group.value.type], group.value.id),
    { columns: 'id', messages: { blocked: 'That member could not be removed from this group.' } }
  )

  if (!result.ok) {
    showToast(result.message, 'error')
    return
  }

  // RLS refuses a delete by FILTERING, so a refusal returns no error and no rows. Zero
  // rows back means it did not happen, and the row must not vanish from the list.
  if (!result.rows.length) {
    showToast('That member could not be removed from this group.', 'error')
    return
  }

  roster.value = roster.value.filter(r => r.membershipId !== row.membershipId)
  rosterCount.value = Math.max(0, rosterCount.value - 1)
  showToast(`${row.name} removed from ${group.value.name}.`)
}

async function confirmDelete () {
  deleting.value = true

  const result = await write(
    supabase
      .from('small_groups')
      .delete()
      .eq('id', group.value.id)
      .eq('church_id', activeChurchId.value),
    { columns: 'id', messages: { blocked: 'That group could not be deleted. It may belong to another church.' } }
  )

  deleting.value = false

  if (!result.ok) {
    showToast(result.message, 'error')
    return
  }

  deleteOpen.value = false
  showToast(`${group.value.name} deleted.`)
  // The page it was showing no longer exists, so leaving it on screen would be a lie.
  router.push({ name: 'Groups' })
}

function joinedLabel (iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

// Toggle one of the two leader-writable milestones on a roster row. Optimistic:
// the flag flips immediately and rolls back if the write is refused, so a leader
// tapping through a group does not wait on a round-trip per tap. set_member_journey
// sends BOTH flags (it sets both columns), so the untouched one is passed as-is.
const savingJourney = ref(new Set())

async function toggleJourney (row, key) {
  if (!canRecordJourneyHere.value) return
  if (savingJourney.value.has(row.memberId)) return

  const before = {
    oneToOne: row.isOneToOneCompleted,
    turningPoint: row.isTurningPointCompleted
  }
  const next = {
    oneToOne: key === 'oneToOne' ? !before.oneToOne : before.oneToOne,
    turningPoint: key === 'turningPoint' ? !before.turningPoint : before.turningPoint
  }

  row.isOneToOneCompleted = next.oneToOne
  row.isTurningPointCompleted = next.turningPoint
  savingJourney.value = new Set(savingJourney.value).add(row.memberId)

  const result = await recordJourney({
    memberId: row.memberId,
    oneToOne: next.oneToOne,
    turningPoint: next.turningPoint
  })

  const pending = new Set(savingJourney.value)
  pending.delete(row.memberId)
  savingJourney.value = pending

  if (!result.ok) {
    row.isOneToOneCompleted = before.oneToOne
    row.isTurningPointCompleted = before.turningPoint
    showToast(result.message, 'error')
  }
}
</script>

<template>
  <div class="gd">
    <div
      v-if="loading"
      class="gd__state"
    >
      <Spinner />
      <p>Loading this group…</p>
    </div>

    <div
      v-else-if="notFound"
      class="gd__state"
    >
      <h1 class="gd__state-title">
        Group not found
      </h1>
      <p>This group does not exist, or it belongs to a church you cannot see.</p>
      <Button @click="router.push({ name: 'Groups' })">
        Back to groups
      </Button>
    </div>

    <div
      v-else-if="errorMessage"
      class="gd__state"
    >
      <h1 class="gd__state-title">
        Could not load this group
      </h1>
      <p>{{ errorMessage }}</p>
      <Button @click="load">
        Try again
      </Button>
    </div>

    <template v-else>
      <!-- Breadcrumb, so the way back is visible rather than remembered. -->
      <nav
        class="gd__crumbs"
        aria-label="Breadcrumb"
      >
        <RouterLink :to="{ name: 'Groups' }">
          Groups
        </RouterLink>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{{ group.name }}</span>
      </nav>

      <header class="gd__head">
        <div class="gd__ident">
          <div class="gd__tags">
            <Badge
              :tone="isMinistry ? 'accent' : 'magenta'"
              eyebrow
            >
              {{ isMinistry ? 'Ministry' : 'Small group' }}
            </Badge>
            <!-- 3a draws an approval line ("Approved · 2 Jun 2021") here. Omitted: a
                 group approval workflow is a decision nobody has made, not a surface
                 waiting on data. If approvals are wanted, that is a spec, not a badge. -->
          </div>

          <h1 class="gd__name">
            {{ group.name }}
          </h1>

          <p class="gd__sub">
            <!-- Only a small group has a leader, and "no leader yet" is a fact worth
                 stating rather than a gap. A ministry gets no line at all. -->
            <template v-if="!isMinistry">
              <span v-if="leaderName">Led by {{ leaderName }}</span>
              <span
                v-else-if="leaderUnknown"
                class="gd__muted"
              >Leader could not be loaded</span>
              <!-- A leader exists but this caller has no name to show for them: they may
                   see that the group is led (the row is visible to them) without seeing
                   member detail. Not "unlinked" — a leader always has a member. -->
              <span
                v-else-if="hasLeader"
                class="gd__muted"
              >Leader assigned</span>
              <span
                v-else
                class="gd__muted"
              >No leader assigned</span>
              <span
                class="gd__dot"
                aria-hidden="true"
              >·</span>
            </template>
            <span>{{ rosterCount }} {{ rosterCount === 1 ? 'member' : 'members' }}</span>
          </p>
        </div>

        <div class="gd__actions">
          <Button
            v-if="canAssignLeader"
            variant="secondary"
            @click="openLeaderDialog"
          >
            {{ hasLeader ? 'Change leader' : 'Assign leader' }}
          </Button>
          <Button
            v-if="canEditGroup"
            variant="secondary"
            @click="renameOpen = true"
          >
            Edit group
          </Button>
          <Button
            v-if="canEditGroup"
            variant="secondary"
            @click="deleteOpen = true"
          >
            Delete
          </Button>
          <Button
            v-if="canAddMembers"
            @click="addOpen = true"
          >
            + Add members
          </Button>
        </div>
      </header>

      <!-- Two tiles, both backed by real data. The mockup also drew "Average at meetings"
           and "Missed 3+ meetings", but there is no group-meeting table to feed them, so
           rather than stand them up as empty placeholders they are not built at all. -->
      <section
        class="gd__tiles"
        aria-label="Summary"
      >
        <Card class="gd__tile">
          <p class="gd__tile-label">
            Members
          </p>
          <p class="gd__tile-value">
            {{ rosterCount }}
          </p>
          <!-- 3a says "+4 since January" here. group membership has no joined-at column,
               so there is no delta to compute — and NO Soon badge either. Rule 4: Soon
               marks a feature, not a value, and never sits inside a control that works.
               A badge here reads as "the member count is coming soon", which is a lie
               about the one number on this tile that is real. The line is simply absent. -->
          <p class="gd__tile-foot">
            {{ isMinistry ? 'in this church' : 'in this group' }}
          </p>
          <!-- NO TRACK HERE. Overview's tiles carry one because each shows a share of
               something; a member count is not a share of anything, so a bar would sit
               at 100% forever and mean nothing. A full bar that encodes no quantity is
               the same lie as a Soon tile with a number in it. -->
        </Card>

        <Card class="gd__tile">
          <p class="gd__tile-label">
            Journey complete
          </p>
          <template v-if="journey">
            <p class="gd__tile-value">
              {{ journey.complete }}
            </p>
            <p class="gd__tile-foot">
              <span class="gd__tile-figure-note">
                {{ journey.total ? Math.round((journey.complete / journey.total) * 100) : 0 }}%
              </span>
              <span>{{ journey.total - journey.complete }} still in progress</span>
            </p>
            <span class="gd__tile-track">
              <span
                class="gd__tile-fill gd__tile-fill--green"
                :style="{ width: `${journey.total ? (journey.complete / journey.total) * 100 : 0}%` }"
              />
            </span>
          </template>
          <p
            v-else
            class="gd__tile-foot"
          >
            You do not have permission to see member detail.
          </p>
        </Card>
      </section>

      <!-- Two columns when there is a journey panel to sit beside the roster; one, with
           the roster full width, when there is not (a names-only caller sees no journey). -->
      <div
        class="gd__cols"
        :class="{ 'gd__cols--single': !journey }"
      >
        <Card class="gd__roster">
          <header class="gd__roster-head">
            <h2>
              Roster <span class="gd__count">{{ rosterCount }}</span>
            </h2>
            <!-- 3a says "Sorted by attendance". This is sorted by name, and says so
                 rather than claiming an order it cannot produce. -->
            <p class="gd__roster-note">
              Sorted by name
            </p>
          </header>

          <p
            v-if="rosterError"
            class="gd__roster-empty"
          >
            {{ rosterError }}
          </p>

          <div
            v-else-if="!roster.length"
            class="gd__roster-empty"
          >
            <p>Nobody is in this group yet.</p>
            <Button
              v-if="canAddMembers"
              @click="addOpen = true"
            >
              + Add members
            </Button>
          </div>

          <!-- The table scrolls inside its own box rather than widening the page. Its
               cells are nowrap so a name never breaks mid-line, which on a 375px phone
               makes the table wider than the viewport — and a page that scrolls
               sideways is a bug, not a layout. -->
          <div
            v-else
            class="gd__table-scroll"
          >
            <table class="gd__table">
              <thead>
                <tr>
                  <th scope="col">
                    Member
                  </th>
                  <th scope="col">
                    Role
                  </th>
                  <th
                    v-if="canRecordJourneyHere"
                    scope="col"
                  >
                    Journey
                  </th>
                  <th scope="col">
                    <span class="gd__sr">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in visibleRoster"
                  :key="row.membershipId"
                  :class="{ 'is-clickable': rosterRowsAreLinks }"
                  @click="openMember(row)"
                >
                  <td>
                    <div class="gd__person">
                      <Avatar :name="row.name" />
                      <div>
                        <p class="gd__person-name">
                          {{ row.name }}
                        </p>
                        <p class="gd__person-meta">
                          <template v-if="row.age !== null">
                            {{ row.age }}
                          </template>
                          <template v-if="row.age !== null && joinedLabel(row.joined)">
                            ·
                          </template>
                          <template v-if="joinedLabel(row.joined)">
                            joined {{ joinedLabel(row.joined) }}
                          </template>
                        </p>
                      </div>
                    </div>
                  </td>
                  <td>
                    <!-- Leader or Member. "Assistant" is drawn in 3a but is a group role
                       nobody has decided on, so it is omitted rather than invented. -->
                    <Badge :tone="row.isLeader ? 'accent' : 'neutral'">
                      {{ row.isLeader ? 'Leader' : 'Member' }}
                    </Badge>
                  </td>
                  <!-- The leader's two writable milestones (0028). Baptism and
                       certification are not here — those stay a Secretariat write. The
                       chips are pressed-state toggles, saved optimistically. -->
                  <td v-if="canRecordJourneyHere">
                    <div class="gd__jtoggles">
                      <button
                        type="button"
                        class="gd__jchip"
                        :class="{ 'is-on': row.isOneToOneCompleted }"
                        :aria-pressed="row.isOneToOneCompleted"
                        :disabled="savingJourney.has(row.memberId)"
                        @click.stop="toggleJourney(row, 'oneToOne')"
                      >
                        One-to-one
                      </button>
                      <button
                        type="button"
                        class="gd__jchip"
                        :class="{ 'is-on': row.isTurningPointCompleted }"
                        :aria-pressed="row.isTurningPointCompleted"
                        :disabled="savingJourney.has(row.memberId)"
                        @click.stop="toggleJourney(row, 'turningPoint')"
                      >
                        Turning Point
                      </button>
                    </div>
                  </td>
                  <td>
                    <!-- Removing the leader is refused by the database (0022's deferred
                       trigger), so the control says to unassign them first rather than
                       offering an action that will bounce. -->
                    <Button
                      v-if="canAddMembers && !row.isLeader"
                      variant="ghost"
                      :aria-label="`Remove ${row.name} from this group`"
                      @click.stop="removeMember(row)"
                    >
                      Remove
                    </Button>
                    <span
                      v-else-if="row.isLeader"
                      class="gd__person-meta"
                    >Unassign as leader first</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Any roster with rows can be capped — a names-only list of 200 people needs
               the "show all" as much as a full one does (story 19). -->
          <footer
            v-if="roster.length > PREVIEW_ROWS"
            class="gd__roster-foot"
          >
            <span>Showing {{ visibleRoster.length }} of {{ roster.length }}</span>
            <Button
              variant="secondary"
              @click="showAll = !showAll"
            >
              {{ showAll ? 'Show fewer' : 'Show all' }}
            </Button>
          </footer>
        </Card>

        <div
          v-if="journey"
          class="gd__side"
        >
          <Card>
            <h2 class="gd__side-title">
              Journey across the group
            </h2>

            <p
              v-if="!journey.total"
              class="gd__roster-empty"
            >
              No members yet, so there is nothing to measure.
            </p>

            <dl
              v-else
              class="gd__journey"
            >
              <div
                v-for="stage in [
                  { key: 'baptized', label: 'Baptized', tone: 'accent' },
                  { key: 'oneToOne', label: 'One-to-one done', tone: 'accent' },
                  { key: 'turningPoint', label: 'Turning Point done', tone: 'magenta' }
                ]"
                :key="stage.key"
                class="gd__stage"
              >
                <dt>{{ stage.label }}</dt>
                <dd>{{ journey[stage.key].count }} · {{ journey[stage.key].percent }}%</dd>
                <span
                  class="gd__bar"
                  role="img"
                  :aria-label="`${stage.label}: ${journey[stage.key].count} of ${journey.total}`"
                >
                  <span
                    class="gd__bar-fill"
                    :class="`gd__bar-fill--${stage.tone}`"
                    :style="{ width: `${journey[stage.key].percent}%` }"
                  />
                </span>
              </div>
            </dl>
          </Card>
        </div>
      </div>
      <!-- Dialogs OPENED FROM THE PAGE, which is the whole reason the page exists.
           None of these could be reached from the old modal without stacking a second
           focus trap on top of the first. -->
      <AddMembersDialog
        v-model:open="addOpen"
        :group="group"
        :church-id="activeChurchId"
        :existing-member-ids="existingMemberIds"
        @added="onAdded"
      />

      <GroupFormModal
        v-model:open="renameOpen"
        mode="edit"
        :group="group"
        :church-id="activeChurchId"
        @saved="onRenamed"
      />

      <!-- Story 32-34: assign the leader FROM THE GROUP, with a confirm step, and
           reversible. This control is the reason the page exists — #75 built the role,
           the RPC and the table, and then had nowhere to put the button. -->
      <Modal
        v-model:open="leaderOpen"
        :title="hasLeader ? `Change the leader of ${group?.name}` : `Assign a leader for ${group?.name}`"
        description="A leader must already be a member of this group and must have a sign-in. Choosing someone replaces the current leader."
      >
        <div class="gd__leader-form">
          <p
            v-if="leaderError"
            class="gd__leader-error"
            role="alert"
          >
            {{ leaderError }}
          </p>

          <p
            v-if="!leaderCandidates.length"
            class="gd__tile-foot"
          >
            Nobody in this group has a sign-in yet, so there is no one who can lead it.
            Link an account to a member first, on Settings → Roles &amp; account linking.
          </p>

          <label
            v-for="c in leaderCandidates"
            :key="c.accountId"
            class="gd__leader-option"
          >
            <input
              v-model="chosenLeader"
              type="radio"
              :value="c.accountId"
            >
            <span>{{ c.name }}</span>
            <Badge v-if="leader && leader.accountId === c.accountId">Current</Badge>
          </label>
        </div>

        <template #footer>
          <Button
            v-if="hasLeader"
            variant="dangerQuiet"
            :disabled="savingLeader"
            @click="removeLeader"
          >
            Unassign
          </Button>
          <Button
            variant="secondary"
            @click="leaderOpen = false"
          >
            Cancel
          </Button>
          <Button
            :disabled="!chosenLeader || savingLeader || (leader && chosenLeader === leader.accountId)"
            @click="saveLeader"
          >
            {{ savingLeader ? 'Saving…' : 'Confirm leader' }}
          </Button>
        </template>
      </Modal>

      <!-- The same treatment GroupsView used before this page took the action over:
           stacked, magenta archive mark, no dismissal by clicking outside, and a
           "Keep group" escape that is a real sentence rather than "Cancel". Copied
           deliberately — a destructive confirm should not look different depending on
           which screen opened it. -->
      <Modal
        v-model:open="deleteOpen"
        :title="`Delete ${group?.name}?`"
        description="The group is removed and everyone in it is unassigned. Members themselves are not affected, and attendance already recorded is kept."
        width="sm"
        layout="stack"
        footer-layout="even"
        icon="archive"
        icon-tone="magenta"
        :close-on-outside-click="false"
      >
        <template #footer>
          <Button
            block
            :disabled="deleting"
            @click="deleteOpen = false"
          >
            Keep group
          </Button>
          <Button
            block
            variant="danger"
            :loading="deleting"
            @click="confirmDelete"
          >
            Delete group
          </Button>
        </template>
      </Modal>
    </template>
  </div>
</template>

<style scoped>
.gd { display: flex; flex-direction: column; gap: var(--sp-20); }

.gd__state {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: var(--sp-12); padding: var(--sp-48) var(--sp-20); text-align: center; color: var(--ink-3);
}
.gd__state-title { margin: 0; font-size: var(--text-h2); color: var(--ink); }

.gd__crumbs { display: flex; align-items: center; gap: var(--sp-8); font-size: var(--text-meta); color: var(--ink-4); }
.gd__crumbs a { color: var(--ink-3); text-decoration: none; }
.gd__crumbs a:hover { color: var(--accent); text-decoration: underline; }

.gd__head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--sp-20); flex-wrap: wrap; }
.gd__tags { display: flex; align-items: center; gap: var(--sp-8); margin-bottom: var(--sp-8); }
.gd__name { margin: 0; font-size: var(--text-h1); line-height: 1.15; }
.gd__sub { margin: var(--sp-6) 0 0; display: flex; align-items: center; flex-wrap: wrap; gap: var(--sp-6); color: var(--ink-3); font-size: var(--text-body); }
.gd__muted { color: var(--ink-4); }
.gd__dot { color: var(--ink-5, var(--ink-4)); }
.gd__actions { display: flex; align-items: center; gap: var(--sp-10); flex-wrap: wrap; }

/* THE TILE IS NOT A NEW TILE. OverviewView already builds this exact component from
   the tokens — label at --text-body-sm/600, figure at --text-figure/800 with tabular
   numerals, note at --text-meta, and a 4px track underneath. Building a second,
   thinner version by eye is what made this page read as bland beside the mockup: no
   figure weight, no coloured note, no track. These mirror those rules rather than
   inventing parallel ones. (`--text-display` does not exist; --text-figure is the
   token, and its comment literally says "stat figure".) */
/* Two tiles now the meetings pair is gone. They keep the left of the row rather than
   stretching to two half-page cards over a single figure each — a stat card reads as a
   stat, not a banner. */
.gd__tiles {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 260px));
  gap: var(--sp-16);
}
.gd__tile { display: flex; flex-direction: column; gap: var(--sp-10); }
.gd__tile-label { margin: 0; font-size: var(--text-body-sm); font-weight: 600; color: var(--ink-4); }
.gd__tile-value {
  margin: 0;
  font-size: var(--text-figure);
  font-weight: 800;
  letter-spacing: var(--tracking-h1);
  color: var(--ink);
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}
.gd__tile-foot { margin: 0; font-size: var(--text-meta); color: var(--ink-5); }
/* The one coloured thing in a tile, same rule as Overview: the share that is done
   reads as progress, not as an error. */
.gd__tile-figure-note { font-weight: 800; color: var(--success); font-variant-numeric: tabular-nums; }
.gd__tile-track { height: 4px; border-radius: var(--r-pill); background: var(--divider); overflow: hidden; }
.gd__tile-fill { display: block; height: 100%; border-radius: var(--r-pill); background: var(--accent); }
.gd__tile-fill--green { background: var(--success); }

.gd__cols { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); gap: var(--sp-16); align-items: start; }
/* No journey panel to sit beside it (a names-only caller) — the roster takes the width. */
.gd__cols--single { grid-template-columns: minmax(0, 1fr); }
.gd__side { display: flex; flex-direction: column; gap: var(--sp-16); }
.gd__side-title { margin: 0 0 var(--sp-12); font-size: var(--text-h3); }

.gd__roster-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--sp-12); margin-bottom: var(--sp-12); }
.gd__roster-head h2 { margin: 0; font-size: var(--text-h3); display: flex; align-items: center; gap: var(--sp-8); }
.gd__count { font-size: var(--text-meta); color: var(--ink-4); background: var(--surface-subtle); border-radius: var(--r-tag); padding: 1px 8px; }
.gd__roster-note { margin: 0; font-size: var(--text-meta); color: var(--ink-4); }
.gd__roster-empty { display: flex; flex-direction: column; align-items: flex-start; gap: var(--sp-12); color: var(--ink-3); margin: 0; padding: var(--sp-16) 0; }

/* The name column takes what is left; Role and Actions take only what they need, so a
   long name is not wrapped to make room for the narrow columns beside it. */
/* position:relative so the visually-hidden column heading inside the table is
   positioned against THIS box rather than the document. Absolutely positioned with no
   positioned ancestor, it anchors at its static position — which is inside a table
   wider than a phone — and quietly widened the whole page by the 10px it stuck out. */
.gd__table-scroll { overflow-x: auto; position: relative; }
.gd__table { width: 100%; border-collapse: collapse; table-layout: auto; }
.gd__table th:first-child, .gd__table td:first-child { width: 100%; }
.gd__table td:not(:first-child) { white-space: nowrap; width: 1%; }
/* The cells stay on one line; the HEADS may wrap, so a column stays as narrow as its
   content rather than as wide as its label. */
.gd__table th:not(:first-child) { white-space: normal; width: 1%; }
.gd__person-meta { white-space: nowrap; }

/* Announced, never shown — the actions column needs a name for a screen reader but
   drawing one would put a heading above a column of buttons. */
.gd__sr {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
}
.gd__table th {
  text-align: left; padding: var(--sp-8) var(--sp-10); border-bottom: 1px solid var(--border);
  font-size: var(--text-eyebrow); letter-spacing: var(--tracking-eyebrow); text-transform: uppercase;
  color: var(--ink-5); font-weight: 700; white-space: nowrap;
  background: var(--surface-subtle);
}
/* 3a's rows are tighter than the default cell padding gave: the drawn roster fits five
   people in the height mine used for four. The name block carries its own line-height,
   so the row height comes from this padding alone. */
.gd__table td { padding: var(--sp-8) var(--sp-10); border-bottom: 1px solid var(--divider); vertical-align: middle; }
.gd__table tr.is-clickable { cursor: pointer; }
.gd__table tr.is-clickable:hover td { background: var(--surface-subtle); }

.gd__person { display: flex; align-items: center; gap: var(--sp-10); line-height: 1.3; }
.gd__person-name { margin: 0; font-weight: 600; }
.gd__person-meta { margin: 0; font-size: var(--text-meta); color: var(--ink-4); }

.gd__roster-foot { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-12); padding-top: var(--sp-12); color: var(--ink-4); font-size: var(--text-meta); }

/* The leader's journey toggles. Pressed chips, in the app's existing pill idiom
   (see MembersView .pill) so the roster stays in the current visual language. */
.gd__jtoggles { display: flex; gap: var(--sp-6); }
.gd__jchip {
  padding: 4px 10px;
  border: 1px solid var(--border-strong);
  border-radius: var(--r-pill);
  background: var(--surface);
  font-family: var(--font-sans);
  font-size: var(--text-meta);
  font-weight: 700;
  color: var(--ink-3);
  cursor: pointer;
  white-space: nowrap;
  transition: background-color var(--dur-state) ease, border-color var(--dur-state) ease, color var(--dur-state) ease;
}
.gd__jchip:hover { background: var(--surface-subtle-2); }
.gd__jchip.is-on { background: var(--accent); border-color: var(--accent); color: #fff; }
.gd__jchip:disabled { opacity: .55; cursor: default; }
.gd__jchip:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.gd__leader-form { display: flex; flex-direction: column; gap: var(--sp-8); max-height: 46vh; overflow-y: auto; }
.gd__leader-option { display: flex; align-items: center; gap: var(--sp-10); padding: var(--sp-8); border-radius: var(--r-inset); cursor: pointer; }
.gd__leader-option:hover { background: var(--surface-subtle); }
.gd__leader-error { margin: 0; color: var(--magenta); font-size: var(--text-meta); }

.gd__journey { margin: 0; display: flex; flex-direction: column; gap: var(--sp-14); }
.gd__stage { display: grid; grid-template-columns: 1fr auto; gap: var(--sp-4) var(--sp-12); }
.gd__stage dt { font-size: var(--text-meta); color: var(--ink-3); }
.gd__stage dd { margin: 0; font-size: var(--text-meta); font-weight: 700; }
.gd__bar { grid-column: 1 / -1; height: 6px; border-radius: 999px; background: var(--surface-subtle-2, var(--divider)); overflow: hidden; }
.gd__bar-fill { display: block; height: 100%; border-radius: 999px; }
.gd__bar-fill--accent { background: var(--accent); }
.gd__bar-fill--magenta { background: var(--magenta, #d6006c); }

/* The journey panel drops below the roster rather than being squeezed beside it. */
@media (max-width: 900px) {
  .gd__cols { grid-template-columns: minmax(0, 1fr); }
  .gd__tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 560px) {
  .gd__tiles { grid-template-columns: minmax(0, 1fr); }
  .gd__head { flex-direction: column; align-items: stretch; }
  .gd__actions { justify-content: flex-start; }
}
</style>

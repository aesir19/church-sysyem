<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import Button from '../components/ui/Button.vue'
import Icon from '../components/ui/icons/Icon.vue'
import GroupCard from '../components/groups/GroupCard.vue'
import GroupFormModal from '../components/groups/GroupFormModal.vue'
import { useActiveChurch } from '../composables/useActiveChurch'
import { useCurrentRole } from '../composables/useCurrentRole'
import { listGroups, countMembersInNoGroup } from '../lib/data/groups'
import { slugify } from '../lib/data/group'

// Ministries & groups — a wall of cards, one per group.
//
// Replaces MinistrySmallGroupView, which held its own queries, its own toast
// implementation, four hand-rolled modals and 1,400 lines of CSS. The queries
// are now lib/data/groups.js, the toast is the app's one queue, and the modals
// are ui/Modal call sites.
//
// THE TABS AND THE SEARCH ARE KEPT even though the mockup draws neither. They
// exist today and this is a redesign: a church with four ministries and a dozen
// small groups needs to be able to say "just the small groups". They are
// restyled as the same pills the members roll uses rather than the old tab bar,
// so the two screens filter the same way.

const router = useRouter()
const { activeChurchId, activeChurchName, ensureLoaded } = useActiveChurch()
const { canManageSmallGroups, canSeeMemberDetail } = useCurrentRole()

const groups = ref([])
const assignments = ref(0)
const inNoGroup = ref(null)
const loading = ref(true)
const errorMessage = ref('')

const activeFilter = ref('all')
const search = ref('')

const formOpen = ref(false)
const formMode = ref('create')
const selectedGroup = ref(null)

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'Ministry', label: 'Ministries' },
  { key: 'Small Group', label: 'Small groups' }
]

const visible = computed(() => {
  const q = search.value.trim().toLowerCase()
  return groups.value
    .filter(g => activeFilter.value === 'all' || g.type === activeFilter.value)
    .filter(g => !q || g.name.toLowerCase().includes(q))
})

// Every bar in the grid is drawn against the same reference, so the cards can
// be compared with each other. Taken across ALL groups rather than the filtered
// set, so switching to "Small groups" does not silently rescale every bar.
const maxCount = computed(() =>
  groups.value.reduce((max, g) => Math.max(max, g.member_count), 0)
)

// "6 groups · 82 assignments · 41 members in none". The last clause is dropped
// entirely when the caller cannot read the roll — see countMembersInNoGroup;
// a zero there would read as "everyone is in a group", which is a different
// claim from "we could not tell".
const subtitle = computed(() => {
  const parts = [
    `${groups.value.length} ${groups.value.length === 1 ? 'group' : 'groups'}`,
    `${assignments.value} ${assignments.value === 1 ? 'assignment' : 'assignments'}`
  ]
  if (inNoGroup.value !== null) parts.push(`${inNoGroup.value} members in none`)
  return parts.join(' · ')
})

async function load () {
  if (!activeChurchId.value) return
  loading.value = true
  errorMessage.value = ''

  const result = await listGroups({
    churchId: activeChurchId.value,
    canSeeMembers: canSeeMemberDetail.value
  })

  if (!result.ok) {
    errorMessage.value = result.message
    groups.value = []
    assignments.value = 0
    inNoGroup.value = null
    loading.value = false
    return
  }

  groups.value = result.rows
  assignments.value = result.assignments
  inNoGroup.value = await countMembersInNoGroup({
    churchId: activeChurchId.value,
    assignedMemberIds: result.assignedMemberIds
  })
  loading.value = false
}

// A card now goes to the group's own page rather than opening a dialog (#76). The
// group is addressable, so it can be linked to and bookmarked, and the back button
// returns here — which is what a card that looks like a link has always implied.
function openGroup (group) {
  router.push({
    name: 'GroupDetail',
    params: { church: slugify(activeChurchName.value), group: slugify(group.name) }
  })
}

function openCreate () {
  if (!activeChurchId.value) {
    errorMessage.value = 'Cannot determine your church. Please reload.'
    return
  }
  selectedGroup.value = null
  formMode.value = 'create'
  formOpen.value = true
}

function onSaved ({ row, mode }) {
  if (mode === 'create') {
    groups.value = [...groups.value, { ...row, member_count: 0, sample_names: [] }]
    return
  }
  const i = groups.value.findIndex(g => g.id === row.id)
  if (i !== -1) {
    groups.value.splice(i, 1, { ...groups.value[i], ...row })
  }
  if (selectedGroup.value?.id === row.id) {
    selectedGroup.value = { ...selectedGroup.value, ...row }
  }
}

onMounted(async () => {
  await ensureLoaded()
  load()
})

watch(activeChurchId, () => {
  selectedGroup.value = null
  load()
})
</script>

<template>
  <div class="grp">
    <header
      class="grp__head anim-rise"
      style="--i: 0"
    >
      <div class="grp__title-block">
        <h1 class="grp__title">
          Ministries &amp; groups
        </h1>
        <p class="grp__sub">
          {{ subtitle }}
        </p>
      </div>
      <Button
        v-if="canManageSmallGroups"
        variant="primary"
        size="lg"
        @click="openCreate"
      >
        + New small group
      </Button>
    </header>

    <div
      class="grp__controls anim-rise"
      style="--i: 1"
    >
      <div class="grp__search">
        <Icon
          name="search"
          :size="16"
          class="grp__search-icon"
        />
        <input
          v-model="search"
          class="grp__search-input"
          type="search"
          placeholder="Search groups…"
          aria-label="Search groups"
        >
      </div>

      <div
        class="grp__pills"
        role="group"
        aria-label="Filter groups"
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

    <div
      v-if="loading"
      class="grp__grid"
    >
      <div
        v-for="n in 6"
        :key="n"
        class="skeleton grp__skeleton"
      />
    </div>

    <p
      v-else-if="errorMessage"
      class="grp__error"
    >
      {{ errorMessage }}
    </p>

    <div
      v-else-if="!visible.length"
      class="empty"
    >
      <span class="empty__tile"><Icon
        name="groups"
        :size="22"
      /></span>
      <h2 class="empty__title">
        <template v-if="search">
          Nothing matches “{{ search }}”
        </template>
        <template v-else-if="activeFilter !== 'all'">
          No {{ activeFilter === 'Ministry' ? 'ministries' : 'small groups' }} yet
        </template>
        <template v-else>
          No groups yet
        </template>
      </h2>
      <p class="empty__body">
        Small groups meet midweek, in homes. Ministries serve at services and are
        shared across every church.
      </p>
      <Button
        v-if="canManageSmallGroups"
        variant="primary"
        @click="openCreate"
      >
        + New small group
      </Button>
    </div>

    <div
      v-else
      class="grp__grid"
    >
      <GroupCard
        v-for="(g, i) in visible"
        :key="g.id"
        :group="g"
        :max-count="maxCount"
        :index="i"
        @open="openGroup"
      />
    </div>

    <!-- GroupDetailModal is gone (#76). A card opens the group's own page now, and the
         roster, add-members, rename and delete all live there. What is left here is
         creating a group, which belongs to the grid rather than to any one group. -->
    <GroupFormModal
      v-if="canManageSmallGroups"
      v-model:open="formOpen"
      :mode="formMode"
      :group="selectedGroup"
      :church-id="activeChurchId"
      @saved="onSaved"
    />

    <!-- Deleting moved to the group's page too: it is an action on one group, and the
         page is where a group's actions live now. -->
  </div>
</template>

<style scoped>
.grp { display: flex; flex-direction: column; gap: var(--sp-16); }

.grp__head { display: flex; align-items: flex-end; justify-content: space-between; gap: var(--sp-16); }
.grp__title-block { display: flex; flex-direction: column; gap: var(--sp-5); min-width: 0; }

.grp__title {
  font-size: var(--text-h1);
  font-weight: 800;
  letter-spacing: var(--tracking-h1);
  line-height: var(--leading-h1);
}

.grp__sub { font-size: var(--text-body); color: var(--ink-4); }

.grp__controls { display: flex; align-items: center; gap: var(--sp-10); flex-wrap: wrap; }

.grp__search { position: relative; display: flex; align-items: center; flex: 1; min-width: 240px; max-width: 360px; }
.grp__search-icon { position: absolute; left: var(--sp-12); color: var(--ink-5); pointer-events: none; }

.grp__search-input {
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
.grp__search-input::placeholder { color: var(--ink-5); }
.grp__search-input:focus { outline: 0; border-color: var(--accent-border-hi); box-shadow: var(--ring-focus); }

.grp__pills { display: flex; gap: var(--sp-8); flex-wrap: wrap; }

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
.pill.is-on { background: var(--accent); border-color: var(--accent); color: #fff; }

/* Three across at the design's width, and it degrades by available room rather
   than by breakpoint — a card stops being readable below about 260px. */
.grp__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--sp-16);
  align-items: start;
}

.grp__skeleton { height: 168px; border-radius: var(--r-card); }

.grp__error { padding: var(--sp-22); font-size: var(--text-body-sm); color: var(--magenta-deep); }

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
.empty__body { font-size: var(--text-body-sm); color: var(--ink-4); max-width: 42ch; line-height: 1.55; }

@media (max-width: 760px) {
  .grp__head { flex-direction: column; align-items: stretch; }
  .grp__search { max-width: none; }
}
</style>

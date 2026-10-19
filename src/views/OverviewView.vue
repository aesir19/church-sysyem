<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useActiveChurch } from '../composables/useActiveChurch'
import { useCurrentRole } from '../composables/useCurrentRole'
import { useCurrentUser } from '../composables/useCurrentUser'
import { fetchOpenService, fetchOverviewStats, fetchRecentServices } from '../lib/data/overview'
import { overviewMode, readOverviewChoice, saveOverviewChoice } from '../utils/overviewMode'
import OverviewPrototype from './overview-prototype/OverviewPrototype.vue'
import DGroupOverview from './overview-prototype/DGroupOverview.vue'

const { activeChurchId, activeChurchName } = useActiveChurch()
const { caps, loadPermissions } = useCurrentRole()
const { firstName, load: loadUser } = useCurrentUser()

// Which Overview: the D-Group view for a plain leader, a remembered Church | My D-Group
// switch for a leader with an elevated role, the church Overview for everyone else
// (docs/specs/d-group-leader-view.md). Decided once permissions are in, so a plain
// leader never sees the church Overview flash first.
const permissionsReady = ref(false)
const mode = computed(() => overviewMode(caps.value))
const choice = ref(readOverviewChoice())
const showDGroup = computed(() => mode.value === 'leader' || (mode.value === 'switch' && choice.value === 'dgroup'))

function choose (value) {
  choice.value = value
  saveOverviewChoice(value)
}

const loading = ref(true)
const failed = ref(false)
const counts = ref({ active: 0, archived: 0, joinedThisMonth: 0 })
const attention = ref({ noOneToOne: 0, notBaptized: 0, inNoGroup: 0 })
const services = ref([])
const openService = ref(null)
let loadGeneration = 0

const now = new Date()
const greetingDate = computed(() =>
  now.toLocaleDateString('en-PH', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  })
)

const greeting = computed(() => {
  const hour = now.getHours()
  const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  return firstName.value ? `${part}, ${firstName.value}` : part
})

async function load () {
  const generation = ++loadGeneration
  const churchId = activeChurchId.value
  failed.value = false
  counts.value = { active: 0, archived: 0, joinedThisMonth: 0 }
  attention.value = { noOneToOne: 0, notBaptized: 0, inNoGroup: 0 }
  services.value = []
  openService.value = null
  if (!churchId) {
    loading.value = false
    return
  }

  loading.value = true
  try {
    const [stats, recentServices, currentService] = await Promise.all([
      fetchOverviewStats(churchId),
      caps.value.canViewAttendance ? fetchRecentServices(churchId, 10) : Promise.resolve([]),
      caps.value.canViewAttendance ? fetchOpenService(churchId) : Promise.resolve(null)
    ])
    if (generation !== loadGeneration) return

    counts.value = {
      active: stats.active,
      archived: stats.archived,
      joinedThisMonth: stats.joinedThisMonth
    }
    attention.value = {
      noOneToOne: stats.noOneToOne,
      notBaptized: stats.notBaptized,
      inNoGroup: stats.inNoGroup
    }
    services.value = recentServices
    openService.value = currentService
  } catch {
    if (generation !== loadGeneration) return
    counts.value = { active: 0, archived: 0, joinedThisMonth: 0 }
    attention.value = { noOneToOne: 0, notBaptized: 0, inNoGroup: 0 }
    services.value = []
    openService.value = null
    failed.value = true
  } finally {
    if (generation === loadGeneration) loading.value = false
  }
}

onMounted(async () => {
  loadUser()
  await loadPermissions()
  permissionsReady.value = true
  if (mode.value !== 'leader') load()
})
watch(activeChurchId, () => { if (permissionsReady.value && mode.value !== 'leader') load() })
</script>

<template>
  <template v-if="permissionsReady">
    <div
      v-if="mode === 'switch'"
      class="view-switch"
    >
      <div
        class="seg"
        role="tablist"
        aria-label="Overview"
      >
        <button
          v-for="opt in [['church', 'Church'], ['dgroup', 'My D-Group']]"
          :key="opt[0]"
          type="button"
          role="tab"
          class="seg__opt"
          :class="{ 'is-on': choice === opt[0] }"
          :aria-selected="choice === opt[0]"
          @click="choose(opt[0])"
        >
          {{ opt[1] }}
        </button>
      </div>
    </div>

    <DGroupOverview v-if="showDGroup" />
    <OverviewPrototype
      v-else
      :greeting="greeting"
      :greeting-date="greetingDate"
      :church-name="activeChurchName"
      :counts="counts"
      :attention="attention"
      :services="services"
      :open-service="openService"
      :loading-overview="loading"
      :overview-error="failed"
    />
  </template>
</template>

<style scoped>
.view-switch { margin-bottom:var(--sp-16); }
.seg { display:inline-flex; gap:3px; padding:3px; border-radius:var(--r-control); background:var(--surface-subtle-2); }
.seg__opt { padding:7px 13px; border:none; background:none; border-radius:var(--r-inset); font-weight:700; font-size:var(--text-meta); color:var(--ink-5); cursor:pointer; }
.seg__opt.is-on { background:var(--surface); color:var(--ink); box-shadow:0 1px 2px rgba(16,24,40,.1); }
</style>

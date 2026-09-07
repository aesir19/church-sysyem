<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useActiveChurch } from '../composables/useActiveChurch'
import { useCurrentRole } from '../composables/useCurrentRole'
import { useCurrentUser } from '../composables/useCurrentUser'
import { fetchOpenService, fetchOverviewStats, fetchRecentServices } from '../lib/data/overview'
import OverviewPrototype from './overview-prototype/OverviewPrototype.vue'

const { activeChurchId, activeChurchName } = useActiveChurch()
const { caps } = useCurrentRole()
const { firstName, load: loadUser } = useCurrentUser()

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

onMounted(() => {
  loadUser()
  load()
})
watch(activeChurchId, load)
</script>

<template>
  <OverviewPrototype
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

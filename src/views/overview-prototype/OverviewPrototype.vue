<script setup>
// The selected Overview direction on the existing `/dashboard/overview` route.
// PROTOTYPE ONLY — the production build never mounts it until the data shape is signed off.
import { computed, onMounted, ref, watch } from 'vue'
import { useActiveChurch } from '../../composables/useActiveChurch'
import { useCurrentRole } from '../../composables/useCurrentRole'
import { listServiceOccurrences, listBirthdays, eventLocation } from '../../lib/data/events'
import { listCalendarOccurrences } from '../../lib/data/eventSeries'
import { listUnderstaffedEvents } from '../../lib/data/eventRoles'
import { expandHolidays } from '../../lib/holidays'
import { addDays } from '../../lib/recurrence'
import VariantA from './VariantA.vue'

const props = defineProps({
  greeting: { type: String, required: true },
  greetingDate: { type: String, required: true },
  churchName: { type: String, default: '' },
  counts: { type: Object, required: true },
  attention: { type: Object, required: true },
  services: { type: Array, required: true },
  openService: { type: Object, default: null },
  loadingOverview: { type: Boolean, default: false },
})

const { activeChurchId } = useActiveChurch()
const { canViewEvents } = useCurrentRole()
const loadingCalendar = ref(true)
const calendarError = ref(false)
const items = ref([])
const understaffed = ref([])

const lastService = computed(() => props.services[props.services.length - 1] || null)
const linkedItems = computed(() => items.value.map((item) => ({
  ...item,
  to: item.isHoliday || item.isBirthday || item.isService
    ? null
    : eventLocation(item, props.churchName, { name: canViewEvents.value ? 'EventDetail' : 'EventPublic' }),
})))
const linkedUnderstaffed = computed(() => understaffed.value.map((event) => ({
  ...event,
  to: eventLocation(event, props.churchName, { name: canViewEvents.value ? 'EventDetail' : 'EventPublic' }),
})))

async function loadCalendar() {
  const churchId = activeChurchId.value
  if (!churchId) { loadingCalendar.value = false; return }
  loadingCalendar.value = true
  calendarError.value = false
  const fromDate = new Date()
  fromDate.setHours(0, 0, 0, 0)
  const toDate = addDays(fromDate, 7)
  const from = fromDate.toISOString()
  const to = toDate.toISOString()

  try {
    const [events, schedules, birthdays, gaps] = await Promise.all([
      listCalendarOccurrences({ churchId, from, to }),
      listServiceOccurrences({ churchId, from, to }),
      listBirthdays({ churchId, from, to }),
      listUnderstaffedEvents({ churchId, withinDays: null, includeDrafts: true }),
    ])
    if (!events.ok) calendarError.value = true
    const merged = [
      ...(events.ok ? events.items : []),
      ...schedules,
      ...birthdays,
      ...expandHolidays(fromDate, toDate),
    ].filter((item) => item.status !== 'cancelled')
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))

    items.value = merged
    understaffed.value = gaps
  } catch {
    calendarError.value = true
    items.value = []
    understaffed.value = []
  } finally {
    loadingCalendar.value = false
  }
}

onMounted(loadCalendar)
watch(activeChurchId, loadCalendar)
</script>

<template>
  <VariantA
    :greeting="greeting"
    :greeting-date="greetingDate"
    :church-name="churchName"
    :counts="counts"
    :attention="attention"
    :items="linkedItems"
    :understaffed="linkedUnderstaffed"
    :last-service="lastService"
    :open-service="openService"
    :loading="loadingOverview || loadingCalendar"
    :calendar-error="calendarError"
  />
</template>

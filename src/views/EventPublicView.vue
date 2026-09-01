<script setup>
// The member's own event view — the mobile "I can serve" sheet (frame 7s). Spec #87,
// stories 36–38. Open to any signed-in member (no capability gate): RLS shows only a
// PUBLISHED event in their own church, so a draft or another church's event simply 404s
// here. It is deliberately lightweight — the facts, the roles with their fill counts (via
// the identity-free event_role_fill RPC, never the roster rows), an "I can serve" action
// that auto-accepts (Q3), and "add to my phone" (the per-event ICS). Restricted roles are
// not offerable and are not shown as tappable (Q7).

import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import Card from '../components/ui/Card.vue'
import Button from '../components/ui/Button.vue'
import Badge from '../components/ui/Badge.vue'
import Alert from '../components/ui/Alert.vue'
import Spinner from '../components/ui/Spinner.vue'
import { useToast } from '../composables/useToast'
import { findEventByDateTitle, parseEventSlug, slugify, kindLabel } from '../lib/data/events'
import { roleFill, offerToServe } from '../lib/data/eventRoles'
import { buildIcs, icsFilename } from '../lib/ics'
import { useActiveChurch } from '../composables/useActiveChurch'

const route = useRoute()
const { showToast } = useToast()
const { churches, ensureLoaded } = useActiveChurch()

const loading = ref(true)
const errorMsg = ref('')
const event = ref(null)
const roles = ref([])
const offering = ref(null)

async function load() {
  loading.value = true
  errorMsg.value = ''
  await ensureLoaded()
  // A member only ever reaches a real, published event here (the Calendar routes worked-out
  // occurrences to the privileged detail instead), so this resolves the church + slug to one row.
  const church = churches.value.find((c) => slugify(c.name) === slugify(route.params.church))
  const { date, titleSlug } = parseEventSlug(route.params.slug)
  const res = church
    ? await findEventByDateTitle({ churchId: church.id, date, titleSlug })
    : { event: null }
  if (!res.event || res.event.status !== 'published') {
    errorMsg.value = 'That event could not be found.'
    event.value = null
    loading.value = false
    return
  }
  event.value = res.event
  await loadRoles()
  loading.value = false
}

async function loadRoles() {
  const res = await roleFill({ eventId: event.value.id })
  roles.value = res.ok ? res.roles : []
}

async function serve(role) {
  offering.value = role.role_id
  const res = await offerToServe(role.role_id)
  offering.value = null
  if (!res.ok) { showToast(res.message, 'error'); return }
  showToast('You’re signed up — thank you for serving!')
  await loadRoles()
}

function downloadIcs() {
  const ics = buildIcs(event.value)
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = icsFilename(event.value.title)
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

const whenLabel = computed(() => {
  const e = event.value
  if (!e?.starts_at) return ''
  const start = new Date(e.starts_at)
  const date = start.toLocaleDateString('en-PH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const st = fmtTime(e.starts_at)
  const en = e.ends_at ? ` – ${fmtTime(e.ends_at)}` : ''
  return `${date} · ${st}${en}`
})
function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(':00', '')
}
function canServe(role) {
  return !role.requires_finance && role.filled < role.count_required
}

onMounted(load)
</script>

<template>
  <div class="pub">
    <div
      v-if="loading"
      class="pub__loading"
    >
      <Spinner label="Loading event" />
    </div>

    <Alert
      v-else-if="!event"
      tone="danger"
    >
      {{ errorMsg }}
    </Alert>

    <template v-else>
      <div class="pub__crumb">
        <RouterLink
          :to="{ name: 'Calendar' }"
          class="pub__crumb-link"
        >
          Calendar
        </RouterLink>
        <span>/</span><span class="pub__crumb-now">{{ event.title }}</span>
      </div>

      <header class="pub__head">
        <div class="pub__badges">
          <Badge tone="neutral">
            {{ kindLabel(event.kind) }}
          </Badge>
        </div>
        <h1 class="pub__title">
          {{ event.title }}
        </h1>
        <p class="pub__when">
          {{ whenLabel }}
        </p>
        <p
          v-if="event.location"
          class="pub__where"
        >
          {{ event.location }}
        </p>
      </header>

      <Card v-if="event.description">
        <p class="pub__desc">
          {{ event.description }}
        </p>
      </Card>

      <Card v-if="roles.length">
        <h2 class="pub__card-title">
          Roles
        </h2>
        <ul class="pub__roles">
          <li
            v-for="role in roles"
            :key="role.role_id"
            class="pub__role"
          >
            <span class="pub__role-body">
              <span class="pub__role-label">{{ role.label }}</span>
              <span class="pub__role-count">{{ role.filled }} of {{ role.count_required }} filled</span>
            </span>
            <Button
              v-if="canServe(role)"
              variant="primary"
              size="sm"
              :loading="offering === role.role_id"
              @click="serve(role)"
            >
              I can serve
            </Button>
            <Badge
              v-else-if="role.requires_finance"
              tone="accent"
            >
              Finance team
            </Badge>
            <Badge
              v-else
              tone="success"
            >
              Full
            </Badge>
          </li>
        </ul>
      </Card>

      <Button
        variant="secondary"
        @click="downloadIcs"
      >
        Add to my phone
      </Button>
    </template>
  </div>
</template>

<style scoped>
.pub { display: flex; flex-direction: column; gap: var(--sp-16); max-width: 560px; margin: 0 auto; }
.pub__loading { display: grid; place-items: center; min-height: 200px; }
.pub__crumb { display: flex; align-items: center; gap: var(--sp-6); font-size: var(--text-meta); color: var(--ink-5); font-weight: 600; }
.pub__crumb-link { color: var(--ink-5); text-decoration: none; }
.pub__crumb-now { color: var(--ink-3); }
.pub__badges { display: flex; gap: var(--sp-6); margin-bottom: var(--sp-8); }
.pub__title { margin: 0; font-size: var(--text-h1); font-weight: 800; letter-spacing: -0.03em; }
.pub__when { margin: var(--sp-6) 0 0; font-size: var(--text-body); color: var(--ink-3); font-weight: 600; }
.pub__where { margin: var(--sp-3) 0 0; font-size: var(--text-body-sm); color: var(--ink-5); }
.pub__desc { margin: 0; font-size: var(--text-body-sm); color: var(--ink-2); line-height: 1.55; }
.pub__card-title { margin: 0 0 var(--sp-10); font-size: var(--text-h3); font-weight: 800; letter-spacing: -0.02em; }
.pub__roles { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--sp-10); }
.pub__role { display: flex; align-items: center; gap: var(--sp-10); }
.pub__role-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.pub__role-label { font-size: var(--text-body-sm); font-weight: 700; }
.pub__role-count { font-size: var(--text-meta); color: var(--ink-5); }
</style>

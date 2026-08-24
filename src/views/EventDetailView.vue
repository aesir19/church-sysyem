<script setup>
// One event (frame 6b, Stage 1 cut — no Programme or Volunteer panels yet; Stage 3 #87).
// The five privileged roles read it, including a draft; only canManageEvents sees the
// action verb and the overflow. Header follows 5b: one verb in the corner, the rest in a
// menu. Publish (7e, no notify channels), Cancel (7h, keeps it on the calendar marked),
// and Delete (drafts only) are dialogs. "What this touches" shows the finance cross-links
// Stage 1 can already read; the write flows are Stage 3.

import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Card from '../components/ui/Card.vue'
import Button from '../components/ui/Button.vue'
import Badge from '../components/ui/Badge.vue'
import Modal from '../components/ui/Modal.vue'
import Alert from '../components/ui/Alert.vue'
import Spinner from '../components/ui/Spinner.vue'
import OverflowMenu from '../components/ui/OverflowMenu.vue'
import { useCurrentRole } from '../composables/useCurrentRole'
import { useToast } from '../composables/useToast'
import {
  getEvent, getEventLinks, kindLabel,
  publishEvent, cancelEvent, deleteEvent,
} from '../lib/data/events'

const route = useRoute()
const router = useRouter()
const { canManageEvents } = useCurrentRole()
const { showToast } = useToast()

const loading = ref(true)
const errorMsg = ref('')
const event = ref(null)
const links = ref({ expenses: [], collections: [] })

const publishOpen = ref(false)
const cancelOpen = ref(false)
const deleteOpen = ref(false)
const cancelReason = ref('')
const busy = ref(false)

const statusTone = { draft: 'warning', published: 'success', cancelled: 'magenta' }
const statusLabel = { draft: 'Draft', published: 'Published', cancelled: 'Cancelled' }

const isDraft = computed(() => event.value?.status === 'draft')
const isPublished = computed(() => event.value?.status === 'published')

// The overflow menu items — Edit always (writers), Cancel only for a published event,
// Delete only for a draft (a published event is cancelled, never deleted).
const menuItems = computed(() => {
  if (!canManageEvents.value || !event.value) return []
  const items = [{ key: 'edit', label: 'Edit', onSelect: goEdit }]
  if (isPublished.value) items.push({ key: 'cancel', label: 'Cancel this event', onSelect: () => (cancelOpen.value = true), danger: true, dividerBefore: true })
  if (isDraft.value) items.push({ key: 'delete', label: 'Delete draft', onSelect: () => (deleteOpen.value = true), danger: true, dividerBefore: true })
  return items
})

async function load() {
  loading.value = true
  errorMsg.value = ''
  const res = await getEvent(route.params.id)
  if (!res.event) { errorMsg.value = res.message || 'That event could not be found.'; loading.value = false; return }
  event.value = res.event
  links.value = await getEventLinks(event.value.id)
  loading.value = false
}
onMounted(load)

function goEdit() { router.push({ name: 'EventEdit', params: { id: event.value.id } }) }

async function doPublish() {
  busy.value = true
  const res = await publishEvent(event.value.id)
  busy.value = false
  publishOpen.value = false
  if (!res.ok) { errorMsg.value = res.message; return }
  event.value = res.rows[0]
  showToast('Event published to members')
}
async function doCancel() {
  busy.value = true
  const res = await cancelEvent(event.value.id, cancelReason.value.trim())
  busy.value = false
  cancelOpen.value = false
  if (!res.ok) { errorMsg.value = res.message; return }
  event.value = res.rows[0]
  showToast('Event cancelled')
}
async function doDelete() {
  busy.value = true
  const res = await deleteEvent(event.value.id)
  busy.value = false
  deleteOpen.value = false
  if (!res.ok) { errorMsg.value = res.message; return }
  showToast('Draft deleted')
  router.push({ name: 'Events' })
}

// --- formatting ---
function fmtWhen(e) {
  if (!e) return ''
  const start = new Date(e.starts_at)
  const date = start.toLocaleDateString('en-PH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const st = fmtTime(e.starts_at)
  const en = e.ends_at ? ` – ${fmtTime(e.ends_at)}` : ''
  const loc = e.location ? ` · ${e.location}` : ''
  return `${date} · ${st}${en}${loc}`
}
function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(':00', '')
}
function fmtDate(iso) { return iso ? new Date(iso).toLocaleDateString('en-PH', { day: 'numeric', month: 'short', year: 'numeric' }) : '' }
function peso(n) { return `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }

const history = computed(() => {
  if (!event.value) return []
  const h = [{ what: 'Event created', when: fmtDate(event.value.created_at) }]
  if (event.value.published_at) h.push({ what: 'Published to members', when: fmtDate(event.value.published_at) })
  if (event.value.status === 'cancelled') h.push({ what: 'Cancelled', when: fmtDate(event.value.updated_at) })
  return h
})
</script>

<template>
  <div class="det">
    <div
      v-if="loading"
      class="det__loading"
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
      <div class="det__crumb">
        <RouterLink
          :to="{ name: 'Events' }"
          class="det__crumb-link"
        >
          Events
        </RouterLink>
        <span>/</span><span class="det__crumb-now">{{ event.title }}</span>
      </div>

      <header class="det__head">
        <div class="det__head-main">
          <div class="det__title-row">
            <h1 class="det__title">
              {{ event.title }}
            </h1>
            <Badge :tone="statusTone[event.status] || 'neutral'">
              {{ statusLabel[event.status] || event.status }}
            </Badge>
            <Badge tone="neutral">
              {{ kindLabel(event.kind) }}
            </Badge>
          </div>
          <p class="det__when">
            {{ fmtWhen(event) }}
          </p>
        </div>
        <div
          v-if="canManageEvents"
          class="det__actions"
        >
          <OverflowMenu
            v-if="menuItems.length"
            :items="menuItems"
          />
          <Button
            v-if="isDraft"
            variant="primary"
            @click="publishOpen = true"
          >
            Publish to members
          </Button>
        </div>
      </header>

      <Alert
        v-if="errorMsg"
        tone="danger"
      >
        {{ errorMsg }}
      </Alert>

      <Alert
        v-if="isDraft"
        tone="warning"
      >
        Not visible to members yet. Publishing shows it on the members' calendar immediately.
      </Alert>
      <Alert
        v-if="event.status === 'cancelled' && event.cancel_reason"
        tone="magenta"
      >
        Cancelled — members are told: “{{ event.cancel_reason }}”
      </Alert>

      <div class="det__cols">
        <div class="det__col">
          <Card v-if="event.description">
            <h2 class="det__card-title">
              Details
            </h2>
            <p class="det__desc">
              {{ event.description }}
            </p>
          </Card>

          <Card>
            <h2 class="det__card-title">
              What this event touches
            </h2>
            <p class="det__muted">
              Attendance, a collection and an expense line are attached to this event by the teams that own them.
            </p>
            <ul
              v-if="links.expenses.length || links.collections.length"
              class="det__links"
            >
              <li
                v-for="x in links.expenses"
                :key="'ex-' + x.id"
                class="det__link"
              >
                <Badge tone="neutral">
                  Expense
                </Badge>
                <span class="det__link-title">{{ x.description }}</span>
                <span class="det__link-val">{{ peso(x.amount) }}</span>
              </li>
              <li
                v-for="c in links.collections"
                :key="'co-' + c.id"
                class="det__link"
              >
                <Badge tone="neutral">
                  Collection
                </Badge>
                <span class="det__link-title">Offering</span>
                <span class="det__link-val">{{ peso(c.amount) }}</span>
              </li>
            </ul>
            <p
              v-else
              class="det__muted det__muted--sm"
            >
              Nothing linked yet.
            </p>
          </Card>
        </div>

        <div class="det__col">
          <Card>
            <h2 class="det__card-title">
              Details
            </h2>
            <dl class="det__facts">
              <div class="det__fact">
                <dt>Kind</dt><dd>{{ kindLabel(event.kind) }}</dd>
              </div>
              <div
                v-if="event.run_by"
                class="det__fact"
              >
                <dt>Run by</dt><dd>{{ event.run_by }}</dd>
              </div>
              <div
                v-if="event.location"
                class="det__fact"
              >
                <dt>Where</dt><dd>{{ event.location }}</dd>
              </div>
              <div
                v-if="event.projected_budget != null"
                class="det__fact"
              >
                <dt>Projected budget</dt><dd>{{ peso(event.projected_budget) }}</dd>
              </div>
              <div class="det__fact">
                <dt>Visible to</dt><dd>{{ isPublished ? 'All members' : 'Not published' }}</dd>
              </div>
            </dl>
          </Card>

          <Card>
            <h2 class="det__card-title">
              History
            </h2>
            <ul class="det__history">
              <li
                v-for="(h, i) in history"
                :key="i"
                class="det__hist"
              >
                <span class="det__hist-bar" />
                <span class="det__hist-body">
                  <span class="det__hist-what">{{ h.what }}</span>
                  <span class="det__hist-when">{{ h.when }}</span>
                </span>
              </li>
            </ul>
          </Card>
        </div>
      </div>
    </template>

    <!-- Publish (7e, no notify channels in v1) -->
    <Modal
      v-model:open="publishOpen"
      title="Publish to members"
      description="Publishing shows this event on the members' calendar immediately."
    >
      <p class="det__dialog-text">
        <strong>{{ event?.title }}</strong> becomes visible to every member of this church right away. You can keep editing it afterwards.
      </p>
      <template #footer>
        <Button
          variant="secondary"
          @click="publishOpen = false"
        >
          Keep as draft
        </Button>
        <Button
          variant="primary"
          :loading="busy"
          @click="doPublish"
        >
          Publish
        </Button>
      </template>
    </Modal>

    <!-- Cancel a published event (7h): stays on the calendar, marked, with a reason -->
    <Modal
      v-model:open="cancelOpen"
      title="Cancel this event?"
      description="The event stays on the calendar marked cancelled, so nobody arrives to an empty room."
      icon="alert"
      icon-tone="magenta"
      layout="stack"
      :close-on-outside-click="false"
    >
      <label class="det__field">
        <span class="det__label">Reason — members will see this</span>
        <textarea
          v-model="cancelReason"
          class="det__textarea"
          rows="2"
          placeholder="e.g. Moved to next week so it does not clash with the anniversary."
        />
      </label>
      <template #footer>
        <Button
          variant="secondary"
          @click="cancelOpen = false"
        >
          Keep the event
        </Button>
        <Button
          variant="danger"
          :loading="busy"
          @click="doCancel"
        >
          Cancel it
        </Button>
      </template>
    </Modal>

    <!-- Delete a draft -->
    <Modal
      v-model:open="deleteOpen"
      title="Delete this draft?"
      description="This removes the draft entirely. It has never been visible to members."
      icon="alert"
      icon-tone="magenta"
      layout="stack"
      :close-on-outside-click="false"
    >
      <p class="det__dialog-text">
        <strong>{{ event?.title }}</strong> will be permanently deleted. This cannot be undone.
      </p>
      <template #footer>
        <Button
          variant="secondary"
          @click="deleteOpen = false"
        >
          Keep it
        </Button>
        <Button
          variant="danger"
          :loading="busy"
          @click="doDelete"
        >
          Delete draft
        </Button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.det { display: flex; flex-direction: column; gap: var(--sp-16); }
.det__loading { display: grid; place-items: center; min-height: 200px; }
.det__crumb { display: flex; align-items: center; gap: var(--sp-6); font-size: var(--text-meta); color: var(--ink-5); font-weight: 600; }
.det__crumb-link { color: var(--ink-5); text-decoration: none; }
.det__crumb-link:hover { color: var(--accent); }
.det__crumb-now { color: var(--ink-3); }

.det__head { display: flex; align-items: flex-end; justify-content: space-between; gap: var(--sp-16); flex-wrap: wrap; }
.det__title-row { display: flex; align-items: center; gap: var(--sp-10); flex-wrap: wrap; }
.det__title { margin: 0; font-size: var(--text-h1); font-weight: 800; letter-spacing: -0.03em; }
.det__when { margin: var(--sp-6) 0 0; font-size: var(--text-body); color: var(--ink-5); }
.det__actions { display: flex; align-items: center; gap: var(--sp-9); }

.det__cols { display: grid; grid-template-columns: 1fr 380px; gap: var(--sp-16); align-items: start; }
.det__col { display: flex; flex-direction: column; gap: var(--sp-16); }
.det__card-title { margin: 0 0 var(--sp-8); font-size: var(--text-h3); font-weight: 800; letter-spacing: -0.02em; }
.det__desc { margin: 0; font-size: var(--text-body-sm); color: var(--ink-2); line-height: 1.55; }
.det__muted { margin: 0; font-size: var(--text-body-sm); color: var(--ink-5); line-height: 1.55; }
.det__muted--sm { margin-top: var(--sp-10); font-size: var(--text-meta); }

.det__links { list-style: none; margin: var(--sp-12) 0 0; padding: 0; display: flex; flex-direction: column; gap: var(--sp-8); }
.det__link { display: flex; align-items: center; gap: var(--sp-10); padding: var(--sp-8) 0; border-bottom: 1px solid var(--border-subtle, var(--border)); }
.det__link:last-child { border-bottom: none; }
.det__link-title { flex: 1; min-width: 0; font-size: var(--text-body-sm); font-weight: 600; }
.det__link-val { font-size: var(--text-body-sm); font-weight: 700; font-variant-numeric: tabular-nums; }

.det__facts { margin: 0; }
.det__fact { display: flex; align-items: baseline; justify-content: space-between; gap: var(--sp-14); padding: var(--sp-9) 0; border-bottom: 1px solid var(--border-subtle, var(--border)); }
.det__fact:last-child { border-bottom: none; }
.det__fact dt { font-size: var(--text-meta); color: var(--ink-5); }
.det__fact dd { margin: 0; font-size: var(--text-body-sm); font-weight: 700; text-align: right; }

.det__history { list-style: none; margin: 0; padding: 0; }
.det__hist { display: flex; gap: var(--sp-10); padding: var(--sp-9) 0; }
.det__hist-bar { width: 4px; flex: none; border-radius: var(--r-pill); background: var(--accent); margin: 3px 0; }
.det__hist-body { display: flex; flex-direction: column; line-height: 1.4; }
.det__hist-what { font-size: var(--text-body-sm); color: var(--ink-2); }
.det__hist-when { font-size: var(--text-meta); color: var(--ink-5); }

.det__dialog-text { margin: 0; font-size: var(--text-body-sm); color: var(--ink-2); line-height: 1.55; }
.det__field { display: flex; flex-direction: column; gap: var(--sp-6); }
.det__label { font-size: var(--text-meta); font-weight: 700; color: var(--ink-3); }
.det__textarea { padding: 10px 12px; border: 1px solid var(--border-strong); border-radius: var(--r-control); background: var(--surface); font-family: inherit; font-size: var(--text-body-sm); color: var(--ink); resize: vertical; }

@media (max-width: 860px) {
  .det__cols { grid-template-columns: 1fr; }
}
</style>

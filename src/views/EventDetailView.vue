<script setup>
// One event (frame 6b, Stage 1 cut — no Programme or Volunteer panels yet; Stage 3 #87).
// The five privileged roles read it, including a draft; only canManageEvents sees the
// action verb and the overflow. Header follows 5b: one verb in the corner, the rest in a
// menu. Publish (7e, no notify channels), Cancel (7h, keeps it on the calendar marked),
// and Delete (drafts only) are dialogs. "What this touches" shows the finance cross-links
// Stage 1 can already read; the write flows are Stage 3.

import { ref, computed, onMounted, watch } from 'vue'
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
  getEventLinks, kindLabel, findEventByDateTitle, parseEventSlug, slugify,
  publishEvent, cancelEvent, deleteEvent,
} from '../lib/data/events'
import {
  getSeries, listSeries, skipOccurrence, deleteSeries, countKeptPast,
} from '../lib/data/eventSeries'
import { describeRule, expandSeries, ymd } from '../lib/recurrence'
import { useActiveChurch } from '../composables/useActiveChurch'
import EventRosterPanel from '../components/events/EventRosterPanel.vue'
import EventProgrammePanel from '../components/events/EventProgrammePanel.vue'
import EventCloseoutPanel from '../components/events/EventCloseoutPanel.vue'
import { buildIcs, icsFilename } from '../lib/ics'

const route = useRoute()
const router = useRouter()
const { canManageEvents } = useCurrentRole()
const { churches, activeChurchId, ensureLoaded, setActiveChurch } = useActiveChurch()
const { showToast } = useToast()

const loading = ref(true)
const errorMsg = ref('')
const event = ref(null)
const links = ref({ expenses: [], collections: [] })
// The roster panel reports its filled/needed totals up, so the draft banner can say how many
// roles still need filling before publish (6b's "N of M volunteer roles are unfilled").
const rosterTotals = ref({ filled: 0, needed: 0 })
const unfilledRoles = computed(() => Math.max(0, rosterTotals.value.needed - rosterTotals.value.filled))
// When this detail is an occurrence of a repeating series, the series it belongs to and the
// specific date. A "virtual" occurrence has no saved row yet — it is worked out from the rule.
const series = ref(null)
const occurrenceDate = ref(null)
const isVirtualOccurrence = ref(false)

const publishOpen = ref(false)
const cancelOpen = ref(false)
const deleteOpen = ref(false)
const skipOpen = ref(false)
const deleteSeriesOpen = ref(false)
const cancelReason = ref('')
const skipReason = ref('')
const deleteConfirmText = ref('')
const busy = ref(false)

const statusTone = { draft: 'warning', published: 'success', cancelled: 'magenta' }
const statusLabel = { draft: 'Draft', published: 'Published', cancelled: 'Cancelled' }

const isDraft = computed(() => event.value?.status === 'draft')
const isPublished = computed(() => event.value?.status === 'published')
const isSeriesOccurrence = computed(() => !!series.value)
// A real, saved events row — the Stage-3 panels (roster/programme/closeout) attach to one,
// so a worked-out series occurrence (synthetic id, no DB row) does not show them.
const isRealEvent = computed(() =>
  !!event.value && !isVirtualOccurrence.value && !String(event.value.id).startsWith('series-'))
// Happened = a non-draft event whose start is in the past → the closeout panel appears (7o).
const hasHappened = computed(() => {
  if (!event.value?.starts_at || event.value.status === 'draft') return false
  return new Date(event.value.starts_at).getTime() < Date.now()
})

/** The single-event ICS download (stories 38/39) — built in the browser, no server. */
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
const seriesRuleText = computed(() => series.value ? describeRule(series.value) : '')
// The past is frozen: an occurrence that has already happened offers no change/skip actions.
const isPastOccurrence = computed(() => {
  if (!occurrenceDate.value) return false
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return new Date(`${occurrenceDate.value}T00:00:00`) < today
})

// The overflow menu items depend on what this is:
//   - a one-off event: Edit; Cancel (published) or Delete (draft).
//   - an occurrence of a series: change this date, skip this date, edit the whole series, or
//     delete the whole series — the Stage-2 actions (frames 7d, 7h, 7i).
const menuItems = computed(() => {
  if (!canManageEvents.value || !event.value) return []
  if (isSeriesOccurrence.value) {
    const items = []
    // A past date is frozen — no change/skip, only whole-series actions that reach forward.
    if (!isPastOccurrence.value) {
      items.push({ key: 'edit-date', label: 'Change this date', onSelect: goEditOccurrence })
      items.push({ key: 'skip', label: 'Cancel this date', onSelect: () => (skipOpen.value = true), danger: true, dividerBefore: true })
    }
    items.push({ key: 'edit-series', label: 'Edit the whole series', onSelect: goEditSeries, dividerBefore: items.length > 0 })
    items.push({ key: 'delete-series', label: 'Delete the whole series', onSelect: openDeleteSeries, danger: true })
    return items
  }
  const items = [{ key: 'edit', label: 'Edit', onSelect: goEdit }]
  if (isPublished.value) items.push({ key: 'cancel', label: 'Cancel this event', onSelect: () => (cancelOpen.value = true), danger: true, dividerBefore: true })
  if (isDraft.value) items.push({ key: 'delete', label: 'Delete draft', onSelect: () => (deleteOpen.value = true), danger: true, dividerBefore: true })
  return items
})

// The URL is authoritative (as in GroupDetailView): /events/<church>/<date>-<title>. The church
// segment resolves to a church the caller can see and switches the active church so a shared link
// lands even when the selector points elsewhere; a church slug they cannot see matches nothing and
// falls through to the same not-found as any invisible event.
async function load() {
  loading.value = true
  errorMsg.value = ''
  event.value = null
  series.value = null
  occurrenceDate.value = null
  isVirtualOccurrence.value = false

  await ensureLoaded()
  const wantedChurch = churches.value.find((c) => slugify(c.name) === slugify(route.params.church))
  if (!wantedChurch) { errorMsg.value = 'That event could not be found.'; loading.value = false; return }
  if (wantedChurch.id !== activeChurchId.value) setActiveChurch(wantedChurch.id)

  const { date, titleSlug } = parseEventSlug(route.params.slug)

  // 1) A real row: a one-off event, a dateless draft, or a materialised series exception.
  const real = await findEventByDateTitle({ churchId: wantedChurch.id, date, titleSlug })
  if (real.event) {
    event.value = real.event
    if (real.event.series_id) {
      occurrenceDate.value = real.event.occurrence_date
      const sres = await getSeries(real.event.series_id)
      if (sres.series) series.value = sres.series
    }
    links.value = await getEventLinks(real.event.id)
    loading.value = false
    return
  }

  // 2) A worked-out (virtual) occurrence — no row, so it is found by matching a series title in
  // the church and confirming the rule actually lands on this date.
  if (date) {
    const sres = await listSeries({ churchId: wantedChurch.id })
    const s = (sres.series ?? []).find((x) => slugify(x.title) === titleSlug)
    if (s) {
      const dayFrom = new Date(`${date}T00:00:00`)
      const dayTo = new Date(dayFrom); dayTo.setDate(dayTo.getDate() + 1)
      if (expandSeries(s, dayFrom, dayTo).some((d) => ymd(d) === date)) {
        return loadVirtualOccurrence({ series: s, date })
      }
    }
  }

  errorMsg.value = 'That event could not be found.'
  loading.value = false
}

function loadVirtualOccurrence({ series: s, date }) {
  series.value = s
  occurrenceDate.value = date
  isVirtualOccurrence.value = true
  const startsAt = new Date(`${date}T${s.timeStart}:00`)
  const endsAt = s.timeEnd ? new Date(`${date}T${s.timeEnd}:00`) : null
  event.value = {
    id: `series-${s.id}-${date}`,
    church_id: s.church_id, title: s.title, kind: s.kind, status: 'published',
    starts_at: startsAt.toISOString(), ends_at: endsAt ? endsAt.toISOString() : null,
    location: s.location, description: s.description, run_by: s.run_by,
    projected_budget: s.projected_budget, series_id: s.id, occurrence_date: date,
  }
  links.value = { expenses: [], collections: [] }
  loading.value = false
}
onMounted(load)
// A link from one event straight to another keeps this component mounted, so reload on the path.
watch(() => [route.params.church, route.params.slug], load)

function goEdit() { router.push({ name: 'EventEdit', params: { id: event.value.id } }) }
function goEditOccurrence() { router.push({ name: 'EventNew', query: { series: series.value.id, date: occurrenceDate.value } }) }
function goEditSeries() { router.push({ name: 'EventNew', query: { series: series.value.id } }) }

async function doSkip() {
  busy.value = true
  const res = await skipOccurrence({ series: series.value, occurrenceDate: occurrenceDate.value, reason: skipReason.value.trim() || null })
  busy.value = false
  skipOpen.value = false
  if (!res.ok) { errorMsg.value = res.message; return }
  showToast('That date was cancelled')
  router.push({ name: 'Calendar' })
}

// The honest "kept" figure is how many PAST dates actually have a saved record — unmaterialised
// past dates are purely worked-out and leave nothing behind. Fetched when the dialog opens.
const keptPastCount = ref(0)
async function openDeleteSeries() {
  keptPastCount.value = await countKeptPast({ seriesId: series.value.id })
  deleteConfirmText.value = ''
  deleteSeriesOpen.value = true
}
const deleteConfirmed = computed(() => deleteConfirmText.value.trim() === (series.value?.title || '').trim())

async function doDeleteSeries() {
  if (!deleteConfirmed.value) return
  busy.value = true
  const res = await deleteSeries({ seriesId: series.value.id })
  busy.value = false
  deleteSeriesOpen.value = false
  if (!res.ok) { errorMsg.value = res.message; return }
  showToast('Repeating event deleted')
  router.push({ name: 'Events' })
}

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
  if (!event.value || !event.value.created_at) return []
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
            <Badge
              v-if="isSeriesOccurrence"
              tone="accent"
            >
              ⟳ Series
            </Badge>
          </div>
          <p class="det__when">
            {{ fmtWhen(event) }}
          </p>
        </div>
        <div class="det__actions">
          <Button
            v-if="isRealEvent && event.starts_at"
            variant="secondary"
            @click="downloadIcs"
          >
            Add to calendar
          </Button>
          <OverflowMenu
            v-if="canManageEvents && menuItems.length"
            :items="menuItems"
          />
          <Button
            v-if="canManageEvents && isDraft"
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
        v-if="isSeriesOccurrence"
        tone="accent"
      >
        This is one date of a repeating event — <strong>{{ seriesRuleText }}</strong>. Changing it lets you choose whether the change is for this date only or the ones after it.
      </Alert>
      <Alert
        v-if="isDraft"
        tone="warning"
      >
        <strong>Not visible to members yet.</strong>
        <template v-if="unfilledRoles">
          {{ unfilledRoles }} of {{ rosterTotals.needed }} volunteer role{{ rosterTotals.needed === 1 ? '' : 's' }} still {{ unfilledRoles === 1 ? 'needs' : 'need' }} filling. Publishing shows it on the members' calendar immediately.
        </template>
        <template v-else>
          Publishing shows it on the members' calendar immediately.
        </template>
      </Alert>
      <Alert
        v-if="event.status === 'cancelled' && event.cancel_reason"
        tone="magenta"
      >
        Cancelled — members are told: “{{ event.cancel_reason }}”
      </Alert>

      <EventCloseoutPanel
        v-if="isRealEvent && hasHappened"
        :event="event"
        :can-manage="canManageEvents"
        @updated="load"
      />

      <div class="det__cols">
        <!-- Left column follows 6b: Programme first, then the volunteer roster. -->
        <div class="det__col">
          <template v-if="isRealEvent">
            <EventProgrammePanel
              :event="event"
              :can-manage="canManageEvents"
            />
            <EventRosterPanel
              :event="event"
              :can-manage="canManageEvents"
              @totals="rosterTotals = $event"
            />
          </template>
          <!-- A worked-out series occurrence has no panels; show its description here so the
               left column is not empty. -->
          <Card v-else-if="event.description">
            <h2 class="det__card-title">
              Details
            </h2>
            <p class="det__desc">
              {{ event.description }}
            </p>
          </Card>
        </div>

        <!-- Right column follows 6b: About, Details, What this event touches, History. -->
        <div class="det__col">
          <Card v-if="event.description && isRealEvent">
            <h2 class="det__card-title">
              About
            </h2>
            <p class="det__desc">
              {{ event.description }}
            </p>
          </Card>

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

    <!-- Cancel ONE date of a series (a typhoon week). Greys the date out; the rest carry on. -->
    <Modal
      v-model:open="skipOpen"
      title="Cancel this date?"
      description="Only this one date is cancelled. Every other date in the series carries on."
      icon="alert"
      icon-tone="magenta"
      layout="stack"
      :close-on-outside-click="false"
    >
      <label class="det__field">
        <span class="det__label">Reason — members will see this</span>
        <textarea
          v-model="skipReason"
          class="det__textarea"
          rows="2"
          placeholder="e.g. Cancelled this week — typhoon."
        />
      </label>
      <template #footer>
        <Button
          variant="secondary"
          @click="skipOpen = false"
        >
          Keep the date
        </Button>
        <Button
          variant="danger"
          :loading="busy"
          @click="doSkip"
        >
          Cancel this date
        </Button>
      </template>
    </Modal>

    <!-- Delete the WHOLE series (frame 7i): future dates go, past dates and their attendance are
         kept, and the name must be typed to confirm. -->
    <Modal
      v-model:open="deleteSeriesOpen"
      title="Delete this repeating event?"
      description="Upcoming dates are removed. Past dates and any attendance already taken are kept."
      icon="alert"
      icon-tone="magenta"
      layout="stack"
      :close-on-outside-click="false"
    >
      <p class="det__dialog-text">
        This stops <strong>{{ series?.title }}</strong> repeating — all its upcoming dates will no longer appear on the calendar.
        <template v-if="keptPastCount">
          Its <strong>{{ keptPastCount }}</strong> past date{{ keptPastCount === 1 ? '' : 's' }} with records (attendance) {{ keptPastCount === 1 ? 'is' : 'are' }} kept.
        </template>
        <template v-else>
          No past dates have records, so nothing is left behind.
        </template>
        This cannot be undone.
      </p>
      <label class="det__field">
        <span class="det__label">Type <strong>{{ series?.title }}</strong> to confirm</span>
        <input
          v-model="deleteConfirmText"
          class="det__input"
          type="text"
          :placeholder="series?.title"
        >
      </label>
      <template #footer>
        <Button
          variant="secondary"
          @click="deleteSeriesOpen = false"
        >
          Keep it
        </Button>
        <Button
          variant="danger"
          :disabled="!deleteConfirmed"
          :loading="busy"
          @click="doDeleteSeries"
        >
          Delete the series
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

.det__cols { display: grid; grid-template-columns: 1fr 400px; gap: var(--sp-16); align-items: start; }
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
.det__input { padding: 10px 12px; border: 1px solid var(--border-strong); border-radius: var(--r-control); background: var(--surface); font-family: inherit; font-size: var(--text-body-sm); font-weight: 600; color: var(--ink); }

@media (max-width: 860px) {
  .det__cols { grid-template-columns: 1fr; }
}
</style>

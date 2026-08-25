<script setup>
// New / edit event OR repeating series (frames 6c, 7d — Stage 2, #86). Route-gated by
// canManageEvents. The form is one screen with an optional "Repeats" section; whether a save
// writes a one-off event, a whole series, or a single occurrence is decided by the mode:
//
//   new, repeat off        → createEvent   (a one-off, unchanged from Stage 1)
//   new, repeat on         → createSeries  (a repeating series)
//   ?id=…                  → updateEvent   (edit the one-off)
//   ?series=…              → updateSeries  (edit the whole rule / shared fields)
//   ?series=…&date=…       → edit ONE occurrence, with the scope choice the owner asked for:
//                            "This date only" → editOccurrence (an exception row), or
//                            "…and the ones after" → splitSeries (end the old rule, start a new
//                            one), prompting first if a later date was specially adjusted.
// Past dates are never rewritten — the scope choices only ever touch this date forward.

import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Card from '../components/ui/Card.vue'
import Button from '../components/ui/Button.vue'
import Alert from '../components/ui/Alert.vue'
import Modal from '../components/ui/Modal.vue'
import Spinner from '../components/ui/Spinner.vue'
import { useActiveChurch } from '../composables/useActiveChurch'
import { useToast } from '../composables/useToast'
import { EVENT_KINDS, createEvent, updateEvent, getEvent } from '../lib/data/events'
import {
  createSeries, updateSeries, getSeries, editOccurrence, splitSeries,
  ruleColumns, countFutureExceptions,
} from '../lib/data/eventSeries'
import { describeRule } from '../lib/recurrence'

const route = useRoute()
const router = useRouter()
const { activeChurchId, ensureLoaded } = useActiveChurch()
const { showToast } = useToast()

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const NTHS = [{ v: 1, l: 'first' }, { v: 2, l: 'second' }, { v: 3, l: 'third' }, { v: 4, l: 'fourth' }, { v: -1, l: 'last' }]

// --- mode -----------------------------------------------------------------
const editId = computed(() => route.params.id || null)
const seriesId = computed(() => route.query.series || null)
const occDate = computed(() => route.query.date || null)
const isOneOffEdit = computed(() => !!editId.value)
const isSeriesEdit = computed(() => !!seriesId.value && !occDate.value)
const isOccurrenceEdit = computed(() => !!seriesId.value && !!occDate.value)
const isNew = computed(() => !isOneOffEdit.value && !seriesId.value)

const loading = ref(false)
const saving = ref(false)
const errorMsg = ref('')
const wasPublished = ref(false)
const loadedSeries = ref(null)

const form = ref({
  title: '', kind: 'service', date: '', starts: '', ends: '',
  location: '', run_by: '', description: '', projected_budget: '',
  // repeat
  repeats: false,
  cadence: 'weekly', intervalN: 1, anchor: 'weekday',
  weekOfMonth1: 'auto',
  dayOfMonth2: '', weekday2: 0, weekOfMonth2: 1,
  endMode: 'never', endsOn: '', countN: '',
  // occurrence scope
  scope: 'this',
})

// The scope-confirm for "…and the ones after" when a later date was specially adjusted.
const splitConfirmOpen = ref(false)
const futureExceptionCount = ref(0)

onMounted(async () => {
  await ensureLoaded()
  if (isOneOffEdit.value) return loadOneOff()
  if (seriesId.value) return loadSeries()
})

async function loadOneOff() {
  loading.value = true
  const res = await getEvent(editId.value)
  if (res.event) {
    const e = res.event
    wasPublished.value = e.status === 'published'
    form.value = { ...form.value,
      title: e.title, kind: e.kind,
      date: e.starts_at ? e.starts_at.slice(0, 10) : '',
      starts: e.starts_at ? toTimeInput(e.starts_at) : '',
      ends: e.ends_at ? toTimeInput(e.ends_at) : '',
      location: e.location || '', run_by: e.run_by || '',
      description: e.description || '', projected_budget: e.projected_budget ?? '',
    }
  } else { errorMsg.value = res.message }
  loading.value = false
}

async function loadSeries() {
  loading.value = true
  const res = await getSeries(seriesId.value)
  if (!res.series) { errorMsg.value = res.message; loading.value = false; return }
  const s = res.series
  loadedSeries.value = s
  wasPublished.value = s.status === 'published'
  form.value = { ...form.value,
    title: s.title, kind: s.kind,
    // Occurrence edit sits on that date; whole-series edit sits on the series start.
    date: isOccurrenceEdit.value ? occDate.value : s.startsOn,
    starts: s.timeStart || '', ends: s.timeEnd || '',
    location: s.location || '', run_by: s.run_by || '',
    description: s.description || '', projected_budget: s.projected_budget ?? '',
    repeats: true,
    cadence: s.cadence, intervalN: s.intervalN || 1, anchor: s.anchor || 'weekday',
    weekOfMonth1: (s.cadence === 'monthly' && s.anchor === 'weekday' && s.weekOfMonth != null) ? s.weekOfMonth : 'auto',
    dayOfMonth2: s.dayOfMonth2 ?? '', weekday2: s.weekday2 ?? 0, weekOfMonth2: s.weekOfMonth2 ?? 1,
    endMode: s.endsOn ? 'on' : s.countN ? 'after' : 'never',
    endsOn: s.endsOn || '', countN: s.countN ?? '',
    scope: 'this',
  }
  loading.value = false
}

const canSubmit = computed(() => form.value.title.trim() && form.value.date && form.value.starts)

// The past is frozen (owner's rule; #86 story 12): a date that has already happened cannot be
// edited or split, because splitting from it would rewrite history. Blocks the occurrence editor.
const isPastOccurrence = computed(() => {
  if (!isOccurrenceEdit.value || !occDate.value) return false
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return new Date(`${occDate.value}T00:00:00`) < today
})

// --- rule building --------------------------------------------------------
function nthOfDate(d) { return Math.ceil(d.getDate() / 7) }

function buildRule() {
  const d = new Date(`${form.value.date}T00:00:00`)
  const rule = {
    cadence: form.value.cadence,
    intervalN: Number(form.value.intervalN) || 1,
    anchor: form.value.cadence === 'weekly' ? null : form.value.anchor,
    weekday: null, weekOfMonth: null, dayOfMonth: null,
    weekday2: null, weekOfMonth2: null, dayOfMonth2: null,
    timeStart: form.value.starts,
    timeEnd: form.value.ends || null,
    startsOn: form.value.date,
    endsOn: form.value.endMode === 'on' ? (form.value.endsOn || null) : null,
    countN: form.value.endMode === 'after' ? (Number(form.value.countN) || null) : null,
  }
  if (rule.cadence === 'weekly') {
    rule.weekday = d.getDay()
  } else if (rule.cadence === 'monthly' && rule.anchor === 'date') {
    rule.dayOfMonth = d.getDate()
  } else if (rule.cadence === 'monthly') {
    // "Auto" tracks whichever nth the chosen date is; an explicit pick (incl. "last", -1) lets
    // a "last Saturday" series exist even though the date lands on the 4th.
    rule.weekday = d.getDay()
    rule.weekOfMonth = form.value.weekOfMonth1 === 'auto' ? nthOfDate(d) : Number(form.value.weekOfMonth1)
  } else if (rule.cadence === 'twice_monthly' && rule.anchor === 'date') {
    rule.dayOfMonth = d.getDate()
    rule.dayOfMonth2 = Number(form.value.dayOfMonth2) || d.getDate()
  } else if (rule.cadence === 'twice_monthly') {
    rule.weekday = d.getDay(); rule.weekOfMonth = nthOfDate(d)
    rule.weekday2 = Number(form.value.weekday2); rule.weekOfMonth2 = Number(form.value.weekOfMonth2)
  }
  return rule
}

// Live plain-words preview of the repeat, so the writer reads what they are about to make.
const rulePreview = computed(() => {
  if (!form.value.repeats || !form.value.date || !form.value.starts) return ''
  try { return describeRule(buildRule()) } catch { return '' }
})

function sharedFields() {
  return {
    church_id: activeChurchId.value,
    title: form.value.title.trim(),
    kind: form.value.kind,
    location: form.value.location.trim() || null,
    run_by: form.value.run_by.trim() || null,
    description: form.value.description.trim() || null,
    projected_budget: form.value.projected_budget === '' ? null : Number(form.value.projected_budget),
  }
}

function eventPayload() {
  const startsAt = new Date(`${form.value.date}T${form.value.starts}`).toISOString()
  const endsAt = form.value.ends ? new Date(`${form.value.date}T${form.value.ends}`).toISOString() : null
  const { church_id, title, kind, location, run_by, description, projected_budget } = sharedFields()
  return { church_id, title, kind, starts_at: startsAt, ends_at: endsAt, location, run_by, description, projected_budget }
}

function seriesPayload() {
  return { ...sharedFields(), ...ruleColumns(buildRule()) }
}

// --- submit ---------------------------------------------------------------
async function submit(publish) {
  if (!canSubmit.value || saving.value) return
  errorMsg.value = ''

  if (isOccurrenceEdit.value) return submitOccurrence()

  saving.value = true
  let res
  if (isSeriesEdit.value) {
    res = await updateSeries(seriesId.value, publish && !wasPublished.value
      ? { ...seriesPayload(), status: 'published', published_at: new Date().toISOString() }
      : seriesPayload())
  } else if (isNew.value && form.value.repeats) {
    res = await createSeries(seriesPayload(), { publish })
  } else if (isNew.value) {
    res = await createEvent(eventPayload(), { publish })
  } else {
    // one-off edit
    res = await updateEvent(editId.value, publish && !wasPublished.value
      ? { ...eventPayload(), status: 'published', published_at: new Date().toISOString() }
      : eventPayload())
  }
  saving.value = false
  if (!res.ok) { errorMsg.value = res.message; return }

  showToast(publish ? 'Saved and published' : 'Saved as draft')
  const saved = res.rows[0]
  if (form.value.repeats || isSeriesEdit.value) router.push({ name: 'Events' })
  else router.push(saved?.id ? { name: 'EventDetail', params: { id: saved.id } } : { name: 'Events' })
}

async function submitOccurrence() {
  if (isPastOccurrence.value) {
    errorMsg.value = 'That date has already happened, so it can’t be changed.'
    return
  }
  if (form.value.scope === 'after') {
    // Splitting the rule from this date. Warn first if a later date was specially adjusted.
    futureExceptionCount.value = await countFutureExceptions({ seriesId: seriesId.value, fromDate: occDate.value })
    if (futureExceptionCount.value > 0) { splitConfirmOpen.value = true; return }
    return doSplit(false)
  }
  // "This date only" — a single exception row, everything else untouched.
  saving.value = true
  const res = await editOccurrence({ series: loadedSeries.value, occurrenceDate: occDate.value, payload: eventPayload() })
  saving.value = false
  if (!res.ok) { errorMsg.value = res.message; return }
  showToast('This date updated')
  router.push({ name: 'Events' })
}

async function doSplit(overwriteExceptions) {
  splitConfirmOpen.value = false
  saving.value = true
  const res = await splitSeries({
    oldSeriesId: seriesId.value,
    fromDate: occDate.value,
    newSeriesPayload: { ...seriesPayload(), status: wasPublished.value ? 'published' : 'draft' },
    overwriteExceptions,
  })
  saving.value = false
  if (!res.ok) { errorMsg.value = res.message; return }
  showToast('This date and the ones after were updated')
  router.push({ name: 'Events' })
}

function cancel() {
  if (isOneOffEdit.value) return router.push({ name: 'EventDetail', params: { id: editId.value } })
  router.push({ name: 'Events' })
}

// --- headings -------------------------------------------------------------
const heading = computed(() => {
  if (isOccurrenceEdit.value) return 'Change this date'
  if (isSeriesEdit.value) return 'Edit repeating event'
  if (isOneOffEdit.value) return 'Edit event'
  return 'New event'
})

function toTimeInput(iso) {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
</script>

<template>
  <div class="cmp">
    <div class="cmp__crumb">
      <span>Calendar</span><span>/</span><span class="cmp__crumb-now">{{ heading }}</span>
    </div>
    <h1 class="cmp__title">
      {{ heading }}
    </h1>
    <p class="cmp__sub">
      {{ isOccurrenceEdit ? 'This affects one date of a repeating event — choose how far the change reaches below.' : 'Saved as a draft until you publish it. Members see nothing before then.' }}
    </p>

    <div
      v-if="loading"
      class="cmp__loading"
    >
      <Spinner label="Loading" />
    </div>

    <Card
      v-else
      class="cmp__card"
      :padded="false"
    >
      <div class="cmp__body">
        <Alert
          v-if="errorMsg"
          tone="danger"
          class="cmp__alert"
        >
          {{ errorMsg }}
        </Alert>

        <div class="cmp__grid cmp__grid--2">
          <label class="cmp__field cmp__field--wide">
            <span class="cmp__label">Name of the event</span>
            <input
              v-model="form.title"
              class="cmp__input"
              type="text"
              placeholder="e.g. Youth outreach — San Roque"
            >
          </label>
          <label class="cmp__field">
            <span class="cmp__label">Kind</span>
            <select
              v-model="form.kind"
              class="cmp__input"
            >
              <option
                v-for="k in EVENT_KINDS"
                :key="k.value"
                :value="k.value"
              >{{ k.label }}</option>
            </select>
          </label>
        </div>

        <div class="cmp__grid cmp__grid--3">
          <label class="cmp__field">
            <span class="cmp__label">{{ form.repeats ? 'Starts on' : 'Date' }}</span>
            <input
              v-model="form.date"
              class="cmp__input"
              type="date"
            >
          </label>
          <label class="cmp__field">
            <span class="cmp__label">Starts</span>
            <input
              v-model="form.starts"
              class="cmp__input"
              type="time"
            >
          </label>
          <label class="cmp__field">
            <span class="cmp__label">Ends</span>
            <input
              v-model="form.ends"
              class="cmp__input"
              type="time"
            >
          </label>
        </div>

        <!-- Repeat section (frame 6c). Hidden on a one-off edit and an occurrence edit; those
             are not where the rule is created or changed. -->
        <div
          v-if="isNew || isSeriesEdit"
          class="cmp__repeat"
        >
          <label
            v-if="isNew"
            class="cmp__toggle"
          >
            <input
              v-model="form.repeats"
              type="checkbox"
            >
            <span>This event repeats</span>
          </label>

          <div
            v-if="form.repeats"
            class="cmp__repeat-body"
          >
            <div class="cmp__grid cmp__grid--3">
              <label class="cmp__field">
                <span class="cmp__label">How often</span>
                <select
                  v-model="form.cadence"
                  class="cmp__input"
                >
                  <option value="weekly">Every week / few weeks</option>
                  <option value="monthly">Every month / few months</option>
                  <option value="twice_monthly">Twice a month</option>
                </select>
              </label>
              <label
                v-if="form.cadence !== 'twice_monthly'"
                class="cmp__field"
              >
                <span class="cmp__label">Every</span>
                <div class="cmp__inline">
                  <input
                    v-model="form.intervalN"
                    class="cmp__input cmp__input--num"
                    type="number"
                    min="1"
                    max="24"
                  >
                  <span class="cmp__unit">{{ form.cadence === 'weekly' ? 'week(s)' : 'month(s)' }}</span>
                </div>
              </label>
              <label
                v-if="form.cadence !== 'weekly'"
                class="cmp__field"
              >
                <span class="cmp__label">On the</span>
                <select
                  v-model="form.anchor"
                  class="cmp__input"
                >
                  <option value="weekday">Same weekday (e.g. 3rd Saturday)</option>
                  <option value="date">Same date (e.g. the 15th)</option>
                </select>
              </label>
            </div>

            <!-- Which weekday-of-month, incl. "last" — lets a "last Saturday" series exist. -->
            <label
              v-if="form.cadence === 'monthly' && form.anchor === 'weekday'"
              class="cmp__field"
            >
              <span class="cmp__label">Which one</span>
              <select
                v-model="form.weekOfMonth1"
                class="cmp__input"
              >
                <option value="auto">Whichever the start date falls on</option>
                <option
                  v-for="n in NTHS"
                  :key="n.v"
                  :value="n.v"
                >The {{ n.l }} of the month</option>
              </select>
            </label>

            <!-- Twice-a-month needs a SECOND day. -->
            <div
              v-if="form.cadence === 'twice_monthly'"
              class="cmp__grid cmp__grid--2"
            >
              <label
                v-if="form.anchor === 'date'"
                class="cmp__field"
              >
                <span class="cmp__label">…and also on day</span>
                <input
                  v-model="form.dayOfMonth2"
                  class="cmp__input cmp__input--num"
                  type="number"
                  min="1"
                  max="31"
                  placeholder="e.g. 15"
                >
              </label>
              <div
                v-else
                class="cmp__field"
              >
                <span class="cmp__label">…and also the</span>
                <div class="cmp__inline">
                  <select
                    v-model.number="form.weekOfMonth2"
                    class="cmp__input"
                  >
                    <option
                      v-for="n in NTHS"
                      :key="n.v"
                      :value="n.v"
                    >
                      {{ n.l }}
                    </option>
                  </select>
                  <select
                    v-model.number="form.weekday2"
                    class="cmp__input"
                  >
                    <option
                      v-for="(w, i) in WEEKDAYS"
                      :key="w"
                      :value="i"
                    >
                      {{ w }}
                    </option>
                  </select>
                </div>
              </div>
            </div>

            <div class="cmp__grid cmp__grid--2">
              <label class="cmp__field">
                <span class="cmp__label">Ends</span>
                <select
                  v-model="form.endMode"
                  class="cmp__input"
                >
                  <option value="never">Never — keeps repeating</option>
                  <option value="on">On a date</option>
                  <option value="after">After a number of times</option>
                </select>
              </label>
              <label
                v-if="form.endMode === 'on'"
                class="cmp__field"
              >
                <span class="cmp__label">End date</span>
                <input
                  v-model="form.endsOn"
                  class="cmp__input"
                  type="date"
                >
              </label>
              <label
                v-if="form.endMode === 'after'"
                class="cmp__field"
              >
                <span class="cmp__label">Number of times</span>
                <input
                  v-model="form.countN"
                  class="cmp__input cmp__input--num"
                  type="number"
                  min="1"
                >
              </label>
            </div>

            <p
              v-if="rulePreview"
              class="cmp__preview"
            >
              <span aria-hidden="true">⟳</span> {{ rulePreview }}
            </p>
          </div>
        </div>

        <Alert
          v-if="isPastOccurrence"
          tone="warning"
        >
          This date has already happened. Past dates are kept as they were and can’t be changed.
        </Alert>

        <!-- Occurrence-edit scope (frame 7d), the owner's two-option model. -->
        <div
          v-if="isOccurrenceEdit && !isPastOccurrence"
          class="cmp__scope"
        >
          <span class="cmp__label">This change is for…</span>
          <label class="cmp__radio">
            <input
              v-model="form.scope"
              type="radio"
              value="this"
            >
            <span><strong>This date only.</strong> Every other date stays as it is.</span>
          </label>
          <label class="cmp__radio">
            <input
              v-model="form.scope"
              type="radio"
              value="after"
            >
            <span><strong>This date and the ones after it.</strong> Earlier dates are left untouched.</span>
          </label>
        </div>

        <div class="cmp__grid cmp__grid--2">
          <label class="cmp__field">
            <span class="cmp__label">Where</span>
            <input
              v-model="form.location"
              class="cmp__input"
              type="text"
              placeholder="Main hall"
            >
          </label>
          <label class="cmp__field">
            <span class="cmp__label">Run by</span>
            <input
              v-model="form.run_by"
              class="cmp__input"
              type="text"
              placeholder="Youth Ministry"
            >
          </label>
        </div>

        <label class="cmp__field">
          <span class="cmp__label">What members will read</span>
          <textarea
            v-model="form.description"
            class="cmp__input cmp__textarea"
            rows="3"
            placeholder="A short description members will see once it is published."
          />
        </label>

        <label class="cmp__field cmp__field--budget">
          <span class="cmp__label">Projected budget <span class="cmp__hint">(shown for planning only — no approval)</span></span>
          <input
            v-model="form.projected_budget"
            class="cmp__input"
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
          >
        </label>
      </div>

      <div class="cmp__foot">
        <Button
          variant="secondary"
          @click="cancel"
        >
          Cancel
        </Button>
        <div class="cmp__foot-commit">
          <Button
            v-if="!isOccurrenceEdit"
            variant="secondary"
            :disabled="!canSubmit"
            :loading="saving"
            @click="submit(false)"
          >
            {{ isNew ? 'Keep as draft' : 'Save draft' }}
          </Button>
          <Button
            variant="primary"
            :disabled="!canSubmit || isPastOccurrence"
            :loading="saving"
            @click="submit(true)"
          >
            {{ isOccurrenceEdit ? 'Save this change' : (wasPublished ? 'Save changes' : 'Save and publish') }}
          </Button>
        </div>
      </div>
    </Card>

    <!-- "Specially adjusted date" confirm (the owner's follow-up alert). -->
    <Modal
      v-model:open="splitConfirmOpen"
      title="Some later dates were changed on purpose"
      description="They will keep their own values unless you choose to overwrite them."
      icon="alert"
      icon-tone="warning"
      layout="stack"
      :close-on-outside-click="false"
    >
      <p class="cmp__dialog-text">
        <strong>{{ futureExceptionCount }}</strong> later date{{ futureExceptionCount === 1 ? ' was' : 's were' }}
        changed by hand. Keep those as they are, or overwrite them with this change too?
      </p>
      <template #footer>
        <Button
          variant="secondary"
          :loading="saving"
          @click="doSplit(false)"
        >
          Keep their changes
        </Button>
        <Button
          variant="primary"
          :loading="saving"
          @click="doSplit(true)"
        >
          Overwrite them too
        </Button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.cmp { display: flex; flex-direction: column; gap: var(--sp-4); max-width: 900px; }
.cmp__crumb { display: flex; align-items: center; gap: var(--sp-6); font-size: var(--text-meta); color: var(--ink-5); font-weight: 600; }
.cmp__crumb-now { color: var(--ink-3); }
.cmp__title { margin: var(--sp-8) 0 0; font-size: var(--text-h1); font-weight: 800; letter-spacing: -0.03em; }
.cmp__sub { margin: var(--sp-4) 0 var(--sp-16); font-size: var(--text-body); color: var(--ink-5); }
.cmp__loading { display: grid; place-items: center; min-height: 200px; }

.cmp__card { overflow: hidden; }
.cmp__body { padding: var(--sp-20) var(--sp-20); display: flex; flex-direction: column; gap: var(--sp-16); }
.cmp__alert { margin-bottom: var(--sp-4); }
.cmp__grid { display: grid; gap: var(--sp-14); }
.cmp__grid--2 { grid-template-columns: 1fr 220px; }
.cmp__grid--3 { grid-template-columns: 1fr 1fr 1fr; }
.cmp__field { display: flex; flex-direction: column; gap: var(--sp-6); }
.cmp__field--wide { min-width: 0; }
.cmp__field--budget { max-width: 240px; }
.cmp__label { font-size: var(--text-meta); font-weight: 700; color: var(--ink-3); }
.cmp__hint { font-weight: 500; color: var(--ink-5); }
.cmp__input { padding: 10px 12px; border: 1px solid var(--border-strong); border-radius: var(--r-control); background: var(--surface); font-family: inherit; font-size: var(--text-body-sm); font-weight: 600; color: var(--ink); }
.cmp__input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; border-color: var(--accent); }
.cmp__input--num { max-width: 90px; }
.cmp__textarea { font-weight: 500; resize: vertical; }
.cmp__inline { display: flex; align-items: center; gap: var(--sp-8); }
.cmp__unit { font-size: var(--text-body-sm); color: var(--ink-5); font-weight: 600; }

.cmp__repeat { border: 1px solid var(--border); border-radius: var(--r-control); padding: var(--sp-14); background: var(--surface-subtle); display: flex; flex-direction: column; gap: var(--sp-14); }
.cmp__toggle { display: flex; align-items: center; gap: var(--sp-8); font-size: var(--text-body-sm); font-weight: 700; cursor: pointer; }
.cmp__repeat-body { display: flex; flex-direction: column; gap: var(--sp-14); }
.cmp__preview { margin: 0; padding: var(--sp-10) var(--sp-12); background: var(--accent-tint); border-radius: var(--r-inset); font-size: var(--text-body-sm); font-weight: 700; color: var(--accent-darkest); }

.cmp__scope { border: 1px solid var(--border); border-radius: var(--r-control); padding: var(--sp-14); background: var(--surface-subtle); display: flex; flex-direction: column; gap: var(--sp-10); }
.cmp__radio { display: flex; align-items: flex-start; gap: var(--sp-8); font-size: var(--text-body-sm); color: var(--ink-2); cursor: pointer; line-height: 1.45; }
.cmp__radio input { margin-top: 3px; }

.cmp__dialog-text { margin: 0; font-size: var(--text-body-sm); color: var(--ink-2); line-height: 1.55; }

.cmp__foot { display: flex; align-items: center; gap: var(--sp-12); padding: var(--sp-14) var(--sp-20); border-top: 1px solid var(--border); background: var(--surface-subtle); }
.cmp__foot-commit { margin-left: auto; display: flex; gap: var(--sp-9); }

@media (max-width: 640px) {
  .cmp__grid--2, .cmp__grid--3 { grid-template-columns: 1fr; }
  .cmp__foot { flex-direction: column; align-items: stretch; }
  .cmp__foot-commit { margin-left: 0; }
}
</style>

<script setup>
// New / edit event (frame 6c, Stage 1 cut — no recurrence pill and no "roles to fill"
// yet; those are Stage 2/3). Route-gated by canManageEvents, so only writers reach it. The
// commit sits at the foot of the form it commits (frame 5b): the page corner stays empty
// on a form screen. Two commits — keep as draft, or create/save and publish.

import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Card from '../components/ui/Card.vue'
import Button from '../components/ui/Button.vue'
import Alert from '../components/ui/Alert.vue'
import Spinner from '../components/ui/Spinner.vue'
import { useActiveChurch } from '../composables/useActiveChurch'
import { useToast } from '../composables/useToast'
import { EVENT_KINDS, createEvent, updateEvent, getEvent } from '../lib/data/events'

const route = useRoute()
const router = useRouter()
const { activeChurchId, ensureLoaded } = useActiveChurch()
const { showToast } = useToast()

const editId = computed(() => route.params.id || null)
const isEdit = computed(() => !!editId.value)

const loading = ref(false)
const saving = ref(false)
const errorMsg = ref('')
const wasPublished = ref(false)

const form = ref({
  title: '', kind: 'service', date: '', starts: '', ends: '',
  location: '', run_by: '', description: '', projected_budget: '',
})

onMounted(async () => {
  await ensureLoaded()
  if (isEdit.value) {
    loading.value = true
    const res = await getEvent(editId.value)
    if (res.event) {
      const e = res.event
      wasPublished.value = e.status === 'published'
      form.value = {
        title: e.title,
        kind: e.kind,
        date: e.starts_at ? e.starts_at.slice(0, 10) : '',
        starts: e.starts_at ? toTimeInput(e.starts_at) : '',
        ends: e.ends_at ? toTimeInput(e.ends_at) : '',
        location: e.location || '',
        run_by: e.run_by || '',
        description: e.description || '',
        projected_budget: e.projected_budget ?? '',
      }
    } else {
      errorMsg.value = res.message
    }
    loading.value = false
  }
})

const canSubmit = computed(() => form.value.title.trim() && form.value.date && form.value.starts)

function buildPayload() {
  const startsAt = new Date(`${form.value.date}T${form.value.starts}`).toISOString()
  const endsAt = form.value.ends ? new Date(`${form.value.date}T${form.value.ends}`).toISOString() : null
  return {
    church_id: activeChurchId.value,
    title: form.value.title.trim(),
    kind: form.value.kind,
    starts_at: startsAt,
    ends_at: endsAt,
    location: form.value.location.trim() || null,
    run_by: form.value.run_by.trim() || null,
    description: form.value.description.trim() || null,
    projected_budget: form.value.projected_budget === '' ? null : Number(form.value.projected_budget),
  }
}

async function submit(publish) {
  if (!canSubmit.value || saving.value) return
  saving.value = true
  errorMsg.value = ''
  const payload = buildPayload()
  let res
  if (isEdit.value) {
    // Preserve published state on edit; publishing a draft is done from the detail page.
    res = await updateEvent(editId.value, publish && !wasPublished.value
      ? { ...payload, status: 'published', published_at: new Date().toISOString() }
      : payload)
  } else {
    res = await createEvent(payload, { publish })
  }
  saving.value = false
  if (!res.ok) { errorMsg.value = res.message; return }
  const saved = res.rows[0]
  showToast(publish ? 'Event published' : 'Draft saved')
  router.push(saved?.id ? { name: 'EventDetail', params: { id: saved.id } } : { name: 'Events' })
}

function cancel() {
  router.push(isEdit.value ? { name: 'EventDetail', params: { id: editId.value } } : { name: 'Events' })
}

function toTimeInput(iso) {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
</script>

<template>
  <div class="cmp">
    <div class="cmp__crumb">
      <span>Calendar</span><span>/</span><span class="cmp__crumb-now">{{ isEdit ? 'Edit event' : 'New event' }}</span>
    </div>
    <h1 class="cmp__title">
      {{ isEdit ? 'Edit event' : 'New event' }}
    </h1>
    <p class="cmp__sub">
      Saved as a draft until you publish it. Members see nothing before then.
    </p>

    <div
      v-if="loading"
      class="cmp__loading"
    >
      <Spinner label="Loading event" />
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
            <span class="cmp__label">Date</span>
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
            variant="secondary"
            :disabled="!canSubmit"
            :loading="saving"
            @click="submit(false)"
          >
            {{ isEdit ? 'Save draft' : 'Keep as draft' }}
          </Button>
          <Button
            variant="primary"
            :disabled="!canSubmit"
            :loading="saving"
            @click="submit(true)"
          >
            {{ isEdit && wasPublished ? 'Save changes' : (isEdit ? 'Save and publish' : 'Create and publish') }}
          </Button>
        </div>
      </div>
    </Card>
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
.cmp__textarea { font-weight: 500; resize: vertical; }

.cmp__foot { display: flex; align-items: center; gap: var(--sp-12); padding: var(--sp-14) var(--sp-20); border-top: 1px solid var(--border); background: var(--surface-subtle); }
.cmp__foot-commit { margin-left: auto; display: flex; gap: var(--sp-9); }

@media (max-width: 640px) {
  .cmp__grid--2, .cmp__grid--3 { grid-template-columns: 1fr; }
  .cmp__foot { flex-direction: column; align-items: stretch; }
  .cmp__foot-commit { margin-left: 0; }
}
</style>

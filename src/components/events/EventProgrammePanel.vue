<script setup>
// The programme — the running order (frame 6b, upper-left card). Spec #87, stories 16–19.
// SEPARATE from the roster (Q11): a "lead" here is a plain note (free text or a member's
// name), never a volunteer assignment. A clean list with a "+ Add an item" button in the
// header (the add form is hidden until asked for, like 6b); the lead sits on the right, and
// an unassigned lead reads as a visible blank (story 19). Readable by anyone who can see the
// event; editable by canManageEvents.

import { ref, computed, onMounted } from 'vue'
import Card from '../ui/Card.vue'
import Button from '../ui/Button.vue'
import Input from '../ui/Input.vue'
import Spinner from '../ui/Spinner.vue'
import { useToast } from '../../composables/useToast'
import {
  listProgramme, addProgrammeItem, deleteProgrammeItem, reorderProgramme,
} from '../../lib/data/eventRoles'

const props = defineProps({
  event: { type: Object, required: true },
  canManage: { type: Boolean, default: false },
})

const { showToast } = useToast()
const loading = ref(true)
const items = ref([])
const adding = ref(false)
const draft = ref({ time: '', title: '', lead: '', note: '' })
const busy = ref(false)

async function load() {
  loading.value = true
  const res = await listProgramme({ eventId: props.event.id })
  items.value = res.ok ? res.items : []
  loading.value = false
}
onMounted(load)

async function doAdd() {
  if (!draft.value.title.trim()) return
  busy.value = true
  const itemTime = draft.value.time && props.event.starts_at
    ? isoAtDate(props.event.starts_at, draft.value.time)
    : null
  const res = await addProgrammeItem({
    eventId: props.event.id, churchId: props.event.church_id,
    title: draft.value.title.trim(),
    itemTime,
    leadName: draft.value.lead.trim() || null,
    note: draft.value.note.trim() || null,
    position: items.value.length,
  })
  busy.value = false
  if (!res.ok) { showToast(res.message, 'error'); return }
  draft.value = { time: '', title: '', lead: '', note: '' }
  adding.value = false
  await load()
}

async function doRemove(item) {
  const res = await deleteProgrammeItem(item.id)
  if (!res.ok) { showToast(res.message, 'error'); return }
  await load()
}

async function move(index, dir) {
  const to = index + dir
  if (to < 0 || to >= items.value.length) return
  const reordered = [...items.value]
  const [it] = reordered.splice(index, 1)
  reordered.splice(to, 0, it)
  items.value = reordered
  const res = await reorderProgramme(reordered.map((r, i) => ({ id: r.id, position: i })))
  if (!res.ok) { showToast(res.message, 'error'); await load() }
}

function isoAtDate(dateIso, hm) {
  const d = new Date(dateIso)
  const [h, m] = hm.split(':').map(Number)
  d.setHours(h || 0, m || 0, 0, 0)
  return d.toISOString()
}
function fmtTime(iso) {
  // Full "8:00 am" like 6b — don't collapse the :00, and lower-case the meridiem.
  return iso ? new Date(iso).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase() : ''
}

// "Five hours · 7 items" in 6b — we show the real span when both ends are known, never faked.
const spanLabel = computed(() => {
  const s = props.event?.starts_at, e = props.event?.ends_at
  if (!s || !e) return ''
  const mins = Math.round((new Date(e) - new Date(s)) / 60000)
  if (mins <= 0) return ''
  const h = Math.floor(mins / 60), m = mins % 60
  const parts = []
  if (h) parts.push(`${h} hr${h === 1 ? '' : 's'}`)
  if (m) parts.push(`${m} min`)
  return parts.join(' ')
})
</script>

<template>
  <Card :padded="false">
    <div class="prog__head">
      <div>
        <h2 class="prog__title">
          Programme
        </h2>
        <p
          v-if="items.length"
          class="prog__sub"
        >
          <template v-if="spanLabel">
            {{ spanLabel }} ·
          </template>{{ items.length }} item{{ items.length === 1 ? '' : 's' }}
        </p>
      </div>
      <button
        v-if="canManage && !adding"
        class="prog__add-btn"
        @click="adding = true"
      >
        + Add an item
      </button>
    </div>

    <div
      v-if="loading"
      class="prog__loading"
    >
      <Spinner label="Loading programme" />
    </div>

    <template v-else>
      <p
        v-if="!items.length && !adding"
        class="prog__empty"
      >
        No programme yet.<template v-if="canManage">
          Add the running order with “Add an item”.
        </template>
      </p>

      <ol
        v-else-if="items.length"
        class="prog__list"
      >
        <li
          v-for="(item, i) in items"
          :key="item.id"
          class="prog__item"
        >
          <span class="prog__time">{{ fmtTime(item.item_time) || '—' }}</span>
          <span class="prog__body">
            <span class="prog__item-title">{{ item.title }}</span>
            <span
              v-if="item.note"
              class="prog__note"
            >{{ item.note }}</span>
          </span>
          <span
            class="prog__lead"
            :class="{ 'is-blank': !item.leadDisplayName }"
          >{{ item.leadDisplayName || 'Not assigned' }}</span>
          <span
            v-if="canManage"
            class="prog__controls"
          >
            <button
              class="prog__x"
              title="Up"
              :disabled="i === 0"
              @click="move(i, -1)"
            >↑</button>
            <button
              class="prog__x"
              title="Down"
              :disabled="i === items.length - 1"
              @click="move(i, 1)"
            >↓</button>
            <button
              class="prog__x"
              title="Remove"
              @click="doRemove(item)"
            >✕</button>
          </span>
        </li>
      </ol>

      <!-- Add form — hidden until "Add an item" (6b) -->
      <div
        v-if="adding"
        class="prog__addform"
      >
        <div class="prog__addgrid">
          <Input
            v-model="draft.time"
            label="Time"
            type="time"
          />
          <Input
            v-model="draft.title"
            label="Item"
            placeholder="e.g. Opening prayer"
          />
        </div>
        <div class="prog__addgrid">
          <Input
            v-model="draft.lead"
            label="Lead"
            placeholder="Who leads this"
            optional
          />
          <Input
            v-model="draft.note"
            label="Note"
            placeholder="Optional"
            optional
          />
        </div>
        <div class="prog__addbtns">
          <Button
            variant="secondary"
            size="sm"
            @click="adding = false"
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            :loading="busy"
            :disabled="!draft.title.trim()"
            @click="doAdd"
          >
            Add item
          </Button>
        </div>
      </div>
    </template>
  </Card>
</template>

<style scoped>
.prog__head { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-12); padding: var(--sp-16) var(--sp-20); border-bottom: 1px solid var(--border-subtle, var(--border)); }
.prog__title { margin: 0; font-size: var(--text-h3); font-weight: 800; letter-spacing: -0.02em; }
.prog__sub { margin: 3px 0 0; font-size: var(--text-meta); color: var(--ink-5); }
.prog__add-btn { display: inline-flex; align-items: center; gap: 6px; padding: 9px 14px; border: 1px solid var(--border-strong); background: var(--surface); border-radius: 10px; font: inherit; font-weight: 700; font-size: var(--text-meta); color: var(--ink-2); cursor: pointer; transition: background .15s, border-color .15s, color .15s; }
.prog__add-btn:hover { background: var(--accent-tint, #e9f8ff); border-color: var(--accent); color: var(--accent); }
.prog__loading { display: grid; place-items: center; min-height: 80px; }
.prog__empty { margin: 0; padding: var(--sp-16) var(--sp-20); font-size: var(--text-body-sm); color: var(--ink-5); }

.prog__list { list-style: none; margin: 0; padding: 0; }
.prog__item { position: relative; display: grid; grid-template-columns: 96px 1fr 170px; gap: var(--sp-14); align-items: start; padding: var(--sp-14) var(--sp-20); border-bottom: 1px solid var(--border-subtle, var(--border)); transition: background .16s; }
.prog__item:last-child { border-bottom: none; }
.prog__item:hover { background: var(--surface-2, #fbfcfd); }
.prog__time { font-size: var(--text-body-sm); font-weight: 800; color: var(--accent); font-variant-numeric: tabular-nums; }
.prog__body { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.prog__item-title { font-size: var(--text-body-sm); font-weight: 700; }
.prog__note { font-size: var(--text-meta); color: var(--ink-5); }
.prog__lead { min-width: 0; font-size: var(--text-meta); color: var(--ink-3); text-align: right; overflow-wrap: anywhere; }
.prog__lead.is-blank { color: var(--warn, #b54708); }
/* Controls float over the right edge on hover so they never widen the lead column (6b keeps the grid fixed). */
.prog__controls { position: absolute; top: 8px; right: var(--sp-20); display: flex; align-items: center; gap: 2px; padding: 2px; border-radius: var(--r-control); background: var(--surface); box-shadow: var(--shadow-1, 0 1px 4px rgba(16,24,40,.12)); opacity: 0; transition: opacity .15s; }
.prog__item:hover .prog__controls { opacity: 1; }
.prog__x { border: none; background: transparent; color: var(--ink-5); cursor: pointer; font-size: 12px; padding: 2px 5px; border-radius: var(--r-control); }
.prog__x:hover:not(:disabled) { color: var(--ink); background: var(--surface-2, rgba(0,0,0,.04)); }
.prog__x:disabled { opacity: .3; cursor: not-allowed; }

.prog__addform { padding: var(--sp-14) var(--sp-20); display: flex; flex-direction: column; gap: var(--sp-10); border-top: 1px solid var(--border-subtle, var(--border)); }
.prog__addgrid { display: grid; grid-template-columns: 140px 1fr; gap: var(--sp-10); }
.prog__addbtns { display: flex; gap: var(--sp-8); }
</style>

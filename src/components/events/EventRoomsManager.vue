<script setup>
// Manage the church's room list (frame 7j's source; story 26). Spec #87. Owned by the
// Church Leader (+ SuperAdmin) — Q4, canManageRooms — not Events Team, who only pick a room
// in the composer. A short operational list (label, optional capacity, bookable), not a
// scheduling product. RLS (0035) is the enforcement; this dialog is the affordance.

import { ref, watch } from 'vue'
import Modal from '../ui/Modal.vue'
import Button from '../ui/Button.vue'
import Input from '../ui/Input.vue'
import Toggle from '../ui/Toggle.vue'
import Badge from '../ui/Badge.vue'
import Spinner from '../ui/Spinner.vue'
import { useToast } from '../../composables/useToast'
import { listRooms, addRoom, updateRoom, deleteRoom } from '../../lib/data/eventRooms'

const props = defineProps({
  open: { type: Boolean, default: false },
  churchId: { type: String, default: null },
})
const emit = defineEmits(['update:open'])

const { showToast } = useToast()
const loading = ref(true)
const rooms = ref([])
const draft = ref({ label: '', capacity: '', bookable: true })
const busy = ref(false)

watch(() => props.open, (isOpen) => { if (isOpen) load() })

async function load() {
  loading.value = true
  const res = await listRooms({ churchId: props.churchId })
  rooms.value = res.ok ? res.rooms : []
  loading.value = false
}

async function doAdd() {
  if (!draft.value.label.trim()) return
  busy.value = true
  const res = await addRoom({
    churchId: props.churchId,
    label: draft.value.label.trim(),
    capacity: draft.value.capacity === '' ? null : Number(draft.value.capacity),
    isBookable: draft.value.bookable,
  })
  busy.value = false
  if (!res.ok) { showToast(res.message, 'error'); return }
  draft.value = { label: '', capacity: '', bookable: true }
  await load()
}

async function toggleBookable(room) {
  const res = await updateRoom(room.id, { is_bookable: !room.is_bookable })
  if (!res.ok) { showToast(res.message, 'error'); return }
  await load()
}

async function doDelete(room) {
  const res = await deleteRoom(room.id)
  if (!res.ok) { showToast(res.message, 'error'); return }
  showToast('Room removed')
  await load()
}
</script>

<template>
  <Modal
    :open="open"
    title="Rooms"
    description="The spaces events can be booked into. Events Team choose from this list."
    layout="stack"
    @update:open="emit('update:open', $event)"
  >
    <div
      v-if="loading"
      class="rm__loading"
    >
      <Spinner label="Loading rooms" />
    </div>
    <template v-else>
      <ul
        v-if="rooms.length"
        class="rm__list"
      >
        <li
          v-for="room in rooms"
          :key="room.id"
          class="rm__row"
        >
          <span class="rm__name">{{ room.label }}</span>
          <Badge
            v-if="room.capacity"
            tone="neutral"
          >
            Seats {{ room.capacity }}
          </Badge>
          <Badge :tone="room.is_bookable ? 'success' : 'warning'">
            {{ room.is_bookable ? 'Bookable' : 'Not bookable' }}
          </Badge>
          <span class="rm__spacer" />
          <button
            class="rm__link"
            @click="toggleBookable(room)"
          >
            {{ room.is_bookable ? 'Make unbookable' : 'Make bookable' }}
          </button>
          <button
            class="rm__icon"
            title="Remove"
            @click="doDelete(room)"
          >
            ✕
          </button>
        </li>
      </ul>
      <p
        v-else
        class="rm__muted"
      >
        No rooms yet. Add the first one below.
      </p>

      <div class="rm__add">
        <div class="rm__add-grid">
          <Input
            v-model="draft.label"
            label="Room name"
            placeholder="e.g. Main hall"
          />
          <Input
            v-model="draft.capacity"
            label="Capacity"
            type="number"
            optional
          />
        </div>
        <Toggle v-model="draft.bookable">
          Bookable
        </Toggle>
        <Button
          variant="primary"
          size="sm"
          :loading="busy"
          :disabled="!draft.label.trim()"
          @click="doAdd"
        >
          Add room
        </Button>
      </div>
    </template>

    <template #footer>
      <Button
        variant="secondary"
        @click="emit('update:open', false)"
      >
        Done
      </Button>
    </template>
  </Modal>
</template>

<style scoped>
.rm__loading { display: grid; place-items: center; min-height: 100px; }
.rm__list { list-style: none; margin: 0 0 var(--sp-14); padding: 0; display: flex; flex-direction: column; gap: 2px; }
.rm__row { display: flex; align-items: center; gap: var(--sp-8); padding: var(--sp-9) 0; border-bottom: 1px solid var(--border-subtle, var(--border)); }
.rm__name { font-size: var(--text-body-sm); font-weight: 700; }
.rm__spacer { flex: 1; }
.rm__link { border: none; background: none; color: var(--accent); font: inherit; font-size: var(--text-meta); font-weight: 700; cursor: pointer; }
.rm__icon { border: none; background: none; color: var(--ink-5); cursor: pointer; padding: 4px; border-radius: var(--r-control); }
.rm__icon:hover { color: var(--danger, #d92d20); background: var(--surface-2, rgba(0,0,0,.04)); }
.rm__muted { margin: 0 0 var(--sp-14); font-size: var(--text-body-sm); color: var(--ink-5); }
.rm__add { padding-top: var(--sp-12); border-top: 1px solid var(--border-subtle, var(--border)); display: flex; flex-direction: column; gap: var(--sp-10); }
.rm__add-grid { display: grid; grid-template-columns: 1fr 120px; gap: var(--sp-10); }
</style>

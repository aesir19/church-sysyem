<script setup>
// The composer's "Roles to fill" field (frame 6c). Purely LOCAL state — the roles a new or
// edited event will need, shown as chips with an "Add a role" pill. Nothing here touches the
// database: the composer persists these to event_roles on save (a new event has no id until
// then), so the same rows the detail roster (6b) reads are created from one place.
//
// Each role is { _key, id, label, count_required, requires_finance, note }. `_key` is a stable
// local handle for v-for and editing; `id` is null for a role added here and set for one loaded
// from an existing event (so the composer can tell an add from an edit on save).

import { ref } from 'vue'

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
})
const emit = defineEmits(['update:modelValue'])

let seq = 0
function mintKey() { return `r${Date.now().toString(36)}-${++seq}` }

const formOpen = ref(false)
const editingKey = ref(null)
const draft = ref({ label: '', count: 1, requiresFinance: false, note: '' })

function openAdd() {
  editingKey.value = null
  draft.value = { label: '', count: 1, requiresFinance: false, note: '' }
  formOpen.value = true
}
function openEdit(role) {
  editingKey.value = role._key
  draft.value = {
    label: role.label,
    count: role.count_required,
    requiresFinance: role.requires_finance,
    note: role.note || '',
  }
  formOpen.value = true
}
function closeForm() { formOpen.value = false; editingKey.value = null }

function save() {
  const label = draft.value.label.trim()
  if (!label) return
  const patch = {
    label,
    count_required: Math.max(1, Number(draft.value.count) || 1),
    requires_finance: !!draft.value.requiresFinance,
    note: draft.value.note.trim() || null,
  }
  let next
  if (editingKey.value) {
    next = props.modelValue.map((r) => (r._key === editingKey.value ? { ...r, ...patch } : r))
  } else {
    next = [...props.modelValue, { _key: mintKey(), id: null, ...patch }]
  }
  emit('update:modelValue', next)
  closeForm()
}

function remove(role) {
  emit('update:modelValue', props.modelValue.filter((r) => r._key !== role._key))
}
</script>

<template>
  <div class="rf">
    <div class="rf__chips">
      <button
        v-for="role in modelValue"
        :key="role._key"
        type="button"
        class="rf__chip"
        :class="{ 'rf__chip--finance': role.requires_finance }"
        @click="openEdit(role)"
      >
        <span class="rf__chip-label">{{ role.label }}</span>
        <span class="rf__chip-count">×{{ role.count_required }}</span>
        <span
          class="rf__chip-x"
          aria-hidden="true"
          title="Remove role"
          @click.stop="remove(role)"
        >✕</span>
      </button>

      <button
        type="button"
        class="rf__add"
        @click="openAdd"
      >
        + Add a role
      </button>
    </div>

    <div
      v-if="formOpen"
      class="rf__form"
    >
      <div class="rf__row">
        <label class="rf__field rf__field--grow">
          <span class="rf__label">Role</span>
          <input
            v-model="draft.label"
            class="rf__input"
            type="text"
            placeholder="e.g. Usher, Sound, Kitchen"
            @keydown.enter.prevent="save"
          >
        </label>
        <label class="rf__field">
          <span class="rf__label">How many</span>
          <input
            v-model.number="draft.count"
            class="rf__input rf__input--num"
            type="number"
            min="1"
          >
        </label>
      </div>

      <label class="rf__finance">
        <input
          v-model="draft.requiresFinance"
          type="checkbox"
        >
        <span>Finance role — only finance-team members can fill it (it counts the offering).</span>
      </label>

      <div class="rf__btns">
        <button
          type="button"
          class="rf__btn rf__btn--ghost"
          @click="closeForm"
        >
          Cancel
        </button>
        <button
          type="button"
          class="rf__btn rf__btn--go"
          :disabled="!draft.label.trim()"
          @click="save"
        >
          {{ editingKey ? 'Save role' : 'Add role' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rf { display: flex; flex-direction: column; gap: var(--sp-12); }
.rf__chips { display: flex; flex-wrap: wrap; gap: var(--sp-8); }

.rf__chip { display: inline-flex; align-items: center; gap: var(--sp-8); padding: 8px 12px; border: 1px solid var(--border-strong); border-radius: var(--r-pill, 999px); background: var(--surface); font: inherit; font-size: var(--text-body-sm); font-weight: 700; color: var(--ink); cursor: pointer; transition: border-color .16s, background .16s; }
.rf__chip:hover { border-color: var(--accent); background: var(--accent-tint, #e9f8ff); }
.rf__chip--finance { border-style: dashed; }
.rf__chip-count { font-size: var(--text-meta); font-weight: 700; color: var(--ink-5); }
.rf__chip-x { display: inline-flex; align-items: center; justify-content: center; width: 15px; height: 15px; margin-left: 1px; border-radius: 50%; font-size: 9px; color: var(--ink-5); }
.rf__chip-x:hover { background: var(--surface-subtle-2, rgba(0,0,0,.06)); color: var(--danger, #d92d20); }

.rf__add { display: inline-flex; align-items: center; gap: var(--sp-7); padding: 8px 13px; border: 1px dashed var(--border-strong); border-radius: var(--r-pill, 999px); background: var(--surface); font: inherit; font-size: var(--text-body-sm); font-weight: 700; color: var(--ink-3); cursor: pointer; transition: border-color .16s, color .16s; }
.rf__add:hover { border-color: var(--accent); color: var(--accent); }

.rf__form { display: flex; flex-direction: column; gap: var(--sp-12); padding: var(--sp-14); border: 1px solid var(--border); border-radius: var(--r-control); background: var(--surface-subtle); }
.rf__row { display: flex; gap: var(--sp-14); align-items: flex-end; flex-wrap: wrap; }
.rf__field { display: flex; flex-direction: column; gap: var(--sp-6); }
.rf__field--grow { flex: 1 1 200px; min-width: 0; }
.rf__label { font-size: var(--text-meta); font-weight: 700; color: var(--ink-3); }
.rf__input { padding: 9px 11px; border: 1px solid var(--border-strong); border-radius: var(--r-control); background: var(--surface); font: inherit; font-size: var(--text-body-sm); font-weight: 600; color: var(--ink); }
.rf__input:focus-visible { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-tint, #e9f8ff); }
.rf__input--num { width: 84px; }
.rf__finance { display: flex; align-items: flex-start; gap: var(--sp-8); font-size: var(--text-body-sm); color: var(--ink-2); line-height: 1.45; cursor: pointer; }
.rf__finance input { margin-top: 3px; }
.rf__btns { display: flex; justify-content: flex-end; gap: var(--sp-8); }
.rf__btn { padding: 8px 14px; border-radius: var(--r-control); font: inherit; font-size: var(--text-meta); font-weight: 700; cursor: pointer; }
.rf__btn--ghost { border: 1px solid var(--border-strong); background: var(--surface); color: var(--ink-3); }
.rf__btn--go { border: none; background: var(--accent); color: #fff; }
.rf__btn--go:disabled { opacity: .5; cursor: not-allowed; }
</style>

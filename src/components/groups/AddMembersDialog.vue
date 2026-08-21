<script setup>
import { computed, ref, watch } from 'vue'
import Modal from '../ui/Modal.vue'
import Button from '../ui/Button.vue'
import Input from '../ui/Input.vue'
import Avatar from '../ui/Avatar.vue'
import { supabase } from '../../lib/supabase'
import { write } from '../../lib/data/write'
import { MEMBERSHIP_TABLES, MEMBERSHIP_PARENT_KEY } from '../../lib/data/groups'
import { showToast } from '../../composables/useToast'

// "Add to Youth Ministry" — dialog 05, finally as its own dialog.
//
// THE COMPROMISE THIS PAYS OFF. GroupDetailModal carried this list inside itself, and
// its comment said why: "The mockup draws 'Add to Youth Ministry' as its own dialog
// opened from the group page. There is no group page — the card opens this — so a
// second dialog would be a dialog on top of a dialog, which is two focus traps
// competing for one Escape key." There is a page now, so this is opened FROM the page
// and there is only ever one focus trap.
//
// MULTI-SELECT, ONE INSERT. The list has checkboxes and the button counts them, and all
// of them go in a single insert — not one request per person, which would half-succeed
// and leave the roster in a state nobody chose.

const props = defineProps({
  open: { type: Boolean, required: true },
  group: { type: Object, default: null },
  churchId: { type: String, default: '' },
  // Member ids already in the group. Excluded from the list rather than shown and
  // refused, so a duplicate cannot be attempted in the first place.
  existingMemberIds: { type: Array, default: () => [] }
})

const emit = defineEmits(['update:open', 'added'])

const roll = ref([])
const loading = ref(false)
const saving = ref(false)
const errorMessage = ref('')
const search = ref('')
const selected = ref(new Set())

const selectedCount = computed(() => selected.value.size)

const already = computed(() => new Set(props.existingMemberIds))

// Built as a string rather than interpolated in the template, where
// `Add ${count || ''} ${...}` collapsed to "Add  members" — two spaces — whenever
// nothing was selected. The button is disabled then, but it is still read aloud.
const addLabel = computed(() => {
  if (saving.value) return 'Adding…'
  if (!selectedCount.value) return 'Add members'
  return `Add ${selectedCount.value} ${selectedCount.value === 1 ? 'member' : 'members'}`
})

const candidates = computed(() => {
  const q = search.value.trim().toLowerCase()
  return roll.value
    .filter(m => !already.value.has(m.id))
    .filter(m => !q || `${m.first_name} ${m.last_name}`.toLowerCase().includes(q))
})

watch(() => props.open, open => {
  if (!open) return
  selected.value = new Set()
  search.value = ''
  errorMessage.value = ''
  loadRoll()
})

async function loadRoll () {
  if (!props.churchId) return
  loading.value = true

  const { data, error } = await supabase
    .from('members')
    .select('id, first_name, last_name')
    .eq('member_of', props.churchId)
    // Required since 0010 stopped RLS hiding archived rows — an archived member must
    // not be offered for assignment.
    .is('archived_at', null)
    .order('last_name', { ascending: true })

  errorMessage.value = error ? 'Could not load the church roll.' : ''
  roll.value = data || []
  loading.value = false
}

function toggle (id) {
  // A new Set each time: mutating one in place does not retrigger the computed that
  // counts it, so the button would keep saying "Add 0 members".
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

async function submit () {
  if (!selectedCount.value || !props.group) return
  saving.value = true
  errorMessage.value = ''

  // Which table, and which column names the parent, both depend on the kind of group —
  // 0026 split the memberships in two.
  const rows = [...selected.value].map(member_id => ({
    [MEMBERSHIP_PARENT_KEY[props.group.type]]: props.group.id,
    member_id
  }))

  const result = await write(
    supabase.from(MEMBERSHIP_TABLES[props.group.type]).insert(rows),
    {
      columns: 'id, member_id',
      messages: {
        blocked: 'Those members could not be added to this group.',
        conflict: 'Somebody in that selection is already in this group.'
      }
    }
  )

  saving.value = false

  if (!result.ok) {
    errorMessage.value = result.message
    showToast('Could not add to the group.', 'error')
    return
  }

  emit('added', { count: result.rows.length })
  emit('update:open', false)
  showToast(`${result.rows.length} added to ${props.group.name}.`)
}
</script>

<template>
  <Modal
    :open="open"
    :title="`Add to ${group?.name || 'group'}`"
    description="Search the church roll and choose who to add. People already in this group are not listed."
    @update:open="emit('update:open', $event)"
  >
    <div class="am">
      <Input
        v-model="search"
        label="Search"
        placeholder="Search the roll…"
      />

      <p
        v-if="errorMessage"
        class="am__error"
        role="alert"
      >
        {{ errorMessage }}
      </p>

      <p
        v-else-if="loading"
        class="am__note"
      >
        Loading the roll…
      </p>

      <p
        v-else-if="!candidates.length"
        class="am__note"
      >
        <template v-if="search">
          Nobody on the roll matches “{{ search }}”.
        </template>
        <template v-else>
          Everybody on the roll is already in this group.
        </template>
      </p>

      <ul
        v-else
        class="am__list"
      >
        <li
          v-for="m in candidates"
          :key="m.id"
        >
          <label class="am__row">
            <input
              type="checkbox"
              :checked="selected.has(m.id)"
              @change="toggle(m.id)"
            >
            <Avatar :name="`${m.first_name} ${m.last_name}`" />
            <span>{{ m.first_name }} {{ m.last_name }}</span>
          </label>
        </li>
      </ul>
    </div>

    <template #footer>
      <Button
        variant="secondary"
        @click="emit('update:open', false)"
      >
        Cancel
      </Button>
      <Button
        :disabled="!selectedCount || saving"
        @click="submit"
      >
        {{ addLabel }}
      </Button>
    </template>
  </Modal>
</template>

<style scoped>
.am { display: flex; flex-direction: column; gap: var(--sp-12); }
.am__note { margin: 0; color: var(--ink-4); font-size: var(--text-meta); }
.am__error { margin: 0; color: var(--danger, #c0143c); font-size: var(--text-meta); }

/* The list scrolls, the dialog does not — one scrollbar, not the two the old modal
   ended up with when the roster and the dialog both scrolled. */
.am__list {
  list-style: none; margin: 0; padding: 0;
  max-height: 46vh; overflow-y: auto;
  border: 1px solid var(--border); border-radius: var(--r-inset);
}
.am__row {
  display: flex; align-items: center; gap: var(--sp-10);
  padding: var(--sp-8) var(--sp-10); cursor: pointer;
  border-bottom: 1px solid var(--divider);
}
.am__list li:last-child .am__row { border-bottom: 0; }
.am__row:hover { background: var(--surface-subtle); }
</style>

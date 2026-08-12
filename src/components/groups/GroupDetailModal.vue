<script setup>
import { computed, ref, watch } from 'vue'
import Modal from '../ui/Modal.vue'
import Button from '../ui/Button.vue'
import Avatar from '../ui/Avatar.vue'
import Icon from '../ui/icons/Icon.vue'
import { supabase } from '../../lib/supabase'
import { write } from '../../lib/data/write'
import { showToast } from '../../composables/useToast'

// The group, its roll, and dialog 05's "add members" list in one place.
//
// ONE DIALOG RATHER THAN TWO. The mockup draws "Add to Youth Ministry" as its
// own dialog opened from the group page. There is no group page — the card
// opens this — so a second dialog would be a dialog on top of a dialog, which
// is two focus traps competing for one Escape key. The add list lives inside
// instead, revealed by a button.
//
// MULTI-SELECT, ONE INSERT. The mockup's list has checkboxes and its button
// counts them ("Add 3 members"). The old flow added one member per click and
// per round-trip. A single `.insert([...])` is the same capability, fewer
// requests, and — because it is one statement — it cannot half-succeed and
// leave the count on the card disagreeing with the list.

const props = defineProps({
  open: { type: Boolean, default: false },
  group: { type: Object, default: null },
  churchId: { type: String, default: '' },
  // canManageGroupMembers({ isFinanceGroup }) resolved by the parent — the
  // Finance ministry is Pastor-only and that rule lives in capabilities.js.
  canManageMembers: { type: Boolean, default: false },
  canEditGroup: { type: Boolean, default: false }
})

const emit = defineEmits(['update:open', 'request-delete', 'request-rename', 'changed'])

const members = ref([])
const loading = ref(false)
const errorMessage = ref('')

const adding = ref(false)
const search = ref('')
const roll = ref([])
const selected = ref(new Set())
const saving = ref(false)

const isSmallGroup = computed(() => props.group?.type === 'Small Group')

const alreadyIn = computed(() => new Set(members.value.map(gm => gm.member_id)))

// The roll, minus whoever is already here, filtered by what has been typed.
// Capped at eight rows: this is a picker, not a second members screen, and an
// unbounded list inside a dialog scrolls past the button that submits it.
const candidates = computed(() => {
  const q = search.value.trim().toLowerCase()
  return roll.value
    .filter(m => !alreadyIn.value.has(m.id))
    .filter(m => !q || `${m.first_name} ${m.last_name}`.toLowerCase().includes(q))
    .slice(0, 8)
})

const selectedCount = computed(() => selected.value.size)

function nameOf (m) {
  return `${m.first_name} ${m.last_name}`.trim()
}

watch(() => props.open, (open) => {
  if (!open) return
  members.value = []
  errorMessage.value = ''
  adding.value = false
  search.value = ''
  selected.value = new Set()
  loadMembers()
})

async function loadMembers () {
  if (!props.group) return
  loading.value = true
  const { data, error } = await supabase
    .from('group_members')
    .select('id, member_id, members!inner(first_name, last_name, member_of)')
    // Scoped to the active church: a Ministry is global, so without this a
    // SuperAdmin would see every church's assignments in one list.
    .eq('group_id', props.group.id)
    .eq('members.member_of', props.churchId)

  if (error) {
    errorMessage.value = 'Could not load this group’s members.'
    members.value = []
  } else {
    members.value = data || []
  }
  loading.value = false
}

async function loadRoll () {
  if (roll.value.length) return
  const { data } = await supabase
    .from('members')
    .select('id, first_name, last_name')
    .eq('member_of', props.churchId)
    // Required since 0010 stopped RLS hiding archived rows — an archived member
    // must not be offered for assignment.
    .is('archived_at', null)
    .order('last_name', { ascending: true })
  roll.value = data || []
}

function startAdding () {
  adding.value = true
  selected.value = new Set()
  search.value = ''
  loadRoll()
}

function toggle (id) {
  // A new Set each time: mutating one in place does not retrigger the computed
  // that counts it, so the button would keep saying "Add 0 members".
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

async function addSelected () {
  if (!selectedCount.value) return
  saving.value = true
  errorMessage.value = ''

  const rows = [...selected.value].map(member_id => ({ group_id: props.group.id, member_id }))
  const result = await write(
    supabase.from('group_members').insert(rows),
    {
      columns: 'id, member_id, members!inner(first_name, last_name, member_of)',
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

  members.value = [...members.value, ...result.rows]
  emit('changed', { groupId: props.group.id, delta: result.rows.length })
  adding.value = false
  selected.value = new Set()
  showToast(`${result.rows.length} added to ${props.group.name}.`)
}

async function removeMember (gm) {
  const result = await write(
    supabase
      .from('group_members')
      .delete()
      .eq('id', gm.id)
      .eq('group_id', props.group.id)
      .eq('member_id', gm.member_id),
    { columns: 'id', messages: { blocked: 'That member could not be removed from this group.' } }
  )

  // RLS refuses a delete by FILTERING, so without the `.select()` that `write`
  // adds, a refusal returns no error and the row would vanish from this list
  // until the next load brought it back.
  if (!result.ok) {
    showToast(result.message, 'error')
    return
  }

  members.value = members.value.filter(m => m.id !== gm.id)
  emit('changed', { groupId: props.group.id, delta: -1 })
  showToast('Removed from the group.')
}
</script>

<template>
  <Modal
    v-if="group"
    :open="open"
    :title="group.name"
    :description="`${group.type} · ${members.length} ${members.length === 1 ? 'member' : 'members'} in this church`"
    width="lg"
    @update:open="$emit('update:open', $event)"
  >
    <p
      v-if="errorMessage"
      class="gd__error"
      role="alert"
    >
      {{ errorMessage }}
    </p>

    <!-- The roll -->
    <section
      v-if="!adding"
      class="gd__section"
    >
      <div
        v-if="loading"
        class="gd__skeleton"
      >
        <div
          v-for="n in 3"
          :key="n"
          class="skeleton gd__skeleton-row"
        />
      </div>

      <p
        v-else-if="!members.length"
        class="gd__empty"
      >
        Nobody is in this group yet.
      </p>

      <ul
        v-else
        class="gd__list"
      >
        <li
          v-for="gm in members"
          :key="gm.id"
          class="gd__row"
        >
          <Avatar
            :name="nameOf(gm.members)"
            :size="30"
          />
          <span class="gd__name">{{ nameOf(gm.members) }}</span>
          <button
            v-if="canManageMembers"
            type="button"
            class="gd__remove"
            :aria-label="`Remove ${nameOf(gm.members)} from ${group.name}`"
            @click="removeMember(gm)"
          >
            <Icon
              name="close"
              :size="13"
              :width="2.2"
            />
          </button>
        </li>
      </ul>
    </section>

    <!-- Dialog 05, inline -->
    <section
      v-else
      class="gd__section"
    >
      <div class="gd__search">
        <Icon
          name="search"
          :size="16"
          class="gd__search-icon"
        />
        <input
          v-model="search"
          class="gd__search-input"
          type="search"
          placeholder="Search the roll…"
          aria-label="Search the roll"
        >
      </div>

      <p
        v-if="!candidates.length"
        class="gd__empty"
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
        class="gd__list"
      >
        <li
          v-for="m in candidates"
          :key="m.id"
          class="gd__row"
        >
          <label class="gd__pick">
            <input
              type="checkbox"
              class="gd__check"
              :checked="selected.has(m.id)"
              @change="toggle(m.id)"
            >
            <Avatar
              :name="nameOf(m)"
              :size="30"
            />
            <span class="gd__name">{{ nameOf(m) }}</span>
          </label>
        </li>
      </ul>
    </section>

    <template #footer>
      <template v-if="adding">
        <Button
          :disabled="saving"
          @click="adding = false"
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          :loading="saving"
          :disabled="!selectedCount"
          @click="addSelected"
        >
          Add {{ selectedCount }} {{ selectedCount === 1 ? 'member' : 'members' }}
        </Button>
      </template>

      <template v-else>
        <!-- Deleting is only ever offered for a small group the caller's own
             church owns; a Ministry is global and shared with every church. -->
        <Button
          v-if="canEditGroup && isSmallGroup"
          class="footer-left"
          variant="dangerQuiet"
          @click="$emit('request-delete', group)"
        >
          Delete group
        </Button>
        <Button
          v-if="canEditGroup && isSmallGroup"
          @click="$emit('request-rename', group)"
        >
          Rename
        </Button>
        <Button
          v-if="canManageMembers"
          variant="primary"
          @click="startAdding"
        >
          Add members
        </Button>
      </template>
    </template>
  </Modal>
</template>

<style scoped>
.gd__section { display: flex; flex-direction: column; gap: var(--sp-12); }

.gd__error {
  padding: var(--sp-10) var(--sp-12);
  border-radius: var(--r-inset);
  background: var(--magenta-tint);
  border: 1px solid var(--magenta-border);
  font-size: var(--text-body-sm);
  color: var(--magenta-darkest);
}

.gd__empty { font-size: var(--text-body-sm); color: var(--ink-5); padding: var(--sp-10) 0; }

.gd__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  max-height: 320px;
  overflow-y: auto;
}

.gd__row {
  display: flex;
  align-items: center;
  gap: var(--sp-12);
  padding: var(--sp-9) 0;
  border-bottom: 1px solid var(--divider);
}
.gd__row:last-child { border-bottom: 0; }

.gd__pick {
  display: flex;
  align-items: center;
  gap: var(--sp-12);
  flex: 1;
  min-width: 0;
  cursor: pointer;
}

.gd__check { width: 17px; height: 17px; flex: none; accent-color: var(--accent); cursor: pointer; }

.gd__name { flex: 1; min-width: 0; font-size: var(--text-body-sm); font-weight: 600; color: var(--ink); }

.gd__remove {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  flex: none;
  border: 1px solid var(--border-strong);
  border-radius: var(--r-tag);
  background: var(--surface);
  color: var(--ink-5);
  cursor: pointer;
  transition: background-color var(--dur-state) ease, color var(--dur-state) ease;
}
.gd__remove:hover { background: var(--magenta-tint); border-color: var(--magenta-border); color: var(--magenta); }
.gd__remove:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

/* --- Search ------------------------------------------------------------ */
.gd__search { position: relative; display: flex; align-items: center; }
.gd__search-icon { position: absolute; left: var(--sp-12); color: var(--ink-5); pointer-events: none; }

.gd__search-input {
  width: 100%;
  padding: 10px var(--sp-14) 10px 35px;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: var(--r-control);
  font-family: var(--font-sans);
  font-size: var(--text-body);
  color: var(--ink);
}
.gd__search-input:focus {
  outline: 0;
  border-color: var(--accent-border-hi);
  box-shadow: var(--ring-focus);
}

.gd__skeleton { display: flex; flex-direction: column; gap: var(--sp-10); }
.gd__skeleton-row { height: 38px; }
</style>

<script setup>
// Mockup 4d: pick the member record a sign-in belongs to.
//
// THE MOST CONSEQUENTIAL ACTION IN THE SYSTEM. Linking is what turns an account that
// can see nothing into one with a church and a role, so the two things this dialog owes
// the operator are (a) enough detail to tell two people with the same name apart, and
// (b) no invented confidence figure encouraging them to skip that.
//
// BIRTHDATE IS SHOWN FOR EXACTLY THAT REASON. It is PII, and it is on screen here only
// because "Jomar Santos" appears twice in 4d and the birthdate is the thing that
// separates them. Only a Super Admin ever opens this dialog, and only they can read the
// members table at all (0015).
//
// "Create new member record" from 4d is not built — it is a whole member-create form
// inside a dialog and belongs with the Members page work.

import { ref, watch, computed } from 'vue'
import { supabase } from '../../lib/supabase'
import Modal from '../ui/Modal.vue'
import Button from '../ui/Button.vue'
import Avatar from '../ui/Avatar.vue'
import Spinner from '../ui/Spinner.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  account: { type: Object, default: null },
  roleChoices: { type: Array, default: () => [] }
})

const emit = defineEmits(['update:open', 'link'])

const query = ref('')
const rows = ref([])
const searching = ref(false)
const chosen = ref(null)
const role = ref('member')
const errorMessage = ref('')

// Reset every time it opens. A dialog that remembers the last person searched for is
// how the wrong member gets linked to the next account.
watch(() => props.open, isOpen => {
  if (!isOpen) return
  query.value = props.account?.signup_name || ''
  rows.value = []
  chosen.value = null
  role.value = 'member'
  errorMessage.value = ''
  if (query.value) search()
})

async function search () {
  const needle = query.value.trim()
  if (!needle) {
    rows.value = []
    return
  }

  searching.value = true
  errorMessage.value = ''

  const { data, error } = await supabase
    .from('members')
    .select('id, first_name, last_name, birthdate, member_of')
    // Archived members are visible to RLS since 0010; filtering them is the
    // application's job at every read, and an archived person should not be
    // gaining a sign-in.
    .is('archived_at', null)
    .or(`first_name.ilike.%${needle}%,last_name.ilike.%${needle}%`)
    .order('last_name')
    .limit(20)

  searching.value = false

  if (error) {
    errorMessage.value = 'Could not search member records.'
    rows.value = []
    return
  }

  rows.value = data || []
}

const canLink = computed(() => !!chosen.value)

function confirm () {
  if (!chosen.value) return
  emit('link', {
    accountId: props.account.account_id,
    memberId: chosen.value.id,
    memberName: `${chosen.value.first_name} ${chosen.value.last_name}`,
    role: role.value
  })
}
</script>

<template>
  <Modal
    :open="open"
    width="lg"
    :title="account ? `Link ${account.email}` : 'Link account'"
    description="Pick the member record this account belongs to, then give it a role."
    @update:open="emit('update:open', $event)"
  >
    <div class="lam">
      <div class="lam__search">
        <input
          v-model="query"
          type="search"
          class="lam__input"
          placeholder="Search member records by name"
          aria-label="Search member records by name"
          @keyup.enter="search"
        >
        <Button
          size="sm"
          :loading="searching"
          @click="search"
        >
          Search
        </Button>
      </div>

      <p
        v-if="errorMessage"
        class="lam__state lam__state--error"
      >
        {{ errorMessage }}
      </p>

      <p
        v-else-if="searching"
        class="lam__state"
      >
        <Spinner /> Searching…
      </p>

      <p
        v-else-if="query && !rows.length"
        class="lam__state"
      >
        No active member matches that name.
      </p>

      <ul
        v-else-if="rows.length"
        class="lam__list"
      >
        <li
          v-for="member in rows"
          :key="member.id"
        >
          <button
            type="button"
            class="lam__row"
            :class="{ 'is-chosen': chosen && chosen.id === member.id }"
            :aria-pressed="!!chosen && chosen.id === member.id"
            @click="chosen = member"
          >
            <Avatar
              :name="`${member.first_name} ${member.last_name}`"
              :size="28"
            />
            <span class="lam__name">{{ member.first_name }} {{ member.last_name }}</span>
            <!-- The disambiguator. Two members can share a name; this is what tells
                 them apart, and it is the reason this dialog shows a birthdate at all. -->
            <span class="lam__meta">b. {{ member.birthdate }}</span>
          </button>
        </li>
      </ul>

      <div class="lam__role">
        <label
          class="lam__role-label"
          for="lam-role"
        >Role on link</label>
        <select
          id="lam-role"
          v-model="role"
          class="lam__select"
        >
          <option
            v-for="choice in roleChoices"
            :key="choice.value"
            :value="choice.value"
          >
            {{ choice.label }}
          </option>
        </select>
        <span class="lam__role-note">Finance and Secretariat come from ministry membership, not from here.</span>
      </div>
    </div>

    <template #footer>
      <Button @click="emit('update:open', false)">
        Cancel
      </Button>
      <Button
        variant="primary"
        :disabled="!canLink"
        @click="confirm"
      >
        {{ canLink ? `Link to ${chosen.first_name}` : 'Pick a member first' }}
      </Button>
    </template>
  </Modal>
</template>

<style scoped>
.lam { display: flex; flex-direction: column; gap: 12px; }

.lam__search { display: flex; gap: var(--sp-8); }

.lam__input {
  flex: 1;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-control);
  background: var(--surface-subtle);
  font-family: inherit;
  font-size: var(--text-field);
}

.lam__state {
  display: flex;
  align-items: center;
  gap: var(--sp-8);
  margin: 0;
  font-size: var(--text-meta);
  color: var(--ink-3);
}
.lam__state--error { color: var(--magenta-darkest); }

.lam__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 280px;
  overflow-y: auto;
}

.lam__row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 11px 13px;
  border: 1px solid var(--border);
  border-radius: var(--r-inset);
  background: var(--surface);
  cursor: pointer;
  font-family: inherit;
  text-align: left;
}

.lam__row:hover { border-color: var(--accent-border); }
.lam__row:focus-visible { outline: var(--ring-focus); outline-offset: -2px; }

.lam__row.is-chosen {
  border-color: var(--accent);
  background: var(--accent-tint);
}

.lam__name { flex: 1; font-weight: 700; font-size: var(--text-body-sm); }
.lam__meta { font-size: var(--text-meta); color: var(--ink-4); }

.lam__role {
  display: flex;
  align-items: center;
  gap: var(--sp-8);
  flex-wrap: wrap;
  padding-top: 12px;
  border-top: 1px solid var(--divider);
}

.lam__role-label { font-size: var(--text-meta); color: var(--ink-4); }

.lam__select {
  padding: 8px 11px;
  border: 1px solid var(--border);
  border-radius: var(--r-control);
  background: var(--surface);
  font-family: inherit;
  font-size: var(--text-meta);
  font-weight: 600;
  color: var(--ink-2);
}

.lam__role-note { font-size: var(--text-meta); color: var(--ink-4); }
</style>

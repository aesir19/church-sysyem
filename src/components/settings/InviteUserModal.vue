<script setup>
// Invite a member to their account, and tie the sign-in to that member before it is
// even created. MEMBER-FIRST (ADR-0019).
//
// YOU PICK THE PERSON, NOT AN ADDRESS. The invite goes to the e-mail already saved on
// the member's record — the one source of truth — so a mistyped address is impossible.
// This dialog never lets you type an address: it searches members by name and shows,
// on every row, the address the invite would go to. Seeing "jane@…" before you send is
// the cheapest guard against inviting the wrong place.
//
// BIRTHDATE IS THE DISAMBIGUATOR. Two members can share a name (mirrors 4d /
// LinkAccountModal); the birthdate is the thing that tells them apart, and is the only
// reason it is on screen. members RLS already scopes the rows to what the caller may
// invite (every church for a Super Admin, their own for a Church Leader).
//
// A MEMBER WITH NO E-MAIL CANNOT BE INVITED. Their row is shown but disabled, with a
// prompt to add an address first — greyed-out-with-a-reason, not hidden, so you can see
// why the person you want is not selectable. invite_member() enforces the same rule
// server-side; this is only the humane surface of it.

import { ref, watch, computed } from 'vue'
import { supabase } from '../../lib/supabase'
import Modal from '../ui/Modal.vue'
import Button from '../ui/Button.vue'
import Avatar from '../ui/Avatar.vue'
import Spinner from '../ui/Spinner.vue'
import Alert from '../ui/Alert.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  canSetRole: { type: Boolean, default: false },
  roleChoices: { type: Array, default: () => [] },
  sending: { type: Boolean, default: false },
  errorMessage: { type: String, default: '' }
})

const emit = defineEmits(['update:open', 'invite'])

const query = ref('')
const rows = ref([])
const searching = ref(false)
const chosen = ref(null)
const role = ref('unassigned')
const lookupError = ref('')
let lookupToken = 0
let debounce = null

// Reset every time it opens — a form that remembers the last search is how the wrong
// member gets attached to the next invite.
watch(() => props.open, isOpen => {
  if (!isOpen) return
  clearTimeout(debounce)
  query.value = ''
  rows.value = []
  chosen.value = null
  role.value = 'unassigned'
  lookupError.value = ''
})

// The list follows the name box. Every edit clears the current pick — the chosen member
// must always be one that is actually in the list — then, after a short pause, we search.
watch(query, () => {
  clearTimeout(debounce)
  chosen.value = null
  lookupError.value = ''
  if (!query.value.trim()) {
    rows.value = []
    searching.value = false
    return
  }
  searching.value = true
  debounce = setTimeout(searchMembers, 300)
})

async function searchMembers () {
  const needle = query.value.trim()
  const token = ++lookupToken
  searching.value = true
  lookupError.value = ''

  const { data, error } = await supabase
    .from('members')
    .select('id, first_name, last_name, birthdate, member_of, email')
    // Archived members are visible to RLS since 0010; filtering them is the
    // application's job, and an archived person should not be gaining a sign-in.
    .is('archived_at', null)
    .or(`first_name.ilike.%${needle}%,last_name.ilike.%${needle}%`)
    .order('last_name')
    .limit(20)

  // A newer keystroke already started another search; drop this stale result.
  if (token !== lookupToken) return
  searching.value = false

  if (error) {
    lookupError.value = 'Could not search member records.'
    rows.value = []
    return
  }

  rows.value = data || []
}

// Only a member with an address on file can be picked; the server enforces the same.
const hasEmail = member => !!(member.email && member.email.trim())

function choose (member) {
  if (!hasEmail(member)) return
  chosen.value = member
}

const canSend = computed(() => !!chosen.value && !props.sending)

function confirm () {
  if (!canSend.value) return
  emit('invite', {
    memberId: chosen.value.id,
    memberName: `${chosen.value.first_name} ${chosen.value.last_name}`,
    email: chosen.value.email,
    role: props.canSetRole ? role.value : null
  })
}
</script>

<template>
  <Modal
    :open="open"
    width="lg"
    title="Invite a user"
    description="Find the member and send the invitation to the e-mail on their record."
    @update:open="emit('update:open', $event)"
  >
    <div class="iu">
      <Alert
        v-if="errorMessage"
        tone="danger"
      >
        {{ errorMessage }}
      </Alert>

      <div class="iu__field">
        <label
          class="iu__label"
          for="iu-search"
        >Member</label>
        <input
          id="iu-search"
          v-model="query"
          type="search"
          class="iu__input"
          placeholder="Search members by name"
          autocomplete="off"
        >
      </div>

      <div class="iu__field">
        <p
          v-if="lookupError"
          class="iu__state iu__state--error"
        >
          {{ lookupError }}
        </p>
        <p
          v-else-if="!query.trim()"
          class="iu__state"
        >
          Search for the member you want to invite.
        </p>
        <p
          v-else-if="searching"
          class="iu__state"
        >
          <Spinner /> Searching members…
        </p>
        <p
          v-else-if="!rows.length"
          class="iu__state iu__state--warn"
        >
          No active member matches that name.
        </p>

        <ul
          v-else
          class="iu__list"
        >
          <li
            v-for="member in rows"
            :key="member.id"
          >
            <button
              type="button"
              class="iu__row"
              :class="{ 'is-chosen': chosen && chosen.id === member.id, 'is-disabled': !hasEmail(member) }"
              :aria-pressed="!!chosen && chosen.id === member.id"
              :disabled="!hasEmail(member)"
              @click="choose(member)"
            >
              <Avatar
                :name="`${member.first_name} ${member.last_name}`"
                :size="28"
              />
              <span class="iu__who">
                <span class="iu__name">{{ member.first_name }} {{ member.last_name }}</span>
                <!-- Where the invite would go, shown before you send. Or why it can't. -->
                <span
                  v-if="hasEmail(member)"
                  class="iu__email"
                >{{ member.email }}</span>
                <span
                  v-else
                  class="iu__email iu__email--none"
                >No e-mail on file — add one first</span>
              </span>
              <!-- The disambiguator: two members can share a name. -->
              <span class="iu__meta">b. {{ member.birthdate }}</span>
            </button>
          </li>
        </ul>

        <p
          v-if="chosen"
          class="iu__chosen"
        >
          Inviting <strong>{{ chosen.first_name }} {{ chosen.last_name }}</strong> at
          <strong>{{ chosen.email }}</strong>.
        </p>
      </div>

      <div
        v-if="canSetRole"
        class="iu__role"
      >
        <label
          class="iu__role-label"
          for="iu-role"
        >Role</label>
        <select
          id="iu-role"
          v-model="role"
          class="iu__select"
        >
          <option value="unassigned">
            No role yet
          </option>
          <option
            v-for="choice in roleChoices"
            :key="choice.value"
            :value="choice.value"
          >
            {{ choice.label }}
          </option>
        </select>
        <span class="iu__role-note">Finance and Secretariat come from ministry membership, not from here.</span>
      </div>
      <p
        v-else
        class="iu__role-note iu__role-note--block"
      >
        The person joins with no role. A Super Admin assigns one afterwards.
      </p>
    </div>

    <template #footer>
      <Button
        :disabled="sending"
        @click="emit('update:open', false)"
      >
        Cancel
      </Button>
      <Button
        variant="primary"
        :loading="sending"
        :disabled="!canSend"
        @click="confirm"
      >
        {{ chosen ? 'Send invitation' : 'Pick a member first' }}
      </Button>
    </template>
  </Modal>
</template>

<style scoped>
.iu { display: flex; flex-direction: column; gap: var(--sp-16); }

.iu__field { display: flex; flex-direction: column; gap: var(--sp-7); }

.iu__label { font-size: var(--text-meta); font-weight: 700; color: var(--ink-3); }

.iu__input {
  flex: 1;
  padding: var(--sp-10) var(--sp-12);
  border: 1px solid var(--border);
  border-radius: var(--r-control);
  background: var(--surface-subtle);
  font-family: inherit;
  font-size: var(--text-field);
}

.iu__state {
  display: flex;
  align-items: center;
  gap: var(--sp-8);
  margin: 0;
  font-size: var(--text-meta);
  color: var(--ink-3);
}
.iu__state--error { color: var(--magenta-darkest); }
.iu__state--warn { color: var(--magenta-darkest); }

.iu__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-6);
  max-height: 280px;
  overflow-y: auto;
}

.iu__row {
  display: flex;
  align-items: center;
  gap: var(--sp-12);
  width: 100%;
  padding: 11px 13px;
  border: 1px solid var(--border);
  border-radius: var(--r-inset);
  background: var(--surface);
  cursor: pointer;
  font-family: inherit;
  text-align: left;
}
.iu__row:hover { border-color: var(--accent-border); }
.iu__row:focus-visible { outline: var(--ring-focus); outline-offset: -2px; }
.iu__row.is-chosen { border-color: var(--accent); background: var(--accent-tint); }
.iu__row.is-disabled { opacity: 0.55; cursor: not-allowed; }
.iu__row.is-disabled:hover { border-color: var(--border); }

.iu__who { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.iu__name { font-weight: 700; font-size: var(--text-body-sm); }
.iu__email { font-size: var(--text-meta); color: var(--ink-4); overflow-wrap: anywhere; }
.iu__email--none { color: var(--magenta-darkest); }
.iu__meta { font-size: var(--text-meta); color: var(--ink-4); flex: none; }

.iu__chosen {
  margin: 0;
  font-size: var(--text-meta);
  color: var(--ink-3);
}

.iu__role {
  display: flex;
  align-items: center;
  gap: var(--sp-8);
  flex-wrap: wrap;
  padding-top: var(--sp-14);
  border-top: 1px solid var(--divider);
}
.iu__role-label { font-size: var(--text-meta); color: var(--ink-4); }

.iu__select {
  padding: var(--sp-8) 11px;
  border: 1px solid var(--border);
  border-radius: var(--r-control);
  background: var(--surface);
  font-family: inherit;
  font-size: var(--text-meta);
  font-weight: 600;
  color: var(--ink-2);
}

.iu__role-note { font-size: var(--text-meta); color: var(--ink-4); }
.iu__role-note--block { margin: 0; padding-top: var(--sp-14); border-top: 1px solid var(--divider); }
</style>

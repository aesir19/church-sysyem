<script setup>
// Invite a new user, and tie the sign-in to a member before it is even created.
//
// TWO GRANTS IN ONE FORM. An e-mail says who to invite; the member says who they
// are. A Super Admin may also set a role here; a Church Leader may not — they
// invite and link within their own church, and a Super Admin grants the role
// afterwards (mirrors invite_member/0037). `canSetRole` is what draws or hides
// the role row, but the SQL is the enforcement, not this flag.
//
// The member lookup is driven by the e-mail above, not a name search: an invite is
// tied to the member record that already carries that address. It needs no church
// filter of its own — members RLS already scopes the rows to what the caller may
// see (every church for a Super Admin, their own for a Church Leader), which is
// exactly the set each is allowed to invite.

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

const email = ref('')
const rows = ref([])
const looking = ref(false)
const chosen = ref(null)
const role = ref('unassigned')
const lookupError = ref('')
let lookupToken = 0
let debounce = null

// Reset every time it opens — a form that remembers the last invite is how the
// wrong member gets attached to the next e-mail.
watch(() => props.open, isOpen => {
  if (!isOpen) return
  clearTimeout(debounce)
  email.value = ''
  rows.value = []
  chosen.value = null
  role.value = 'unassigned'
  lookupError.value = ''
})

// A light client-side check so an obvious typo is caught before a round trip. The
// server validates for real; this is only to fail fast on an empty or shapeless
// address.
const emailLooksValid = computed(() => /^\S+@\S+\.\S+$/.test(email.value.trim()))

// The list follows the e-mail. Every edit clears the current match — the chosen
// member must always be the one whose address is in the box, never a stale pick
// left over from a previous address — then, once the address is well-formed, we
// look up the member record that carries it.
watch(email, () => {
  clearTimeout(debounce)
  rows.value = []
  chosen.value = null
  lookupError.value = ''
  if (!emailLooksValid.value) {
    looking.value = false
    return
  }
  looking.value = true
  debounce = setTimeout(lookupByEmail, 300)
})

async function lookupByEmail () {
  const needle = email.value.trim()
  const token = ++lookupToken
  looking.value = true
  lookupError.value = ''

  // ilike with no wildcards is an exact, case-insensitive match — the member whose
  // stored e-mail is this address, and no partial-name hits.
  const { data, error } = await supabase
    .from('members')
    .select('id, first_name, last_name, birthdate, member_of')
    .is('archived_at', null)
    .ilike('email', needle)
    .order('last_name')
    .limit(20)

  // A newer keystroke already started another lookup; drop this stale result.
  if (token !== lookupToken) return
  looking.value = false

  if (error) {
    lookupError.value = 'Could not look up member records.'
    rows.value = []
    return
  }

  rows.value = data || []
  // One unambiguous match is the common case — attach it without an extra click.
  chosen.value = rows.value.length === 1 ? rows.value[0] : null
}
const canSend = computed(() => emailLooksValid.value && !!chosen.value && !props.sending)

function confirm () {
  if (!canSend.value) return
  emit('invite', {
    email: email.value.trim(),
    memberId: chosen.value.id,
    memberName: `${chosen.value.first_name} ${chosen.value.last_name}`,
    role: props.canSetRole ? role.value : null
  })
}
</script>

<template>
  <Modal
    :open="open"
    width="lg"
    title="Invite a user"
    description="Send an invitation e-mail and attach the member record it belongs to."
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
          for="iu-email"
        >E-mail address</label>
        <input
          id="iu-email"
          v-model="email"
          type="email"
          class="iu__input"
          placeholder="name@example.com"
          autocomplete="off"
        >
        <span
          v-if="email && !emailLooksValid"
          class="iu__hint iu__hint--warn"
        >That does not look like an e-mail address.</span>
      </div>

      <div class="iu__field">
        <span class="iu__label">Member record</span>

        <p
          v-if="lookupError"
          class="iu__state iu__state--error"
        >
          {{ lookupError }}
        </p>
        <p
          v-else-if="!emailLooksValid"
          class="iu__state"
        >
          Enter an e-mail address above to find its member record.
        </p>
        <p
          v-else-if="looking"
          class="iu__state"
        >
          <Spinner /> Looking up member records…
        </p>
        <p
          v-else-if="!rows.length"
          class="iu__state iu__state--warn"
        >
          No member record has this e-mail address.
        </p>

        <ul
          v-else-if="rows.length"
          class="iu__list"
        >
          <li
            v-for="member in rows"
            :key="member.id"
          >
            <button
              type="button"
              class="iu__row"
              :class="{ 'is-chosen': chosen && chosen.id === member.id }"
              :aria-pressed="!!chosen && chosen.id === member.id"
              @click="chosen = member"
            >
              <Avatar
                :name="`${member.first_name} ${member.last_name}`"
                :size="28"
              />
              <span class="iu__name">{{ member.first_name }} {{ member.last_name }}</span>
              <!-- Same disambiguator as the linking dialog: two members can share a
                   name, and the birthdate is what tells them apart. -->
              <span class="iu__meta">b. {{ member.birthdate }}</span>
            </button>
          </li>
        </ul>

        <p
          v-if="chosen"
          class="iu__chosen"
        >
          Inviting <strong>{{ email || 'this address' }}</strong> as
          <strong>{{ chosen.first_name }} {{ chosen.last_name }}</strong>.
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
.iu { display: flex; flex-direction: column; gap: 16px; }

.iu__field { display: flex; flex-direction: column; gap: 7px; }

.iu__label { font-size: var(--text-meta); font-weight: 700; color: var(--ink-3); }

.iu__input {
  flex: 1;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-control);
  background: var(--surface-subtle);
  font-family: inherit;
  font-size: var(--text-field);
}

.iu__hint { font-size: var(--text-meta); color: var(--ink-4); }
.iu__hint--warn { color: var(--magenta-darkest); }

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
  gap: 6px;
  max-height: 240px;
  overflow-y: auto;
}

.iu__row {
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
.iu__row:hover { border-color: var(--accent-border); }
.iu__row:focus-visible { outline: var(--ring-focus); outline-offset: -2px; }
.iu__row.is-chosen { border-color: var(--accent); background: var(--accent-tint); }

.iu__name { flex: 1; font-weight: 700; font-size: var(--text-body-sm); }
.iu__meta { font-size: var(--text-meta); color: var(--ink-4); }

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
  padding-top: 14px;
  border-top: 1px solid var(--divider);
}
.iu__role-label { font-size: var(--text-meta); color: var(--ink-4); }

.iu__select {
  padding: 8px 11px;
  border: 1px solid var(--border);
  border-radius: var(--r-control);
  background: var(--surface);
  font-family: inherit;
  font-size: var(--text-meta);
  font-weight: 600;
  color: var(--ink-2);
}

.iu__role-note { font-size: var(--text-meta); color: var(--ink-4); }
.iu__role-note--block { margin: 0; padding-top: 14px; border-top: 1px solid var(--divider); }
</style>

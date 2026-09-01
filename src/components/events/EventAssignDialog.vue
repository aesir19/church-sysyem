<script setup>
// Assign someone to a role (frame 7f). Spec #87, the rule-3 surface: eligibility and
// clash are shown BEFORE the choice, so the dialog prevents mistakes rather than
// reporting them (story 42).
//
// TWO WAYS IN. A church member (searched through the directory) or a named guest — a guest
// also covers a helper from another church (Q1), since the directory wall stops us browsing
// another church's roster. A finance-required role (story 9) accepts ONLY a finance-team
// member: the guest tab is closed for it, and non-finance members show as "not eligible"
// with the reason. The affordance is the dim; the DB guard (0035) is the enforcement.

import { ref, computed, watch } from 'vue'
import Modal from '../ui/Modal.vue'
import Button from '../ui/Button.vue'
import Input from '../ui/Input.vue'
import Badge from '../ui/Badge.vue'
import Alert from '../ui/Alert.vue'
import { listDirectory } from '../../lib/data/members'
import { assignMember, assignGuest, findPersonClashes } from '../../lib/data/eventRoles'

const props = defineProps({
  open: { type: Boolean, default: false },
  event: { type: Object, default: null },
  role: { type: Object, default: null },
})
const emit = defineEmits(['update:open', 'assigned'])

const mode = ref('member')
const query = ref('')
const results = ref([])
const searching = ref(false)
const selected = ref(null)
const clashes = ref([])
const checkingClash = ref(false)
const guest = ref({ name: '', contact: '', affiliation: '' })
const busy = ref(false)
const errorMsg = ref('')

const requiresFinance = computed(() => !!props.role?.requires_finance)

// A finance-required role cannot take a guest (Q7); force the member tab.
watch(() => props.open, (isOpen) => {
  if (isOpen) {
    mode.value = 'member'
    query.value = ''
    results.value = []
    selected.value = null
    clashes.value = []
    guest.value = { name: '', contact: '', affiliation: '' }
    errorMsg.value = ''
  }
})

let searchTimer = null
watch(query, (q) => {
  clearTimeout(searchTimer)
  selected.value = null
  clashes.value = []
  if (q.trim().length < 2) { results.value = []; return }
  searchTimer = setTimeout(runSearch, 250)
})

async function runSearch() {
  if (!props.event?.church_id) return
  searching.value = true
  const res = await listDirectory(props.event.church_id, { query: query.value.trim() })
  searching.value = false
  results.value = res.ok ? (res.rows || []) : []
}

function fullName(m) {
  return [m.first_name, m.middle_name, m.last_name].filter(Boolean).join(' ').trim()
}

// The directory returns ministry NAMES; a finance member is one whose ministries name
// finance. Used only to dim the ineligible — the write path is the real gate.
function isFinanceMember(m) {
  return (m.ministries || []).some((n) => /financ/i.test(n))
}
function eligible(m) {
  return !requiresFinance.value || isFinanceMember(m)
}

async function pick(m) {
  if (!eligible(m)) return
  selected.value = m
  clashes.value = []
  if (!props.event?.starts_at) return
  checkingClash.value = true
  clashes.value = await findPersonClashes({
    churchId: props.event.church_id,
    memberId: m.id,
    startsAt: props.event.starts_at,
    endsAt: props.event.ends_at,
    excludeEventId: props.event.id,
  })
  checkingClash.value = false
}

async function confirmMember() {
  if (!selected.value) return
  busy.value = true
  errorMsg.value = ''
  const res = await assignMember({
    eventId: props.event.id, churchId: props.event.church_id,
    roleId: props.role.id, memberId: selected.value.id,
  })
  busy.value = false
  if (!res.ok) { errorMsg.value = res.message; return }
  emit('assigned')
  emit('update:open', false)
}

const guestValid = computed(() => guest.value.name.trim().length > 0)
async function confirmGuest() {
  if (!guestValid.value) return
  busy.value = true
  errorMsg.value = ''
  const res = await assignGuest({
    eventId: props.event.id, churchId: props.event.church_id, roleId: props.role.id,
    guestName: guest.value.name.trim(),
    guestContact: guest.value.contact.trim() || null,
    guestAffiliation: guest.value.affiliation.trim() || null,
  })
  busy.value = false
  if (!res.ok) { errorMsg.value = res.message; return }
  emit('assigned')
  emit('update:open', false)
}

function fmtWhen(iso) {
  return iso ? new Date(iso).toLocaleDateString('en-PH', { day: 'numeric', month: 'short' }) : ''
}
</script>

<template>
  <Modal
    :open="open"
    :title="`Assign to ${role?.label || 'role'}`"
    description="Add a church member or a named guest to this role."
    layout="stack"
    @update:open="emit('update:open', $event)"
  >
    <div class="asg">
      <div
        class="asg__tabs"
        role="tablist"
      >
        <button
          class="asg__tab"
          :class="{ 'is-on': mode === 'member' }"
          role="tab"
          @click="mode = 'member'"
        >
          Member
        </button>
        <button
          class="asg__tab"
          :class="{ 'is-on': mode === 'guest' }"
          role="tab"
          :disabled="requiresFinance"
          :title="requiresFinance ? 'A finance-required role must be a finance-team member' : ''"
          @click="mode = 'guest'"
        >
          Guest
        </button>
      </div>

      <Alert
        v-if="requiresFinance"
        tone="accent"
      >
        This role counts the offering, so only finance-team members can be assigned.
      </Alert>

      <!-- Member search -->
      <div v-if="mode === 'member'">
        <Input
          v-model="query"
          label="Search members"
          placeholder="Type a name…"
        />
        <p
          v-if="searching"
          class="asg__muted"
        >
          Searching…
        </p>
        <ul
          v-else-if="results.length"
          class="asg__results"
        >
          <li
            v-for="m in results"
            :key="m.id"
            class="asg__result"
            :class="{ 'is-off': !eligible(m), 'is-sel': selected?.id === m.id }"
          >
            <button
              class="asg__result-btn"
              :disabled="!eligible(m)"
              @click="pick(m)"
            >
              <span class="asg__result-name">{{ fullName(m) }}</span>
              <Badge
                v-if="!eligible(m)"
                tone="neutral"
              >
                Not eligible — not on finance team
              </Badge>
              <Badge
                v-else-if="isFinanceMember(m)"
                tone="success"
              >
                Finance
              </Badge>
            </button>
          </li>
        </ul>
        <p
          v-else-if="query.trim().length >= 2"
          class="asg__muted"
        >
          No members match “{{ query }}”.
        </p>

        <!-- Clash shown BEFORE the choice is confirmed (story 42) -->
        <Alert
          v-if="selected && clashes.length"
          tone="warning"
        >
          <strong>{{ fullName(selected) }}</strong> already has a duty that overlaps this time:
          <span
            v-for="c in clashes"
            :key="c.eventId"
          >“{{ c.title }}” ({{ fmtWhen(c.starts_at) }})</span>. You can assign anyway.
        </Alert>
        <p
          v-else-if="selected && checkingClash"
          class="asg__muted"
        >
          Checking for clashes…
        </p>
        <p
          v-else-if="selected"
          class="asg__ok"
        >
          {{ fullName(selected) }} is free at this time.
        </p>
      </div>

      <!-- Guest entry -->
      <div
        v-else
        class="asg__guest"
      >
        <Input
          v-model="guest.name"
          label="Guest name"
          placeholder="e.g. Ptr. Dan Cruz"
          required
        />
        <Input
          v-model="guest.contact"
          label="Contact"
          placeholder="Phone or email"
          optional
        />
        <Input
          v-model="guest.affiliation"
          label="From (church or group)"
          placeholder="e.g. UDFC Cogon"
          optional
        />
      </div>

      <Alert
        v-if="errorMsg"
        tone="danger"
      >
        {{ errorMsg }}
      </Alert>
    </div>

    <template #footer>
      <Button
        variant="secondary"
        @click="emit('update:open', false)"
      >
        Cancel
      </Button>
      <Button
        v-if="mode === 'member'"
        variant="primary"
        :disabled="!selected"
        :loading="busy"
        @click="confirmMember"
      >
        {{ selected && clashes.length ? 'Assign anyway' : 'Assign' }}
      </Button>
      <Button
        v-else
        variant="primary"
        :disabled="!guestValid"
        :loading="busy"
        @click="confirmGuest"
      >
        Add guest
      </Button>
    </template>
  </Modal>
</template>

<style scoped>
.asg { display: flex; flex-direction: column; gap: var(--sp-12); }
.asg__tabs { display: inline-flex; gap: 2px; padding: 3px; background: var(--surface-subtle-2, var(--surface)); border: 1px solid var(--border); border-radius: var(--r-control); width: fit-content; }
.asg__tab { border: none; background: transparent; padding: 6px 16px; border-radius: calc(var(--r-control) - 3px); font: inherit; font-size: var(--text-body-sm); font-weight: 700; color: var(--ink-5); cursor: pointer; }
.asg__tab.is-on { background: var(--surface); color: var(--ink); box-shadow: var(--shadow-1, 0 1px 2px rgba(0,0,0,.08)); }
.asg__tab:disabled { opacity: .4; cursor: not-allowed; }
.asg__results { list-style: none; margin: var(--sp-10) 0 0; padding: 0; max-height: 240px; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
.asg__result-btn { width: 100%; display: flex; align-items: center; gap: var(--sp-10); padding: var(--sp-9) var(--sp-10); border: 1px solid transparent; border-radius: var(--r-control); background: transparent; font: inherit; text-align: left; cursor: pointer; }
.asg__result-btn:hover:not(:disabled) { background: var(--surface-subtle-2, var(--hover, rgba(0,0,0,.03))); }
.asg__result.is-sel .asg__result-btn { border-color: var(--accent); background: var(--accent-soft, rgba(0,0,0,.04)); }
.asg__result-btn:disabled { cursor: not-allowed; opacity: .6; }
.asg__result-name { flex: 1; min-width: 0; font-size: var(--text-body-sm); font-weight: 600; }
.asg__guest { display: flex; flex-direction: column; gap: var(--sp-10); }
.asg__muted { margin: var(--sp-8) 0 0; font-size: var(--text-meta); color: var(--ink-5); }
.asg__ok { margin: var(--sp-8) 0 0; font-size: var(--text-meta); color: var(--good, var(--ink-5)); font-weight: 600; }
</style>

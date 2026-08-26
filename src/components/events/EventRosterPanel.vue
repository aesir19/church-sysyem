<script setup>
// The volunteer roster (frame 6b left column, lower card). Spec #87. A "N filled of M"
// gauge with a bar + % in the header (story 2), the roles an event needs (stories 1–5),
// and the people in them shown as avatar + name + status (stories 6–14). Separate from the
// programme (Q11). Read for anyone who can view the event; the assign/remove/add controls
// are canManageEvents only. The "Add a role" form is tucked behind a button so the card
// reads as a roster, not an editor — matching 6b.

import { ref, computed, onMounted } from 'vue'
import Card from '../ui/Card.vue'
import Button from '../ui/Button.vue'
import Input from '../ui/Input.vue'
import Toggle from '../ui/Toggle.vue'
import Spinner from '../ui/Spinner.vue'
import EventAssignDialog from './EventAssignDialog.vue'
import { useToast } from '../../composables/useToast'
import { listRoster, addRole, deleteRole, unassign } from '../../lib/data/eventRoles'

const props = defineProps({
  event: { type: Object, required: true },
  canManage: { type: Boolean, default: false },
})
const emit = defineEmits(['totals'])

const { showToast } = useToast()
const loading = ref(true)
const roles = ref([])
const adding = ref(false)
const newRole = ref({ label: '', count: 1, requiresFinance: false })
const busy = ref(false)
const assignOpen = ref(false)
const assignRole = ref(null)

const totals = computed(() => {
  let filled = 0, needed = 0
  for (const r of roles.value) { filled += Math.min(r.filled, r.count_required); needed += r.count_required }
  return { filled, needed }
})
const gaugePct = computed(() => (totals.value.needed ? Math.round((totals.value.filled / totals.value.needed) * 100) : 0))

async function load() {
  loading.value = true
  const res = await listRoster({ eventId: props.event.id })
  roles.value = res.ok ? res.roles : []
  loading.value = false
  emit('totals', totals.value)
}
onMounted(load)

// Open slots on a role = the count still needed after the confirmed/offered people.
function openSlots(role) { return Math.max(0, role.count_required - role.filled) }

// A filled role reads "Confirmed" (green) in 6b's right column; if anyone is only offered,
// it reads "Offered" (amber). Null while a slot is still open — the Assign button shows instead.
function roleStatus(role) {
  const a = role.assignments || []
  if (!a.length || openSlots(role)) return null
  return a.every((x) => x.status === 'confirmed') ? 'confirmed' : 'offered'
}

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase()
}

async function doAddRole() {
  if (!newRole.value.label.trim()) return
  busy.value = true
  const res = await addRole({
    eventId: props.event.id, churchId: props.event.church_id,
    label: newRole.value.label.trim(),
    countRequired: Math.max(1, Number(newRole.value.count) || 1),
    requiresFinance: newRole.value.requiresFinance,
  })
  busy.value = false
  if (!res.ok) { showToast(res.message, 'error'); return }
  newRole.value = { label: '', count: 1, requiresFinance: false }
  adding.value = false
  await load()
}

async function doDeleteRole(role) {
  const res = await deleteRole(role.id)
  if (!res.ok) { showToast(res.message, 'error'); return }
  await load()
}

function openAssign(role) {
  assignRole.value = role
  assignOpen.value = true
}
async function onAssigned() {
  showToast('Assigned')
  await load()
}

async function doUnassign(a) {
  const res = await unassign(a.id)
  if (!res.ok) { showToast(res.message, 'error'); return }
  await load()
}
</script>

<template>
  <Card :padded="false">
    <div class="rost__head">
      <div>
        <h2 class="rost__title">
          Volunteer roles
        </h2>
        <p
          v-if="roles.length"
          class="rost__sub"
        >
          {{ totals.filled }} filled of {{ totals.needed }}
        </p>
      </div>
      <span
        v-if="roles.length"
        class="rost__gauge"
      >
        <span class="rost__bar"><span
          class="rost__bar-fill"
          :style="{ width: gaugePct + '%' }"
        /></span>
        <span class="rost__pct">{{ gaugePct }}%</span>
      </span>
    </div>

    <div
      v-if="loading"
      class="rost__loading"
    >
      <Spinner label="Loading roster" />
    </div>

    <template v-else>
      <!-- Empty vs. unfilled are different pictures (story 40). -->
      <p
        v-if="!roles.length"
        class="rost__empty"
      >
        No roles declared yet.<template v-if="canManage">
          Add the roles this event needs.
        </template>
      </p>

      <ul
        v-else
        class="rost__roles"
      >
        <li
          v-for="role in roles"
          :key="role.id"
          class="rost__role"
        >
          <div class="rost__role-cell">
            <span class="rost__role-label">
              {{ role.label }}<span
                v-if="role.count_required > 1"
                class="rost__mult"
              >×{{ role.count_required }}</span>
            </span>
            <span
              v-if="role.requires_finance"
              class="rost__role-note"
            >Finance role required</span>
          </div>

          <!-- Middle column: the people in the role, or "Nobody yet" (6b). -->
          <div class="rost__who">
            <div
              v-for="a in role.assignments"
              :key="a.id"
              class="rost__person"
            >
              <span
                class="rost__avatar"
                :class="{ 'is-guest': a.isGuest }"
              >{{ a.isGuest ? '★' : initials(a.displayName) }}</span>
              <span class="rost__person-name">{{ a.displayName }}</span>
              <span
                v-if="a.isGuest"
                class="rost__guest-tag"
              >Guest</span>
              <button
                v-if="canManage"
                class="rost__x"
                title="Remove"
                @click="doUnassign(a)"
              >
                ✕
              </button>
            </div>
            <span
              v-if="!role.assignments.length"
              class="rost__nobody"
            >Nobody yet</span>
          </div>

          <!-- Right column: Confirmed/Offered when full, else the Assign action (6b). -->
          <div class="rost__act">
            <span
              v-if="roleStatus(role) === 'confirmed'"
              class="rost__stat is-confirmed"
            >Confirmed</span>
            <span
              v-else-if="roleStatus(role) === 'offered'"
              class="rost__stat is-offered"
            >Offered</span>
            <button
              v-else-if="canManage"
              class="rost__assign"
              @click="openAssign(role)"
            >
              Assign
            </button>
            <span
              v-else
              class="rost__stat is-open"
            >{{ openSlots(role) }} needed</span>
          </div>

          <button
            v-if="canManage"
            class="rost__role-x"
            title="Remove role"
            @click="doDeleteRole(role)"
          >
            ✕
          </button>
        </li>
      </ul>

      <!-- Add a role — behind a button, so the card reads as a roster (6b). -->
      <div
        v-if="canManage"
        class="rost__foot"
      >
        <button
          v-if="!adding"
          class="rost__addlink"
          @click="adding = true"
        >
          + Add a role
        </button>
        <div
          v-else
          class="rost__addform"
        >
          <Input
            v-model="newRole.label"
            label="Role"
            placeholder="e.g. Usher, Sound, Offering counter"
          />
          <div class="rost__addrow">
            <label class="rost__count">
              <span class="rost__count-label">How many</span>
              <input
                v-model.number="newRole.count"
                class="rost__count-input"
                type="number"
                min="1"
              >
            </label>
            <Toggle v-model="newRole.requiresFinance">
              Finance role (counts the offering)
            </Toggle>
          </div>
          <div class="rost__addbtns">
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
              :disabled="!newRole.label.trim()"
              @click="doAddRole"
            >
              Add role
            </Button>
          </div>
        </div>
      </div>
    </template>

    <EventAssignDialog
      v-model:open="assignOpen"
      :event="event"
      :role="assignRole"
      @assigned="onAssigned"
    />
  </Card>
</template>

<style scoped>
.rost__head { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-12); padding: var(--sp-16) var(--sp-20); border-bottom: 1px solid var(--border-subtle, var(--border)); }
.rost__title { margin: 0; font-size: var(--text-h3); font-weight: 800; letter-spacing: -0.02em; }
.rost__sub { margin: 3px 0 0; font-size: var(--text-meta); color: var(--ink-5); }
.rost__gauge { display: flex; align-items: center; gap: var(--sp-9); }
.rost__bar { width: 120px; height: 6px; border-radius: var(--r-pill); background: var(--surface-subtle-2, var(--border)); overflow: hidden; }
.rost__bar-fill { display: block; height: 100%; border-radius: var(--r-pill); background: var(--accent); transition: width .5s cubic-bezier(.2,.8,.2,1); }
.rost__pct { font-size: var(--text-meta); font-weight: 800; color: var(--accent); font-variant-numeric: tabular-nums; }
.rost__loading { display: grid; place-items: center; min-height: 80px; }
.rost__empty { margin: 0; padding: var(--sp-16) var(--sp-20); font-size: var(--text-body-sm); color: var(--ink-5); }

.rost__roles { list-style: none; margin: 0; padding: 0; }
.rost__role { position: relative; display: grid; grid-template-columns: 1fr minmax(140px, 200px) 110px; gap: var(--sp-14); align-items: center; padding: var(--sp-14) var(--sp-20); border-bottom: 1px solid var(--border-subtle, var(--border)); transition: background .16s; }
.rost__role:last-child { border-bottom: none; }
.rost__role:hover { background: var(--surface-subtle-2, #fbfcfd); }
.rost__role-cell { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.rost__role-label { font-size: var(--text-body-sm); font-weight: 700; }
.rost__mult { margin-left: 5px; font-weight: 700; color: var(--ink-5); }
.rost__role-note { font-size: var(--text-meta); color: var(--ink-5); }

.rost__who { display: flex; flex-direction: column; gap: var(--sp-6); min-width: 0; }
.rost__person { display: flex; align-items: center; gap: var(--sp-8); min-width: 0; }
.rost__avatar { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; flex: none; border-radius: 50%; background: var(--accent-tint, var(--surface-subtle-2, #e9f8ff)); color: var(--accent); font-weight: 800; font-size: 10.5px; }
.rost__avatar.is-guest { background: var(--surface-subtle-2, #f2f4f7); color: var(--ink-3); }
.rost__person-name { font-size: var(--text-body-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rost__guest-tag { flex: none; font-size: 10px; font-weight: 800; letter-spacing: .03em; text-transform: uppercase; color: var(--ink-5); background: var(--surface-subtle-2, #f2f4f7); border-radius: var(--r-pill); padding: 2px 7px; }
.rost__nobody { font-size: var(--text-body-sm); color: var(--accent-deep, #aa0b56); font-weight: 600; }
.rost__x { border: none; background: transparent; color: var(--ink-5); cursor: pointer; font-size: 12px; padding: 2px 4px; border-radius: var(--r-control); opacity: 0; transition: opacity .15s; }
.rost__person:hover .rost__x { opacity: 1; }
.rost__x:hover { color: var(--danger, #d92d20); }

.rost__act { justify-self: end; }
.rost__stat { font-size: var(--text-meta); font-weight: 700; white-space: nowrap; }
.rost__stat.is-confirmed { color: var(--good, #0e7a4f); }
.rost__stat.is-offered { color: var(--warn, #b54708); }
.rost__stat.is-open { color: var(--ink-5); }
.rost__assign { padding: 7px 14px; border: 1px solid var(--border-strong); background: var(--surface); border-radius: 9px; font: inherit; font-size: var(--text-meta); font-weight: 700; color: var(--accent); cursor: pointer; transition: background .15s, border-color .15s; }
.rost__assign:hover { background: var(--accent-tint, #e9f8ff); border-color: var(--accent); }
/* Role delete floats over the row edge on hover, so it never breaks the fixed 3-column grid. */
.rost__role-x { position: absolute; top: 6px; right: 6px; border: none; background: transparent; color: var(--ink-6, var(--ink-5)); cursor: pointer; font-size: 11px; padding: 4px; border-radius: var(--r-control); opacity: 0; transition: opacity .15s; }
.rost__role:hover .rost__role-x { opacity: .6; }
.rost__role-x:hover { color: var(--danger, #d92d20); opacity: 1; }

.rost__foot { padding: var(--sp-14) var(--sp-20); border-top: 1px solid var(--border-subtle, var(--border)); }
.rost__addlink { border: none; background: none; color: var(--accent); font: inherit; font-size: var(--text-body-sm); font-weight: 700; cursor: pointer; padding: 0; }
.rost__addform { display: flex; flex-direction: column; gap: var(--sp-10); }
.rost__addrow { display: flex; align-items: center; gap: var(--sp-14); flex-wrap: wrap; }
.rost__count { display: flex; flex-direction: column; gap: var(--sp-5); }
.rost__count-label { font-size: var(--text-meta); font-weight: 700; color: var(--ink-3); }
.rost__count-input { width: 80px; padding: 8px 10px; border: 1px solid var(--border-strong); border-radius: var(--r-control); background: var(--surface); font: inherit; font-size: var(--text-body-sm); color: var(--ink); }
.rost__addbtns { display: flex; gap: var(--sp-8); }
</style>

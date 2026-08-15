<script setup>
// The gear on the account card, and the menu behind it (mockup 4c).
//
// HAND-ROLLED, NOT REKA. The Dialog ADR scopes that dependency to Dialog and says
// everything else stays hand-rolled or native. A menu is a much smaller problem than a
// focus trap: close on Escape, close on outside click, restore focus to the trigger.
// All three are here.
//
// ENTRIES ARE HIDDEN, NOT LOCKED — and that is a deliberate departure from the nav,
// which shows a forbidden item greyed rather than removing it. The two surfaces answer
// different questions. The nav advertises what the product contains, so hiding an item
// would make a permission failure silent. This is a menu of administrative actions on a
// card the user is already looking at; listing things they can never do would be noise.
// The direct-URL case is still loud — the settings views render a "not yours to open"
// page rather than an empty shell.
//
// Sign out moves in here, which is what the comment in AppSidebar has been waiting for:
// it was parked next to the theme toggle because the screen it belongs on did not exist.

import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useCurrentRole } from '../composables/useCurrentRole'
import { useSession } from '../composables/useSession'
import { listAccounts } from '../lib/data/admin'
import Icon from './ui/icons/Icon.vue'
import Soon from './ui/Soon.vue'

// The waiting count is fetched here rather than passed in. It is one cheap RPC, only
// for a Super Admin, and keeping it local means the sidebar does not have to know that
// this menu has a queue behind it.
const router = useRouter()
const route = useRoute()
const { signOut } = useSession()
const { caps, role } = useCurrentRole()

// 4c heads the menu with the role, not just the word Settings — "SETTINGS ·
// SUPERADMIN". It answers "what am I allowed to do here" before the list does.
const ROLE_LABEL = {
  super_admin: 'Super Admin',
  head_pastor: 'Head Pastor',
  pastor: 'Pastor',
  church_leader: 'Church Leader',
  member: 'Member'
}
const heading = computed(() => {
  const label = ROLE_LABEL[role.value]
  return label ? `Settings · ${label}` : 'Settings'
})

const open = ref(false)
const root = ref(null)
const trigger = ref(null)

// null until we know. A zero here would claim the queue is empty before it has been
// read, which is the same lie as a Soon tile showing a figure.
const waitingCount = ref(null)

const canManageAccounts = computed(() => !!caps.value.isSuperAdmin)
const canAssignPastors = computed(() => !!caps.value.isSuperAdmin || !!caps.value.isHeadPastor)

const entries = computed(() => {
  const list = []

  if (canManageAccounts.value) {
    list.push({
      key: 'roles',
      label: 'Roles & account linking',
      hint: waitingCount.value ? `${waitingCount.value} awaiting a link` : 'Tie a sign-in to a member',
      to: '/dashboard/settings/roles'
    })
  }

  if (canAssignPastors.value) {
    list.push({
      key: 'pastors',
      label: 'Pastor assignment',
      hint: 'Who pastors which church',
      to: '/dashboard/settings/pastors'
    })
  }

  // Drawn in 4c, not built. Shown to the roles that will be able to use them, so the
  // shape of the administration area is visible from the first release — and withheld
  // from those who never will, which is the visibility rule above still applying.
  if (canManageAccounts.value) {
    list.push(
      { key: 'profile', label: 'Church profile', hint: 'Name, address, schedule', soon: 'church profiles are not editable yet' },
      { key: 'checkin', label: 'Check-in link & QR', hint: "Rotate a church's token", soon: 'rotation is not built yet' },
      { key: 'audit', label: 'Audit log', hint: 'Who changed what', soon: 'there is no audit log yet' }
    )
  }

  return list
})

const badge = computed(() => (canManageAccounts.value && waitingCount.value ? waitingCount.value : null))

function close (returnFocus = true) {
  if (!open.value) return
  open.value = false
  if (returnFocus) trigger.value?.focus()
}

function go (entry) {
  if (entry.soon) return
  close(false)
  router.push(entry.to)
}

function onSignOut () {
  close(false)
  signOut()
}

function onPointerDown (event) {
  if (root.value && !root.value.contains(event.target)) close(false)
}

function onKeydown (event) {
  if (event.key === 'Escape') close()
}

onMounted(async () => {
  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('keydown', onKeydown)

  if (canManageAccounts.value) {
    const res = await listAccounts({ canManageAccounts: true })
    // Left at null on failure. Better no badge than a wrong one.
    if (res.ok) waitingCount.value = res.waiting.length
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointerDown, true)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div
    ref="root"
    class="sm"
  >
    <button
      ref="trigger"
      type="button"
      class="sm__gear"
      :class="{ 'is-open': open }"
      :aria-expanded="open"
      aria-haspopup="menu"
      :aria-label="badge ? `Settings, ${badge} accounts awaiting a link` : 'Settings'"
      @click="open = !open"
    >
      <Icon
        name="settings"
        :size="15"
        :width="1.9"
      />
      <span
        v-if="badge"
        class="sm__badge"
      >{{ badge }}</span>
    </button>

    <div
      v-if="open"
      class="sm__menu"
      role="menu"
    >
      <p class="sm__head">
        {{ heading }}
      </p>

      <button
        v-for="entry in entries"
        :key="entry.key"
        type="button"
        role="menuitem"
        class="sm__item"
        :class="{ 'is-soon': entry.soon, 'is-current': entry.to && route.path === entry.to }"
        :aria-current="entry.to && route.path === entry.to ? 'page' : undefined"
        :disabled="!!entry.soon"
        :title="entry.soon || undefined"
        @click="go(entry)"
      >
        <span class="sm__label">
          {{ entry.label }}
          <Soon
            v-if="entry.soon"
            :waiting-on="entry.soon"
          />
        </span>
        <span class="sm__hint">{{ entry.hint }}</span>
      </button>

      <div class="sm__rule" />

      <button
        type="button"
        role="menuitem"
        class="sm__item sm__item--plain"
        @click="onSignOut"
      >
        <span class="sm__label">Sign out</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.sm { position: relative; display: inline-flex; }

.sm__gear {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--border);
  border-radius: var(--r-control);
  background: var(--surface);
  color: var(--ink-3);
  cursor: pointer;
  transition: background var(--dur-state), color var(--dur-state), border-color var(--dur-state);
}

.sm__gear:hover,
.sm__gear.is-open {
  background: var(--accent-tint);
  border-color: var(--accent-border);
  color: var(--accent-darkest);
}

.sm__gear:focus-visible { outline: var(--ring-focus); outline-offset: 2px; }

.sm__badge {
  position: absolute;
  top: -5px;
  right: -5px;
  min-width: 15px;
  height: 15px;
  padding: 0 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--r-pill);
  background: var(--magenta);
  color: #fff;
  font-size: 9.5px;
  font-weight: 800;
  line-height: 1;
}

.sm__menu {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  z-index: 40;
  width: 228px;
  padding: 7px;
  border: 1px solid var(--border);
  border-radius: 13px;
  background: var(--surface);
  box-shadow: var(--shadow-popover);
}

.sm__head {
  margin: 0;
  padding: 7px 10px 6px;
  font-size: var(--text-eyebrow);
  font-weight: 700;
  letter-spacing: var(--tracking-eyebrow);
  text-transform: uppercase;
  color: var(--ink-4);
}

.sm__item {
  display: flex;
  flex-direction: column;
  gap: 1px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  font-family: inherit;
}

.sm__item:hover:not(:disabled) { background: var(--accent-tint); }

/* The page you are on. 4c tints the row and turns the label accent — a current
   marker, not a hover state, so it survives the pointer leaving. */
.sm__item.is-current { background: var(--accent-tint); }
.sm__item.is-current .sm__label { color: var(--accent-darkest); }
.sm__item:focus-visible { outline: var(--ring-focus); outline-offset: -2px; }

.sm__item.is-soon { cursor: not-allowed; }
.sm__item.is-soon .sm__label { color: var(--ink-4); }

.sm__label {
  display: flex;
  align-items: center;
  gap: var(--sp-8);
  font-size: var(--text-body-sm);
  font-weight: 700;
  color: var(--ink);
}

.sm__hint {
  font-size: var(--text-meta);
  color: var(--ink-4);
}

.sm__item--plain .sm__label { color: var(--ink-3); }

.sm__rule {
  height: 1px;
  margin: 6px 4px;
  background: var(--divider);
}
</style>

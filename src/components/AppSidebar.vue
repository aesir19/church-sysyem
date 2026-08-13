<script setup>
import { ref, computed, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import AppLogo from './AppLogo.vue'
import ChurchSwitcher from './ChurchSwitcher.vue'
import SettingsMenu from './SettingsMenu.vue'
import Avatar from './ui/Avatar.vue'
import Badge from './ui/Badge.vue'
import Icon from './ui/icons/Icon.vue'
import { useActiveChurch } from '../composables/useActiveChurch'
import { useCurrentRole } from '../composables/useCurrentRole'
import { useCurrentUser } from '../composables/useCurrentUser'
import { useSession } from '../composables/useSession'
import { useTheme } from '../composables/useTheme'

// The 242px left nav: brand, church switcher, nine items, user card pinned to
// the bottom by margin-top:auto.
//
// WHY EVERY ITEM RENDERS, INCLUDING ONES THE CALLER CANNOT USE. The handoff is
// explicit: "Never hide a permission failure silently — show the no-access
// state with Request access." A nav that quietly shortens itself teaches a
// Secretariat user that Collections does not exist, rather than that it is not
// theirs; then they ask why the app has no finance section. Gating happens at
// the route and inside the screen, where it can explain itself. The one thing
// the nav does carry is `requiresCapability`, so a locked item is marked rather
// than merely disappointing.

defineProps({
  // The mobile drawer renders the same nav; it just needs to close on navigate.
  compact: { type: Boolean, default: false }
})

const emit = defineEmits(['navigate'])

const { activeChurchName, showChurchSelector } = useActiveChurch()
const { caps, role } = useCurrentRole()
const { isDark, toggleTheme } = useTheme()

// The ONE sign-out path. `useSession().signOut()` clears the cached church,
// role and display name alongside the Supabase session — calling
// supabase.auth.signOut() directly leaves the previous user's first name in
// localStorage for the next person on a shared browser to be greeted by.
const { signOut } = useSession()

function onSignOut () {
  emit('navigate')
  signOut()
}

const switcherOpen = ref(false)

const NAV = [
  { key: 'overview',    label: 'Overview',    icon: 'overview',    to: '/dashboard/overview' },
  { key: 'members',     label: 'Members',     icon: 'members',     to: '/dashboard/members' },
  { key: 'groups',      label: 'Groups',      icon: 'groups',      to: '/dashboard/groups' },
  { key: 'attendance',  label: 'Attendance',  icon: 'attendance',  to: '/dashboard/attendance',  needs: 'canViewAttendance' },
  { key: 'collections', label: 'Collections', icon: 'collections', to: '/dashboard/collections', needs: 'canWriteFinance' },
  { key: 'expenses',    label: 'Expenses',    icon: 'expenses',    to: '/dashboard/expenses',    needs: 'canWriteFinance' },
  { key: 'funds',       label: 'Funds',       icon: 'funds',       to: '/dashboard/funds',       needs: 'canViewFinance' },
  { key: 'statistics',  label: 'Statistics',  icon: 'statistics',  to: null, badge: 'Soon' },
  { key: 'next',        label: "What's next", icon: 'next',        to: '/dashboard/whats-next',  badge: 'New' }
]

const items = computed(() =>
  NAV.map(item => ({
    ...item,
    locked: !!item.needs && !caps.value[item.needs]
  }))
)

// The user card's second line. Reads the real role rather than the mockups'
// three-role vocabulary — see the ADR on the seven-role capability set.
const ROLE_LABEL = {
  super_admin: 'Super Admin',
  head_pastor: 'Head Pastor',
  pastor: 'Pastor',
  church_leader: 'Church Leader',
  finance: 'Finance',
  secretariat: 'Secretariat',
  welcome: 'Welcome Team'
}

const { displayName, load: loadUser } = useCurrentUser()

// The gear replaces the standalone sign-out for anyone who has settings to reach,
// because sign out lives inside the menu. Everyone else keeps the plain button: a gear
// whose only entry is "Sign out" is a worse affordance than a sign-out button, and the
// dashboard must always be signable-out-of on a shared church computer.
const canOpenSettings = computed(() => caps.value.isSuperAdmin || caps.value.isHeadPastor)

onMounted(loadUser)

const userName = computed(() => displayName.value || 'Signed in')
const roleLabel = computed(() => ROLE_LABEL[role.value] || 'No role assigned')
</script>

<template>
  <nav
    class="side"
    :class="{ 'side--compact': compact }"
    aria-label="Main"
  >
    <div class="side__brand">
      <AppLogo />
    </div>

    <button
      v-if="showChurchSelector"
      type="button"
      class="side__church"
      @click="switcherOpen = true"
    >
      <Avatar
        :name="activeChurchName"
        :size="24"
      />
      <span class="side__church-name">{{ activeChurchName || 'Choose a church' }}</span>
      <Icon
        name="chevronDown"
        :size="15"
        :width="2.2"
        class="side__church-chev"
      />
    </button>

    <ul class="side__nav">
      <li
        v-for="item in items"
        :key="item.key"
      >
        <RouterLink
          v-if="item.to"
          :to="item.to"
          class="side__item"
          :class="{ 'is-locked': item.locked }"
          @click="emit('navigate')"
        >
          <Icon
            :name="item.icon"
            :size="17"
            :width="2"
            class="side__icon"
          />
          <span class="side__label">{{ item.label }}</span>
          <Icon
            v-if="item.locked"
            name="lock"
            :size="13"
            :width="2.2"
            class="side__lock"
          />
          <Badge
            v-else-if="item.badge"
            tone="magenta"
            class="side__badge"
          >
            {{ item.badge }}
          </Badge>
        </RouterLink>

        <span
          v-else
          class="side__item is-soon"
          aria-disabled="true"
        >
          <Icon
            :name="item.icon"
            :size="17"
            :width="2"
            class="side__icon"
          />
          <span class="side__label">{{ item.label }}</span>
          <Badge
            tone="magenta"
            class="side__badge"
          >{{ item.badge }}</Badge>
        </span>
      </li>
    </ul>

    <div class="side__user">
      <Avatar
        :name="userName"
        :size="30"
      />
      <span class="side__user-text">
        <span class="side__user-name">{{ userName }}</span>
        <span class="side__user-role">{{ roleLabel }}</span>
      </span>
      <button
        type="button"
        class="side__theme"
        :aria-pressed="isDark"
        @click="toggleTheme"
      >
        <Icon
          :name="isDark ? 'sun' : 'moon'"
          :size="15"
          :width="2.1"
          :title="isDark ? 'Switch to light theme' : 'Switch to dark theme'"
        />
      </button>

      <!-- The gear from mockup 4c. Sign out now lives inside this menu, which is
           where the handoff always put it. The standalone button below stays for
           everyone the menu shows nothing else to, because a dashboard holding
           member PII must always be signable-out-of — on a shared church computer
           that is the whole of the session control. -->
      <SettingsMenu v-if="canOpenSettings" />

      <button
        v-else
        type="button"
        class="side__theme side__signout"
        aria-label="Sign out"
        @click="onSignOut"
      >
        <Icon
          name="signOut"
          :size="16"
          :width="2"
          title="Sign out"
        />
      </button>
    </div>

    <ChurchSwitcher v-model:open="switcherOpen" />
  </nav>
</template>

<style scoped>
.side {
  display: flex;
  flex-direction: column;
  gap: var(--sp-8);
  width: var(--nav-width);
  flex: none;
  height: 100%;
  padding: var(--sp-18) var(--sp-14) var(--sp-14);
  background: var(--surface);
  border-right: 1px solid var(--border);
  overflow-y: auto;
}

.side__brand { padding: 0 var(--sp-6) var(--sp-10); }

/* --- Church switcher trigger ------------------------------------------ */
.side__church {
  display: flex;
  align-items: center;
  gap: var(--sp-10);
  width: 100%;
  padding: var(--sp-9) var(--sp-10);
  margin-bottom: var(--sp-8);
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: var(--r-control);
  font-family: var(--font-sans);
  cursor: pointer;
  transition: background-color var(--dur-state) ease, border-color var(--dur-state) ease;
}
.side__church:hover { background: var(--surface-subtle-2); border-color: var(--ink-6); }

.side__church-name {
  flex: 1;
  min-width: 0;
  text-align: left;
  font-size: var(--text-body);
  font-weight: 700;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.side__church-chev { color: var(--ink-5); }

/* --- Nav -------------------------------------------------------------- */
.side__nav {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.side__item {
  display: flex;
  align-items: center;
  gap: var(--sp-12);
  padding: 9px 11px;
  border-radius: var(--r-control);
  text-decoration: none;
  color: var(--ink-3);
  font-size: var(--text-body);
  font-weight: 500;
  transition: background-color var(--dur-state) ease, color var(--dur-state) ease;
}

.side__icon { opacity: .65; transition: opacity var(--dur-state) ease; }
.side__label { flex: 1; min-width: 0; }

.side__item:hover { background: var(--surface-subtle-2); color: var(--ink); }
.side__item:hover .side__icon { opacity: .9; }

/* vue-router adds router-link-active to ancestors too; the exact class is what
   keeps Funds from lighting up while you are on Collections. */
.side__item.router-link-exact-active {
  background: var(--accent-tint);
  color: var(--accent-darkest);
  font-weight: 700;
}
.side__item.router-link-exact-active .side__icon { opacity: 1; color: var(--accent); }

.side__item.is-soon {
  cursor: default;
  color: var(--ink-4);
}
.side__item.is-soon:hover { background: transparent; color: var(--ink-4); }

/* Locked, not hidden. The item still navigates — the screen behind it explains
   the refusal and offers "Request access". */
.side__item.is-locked .side__label { color: var(--ink-4); }
.side__lock { color: var(--ink-5); }

.side__badge { font-size: var(--text-meta-sm); padding: 2px 7px; }

/* --- User card -------------------------------------------------------- */
.side__user {
  margin-top: auto;
  display: flex;
  align-items: center;
  gap: var(--sp-10);
  padding: var(--sp-10);
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  border-radius: var(--r-inset);
}

.side__user-text { flex: 1; min-width: 0; display: flex; flex-direction: column; line-height: 1.25; }

.side__user-name {
  font-size: var(--text-body-sm);
  font-weight: 700;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.side__user-role { font-size: var(--text-meta-sm); color: var(--ink-5); }

.side__theme {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex: none;
  border: 1px solid var(--border-strong);
  border-radius: var(--r-pill);
  background: var(--surface);
  color: var(--ink-3);
  cursor: pointer;
  transition: background-color var(--dur-state) ease, color var(--dur-state) ease;
}
.side__theme:hover { background: var(--accent-tint); color: var(--accent); }
.side__theme:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

/* Magenta on hover, matching the mockup's own treatment of the words "Sign
   out" — it is the one control here that ends something. */
.side__signout:hover { background: var(--magenta-tint); color: var(--magenta); }
</style>

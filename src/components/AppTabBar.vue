<script setup>
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import Icon from './ui/icons/Icon.vue'
import { useCurrentRole } from '../composables/useCurrentRole'

// The phone's bottom bar: five targets replacing the 242px rail.
//
// FIVE OF NINE, AND "MORE" CARRIES THE REST. The handoff picks these four —
// Home, People, Check in, Funds — and a More button. That is not a shortened
// nav: More opens the same drawer holding all nine items, the church switcher,
// the theme toggle and sign-out. The bar is the frequent path; the drawer is
// the complete one, so nothing becomes unreachable on a phone.
//
// LOCKED, NOT HIDDEN — the rule AppSidebar states at length. A Secretariat user
// gets the Check in tab, marked with a lock, and the screen behind it explains
// the refusal. A bar that silently shortens itself would teach four of the seven
// roles that this app has no attendance.
//
// IN FLOW, NOT FIXED. The bar is the last child of a flex column, so the content
// area simply ends above it. A fixed bar would need bottom padding added to
// every scrolling view, and any view that forgot would hide its last row behind
// the tabs — with the row still there, still scrollable to, and invisible.

const props = defineProps({
  // Marks More as current while the drawer is open, so the bar always shows
  // where you are — including "in the menu".
  menuOpen: { type: Boolean, default: false }
})

const emit = defineEmits(['open-menu'])

const route = useRoute()
const { caps } = useCurrentRole()

const TABS = [
  { key: 'overview',   label: 'Home',     icon: 'overview',   to: '/dashboard/overview' },
  { key: 'members',    label: 'People',   icon: 'members',    to: '/dashboard/members' },
  { key: 'attendance', label: 'Check in', icon: 'attendance', to: '/dashboard/attendance', needs: 'canViewAttendance' },
  { key: 'funds',      label: 'Funds',    icon: 'funds',      to: '/dashboard/funds',      needs: 'canViewFinance' }
]

const tabs = computed(() =>
  TABS.map((tab) => ({ ...tab, locked: !!tab.needs && !caps.value[tab.needs] }))
)

// Groups, Collections, Expenses and What's next have no tab. Rather than leave
// the bar with nothing lit on those screens — which reads as "you are nowhere"
// — More carries the current marker, which is also true: that is where they
// live.
const onUntabbedRoute = computed(() =>
  !TABS.some((tab) => route.path === tab.to)
)

const moreCurrent = computed(() => props.menuOpen || onUntabbedRoute.value)
</script>

<template>
  <nav
    class="tabs"
    aria-label="Primary"
  >
    <RouterLink
      v-for="tab in tabs"
      :key="tab.key"
      :to="tab.to"
      class="tabs__tab"
      :class="{ 'is-locked': tab.locked }"
    >
      <span class="tabs__icon-box">
        <Icon
          :name="tab.icon"
          :size="21"
          :width="2"
        />
        <Icon
          v-if="tab.locked"
          name="lock"
          :size="10"
          :width="2.6"
          class="tabs__lock"
        />
      </span>
      <span class="tabs__label">{{ tab.label }}</span>
    </RouterLink>

    <button
      type="button"
      class="tabs__tab tabs__more"
      :class="{ 'is-current': moreCurrent }"
      :aria-expanded="menuOpen"
      aria-haspopup="menu"
      @click="emit('open-menu')"
    >
      <span class="tabs__icon-box">
        <Icon
          name="dots"
          :size="21"
          :width="2"
        />
      </span>
      <span class="tabs__label">More</span>
    </button>
  </nav>
</template>

<style scoped>
.tabs {
  display: flex;
  flex: none;
  background: var(--surface);
  border-top: 1px solid var(--border);
  /* The trailing space is the home indicator's. env() resolves to 0 where there
     is no notch, so this is the same 10px on a laptop as before. */
  padding: var(--sp-9) var(--sp-8) calc(var(--sp-10) + env(safe-area-inset-bottom, 0px));
}

.tabs__tab {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  /* 44px is the floor for a touch target, and these are the app's smallest. */
  min-height: 44px;
  padding: var(--sp-6) 4px;
  border: 0;
  background: none;
  font-family: var(--font-sans);
  text-decoration: none;
  color: var(--ink-5);
  cursor: pointer;
  transition: color var(--dur-state) ease;
}

.tabs__icon-box { position: relative; display: flex; opacity: .7; transition: opacity var(--dur-state) ease; }

.tabs__lock {
  position: absolute;
  right: -4px;
  bottom: -2px;
  color: var(--ink-5);
  /* The bar is the only place the lock sits on top of another glyph, so it
     needs the surface behind it to stay legible. */
  background: var(--surface);
  border-radius: var(--r-pill);
}

.tabs__label {
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: .01em;
  white-space: nowrap;
}

/* exact-active, not active: /dashboard/overview would otherwise light up from
   any child route, and Funds from Collections. */
.tabs__tab.router-link-exact-active,
.tabs__more.is-current {
  color: var(--accent);
}
.tabs__tab.router-link-exact-active .tabs__icon-box,
.tabs__more.is-current .tabs__icon-box { opacity: 1; }

.tabs__tab.router-link-exact-active .tabs__label,
.tabs__more.is-current .tabs__label { font-weight: 800; }

.tabs__tab:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; border-radius: var(--r-tag); }

.tabs__tab.is-locked { color: var(--ink-6); }
.tabs__tab.is-locked .tabs__icon-box { opacity: .5; }
</style>

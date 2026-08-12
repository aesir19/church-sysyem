<script setup>
/**
 * The dashboard's nav rail.
 *
 * THREE THINGS CHANGED HERE BEYOND THE REPAINT, each recorded where it was
 * decided:
 *
 * 1. THE `v-html` IS GONE. Every nav icon used to be a string of SVG markup
 *    interpolated with `v-html` — a latent sink ARCHITECTURE.md §4.7 and
 *    SECURITY.md §4.1 both already flag, harmless only for as long as nobody
 *    threads a database value into it. The glyphs moved unchanged into
 *    iconPaths.js and render as real `<path>` elements through Icon.vue, so
 *    there is no HTML parse step left to hijack.
 *
 * 2. NINE NAV SLOTS, THREE OF THEM "SOON". Overview, Statistics
 *    and What's next have no route and carry a badge saying so. Shipping the
 *    whole information architecture once is what stops the sidebar churning as
 *    each of those screens arrives — and a disabled slot that says "Soon" is
 *    honest where a missing one is silent.
 *
 * 3. THE ACTIVE ITEM IS THE BRAND COLOUR AGAIN. It was `#3b82f6` — Tailwind's
 *    blue-500, not this app's documented primary. Nobody chose that; it was
 *    copied. It is now `var(--color-accent)`, which means the rebrand reaches
 *    it for free.
 *
 * The nav is presentation only. `cap` hides an item the caller cannot use, and
 * the router guard plus RLS are what actually refuse it (ADR-0001).
 */
import { computed, ref } from 'vue'
import { useCurrentRole } from '../composables/useCurrentRole'
import { useTheme } from '../composables/useTheme'
import AppLogo from './AppLogo.vue'
import Badge from './ui/Badge.vue'
import Icon from './ui/icons/Icon.vue'

const props = defineProps({
  userName: { type: String, default: '' },
  /** Owned by DashboardLayout, which also renders the backdrop behind it. */
  mobileOpen: { type: Boolean, default: false },
})

const emit = defineEmits(['logout', 'collapse', 'close'])

const collapsed = ref(false)

const { canViewAttendance, canViewFinance, canWriteFinance } = useCurrentRole()
const { theme, toggleTheme } = useTheme()

const displayName = computed(() => props.userName || 'User')

function toggleSidebar() {
  collapsed.value = !collapsed.value
  emit('collapse', collapsed.value)
}

/**
 * `cap` names the capability required to see the item; undefined = always
 * visible. `soon` marks a slot whose screen is not built — it renders as a
 * disabled row with a badge, never as a link to nowhere.
 */
const ALL_NAV_ITEMS = Object.freeze([
  { to: '/dashboard/overview', label: 'Overview', icon: 'home', soon: true },
  { to: '/dashboard/members', label: 'Members', icon: 'users' },
  { to: '/dashboard/ministry', label: 'Groups', icon: 'layers' },
  { to: '/dashboard/attendance', label: 'Attendance', icon: 'check-square', cap: 'canViewAttendance' },
  { to: '/dashboard/funds/collections', label: 'Collections', icon: 'dollar-sign', cap: 'canWriteFinance' },
  { to: '/dashboard/funds/expenses', label: 'Expenses', icon: 'receipt', cap: 'canWriteFinance' },
  { to: '/dashboard/funds/reports', label: 'Funds', icon: 'pie-chart', cap: 'canViewFinance' },
  { to: '/dashboard/statistics', label: 'Statistics', icon: 'bar-chart', soon: true },
  { to: '/dashboard/whats-next', label: "What's next", icon: 'flag', soon: true },
])

const capFlags = { canViewAttendance, canViewFinance, canWriteFinance }
const navItems = computed(() =>
  ALL_NAV_ITEMS.filter((item) => !item.cap || capFlags[item.cap]?.value),
)

const themeLabel = computed(() =>
  theme.value === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
)

/**
 * The drawer's own dismiss control, exposed so DashboardLayout can put focus
 * inside the drawer when it opens. Opening a panel and leaving focus on the
 * button behind it means a keyboard user's next Tab lands somewhere they
 * cannot see.
 */
const closeButton = ref(null)
defineExpose({ focusClose: () => closeButton.value?.focus() })
</script>

<template>
  <aside class="sidebar" :class="{ collapsed, 'mobile-open': mobileOpen }">
    <div class="sidebar-top">
      <div class="sidebar-brand">
        <!-- One mark everywhere now. The sidebar drew a door/circle glyph while
             the three auth pages drew a cross/steeple — two marks for one
             church, which nobody decided. -->
        <AppLogo :size="28" :title="collapsed ? 'United Door of Faith Church' : ''" />
        <span v-show="!collapsed" class="brand-text">United Door of Faith Church</span>
      </div>

      <button
        class="icon-button sidebar-toggle"
        type="button"
        :aria-label="collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
        :aria-expanded="!collapsed"
        @click="toggleSidebar"
      >
        <Icon :name="collapsed ? 'chevron-right' : 'chevron-left'" :size="18" />
      </button>

      <button
        ref="closeButton"
        class="icon-button sidebar-close"
        type="button"
        aria-label="Close menu"
        @click="emit('close')"
      >
        <Icon name="x" :size="18" />
      </button>
    </div>

    <nav class="sidebar-nav" aria-label="Dashboard sections">
      <template v-for="item in navItems" :key="item.to">
        <!-- A slot with no screen behind it is rendered as a disabled button,
             not as a dead link: `aria-disabled` alone on an <a href> still lets
             a keyboard user activate it. -->
        <button
          v-if="item.soon"
          class="nav-item nav-item-soon"
          type="button"
          disabled
          :title="collapsed ? `${item.label} — coming soon` : ''"
        >
          <Icon :name="item.icon" :size="20" class="nav-icon" />
          <span v-show="!collapsed" class="nav-label">{{ item.label }}</span>
          <Badge v-show="!collapsed" class="nav-badge">Soon</Badge>
        </button>

        <router-link
          v-else
          :to="item.to"
          class="nav-item"
          :title="collapsed ? item.label : ''"
          @click="emit('close')"
        >
          <Icon :name="item.icon" :size="20" class="nav-icon" />
          <span v-show="!collapsed" class="nav-label">{{ item.label }}</span>
        </router-link>
      </template>
    </nav>

    <div class="sidebar-bottom">
      <div class="sidebar-user" :title="collapsed ? `Hello, ${displayName}!` : ''">
        <span class="user-avatar">
          <Icon name="user" :size="18" />
        </span>
        <span v-show="!collapsed" class="user-greeting">Hello, {{ displayName }}!</span>
      </div>

      <!-- The theme toggle lives here because this is where the design puts it,
           and because the shell is the one surface present on every dashboard
           page. It reports its state through the label, not through the icon
           alone. -->
      <button class="nav-item theme-toggle" type="button" :title="collapsed ? themeLabel : ''" @click="toggleTheme">
        <Icon :name="theme === 'dark' ? 'sun' : 'moon'" :size="20" class="nav-icon" />
        <span v-show="!collapsed" class="nav-label">{{ themeLabel }}</span>
      </button>

      <button class="nav-item sign-out-btn" type="button" :title="collapsed ? 'Sign Out' : ''" @click="emit('logout')">
        <Icon name="log-out" :size="20" class="nav-icon" />
        <span v-show="!collapsed" class="nav-label">Sign Out</span>
      </button>
    </div>
  </aside>
</template>

<style scoped>
/**
 * The rail keeps its own dark surface in BOTH themes — it is a chrome colour,
 * not a page colour, and the design draws it that way. So these are slate
 * primitives rather than semantic surface tokens, which would flip it white in
 * light mode and make the whole layout read as two pages side by side.
 */
.sidebar {
  width: 280px;
  min-height: 100vh;
  background: var(--color-slate-800);
  color: var(--color-slate-200);
  display: flex;
  flex-direction: column;
  transition: width var(--duration-slow) var(--ease-standard);
  position: fixed;
  top: 0;
  left: 0;
  z-index: var(--z-sticky);
}

.sidebar.collapsed {
  width: 64px;
}

.sidebar-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-4) var(--space-3);
  border-bottom: 1px solid var(--color-slate-700);
}

.sidebar-brand {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  overflow: hidden;
  color: var(--color-cyan-300);
}

.brand-text {
  font-size: var(--text-sm);
  font-weight: var(--font-weight-bold);
  letter-spacing: -0.02em;
  line-height: var(--leading-tight);
  color: var(--color-white);
}

.icon-button {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--color-slate-400);
  cursor: pointer;
  transition:
    color var(--duration-fast) var(--ease-standard),
    background-color var(--duration-fast) var(--ease-standard);
}

.icon-button:hover {
  color: var(--color-slate-200);
  background: var(--color-slate-700);
}

.icon-button:focus-visible,
.nav-item:focus-visible {
  outline: 2px solid var(--color-cyan-300);
  outline-offset: -2px;
}

/* The close button is the drawer's, so it exists only where the drawer does. */
.sidebar-close {
  display: none;
}

.sidebar-nav {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: var(--space-3) var(--space-2);
  gap: var(--space-1);
  overflow-y: auto;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3);
  border: none;
  border-radius: var(--radius-md);
  background: none;
  color: var(--color-slate-400);
  text-decoration: none;
  font-family: inherit;
  font-size: var(--text-base);
  font-weight: var(--font-weight-medium);
  text-align: left;
  width: 100%;
  /* The 44px touch floor. The rail is used one-handed on a phone during
     a service. */
  min-height: 44px;
  cursor: pointer;
  transition:
    background-color var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);
}

.nav-item:hover:not(:disabled) {
  background: var(--color-slate-700);
  color: var(--color-slate-100);
}

.nav-item.router-link-active {
  background: var(--color-accent);
  color: var(--color-white);
}

.nav-item-soon {
  cursor: default;
  color: var(--color-slate-500);
}

.nav-badge {
  margin-left: auto;
  background: var(--color-slate-700);
  border-color: var(--color-slate-600);
  color: var(--color-slate-300);
}

.nav-icon {
  flex-shrink: 0;
}

.nav-label {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.sidebar-user {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  overflow: hidden;
}

.user-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: var(--color-slate-700);
  border-radius: var(--radius-full);
  flex-shrink: 0;
  color: var(--color-slate-400);
}

.user-greeting {
  font-size: var(--text-sm);
  color: var(--color-slate-300);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar-bottom {
  padding: var(--space-3) var(--space-2);
  border-top: 1px solid var(--color-slate-700);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.sign-out-btn {
  color: #f87171;
}

.sign-out-btn:hover {
  background: #451a1a;
  color: #fca5a5;
}

/**
 * Mobile: the rail becomes a drawer. The bottom tab bar is
 * deliberately NOT built — the design's is five tabs and two of them point at
 * screens that do not exist.
 */
@media (max-width: 768px) {
  .sidebar {
    width: 280px;
    transform: translateX(-100%);
    transition: transform var(--duration-slow) var(--ease-standard);
    z-index: var(--z-modal);
  }

  .sidebar.collapsed {
    width: 280px;
  }

  .sidebar.mobile-open {
    transform: translateX(0);
    box-shadow: var(--shadow-xl);
  }

  /* Collapsing is a desktop affordance: on a drawer there is nothing to
     collapse into. */
  .sidebar-toggle {
    display: none;
  }

  .sidebar-close {
    display: flex;
  }
}
</style>

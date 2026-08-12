<script setup>
/**
 * The signed-in shell.
 *
 * Two behavioural changes on top of the repaint:
 *
 * - Sign-out goes through `useSession()`, the one path (D12). This file and
 *   DashboardView each had their own, clearing different localStorage keys, so
 *   which keys survived depended on which button you happened to press.
 * - On a phone the rail is a drawer rather than a fixed 280px column that ate
 *   most of the viewport. The bar below appears only at that
 *   width, and only to open it.
 */
import { ref, nextTick, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute } from 'vue-router'
import { supabase } from '../lib/supabase'
import { useSession } from '../composables/useSession'
import AppSidebar from '../components/AppSidebar.vue'
import ChurchSelector from '../components/ChurchSelector.vue'
import AppLogo from '../components/AppLogo.vue'
import Icon from '../components/ui/icons/Icon.vue'

const route = useRoute()
const { signOut } = useSession()

const sidebarCollapsed = ref(false)
const mobileNavOpen = ref(false)
const userName = ref('')

const USER_NAME_KEY = 'udfc.myUserName'

onMounted(async () => {
  // Try cached name first for instant render
  try { userName.value = localStorage.getItem(USER_NAME_KEY) || '' } catch {}

  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    const { data } = await supabase
      .from('user_accounts')
      .select('members(first_name)')
      .eq('id', user.id)
      .single()
    if (data?.members?.first_name) {
      userName.value = data.members.first_name
      try { localStorage.setItem(USER_NAME_KEY, userName.value) } catch {}
    }
  }
})

function onCollapse(isCollapsed) {
  sidebarCollapsed.value = isCollapsed
}

// A drawer that survives the navigation it just caused would cover the page it
// opened. The sidebar also emits `close` on its own links; this covers every
// other way the route can change, including the back button.
watch(() => route.fullPath, () => { mobileNavOpen.value = false })

/**
 * Focus follows the drawer, both ways.
 *
 * A panel that opens without taking focus leaves a keyboard user's next Tab in
 * the page behind it — which the backdrop has covered, so they are typing into
 * something they cannot see. Closing it without giving focus back drops them at
 * the top of the document instead of on the button they just pressed.
 *
 * Containment itself is `inert` on everything outside the drawer (below), not a
 * hand-rolled Tab-cycling trap: ADR-0011 exists precisely because those are
 * easy to get subtly wrong, and the platform already has the primitive.
 */
const sidebar = ref(null)
const menuButton = ref(null)

watch(mobileNavOpen, async (open) => {
  await nextTick()
  if (open) sidebar.value?.focusClose()
  else menuButton.value?.focus()
})

function handleEsc(event) {
  if (event.key === 'Escape') mobileNavOpen.value = false
}

onMounted(() => window.addEventListener('keydown', handleEsc))
onBeforeUnmount(() => window.removeEventListener('keydown', handleEsc))
</script>

<template>
  <div class="layout">
    <!-- Phone-only. The rail is off-canvas at this width, so something has to
         bring it back. -->
    <header class="mobile-bar" :inert="mobileNavOpen || undefined">
      <button
        ref="menuButton"
        class="mobile-menu-btn"
        type="button"
        aria-label="Open menu"
        :aria-expanded="mobileNavOpen"
        @click="mobileNavOpen = true"
      >
        <Icon name="menu" :size="22" />
      </button>
      <AppLogo :size="24" title="" />
      <span class="mobile-title">UDFC Dashboard</span>
    </header>

    <!-- Inert while closed: a backdrop over a closed drawer would swallow every
         click on the page behind it. -->
    <div v-if="mobileNavOpen" class="mobile-backdrop" @click="mobileNavOpen = false" />

    <AppSidebar
      ref="sidebar"
      :userName="userName"
      :mobileOpen="mobileNavOpen"
      @logout="signOut"
      @collapse="onCollapse"
      @close="mobileNavOpen = false"
    />

    <!-- `inert` while the drawer is open: the page behind it stops being
         focusable, clickable and reachable by assistive tech, which is a real
         focus trap from the platform rather than a hand-rolled Tab cycle.
         `|| undefined` because `:inert="false"` would render `inert="false"` —
         a present boolean attribute, and therefore still inert. -->
    <div
      class="layout-main"
      :class="{ 'sidebar-collapsed': sidebarCollapsed }"
      :inert="mobileNavOpen || undefined"
    >
      <!-- Cross-church church picker (SuperAdmin / Head Pastor only; hidden otherwise). -->
      <ChurchSelector />
      <router-view />
    </div>
  </div>
</template>

<style scoped>
.layout {
  display: flex;
  min-height: 100vh;
  background: var(--color-bg-page);
}

.layout-main {
  margin-left: 280px;
  flex: 1;
  transition: margin-left var(--duration-slow) var(--ease-standard);
  min-height: 100vh;
  min-width: 0;
}

.layout-main.sidebar-collapsed {
  margin-left: 64px;
}

.mobile-bar {
  display: none;
}

.mobile-backdrop {
  position: fixed;
  inset: 0;
  background: var(--color-bg-overlay);
  z-index: var(--z-modal-backdrop);
}

@media (max-width: 768px) {
  .mobile-bar {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    position: sticky;
    top: 0;
    z-index: var(--z-sticky);
    padding: var(--space-2) var(--space-3);
    background: var(--color-bg-surface);
    border-bottom: 1px solid var(--color-border-default);
  }

  .layout {
    flex-direction: column;
  }

  .layout-main,
  .layout-main.sidebar-collapsed {
    margin-left: 0;
  }

  .mobile-menu-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    background: none;
    border: none;
    border-radius: var(--radius-md);
    color: var(--color-text-primary);
    cursor: pointer;
  }

  .mobile-menu-btn:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
  }

  .mobile-title {
    font-size: var(--text-base);
    font-weight: var(--font-weight-bold);
    color: var(--color-text-primary);
  }
}
</style>

<script setup>
import { ref, watch, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import AppSidebar from '../components/AppSidebar.vue'
import AppTabBar from '../components/AppTabBar.vue'
import { useActiveChurch } from '../composables/useActiveChurch'
import { useMediaQuery } from '../composables/useMediaQuery'

// The shell: a fixed 242px nav beside a content area that fills the rest and
// scrolls.
//
// FLUID, NOT FRAMED. The mockups are drawn in a 1320×860 frame, which puts the
// content area at 1078px. The content area here has no max-width: the tables
// and the four-up tile grids earn the room, and a centred column on a wide
// monitor reads as a mistake rather than a decision. Fidelity is judged at
// 1320px, where this and the mockup should agree.
//
// On a phone the rail becomes a bottom tab bar, and the full nav stays one tap
// behind its More button as a drawer. The bar carries the four frequent
// destinations; the drawer carries all nine plus the church switcher, the theme
// toggle and sign-out — so nothing is only reachable on a desktop.
//
// The mobile top bar is gone with it. Its only content was the menu button,
// which More replaces, and the mockups draw no chrome above the content on a
// phone: each screen supplies its own heading.

const route = useRoute()
const isMobile = useMediaQuery('(max-width: 900px)')
const drawerOpen = ref(false)

const { ensureLoaded } = useActiveChurch()

onMounted(() => { ensureLoaded() })

// Close the drawer on navigation — otherwise it stays over the screen you just
// asked for.
watch(() => route.fullPath, () => { drawerOpen.value = false })

// Body scroll lock while the drawer is open, so the page behind does not move
// under the finger.
watch([drawerOpen, isMobile], ([open, mobile]) => {
  if (typeof document === 'undefined') return
  document.body.style.overflow = open && mobile ? 'hidden' : ''
})
</script>

<template>
  <div class="shell">
    <!-- Desktop nav -->
    <AppSidebar
      v-if="!isMobile"
      class="shell__side"
    />

    <!-- Mobile drawer -->
    <template v-else>
      <div
        v-if="drawerOpen"
        class="shell__scrim"
        @click="drawerOpen = false"
      />
      <AppSidebar
        v-if="drawerOpen"
        class="shell__side shell__side--drawer"
        compact
        @navigate="drawerOpen = false"
      />
    </template>

    <div class="shell__main">
      <!-- A framed route takes the content area whole: no padding, no scroll
           here. Members needs it because its detail rail is a second
           full-height column that must reach both edges and scroll on its own,
           which it cannot do from inside a padded, already-scrolling box. The
           padding moves onto that view's own scrolling column. -->
      <main
        class="shell__content"
        :class="{ 'shell__content--framed': route.meta.framed }"
      >
        <RouterView />
      </main>

      <AppTabBar
        v-if="isMobile"
        :menu-open="drawerOpen"
        @open-menu="drawerOpen = true"
      />
    </div>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  height: 100dvh;
  background: var(--app-bg);
  overflow: hidden;
}

.shell__side { height: 100%; }

.shell__side--drawer {
  position: fixed;
  inset: 0 auto 0 0;
  z-index: 50;
  box-shadow: var(--shadow-modal);
  animation: drawer-in var(--dur-slide) var(--ease-entrance) both;
}

@keyframes drawer-in {
  from { transform: translateX(-100%); }
  to   { transform: none; }
}

.shell__scrim {
  position: fixed;
  inset: 0;
  z-index: 49;
  background: var(--scrim);
  animation: fade var(--dur-state) ease both;
}

.shell__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.shell__content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--page-pad);
}

.shell__content--framed {
  padding: 0;
  overflow: hidden;
  display: flex;
}

@media (max-width: 900px) {
  .shell__content { padding: var(--sp-16); }
  .shell__content--framed { padding: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .shell__side--drawer, .shell__scrim { animation: none; }
}
</style>

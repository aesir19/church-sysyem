<script setup>
import Toast from './Toast.vue'
import { useToast } from '../../composables/useToast'

// Mounted once, in App.vue. Bottom-right, max three, newest at the bottom —
// the mockups' stack order.
//
// NO <TransitionGroup>. App.vue is in the shared entry chunk, so anything it
// imports is downloaded by every visitor to the public /checkin page on their
// phone, on church wifi, at every service — not just by signed-in staff on a
// lazy dashboard route. TransitionGroup pulls a slice of Vue's transition
// runtime in there for the sake of a leave animation nobody has ever asked
// for. Entrances come from a CSS `slide` on the element itself, which costs
// nothing; toasts simply vanish when dismissed.

const { toasts, dismissToast } = useToast()
</script>

<template>
  <!-- The live region is declared HERE and up front, while empty. A live region
       announces content inserted INTO it; a region that comes into existence
       already holding its message is frequently announced by nothing at all.
       This is why the host renders even with no toasts. -->
  <div
    class="toast-host"
    role="status"
    aria-live="polite"
    aria-atomic="false"
  >
    <Toast
      v-for="toast in toasts"
      :key="toast.id"
      :toast="toast"
      @dismiss="dismissToast(toast.id)"
    />
  </div>
</template>

<style scoped>
.toast-host {
  position: fixed;
  right: var(--sp-20);
  bottom: var(--sp-20);
  z-index: 80;
  display: flex;
  flex-direction: column;
  gap: var(--sp-10);
  /* The container must not eat clicks on the page behind it; the toasts
     themselves take pointer events back. */
  pointer-events: none;
}
.toast-host > * { pointer-events: auto; }

@media (max-width: 640px) {
  .toast-host {
    right: var(--sp-12);
    left: var(--sp-12);
    bottom: calc(var(--sp-12) + env(safe-area-inset-bottom, 0px) + 62px);
  }
}
</style>

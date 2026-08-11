<script setup>
/**
 * The single live region every toast in the app renders into.
 *
 * Mounted once in App.vue beside `<router-view />`. Views call `showToast()`
 * and render nothing themselves, which is what stops a toast being clipped by
 * whichever modal or scroll container happened to be its ancestor — the reason
 * the three per-view implementations each needed their own `position: fixed`
 * and their own z-index guess.
 *
 * The region is declared up front and always present, empty or not. A live
 * region added to the DOM at the same moment as its first message is commonly
 * not announced at all: assistive tech has to be observing the container
 * before the mutation happens.
 *
 * `role="status"` (polite) rather than `alert` (assertive): these report the
 * outcome of something the user just did, and interrupting them mid-sentence
 * to say "Saved" is worse than waiting for a pause. A genuine error that blocks
 * progress belongs inline on the field, where Input.vue's `role="alert"` puts
 * it.
 */
import { useToast } from '../../composables/useToast'
import Toast from './Toast.vue'

const { toasts, dismissToast } = useToast()
</script>

<template>
  <div class="toast-host" role="status" aria-live="polite" aria-atomic="false">
    <TransitionGroup name="toast">
      <Toast
        v-for="toast in toasts"
        :key="toast.id"
        :message="toast.message"
        :type="toast.type"
        @dismiss="dismissToast(toast.id)"
      />
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-host {
  position: fixed;
  top: var(--space-5);
  right: var(--space-5);
  z-index: var(--z-toast);

  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--space-2);

  /* The container spans the corner but must never swallow clicks meant for the
   * page behind it. Each toast turns pointer events back on for itself. */
  pointer-events: none;
}

/* Standardised on the behaviour already proven in two of the three existing
 * implementations. AttendanceView's is a bare v-if with no transition at all;
 * this is not a fourth variant, it is the one that already worked. */
.toast-enter-active,
.toast-leave-active {
  transition:
    opacity var(--duration-slow) var(--ease-standard),
    transform var(--duration-slow) var(--ease-standard);
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

/* Without this, dismissing one toast makes the ones below it jump rather than
 * slide up into the gap. */
.toast-move {
  transition: transform var(--duration-slow) var(--ease-standard);
}

/* leave-active must come out of flow, or TransitionGroup reserves its space
 * for the length of the animation. */
.toast-leave-active {
  position: absolute;
  right: 0;
}

@media (max-width: 600px) {
  .toast-host {
    top: var(--space-3);
    right: var(--space-3);
    left: var(--space-3);
    align-items: stretch;
  }
}
</style>

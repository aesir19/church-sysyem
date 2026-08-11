<script setup>
/**
 * One toast. Presentation only — the queue lives in composables/useToast.js.
 *
 * HAND-ROLLED, AND WHY. ADR-0011 adopts Reka UI for `Dialog` and *optionally*
 * `Toast`. This takes the option and declines it, for a reason the ADR could
 * not have measured in advance:
 *
 *   `<ToastHost />` mounts in App.vue. App.vue is in the SHARED ENTRY CHUNK, so
 *   anything it imports is downloaded by every visitor to `/checkin` — on a
 *   phone, on church wifi, at every service. Reka UI's Toast would land there,
 *   not in a lazy dashboard chunk. The ADR's gate watches
 *   `dist/assets/CheckinView-*.js`, which would not have moved; `index-*.js`
 *   would have, which is worse and ships to strictly more people.
 *
 * The trade is also weaker than the one Dialog makes. A dialog's focus trap is
 * genuinely easy to get wrong and there were four broken attempts to prove it.
 * A toast's semantics are an `aria-live` region and a role — few enough
 * attributes to get right here, and they are right here. What is given up is
 * swipe-to-dismiss and pause-on-hover; each toast carries an explicit dismiss
 * button instead, which is the accessible affordance anyway.
 */
import Icon from './icons/Icon.vue'

const props = defineProps({
  message: { type: String, required: true },
  type: {
    type: String,
    default: 'success',
    validator: (value) => ['success', 'error', 'info'].includes(value),
  },
})

defineEmits(['dismiss'])

const ICONS = { success: 'check-circle', error: 'alert-circle', info: 'info' }
const iconName = () => ICONS[props.type] ?? 'info'
</script>

<template>
  <div class="toast" :class="`toast-${type}`">
    <Icon :name="iconName()" :size="18" class="toast-icon" />
    <p class="toast-message">{{ message }}</p>
    <button type="button" class="toast-dismiss" aria-label="Dismiss" @click="$emit('dismiss')">
      <Icon name="x" :size="14" />
    </button>
  </div>
</template>

<style scoped>
.toast {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  border: 1px solid transparent;
  box-shadow: var(--shadow-md);
  pointer-events: auto;
  max-width: 380px;
}

.toast-icon {
  margin-top: 1px;
}

.toast-message {
  flex: 1;
  font-size: var(--text-base);
  font-weight: var(--font-weight-medium);
  line-height: var(--leading-normal);
  /* A classified message from write.js can be a full sentence; it must wrap
   * rather than stretch the toast off the edge of a phone. */
  overflow-wrap: anywhere;
}

.toast-dismiss {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  margin-top: 1px;
  padding: 0;
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  color: inherit;
  opacity: 0.6;
  cursor: pointer;
}

.toast-dismiss:hover {
  opacity: 1;
}

.toast-dismiss:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 1px;
  opacity: 1;
}

.toast-success {
  background: var(--color-success-bg);
  color: var(--color-success-text);
  border-color: var(--color-success-border);
}

.toast-error {
  background: var(--color-danger-bg);
  color: var(--color-danger-text);
  border-color: var(--color-danger-border);
}

.toast-info {
  background: var(--color-accent-subtle);
  color: var(--color-accent);
  border-color: var(--color-accent-border);
}
</style>

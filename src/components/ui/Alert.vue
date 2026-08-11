<script setup>
/**
 * An inline message that stays on the page: a failed sign-in, a "password set"
 * confirmation, the standing note on the account-pending screen.
 *
 * NOT A TOAST, and the difference is the reason both exist. A toast reports
 * something that just happened and then leaves; this reports the state the
 * page is in, next to the thing it is about, for as long as that state holds.
 * A sign-in error that vanished after four seconds would be read by nobody
 * typing their password.
 *
 * `role="alert"` for the error tone only. Assertive announcement interrupts
 * whatever the screen reader is saying, which is right when the form just
 * refused and wrong for a standing informational note.
 */
import Icon from './icons/Icon.vue'

const props = defineProps({
  tone: {
    type: String,
    default: 'info',
    validator: (value) => ['info', 'success', 'warning', 'error'].includes(value),
  },
})

const ICONS = {
  info: 'info',
  success: 'check-circle',
  warning: 'alert-triangle',
  error: 'alert-circle',
}
</script>

<template>
  <div class="alert" :class="`alert-${tone}`" :role="tone === 'error' ? 'alert' : undefined">
    <Icon :name="ICONS[props.tone]" :size="16" class="alert-icon" />
    <div class="alert-body"><slot /></div>
  </div>
</template>

<style scoped>
.alert {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  font-size: var(--text-base);
  line-height: var(--leading-normal);
  text-align: left;
}

.alert-icon {
  /* Nudged onto the first line's optical centre rather than its box top. */
  margin-top: 2px;
}

.alert-info {
  background: var(--color-bg-subtle);
  border-color: var(--color-border-default);
  color: var(--color-text-secondary);
}

.alert-success {
  background: var(--color-success-bg);
  border-color: var(--color-success-border);
  color: var(--color-success-text);
}

.alert-warning {
  background: var(--color-warning-bg);
  border-color: var(--color-warning-border);
  color: var(--color-warning-text);
}

.alert-error {
  background: var(--color-danger-bg);
  border-color: var(--color-danger-border);
  color: var(--color-danger-text);
}

.alert-body :deep(p) {
  line-height: var(--leading-normal);
}

.alert-body :deep(p + p) {
  margin-top: var(--space-2);
}
</style>

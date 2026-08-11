<script setup>
/**
 * The one spin keyframe in the app.
 *
 * Retires two byte-identical `@keyframes spin` blocks (LoginView,
 * SetPasswordView) plus DashboardView's third `.spinner`. The keyframe only
 * ever needs to exist inside this file, so scoping it here is what makes the
 * duplication impossible to reintroduce by copy-paste.
 *
 * Decorative by default: a spinner beside its own "Saving…" text would be
 * announced twice. Pass a `label` only when this is the sole indication that
 * something is happening.
 */
defineProps({
  /** 'sm' rides inside a button; 'md' is the standalone/page case. */
  size: {
    type: String,
    default: 'md',
    validator: (value) => ['sm', 'md', 'lg'].includes(value),
  },
  /** Announced to screen readers. Empty keeps the element decorative. */
  label: { type: String, default: '' },
})
</script>

<template>
  <span
    class="spinner"
    :class="`spinner-${size}`"
    :role="label ? 'status' : undefined"
    :aria-hidden="label ? undefined : 'true'"
  >
    <span v-if="label" class="sr-only">{{ label }}</span>
  </span>
</template>

<style scoped>
.spinner {
  display: inline-block;
  border-radius: var(--radius-full);
  border: 2px solid var(--color-border-default);
  border-top-color: var(--color-accent);
  animation: spin 0.6s linear infinite;
  flex-shrink: 0;
}

/* Inside a Button the ring must read against the button's own fill, not
 * against the page. currentColor inherits whatever the variant set. */
.spinner-sm {
  width: 14px;
  height: 14px;
  border-width: 2px;
  border-color: currentColor;
  border-top-color: transparent;
  opacity: 0.9;
}

.spinner-md {
  width: 24px;
  height: 24px;
}

.spinner-lg {
  width: 32px;
  height: 32px;
  border-width: 3px;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>

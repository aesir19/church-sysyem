<script setup>
import { computed } from 'vue'
import { RouterLink } from 'vue-router'

// Renders a <button>, an <a>, or a <RouterLink> depending on what it is given,
// because a thing that navigates must be a link — keyboard, middle-click and
// "open in new tab" all come from the element, not from the styling.

const props = defineProps({
  variant: {
    type: String,
    default: 'secondary',
    validator: v => ['primary', 'secondary', 'danger', 'dangerQuiet', 'ghost', 'onDark'].includes(v)
  },
  size: { type: String, default: 'md', validator: v => ['sm', 'md', 'lg'].includes(v) },
  to: { type: [String, Object], default: null },
  href: { type: String, default: null },
  type: { type: String, default: 'button' },
  disabled: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  block: { type: Boolean, default: false }
})

const tag = computed(() => (props.to ? RouterLink : props.href ? 'a' : 'button'))

const bindings = computed(() => {
  if (props.to) return { to: props.to }
  if (props.href) return { href: props.href }
  return { type: props.type, disabled: props.disabled || props.loading }
})
</script>

<template>
  <component
    :is="tag"
    v-bind="bindings"
    class="btn"
    :class="[`btn--${variant}`, `btn--${size}`, { 'btn--block': block, 'is-loading': loading }]"
    :aria-busy="loading || undefined"
    :aria-disabled="(disabled || loading) && (to || href) ? 'true' : undefined"
  >
    <slot />
  </component>
</template>

<style scoped>
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-7);
  border: 1px solid transparent;
  border-radius: var(--r-control);
  font-family: var(--font-sans);
  font-size: var(--text-label);
  font-weight: 700;
  line-height: 1;
  letter-spacing: -0.005em;
  text-decoration: none;
  white-space: nowrap;
  cursor: pointer;
  transition:
    transform var(--dur-state) ease,
    box-shadow var(--dur-state) ease,
    background-color var(--dur-state) ease,
    border-color var(--dur-state) ease,
    color var(--dur-state) ease;
}

.btn--sm { padding: 7px 11px; font-size: var(--text-meta); border-radius: var(--r-tag); }
.btn--md { padding: 10px 15px; }
.btn--lg { padding: 12px 18px; font-size: var(--text-body-sm); }

.btn--block { width: 100%; }

/* --- Primary ---------------------------------------------------------- */
.btn--primary {
  background: var(--accent);
  color: #fff;
  box-shadow: var(--shadow-primary);
}
.btn--primary:hover:not(:disabled):not(.is-loading) {
  background: var(--accent-deep);
  transform: translateY(-1px);
}

/* --- Secondary -------------------------------------------------------- */
.btn--secondary {
  background: var(--surface);
  border-color: var(--border-strong);
  color: var(--ink-2);
}
.btn--secondary:hover:not(:disabled):not(.is-loading) {
  background: var(--surface-subtle-2);
  border-color: var(--ink-6);
}

/* --- Danger ----------------------------------------------------------- */
.btn--danger {
  background: var(--magenta);
  color: #fff;
  box-shadow: var(--shadow-danger);
}
.btn--danger:hover:not(:disabled):not(.is-loading) {
  filter: brightness(.94);
  transform: translateY(-1px);
}

/* The destructive action that sits BESIDE a safe one — "Archive record" on the
   left of the edit-member footer, "Discard changes" under the unsaved-changes
   dialog. Deliberately quieter than .btn--danger: it must be reachable without
   being the thing your eye lands on first. */
.btn--dangerQuiet {
  background: var(--surface);
  border-color: var(--magenta-border);
  color: var(--magenta);
}
.btn--dangerQuiet:hover:not(:disabled):not(.is-loading) {
  background: var(--magenta-tint);
}

/* --- Ghost ------------------------------------------------------------ */
.btn--ghost {
  background: transparent;
  color: var(--ink-3);
}
.btn--ghost:hover:not(:disabled):not(.is-loading) {
  background: var(--surface-subtle-2);
  color: var(--ink);
}

/* --- On the dark panel ------------------------------------------------ */
/* The bulk-selection bar and the undo toast sit on --dark-panel, where both
   secondary and ghost disappear. */
.btn--onDark {
  background: rgba(255, 255, 255, .1);
  border-color: rgba(255, 255, 255, .16);
  color: #fff;
}
.btn--onDark:hover:not(:disabled):not(.is-loading) {
  background: rgba(255, 255, 255, .18);
}

/* --- Disabled --------------------------------------------------------- */
.btn:disabled,
.btn[aria-disabled='true'] {
  opacity: .55;
  cursor: not-allowed;
  box-shadow: none;
  transform: none;
}

.btn.is-loading { cursor: progress; }

.btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
</style>

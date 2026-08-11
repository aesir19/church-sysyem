<script setup>
/**
 * Replaces the per-view `.btn-primary` / `.btn-secondary` / `.btn-tertiary` /
 * `.btn-login` / `.btn-submit` / `.btn-logout` families, each hand-rolled with
 * its own paddings and its own near-miss blue.
 *
 * No headless primitive here on purpose (ADR-0011): a button is a `<button>`,
 * and there is no interaction logic to buy.
 */
import Spinner from './Spinner.vue'

const props = defineProps({
  variant: {
    type: String,
    default: 'primary',
    validator: (value) => ['primary', 'secondary', 'tertiary', 'danger', 'ghost'].includes(value),
  },
  size: {
    type: String,
    default: 'md',
    validator: (value) => ['sm', 'md', 'lg'].includes(value),
  },
  /**
   * In-flight. REDESIGN.md Amendment 17: the handoff's "no spinner" rule is
   * about page and list loading, where a skeleton communicates shape. A submit
   * button mid-flight still needs an indicator — on the screens that write
   * money and attendance, no pending state invites double submits.
   */
  loading: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  /** Defaults to 'button': a bare <button> in a form submits it. */
  type: { type: String, default: 'button' },
  block: { type: Boolean, default: false },
})

defineOptions({ inheritAttrs: true })
</script>

<template>
  <button
    :type="type"
    class="btn"
    :class="[`btn-${props.variant}`, `btn-${props.size}`, { 'btn-block': block, 'is-loading': loading }]"
    :disabled="disabled || loading"
    :aria-busy="loading ? 'true' : undefined"
  >
    <Spinner v-if="loading" size="sm" />
    <slot />
  </button>
</template>

<style scoped>
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  font-family: inherit;
  font-weight: var(--font-weight-semibold);
  line-height: var(--leading-tight);
  cursor: pointer;
  transition:
    background-color var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);
  /* 44px is the mobile target floor from Amendment 12; the md size below meets
   * it without needing a separate touch variant. */
  min-height: 40px;
}

.btn:focus-visible {
  outline: 2px solid transparent;
  outline-offset: 2px;
  box-shadow: var(--shadow-focus-ring);
}

.btn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

/* A loading button is disabled, but it is not unavailable — dimming it to 55%
 * reads as "you may not", where the truth is "it is happening". */
.btn.is-loading:disabled {
  opacity: 1;
  cursor: progress;
}

/* ── Sizes ─────────────────────────────────────────────────────────────────── */
.btn-sm {
  min-height: 32px;
  padding: 0 var(--space-3);
  font-size: var(--text-sm);
}

.btn-md {
  min-height: 44px;
  padding: 0 var(--space-4);
  font-size: var(--text-base);
}

.btn-lg {
  min-height: 48px;
  padding: 0 var(--space-6);
  font-size: var(--text-lg);
}

/* ── Variants ──────────────────────────────────────────────────────────────── */
.btn-primary {
  background: var(--color-accent);
  color: var(--color-text-on-accent);
}
.btn-primary:hover:not(:disabled) {
  background: var(--color-accent-hover);
}
.btn-primary:active:not(:disabled) {
  background: var(--color-accent-active);
}

.btn-secondary {
  background: var(--color-bg-surface);
  color: var(--color-text-primary);
  border-color: var(--color-border-strong);
}
.btn-secondary:hover:not(:disabled) {
  background: var(--color-bg-subtle);
}

.btn-tertiary {
  background: var(--color-accent-subtle);
  /* The accent as text, which has a different contrast floor from the accent
     as a fill. See tokens.css. */
  color: var(--color-accent-text);
  border-color: var(--color-accent-border);
}
.btn-tertiary:hover:not(:disabled) {
  background: var(--color-bg-subtle);
}

.btn-danger {
  background: var(--color-danger);
  color: var(--color-white);
}
.btn-danger:hover:not(:disabled) {
  background: var(--color-danger-hover);
}

.btn-ghost {
  background: transparent;
  color: var(--color-text-secondary);
}
.btn-ghost:hover:not(:disabled) {
  background: var(--color-bg-subtle);
  color: var(--color-text-primary);
}

.btn-block {
  display: flex;
  width: 100%;
}
</style>

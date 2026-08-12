<script setup>
/**
 * Replaces `.stat-badge`, `.church-switcher-badge`, the `.closing-note` pill
 * and the group-type tags.
 *
 * Colour alone never carries the meaning — the label inside always says it too,
 * which is what keeps these readable for the colour-blind and in the Lighthouse
 * accessibility gate.
 */
defineProps({
  variant: {
    type: String,
    default: 'neutral',
    validator: (value) =>
      ['neutral', 'accent', 'accent-secondary', 'success', 'warning', 'danger'].includes(value),
  },
})
</script>

<template>
  <span class="badge" :class="`badge-${variant}`"><slot /></span>
</template>

<style scoped>
.badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 2px var(--space-2);
  border-radius: var(--radius-full);
  border: 1px solid transparent;
  font-size: var(--text-xs);
  font-weight: var(--font-weight-semibold);
  line-height: var(--leading-tight);
  white-space: nowrap;
}

.badge-neutral {
  background: var(--color-bg-subtle);
  color: var(--color-text-secondary);
  border-color: var(--color-border-default);
}

.badge-accent {
  background: var(--color-accent-subtle);
  /* --color-accent-text, not --color-accent: the accent as a FILL and the
     accent as TEXT have different contrast floors. See tokens.css. */
  color: var(--color-accent-text);
  border-color: var(--color-accent-border);
}

/* The rarer second accent. Rare is the point — magenta beside
   cyan everywhere would leave neither one meaning anything. */
.badge-accent-secondary {
  background: var(--color-accent-secondary-subtle);
  color: var(--color-accent-secondary-text);
  border-color: var(--color-accent-secondary-border);
}

.badge-success {
  background: var(--color-success-bg);
  color: var(--color-success-text);
  border-color: var(--color-success-border);
}

.badge-warning {
  background: var(--color-warning-bg);
  color: var(--color-warning-text);
  border-color: var(--color-warning-border);
}

.badge-danger {
  background: var(--color-danger-bg);
  color: var(--color-danger-text);
  border-color: var(--color-danger-border);
}
</style>

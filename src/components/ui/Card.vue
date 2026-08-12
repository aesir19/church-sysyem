<script setup>
// The surface everything sits on. Three knobs, because the mockups use exactly
// three variations: a plain card, a card that lifts on hover (the group grid),
// and a tinted card (the magenta "Missed 3+ meetings" and cyan "Closing
// balance" KPI tiles on Funds and the group detail).

defineProps({
  tint: {
    type: String,
    default: 'none',
    validator: v => ['none', 'accent', 'magenta', 'success', 'warning', 'dark'].includes(v)
  },
  hoverable: { type: Boolean, default: false },
  padded: { type: Boolean, default: true },
  as: { type: String, default: 'div' }
})
</script>

<template>
  <component
    :is="as"
    class="card"
    :class="[`card--${tint}`, { 'card--hover': hoverable, 'card--flush': !padded }]"
  >
    <slot />
  </component>
</template>

<style scoped>
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-card);
  box-shadow: var(--shadow-card);
  padding: var(--card-pad);
  color: var(--ink-3);
}

.card--flush { padding: 0; }

.card--hover {
  transition: transform var(--dur-state) ease, box-shadow var(--dur-state) ease;
}
/* The handoff asks for −4px on the group cards specifically; −3 elsewhere. This
   is the group-card value because it is the only hoverable card in the set. */
.card--hover:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-card-hover);
}

.card--accent  { background: var(--accent-tint-2); border-color: var(--accent-border); }
.card--magenta { background: var(--magenta-tint);  border-color: var(--magenta-border); }
.card--success { background: var(--success-tint);  border-color: var(--success-border); }
.card--warning { background: var(--warning-tint);  border-color: var(--warning-border); }

/* "Your access", the bulk bar, the undo toast, the follow-up summary. */
.card--dark {
  background: var(--dark-panel);
  border-color: var(--dark-panel-border);
  color: var(--dark-panel-ink-2);
}

@media (prefers-reduced-motion: reduce) {
  .card--hover:hover { transform: none; }
}
</style>

<script setup>
/**
 * One card recipe for both families that exist today: the dashboard `.card`
 * and the auth family's `.login-card` / `.set-password-card` / `.pending-card`
 * / `.checkin-card` / `.not-found-card`, which share a radius, shadow and
 * padding and differ only in max-width.
 */
defineProps({
  /** Any CSS length. The auth family is ~420px; dashboard cards are unbounded. */
  maxWidth: { type: String, default: '' },
  padding: {
    type: String,
    default: 'md',
    validator: (value) => ['none', 'sm', 'md', 'lg'].includes(value),
  },
  elevation: {
    type: String,
    default: 'sm',
    validator: (value) => ['none', 'sm', 'md', 'lg'].includes(value),
  },
  /** Renders as <section> etc. where the card is a landmark rather than a box. */
  as: { type: String, default: 'div' },
})
</script>

<template>
  <component
    :is="as"
    class="card"
    :class="[`card-pad-${padding}`, `card-elev-${elevation}`]"
    :style="maxWidth ? { maxWidth } : undefined"
  >
    <slot />
  </component>
</template>

<style scoped>
.card {
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-lg);
  width: 100%;
}

.card-pad-none {
  padding: 0;
}
.card-pad-sm {
  padding: var(--space-4);
}
.card-pad-md {
  padding: var(--space-6);
}
.card-pad-lg {
  padding: var(--space-8);
}

.card-elev-none {
  box-shadow: none;
}
.card-elev-sm {
  box-shadow: var(--shadow-sm);
}
.card-elev-md {
  box-shadow: var(--shadow-md);
}
.card-elev-lg {
  box-shadow: var(--shadow-lg);
}
</style>

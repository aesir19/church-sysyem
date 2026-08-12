<script setup>
// Tags and pills. One component covers the whole vocabulary in the mockups:
// group type tags (MINISTRY / SMALL GROUP), contribution types (Tithes /
// Offering), attendance sources (Member / Guest / QR / By usher), roles
// (Pastor / Finance / Secretariat), nav badges (Soon / New), journey states,
// and the count chips.

defineProps({
  tone: {
    type: String,
    default: 'neutral',
    validator: v => ['neutral', 'accent', 'magenta', 'success', 'warning', 'solid', 'onDark'].includes(v)
  },
  // The eyebrow treatment: uppercase, letterspaced, smaller. Used by the group
  // type tags and the table heads, not by the inline value tags.
  eyebrow: { type: Boolean, default: false },
  dot: { type: Boolean, default: false }
})
</script>

<template>
  <span
    class="badge"
    :class="[`badge--${tone}`, { 'badge--eyebrow': eyebrow }]"
  >
    <span
      v-if="dot"
      class="badge__dot"
      aria-hidden="true"
    />
    <slot />
  </span>
</template>

<style scoped>
.badge {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-6);
  padding: 3px 8px;
  border-radius: var(--r-tag);
  font-size: var(--text-meta);
  font-weight: 700;
  line-height: 1.5;
  white-space: nowrap;
}

.badge--eyebrow {
  font-size: var(--text-eyebrow);
  font-weight: 800;
  letter-spacing: var(--tracking-eyebrow);
  text-transform: uppercase;
}

.badge__dot {
  width: 6px;
  height: 6px;
  border-radius: var(--r-pill);
  background: currentColor;
  flex: none;
}

.badge--neutral { background: var(--divider);        color: var(--ink-3); }
.badge--accent  { background: var(--accent-tint);    color: var(--accent-darkest); }
.badge--magenta { background: var(--magenta-tint);   color: var(--magenta-darkest); }
.badge--success { background: var(--success-tint);   color: var(--success); }
.badge--warning { background: var(--warning-tint-2); color: var(--warning-deep); }

/* The selected filter pill — the first one in the Members filter row. */
.badge--solid   { background: var(--accent);         color: #fff; }

.badge--onDark  { background: rgba(255, 255, 255, .12); color: #fff; }
</style>

<script setup>
// The one "coming soon" marker. Everywhere a surface is drawn to the design but has no
// data behind it yet.
//
// FIVE RULES, AND THE FIRST ONE IS THE WHOLE POINT.
//
// 1. A SOON SURFACE SHOWS NO NUMBER. Not a real one, not a placeholder, not a zero, not
//    a dash. The mockups are full of figures — 19 at meetings, 70% of the roll, 98%
//    confidence — and every one of them is drawing. A badge on an invented number does
//    not make it honest, it makes it an invented number with a badge. So this component
//    renders a label and a mark, and its slot is for prose, never for a value.
// 2. A SOON CONTROL IS INERT AND SAYS WHY. `waiting-on` becomes the tooltip and the
//    accessible description, so the state is explained rather than merely greyed.
// 3. NEVER WIRED TO A SUBSTITUTE SOURCE. The meetings chart is not fed from `attendance`
//    because service attendance answers "did they come to church" while the tile asks
//    "did they come to the group". A confident wrong answer is worse than none.
// 4. SOON MARKS A FEATURE, NOT A VALUE. It goes on the tile, the card, the column, the
//    action — never on an individual cell inside a control that otherwise works.
// 5. A SCREEN READER GETS THE SAME INFORMATION. The badge is not decorative and the
//    disabled state is not conveyed by dimming alone.
//
// It matches the Statistics nav item, which has carried `badge: 'Soon'` and the
// `is-soon` treatment since the redesign — the convention already existed, this just
// makes it reusable.

defineProps({
  // What the surface is waiting for, in the user's language. Shown on hover and read
  // out by assistive technology, so "group meetings are not recorded yet" rather than
  // "no data".
  waitingOn: { type: String, default: '' },
  // `inline` sits in a heading or a button label; `block` is a whole panel's placeholder.
  variant: { type: String, default: 'inline', validator: v => ['inline', 'block'].includes(v) }
})
</script>

<template>
  <span
    v-if="variant === 'inline'"
    class="soon"
    :title="waitingOn || undefined"
  >
    <span class="soon__tag">Soon</span>
    <span class="soon__sr">coming soon<template v-if="waitingOn">, {{ waitingOn }}</template></span>
  </span>

  <div
    v-else
    class="soon-block"
    role="note"
    :aria-label="`Coming soon${waitingOn ? `. ${waitingOn}` : ''}`"
  >
    <span class="soon__tag">Soon</span>
    <p
      v-if="waitingOn"
      class="soon-block__why"
    >
      {{ waitingOn }}
    </p>
    <!-- Prose only. A value here would defeat the whole component. -->
    <slot />
  </div>
</template>

<style scoped>
.soon {
  display: inline-flex;
  align-items: center;
  vertical-align: middle;
}

.soon__tag {
  display: inline-flex;
  align-items: center;
  padding: 2px 7px;
  border-radius: var(--r-tag);
  background: var(--divider);
  color: var(--ink-4);
  font-size: var(--text-eyebrow);
  font-weight: 800;
  letter-spacing: var(--tracking-eyebrow);
  text-transform: uppercase;
  line-height: 1.5;
  white-space: nowrap;
}

/* Announced, never shown. Rule 5: the dimming is not the message. */
.soon__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.soon-block {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--sp-8);
  min-height: 64px;
  justify-content: center;
}

.soon-block__why {
  margin: 0;
  font-size: var(--text-meta);
  color: var(--ink-4);
  text-wrap: pretty;
}
</style>

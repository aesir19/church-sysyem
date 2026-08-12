<script setup>
// The switch. 34×20 track, 16px knob — the mockups' own geometry.
//
// A real <button role="switch"> rather than a styled checkbox. Both are
// accessible if done carefully, but a checkbox has to be visually hidden and
// kept in sync with a fake track, and every time that pattern appears in a
// codebase somebody eventually deletes the hidden input because it "does
// nothing". `role="switch"` announces on/off rather than checked/unchecked,
// which is what these actually are.
//
// The whole row is the control, so the label is inside the button. That is why
// there is no <label for> here — a <label> wrapping a <button> does not forward
// clicks the way it does to an input, and the button already has an accessible
// name from its own text content.

defineProps({
  modelValue: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  // `band` is the mockups' cyan inset panel — used when the switch IS the
  // statement ("Start the discipleship journey"), not when it is one of several
  // in a list.
  band: { type: Boolean, default: false }
})

const emit = defineEmits(['update:modelValue'])
</script>

<template>
  <button
    type="button"
    role="switch"
    class="tgl"
    :class="{ 'tgl--band': band, 'is-on': modelValue }"
    :aria-checked="modelValue ? 'true' : 'false'"
    :disabled="disabled"
    @click="emit('update:modelValue', !modelValue)"
  >
    <span
      class="tgl__track"
      aria-hidden="true"
    ><span class="tgl__knob" /></span>
    <span class="tgl__label"><slot /></span>
  </button>
</template>

<style scoped>
.tgl {
  display: flex;
  align-items: center;
  gap: var(--sp-9);
  width: 100%;
  padding: 0;
  border: 1px solid transparent;
  background: transparent;
  font-family: var(--font-sans);
  font-size: var(--text-body-sm);
  color: var(--ink-3);
  text-align: left;
  cursor: pointer;
}

.tgl--band {
  padding: 11px var(--sp-14);
  border-radius: var(--r-inset);
  background: var(--accent-tint-2);
  border-color: var(--accent-border);
  color: var(--accent-darkest);
}

.tgl__track {
  position: relative;
  width: 34px;
  height: 20px;
  flex: none;
  border-radius: var(--r-pill);
  background: var(--border-strong);
  /* The OFF track needs an edge, not just a fill.
     In dark mode --border-strong (#2c3b49) sits very close to the band's
     --accent-tint-2 (#0a3a4a) in value, so an unlit switch on the cyan band
     read as "possibly on" — on the control that decides whether a joined date
     is written. The inset ring gives the track a boundary in every theme
     rather than relying on the fill alone to carry the state. */
  box-shadow: inset 0 0 0 1px var(--ink-6);
  transition: background-color var(--dur-state) ease, box-shadow var(--dur-state) ease;
}

.tgl__knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: var(--r-pill);
  background: #fff;
  box-shadow: 0 1px 2px rgba(16, 24, 40, .3);
  transition: transform var(--dur-state) var(--ease-entrance);
}

/* Lit, the fill carries the state and the ring would only muddy the edge. */
.tgl.is-on .tgl__track { background: var(--accent); box-shadow: none; }
.tgl.is-on .tgl__knob { transform: translateX(14px); }

.tgl__label { min-width: 0; line-height: 1.4; }
.tgl__label :deep(strong) { font-weight: 800; }

.tgl:disabled { opacity: .55; cursor: not-allowed; }
.tgl:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: var(--r-inset); }

@media (prefers-reduced-motion: reduce) {
  .tgl__track, .tgl__knob { transition: none; }
}
</style>

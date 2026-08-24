<script setup>
// The ⋯ overflow menu — a page's secondary actions, collapsed behind one icon
// (5 - Action Bar System). Its counterpart is the page's primary verb sitting
// beside it; everything rare, occasional, or destructive lives in here instead
// of stacking up as buttons in the corner.
//
// HAND-ROLLED, NOT REKA, and modelled on SettingsMenu.vue — the Dialog ADR keeps
// Reka scoped to Dialog and everything else native or hand-rolled. A menu is the
// small three-part problem: close on Escape, close on outside click, restore
// focus to the trigger. All three are here.
//
// THE ONE RULE THAT IS NOT COSMETIC: an empty menu never renders. A page with no
// page-level secondary actions shows no ⋯ at all, because a ⋯ that opens onto
// nothing is the same clutter the audit set out to remove. Deciding WHICH actions
// a screen has — and whether a lone action is better shown as a plain button than
// hidden in here — is the caller's job; this component only draws the list it is
// given, and draws nothing when that list is empty.

import { ref, onMounted, onBeforeUnmount } from 'vue'
import Icon from './icons/Icon.vue'

defineProps({
  // [{ key, label, onSelect, danger?, disabled?, dividerBefore? }]
  items: { type: Array, default: () => [] },
  // The trigger is icon-only, so it needs its own accessible name.
  label: { type: String, default: 'More actions' },
  // Which edge the menu lines up with. Page headers are right-aligned, so the
  // menu hangs from the trigger's right edge by default.
  align: { type: String, default: 'end', validator: v => ['start', 'end'].includes(v) }
})

const open = ref(false)
const root = ref(null)
const trigger = ref(null)

function close (returnFocus = true) {
  if (!open.value) return
  open.value = false
  if (returnFocus) trigger.value?.focus()
}

function select (item) {
  if (item.disabled) return
  close(false)
  item.onSelect?.()
}

function onPointerDown (event) {
  if (root.value && !root.value.contains(event.target)) close(false)
}

function onKeydown (event) {
  if (event.key === 'Escape') close()
}

onMounted(() => {
  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointerDown, true)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div
    v-if="items.length"
    ref="root"
    class="om"
  >
    <button
      ref="trigger"
      type="button"
      class="om__trigger"
      :class="{ 'is-open': open }"
      :aria-label="label"
      :aria-expanded="open"
      aria-haspopup="menu"
      @click="open = !open"
    >
      <Icon
        name="dots"
        :size="17"
        :width="2"
      />
    </button>

    <!-- v-show, not v-if: the items stay in the DOM (display:none while closed, so
         hidden from the tab order and the a11y tree) rather than being created on
         open. That keeps the capability-gated action list observable — a caller who
         may not edit never has an Edit item rendered at all — which is the contract
         the page's tests assert. Transition gives back the entrance animation v-show
         alone would drop. -->
    <Transition name="om">
      <div
        v-show="open"
        class="om__menu"
        :class="`om__menu--${align}`"
        role="menu"
      >
        <template
          v-for="item in items"
          :key="item.key"
        >
          <div
            v-if="item.dividerBefore"
            class="om__rule"
          />
          <button
            type="button"
            role="menuitem"
            class="om__item"
            :class="{ 'om__item--danger': item.danger }"
            :disabled="item.disabled || undefined"
            @click="select(item)"
          >
            {{ item.label }}
          </button>
        </template>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.om {
  position: relative;
  display: inline-flex;
}

.om__trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border: 1px solid var(--border-strong);
  border-radius: var(--r-control);
  background: var(--surface);
  color: var(--ink-4);
  cursor: pointer;
  transition:
    background var(--dur-state),
    color var(--dur-state),
    border-color var(--dur-state);
}

.om__trigger:hover,
.om__trigger.is-open {
  background: var(--accent-tint);
  border-color: var(--accent-border);
  color: var(--accent-darkest);
}

.om__trigger:focus-visible {
  outline: var(--ring-focus);
  outline-offset: 2px;
}

.om__menu {
  position: absolute;
  top: calc(100% + 8px);
  z-index: 40;
  min-width: 208px;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 13px;
  background: var(--surface);
  box-shadow: var(--shadow-popover);
}

.om-enter-active { animation: om-rise .18s cubic-bezier(.2, .8, .2, 1) both; }
.om-leave-active { transition: opacity .12s ease; }
.om-leave-to { opacity: 0; }

.om__menu--end { right: 0; }
.om__menu--start { left: 0; }

.om__item {
  display: block;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  text-align: left;
  font-family: inherit;
  font-size: var(--text-body-sm);
  font-weight: 600;
  color: var(--ink-2);
  cursor: pointer;
}

.om__item:hover:not(:disabled) { background: var(--accent-tint); }
.om__item:focus-visible { outline: var(--ring-focus); outline-offset: -2px; }

/* The destructive item — always last, always separated by a rule, and magenta so
   it never sits in the same visual weight as the safe actions above it. */
.om__item--danger { color: var(--magenta); }
.om__item--danger:hover:not(:disabled) { background: var(--magenta-tint); }

.om__item:disabled { opacity: .55; cursor: not-allowed; }

.om__rule {
  height: 1px;
  margin: 6px 4px;
  background: var(--divider);
}

@keyframes om-rise {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: none; }
}

@media (prefers-reduced-motion: reduce) {
  .om-enter-active { animation: none; }
  .om-leave-active { transition: none; }
}
</style>

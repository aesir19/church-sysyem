<script setup>
import { computed } from 'vue'
import Icon from './icons/Icon.vue'

// A sortable <th>.
//
// The sort state lives on the element, not beside it: `aria-sort` on the header
// cell is how a screen reader announces which column a table is ordered by and
// in which direction. A visual chevron alone leaves that user with an
// unexplained reordering.
//
// The button inside is what takes focus and the click. A <th> with a click
// handler is not reachable by keyboard.

const props = defineProps({
  sortKey: { type: String, required: true },
  ariaSort: { type: String, default: 'none' },
  align: { type: String, default: 'left', validator: v => ['left', 'right'].includes(v) }
})

defineEmits(['sort'])

const direction = computed(() =>
  props.ariaSort === 'ascending' ? 'chevronUp'
    : props.ariaSort === 'descending' ? 'chevronDown'
      : null
)
</script>

<template>
  <th
    scope="col"
    :aria-sort="ariaSort"
    :class="`th th--${align}`"
  >
    <button
      type="button"
      class="th__btn"
      @click="$emit('sort', sortKey)"
    >
      <span><slot /></span>
      <Icon
        v-if="direction"
        :name="direction"
        :size="12"
        :width="2.6"
        class="th__icon"
      />
    </button>
  </th>
</template>

<style scoped>
.th {
  padding: 0;
  text-align: left;
  background: var(--surface-subtle);
}
.th--right { text-align: right; }

.th__btn {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-6);
  width: 100%;
  padding: var(--sp-10) var(--sp-14);
  border: 0;
  background: transparent;
  font-family: var(--font-sans);
  font-size: var(--text-eyebrow);
  font-weight: 800;
  letter-spacing: var(--tracking-eyebrow);
  text-transform: uppercase;
  color: var(--ink-5);
  cursor: pointer;
  transition: color var(--dur-state) ease;
}
.th--right .th__btn { justify-content: flex-end; }

.th__btn:hover { color: var(--ink-3); }
.th__btn:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

.th[aria-sort='ascending'] .th__btn,
.th[aria-sort='descending'] .th__btn { color: var(--accent-text); }

.th__icon { flex: none; }
</style>

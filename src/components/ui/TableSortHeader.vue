<script setup>
/**
 * A sortable table header that a keyboard can actually operate.
 *
 * D11's second sub-fix, and a plain HTML/ARIA one — Reka UI has no table-header
 * primitive, so ADR-0011's dependency is not involved here.
 *
 * The concrete bug this closes: DashboardView's headers are
 * `<th @click="setSort(...)">`. A `<th>` is not focusable and not activatable,
 * and no amount of ARIA added to it changes that — a keyboard user cannot sort
 * the members table at all today, and a screen reader is never told the table
 * is sorted. The fix is two things at once:
 *
 *   1. a real `<button>` inside the `<th>` carrying the handler, so Tab reaches
 *      it and Enter/Space activate it for free, and
 *   2. `aria-sort` on the `<th>` itself, which is where the attribute belongs —
 *      it describes the column, not the control.
 *
 * Only DashboardView's member table needs this. ChurchFundsView's three tables
 * and the rest found by `<table>` search are fixed-order reports; they get the
 * shared token-driven table CSS and no sort affordance.
 */
import Icon from './icons/Icon.vue'

defineProps({
  /** The column identifier passed back on activation. */
  sortKey: { type: String, required: true },
  /** From useSortState().ariaSortFor(key) — 'ascending' | 'descending' | 'none'. */
  ariaSort: {
    type: String,
    default: 'none',
    validator: (value) => ['ascending', 'descending', 'none'].includes(value),
  },
  align: {
    type: String,
    default: 'left',
    validator: (value) => ['left', 'right', 'center'].includes(value),
  },
})

const emit = defineEmits(['sort'])
</script>

<template>
  <th scope="col" :aria-sort="ariaSort" :class="[`align-${align}`, { active: ariaSort !== 'none' }]">
    <button type="button" class="sort-button" @click="emit('sort', sortKey)">
      <span><slot /></span>
      <!-- Decorative: aria-sort on the <th> is what announces the state, so a
           label here would say it a second time. -->
      <Icon
        :name="ariaSort === 'ascending' ? 'chevron-up' : ariaSort === 'descending' ? 'chevron-down' : 'chevron-sort'"
        :size="14"
        class="sort-icon"
        :class="{ 'is-idle': ariaSort === 'none' }"
      />
    </button>
  </th>
</template>

<style scoped>
th {
  padding: 0;
  background: var(--color-bg-subtle);
  border-bottom: 1px solid var(--color-border-default);
  font-size: var(--text-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-secondary);
  white-space: nowrap;
}

th.active {
  color: var(--color-text-primary);
}

.sort-button {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-3) var(--space-4);
  background: none;
  border: none;
  font: inherit;
  color: inherit;
  cursor: pointer;
  text-align: inherit;
}

.sort-button:hover {
  color: var(--color-text-primary);
}

.sort-button:focus-visible {
  outline: 2px solid var(--color-focus-ring);
  outline-offset: -2px;
}

.align-right .sort-button {
  justify-content: flex-end;
}
.align-center .sort-button {
  justify-content: center;
}

/* The idle chevron pair says "you can sort by this" without competing with the
 * column that actually is sorted. */
.sort-icon.is-idle {
  opacity: 0.35;
}

th:hover .sort-icon.is-idle {
  opacity: 0.7;
}
</style>

/**
 * Reactive wrapper over src/utils/sortState.js.
 *
 * Per-call state, not module-scoped: two tables on one screen sort
 * independently. All the decisions live in the pure module and are unit-tested
 * there; this holds a ref and forwards.
 */

import { computed, ref } from 'vue'
import { ariaSortFor, isSortedBy, nextSortState, sortDirectionFor } from '../utils/sortState'

/**
 * @param {string} [initialKey] the column sorted on first paint
 * @param {'ascending'|'descending'} [initialDirection]
 */
export function useSortState(initialKey = '', initialDirection = 'ascending') {
  const state = ref(initialKey ? { key: initialKey, direction: initialDirection } : null)

  function toggleSort(key) {
    state.value = nextSortState(state.value, key)
  }

  return {
    sort: computed(() => state.value),
    sortKey: computed(() => state.value?.key ?? ''),
    sortDirection: computed(() => sortDirectionFor(state.value, state.value?.key)),
    toggleSort,
    ariaSortFor: (key) => ariaSortFor(state.value, key),
    isSortedBy: (key) => isSortedBy(state.value, key),
  }
}

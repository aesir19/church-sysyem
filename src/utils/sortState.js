/**
 * Which column a table is sorted by, and in which direction.
 *
 * Pulled out of the view because it carries D11's second sub-fix, which is a
 * plain ARIA fix rather than anything a headless-primitive library offers: a
 * sortable `<th>` must announce `aria-sort`, and the three tokens it may carry
 * are a closed vocabulary. A typo there is not a degraded announcement — it is
 * no announcement at all, and nothing in a visual check catches it. Naming the
 * direction `'ascending'`/`'descending'` rather than `'asc'`/`'desc'` is what
 * removes the translation step where that typo would live.
 *
 * See docs/REDESIGN.md "D11 and D12 — exactly where and how".
 *
 * @typedef {{ key: string, direction: 'ascending'|'descending' }} SortState
 */

export const ASCENDING = 'ascending'
export const DESCENDING = 'descending'

/** The `aria-sort` value for a column that is not the sorted one. */
export const NONE = 'none'

function isDirection(value) {
  return value === ASCENDING || value === DESCENDING
}

/** Is `key` the column currently sorted on? */
export function isSortedBy(state, key) {
  return Boolean(key) && state?.key === key
}

/**
 * The direction `key` is sorted in, or null if it is not the sorted column.
 *
 * @returns {'ascending'|'descending'|null}
 */
export function sortDirectionFor(state, key) {
  if (!isSortedBy(state, key)) return null
  return isDirection(state.direction) ? state.direction : ASCENDING
}

/**
 * The `aria-sort` attribute value for one column header.
 *
 * @returns {'ascending'|'descending'|'none'}
 */
export function ariaSortFor(state, key) {
  return sortDirectionFor(state, key) ?? NONE
}

/**
 * The state after a header is activated.
 *
 * Choosing the active column flips it; choosing any other column starts that
 * column ascending rather than carrying the previous column's direction across.
 * Inheriting would land a fresh header on descending with no click that asked
 * for it, showing the user an arrow they did not choose.
 *
 * Returns a new object — the caller's state is never mutated, so a `ref` swap
 * is what triggers the re-render rather than a deep watcher.
 *
 * @returns {SortState} unchanged when `key` names no column
 */
export function nextSortState(state, key) {
  if (!key) return state
  const current = sortDirectionFor(state, key)
  return { key, direction: current === ASCENDING ? DESCENDING : ASCENDING }
}

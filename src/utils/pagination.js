/**
 * Page arithmetic for a server-paginated list.
 *
 * The unbounded member query was replaced with `.range()` at a page size of
 * 50. Client-side paging was rejected as theatre — the
 * unbounded query still runs, so egress is unchanged and the CLAUDE.md
 * threshold it is meant to answer stays breached.
 *
 * The arithmetic lives here rather than in the view because off-by-one is the
 * whole risk and it is invisible on screen: PostgREST's `.range()` bounds are
 * INCLUSIVE, so page 2 of 50 is rows 50–99. A one-row overlap shows the same
 * member twice across a page boundary; a one-row gap hides someone entirely.
 * Neither looks like a bug.
 *
 * Domain-blind on purpose. Nothing here knows what a member is.
 */

/** Coerce anything — a failed count, a URL param, undefined — to a whole number. */
function toCount(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

/**
 * How many pages `total` rows fill.
 *
 * Never less than 1: an empty list still has a page 1, and returning 0 makes
 * every clamp below it produce page 0, which asks the database for rows -50..-1.
 *
 * @returns {number}
 */
export function pageCount(total, pageSize) {
  const size = Math.max(1, toCount(pageSize))
  return Math.max(1, Math.ceil(toCount(total) / size))
}

/**
 * The nearest page that actually exists.
 *
 * The case this exists for: you are on page 3, you type a search matching four
 * people, and page 3 of one page does not exist. Without the clamp the list
 * comes back empty and reads as "no results".
 *
 * @returns {number} 1-based
 */
export function clampPage(page, total, pageSize) {
  const requested = Math.max(1, toCount(page) || 1)
  return Math.min(requested, pageCount(total, pageSize))
}

/**
 * The inclusive `[from, to]` bounds `.range()` wants for a 1-based page.
 *
 * @returns {{ from: number, to: number }}
 */
export function rangeFor(page, pageSize) {
  const size = Math.max(1, toCount(pageSize))
  const index = Math.max(0, (toCount(page) || 1) - 1)
  const from = index * size
  return { from, to: from + size - 1 }
}

/**
 * "101–137 of 137" — the slice actually on screen.
 *
 * Empty string for an empty list rather than "1–0 of 0", which is arithmetic
 * shown to a person who wanted a sentence.
 *
 * @returns {string}
 */
export function rangeLabel(page, pageSize, total) {
  const count = toCount(total)
  if (count === 0) return ''

  const { from } = rangeFor(page, pageSize)
  const first = Math.min(from + 1, count)
  const last = Math.min(from + Math.max(1, toCount(pageSize)), count)
  return `${first}–${last} of ${count}`
}

/** How many pages sit either side of the current one before eliding. */
const WINDOW = 1

/**
 * The slots a numbered pager renders: page numbers, with `'…'` where a stretch
 * is elided.
 *
 * The first and last page are always offered — they are the two a person
 * actually jumps to. A gap is only elided when it hides more than one page,
 * since an ellipsis standing in for a single number costs a click and saves
 * nothing.
 *
 * @returns {(number|'…')[]}
 */
export function pageNumbers(page, total, pageSize) {
  const last = pageCount(total, pageSize)
  const current = clampPage(page, total, pageSize)

  // The window slides rather than shrinking at the ends, so the pager keeps the
  // same width wherever you are in the list. A control that changes size as you
  // move through it puts the next number under a different pixel each time.
  const start = Math.max(1, Math.min(current - WINDOW, last - 2 * WINDOW))
  const end = Math.min(last, start + 2 * WINDOW)

  const wanted = new Set([1, last])
  for (let p = start; p <= end; p++) wanted.add(p)

  const slots = []
  let previous = 0
  for (const p of [...wanted].sort((a, b) => a - b)) {
    const gap = p - previous - 1
    if (gap === 1) slots.push(previous + 1)
    else if (gap > 1) slots.push('…')
    slots.push(p)
    previous = p
  }
  return slots
}

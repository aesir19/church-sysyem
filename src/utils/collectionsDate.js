/**
 * Determines the default service date for a contribution entry.
 *
 * Rules:
 * - Sunday → today
 * - Saturday → previous day (Friday)
 * - Friday → today
 * - Monday–Thursday → previous Sunday
 *
 * @param {Date} [today] - Override for testing; defaults to new Date()
 * @returns {string} ISO date string (YYYY-MM-DD)
 */
export function getDefaultServiceDate(today = new Date()) {
  const day = today.getDay() // 0=Sun,1=Mon,...6=Sat
  const result = new Date(today)

  if (day === 0) {
    // Sunday → today
  } else if (day === 6) {
    // Saturday → Friday (yesterday)
    result.setDate(result.getDate() - 1)
  } else if (day === 5) {
    // Friday → today
  } else {
    // Monday(1)–Thursday(4) → previous Sunday
    result.setDate(result.getDate() - day)
  }

  return formatDateISO(result)
}

/**
 * Format a Date to YYYY-MM-DD local string
 */
export function formatDateISO(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * The service dates offered as pills on the collections form: the default one,
 * then the Sundays before it.
 *
 * DERIVED, NOT QUERIED. The obvious source is the `services` table, but a
 * Finance ministry member has no attendance capability and would read nothing
 * from it under RLS, so the pills would be empty for exactly the role that uses
 * this form. Sundays are also the only thing `services` would have told us that
 * matters here — a collection is entered against the day money was received.
 * Anything outside the pattern is still reachable through the date field beside
 * them, which is why this list is a shortcut rather than a constraint.
 *
 * @param {{ today?: Date, count?: number }} [options]
 * @returns {string[]} ISO date strings, most recent first
 */
export function recentServiceDates({ today = new Date(), count = 4 } = {}) {
  const dates = [getDefaultServiceDate(today)]

  // Step back from the first pill to the Sunday strictly before it. Starting
  // from the pill rather than from `today` matters on a Friday: the default is
  // Friday itself, and the one before it is the previous Sunday, not the one
  // before that.
  const cursor = new Date(`${dates[0]}T00:00:00`)
  while (dates.length < count) {
    // -7 on a Sunday, otherwise back to the Sunday of the current week.
    cursor.setDate(cursor.getDate() - (cursor.getDay() === 0 ? 7 : cursor.getDay()))
    dates.push(formatDateISO(cursor))
  }

  return dates
}

/** 'Aug 2' — the pill's own label. */
export function formatServiceDateShort(value) {
  if (!value) return ''
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })
}

// The 3-hour edit window was retired in migration 0039: collections and expenses
// are append-only now, corrected by tracked reversals rather than an in-place
// edit. isWithinEditWindow (and its client/RLS enforcement) went with it.

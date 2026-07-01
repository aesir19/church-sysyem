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
 * Check if a contribution is still within the editable window (3 hours).
 * @param {string} createdAt - ISO timestamp of when the record was inserted
 * @param {Date} [now] - Override for testing
 * @returns {boolean}
 */
export function isWithinEditWindow(createdAt, now = new Date()) {
  const created = new Date(createdAt)
  const threeHoursMs = 3 * 60 * 60 * 1000
  return (now.getTime() - created.getTime()) <= threeHoursMs
}

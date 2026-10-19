// "2 Aug" / "1 August" — day before month, as mockup 13 writes dates.
//
// Spelled out here rather than left to toLocaleDateString('en-GB'): newer ICU versions
// abbreviate September as "Sept", so the same code read differently across browsers.
// A bare YYYY-MM-DD is a calendar date as written; an instant is read in Manila.

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const MANILA_OFFSET = 8 * 3_600_000

export function dayMonth (value, { long = false } = {}) {
  const isDateOnly = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  const d = isDateOnly
    ? new Date(`${value}T00:00:00Z`)
    : new Date(new Date(value).getTime() + MANILA_OFFSET)
  return `${d.getUTCDate()} ${(long ? LONG : SHORT)[d.getUTCMonth()]}`
}

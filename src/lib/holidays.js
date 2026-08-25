// Philippine holidays on the Calendar (Q13). Spec #87.
//
// VENDORED, NOT LIVE (rules 1 + 2). The holiday list is a static file bundled with the
// app (src/data/holidays.json), refreshed at release time by scripts/build-holidays.js
// from a reliable open source (Nager.Date, MIT). There is NO runtime API call: a holiday
// is public, the same for every viewer, and calling a third party from a members-facing
// page for a ~20-item-a-year list is standing risk for nothing. The overlay is read-only
// and PURELY VISUAL — it labels a day and touches nothing else (no clash, no gaps, no
// attendance).
//
// PH's movable holidays (Holy Week, Eid) are set by government proclamation each year, so
// a static per-year list is the CORRECT source, not a formula. definedThrough() surfaces
// the last year the file covers, so the UI can flag when it needs a refresh.

import holidays from '../data/holidays.json'

/** The last year the bundled list covers — the UI shows "holidays through YYYY" so a stale
 *  file is visible, not silent. */
export function definedThrough(list = holidays) {
  let max = 0
  for (const h of list) {
    const y = Number(String(h.date).slice(0, 4))
    if (y > max) max = y
  }
  return max || null
}

/**
 * Expand the holiday list into dated, all-day calendar items within [from, to). Pure and
 * exported for testing. Each item carries the holiday name and its type ('regular' |
 * 'special') so the view can style the two differently. Anchored at local noon for the
 * same reason birthdays are (see events.js): midnight serialises a day early in Manila.
 */
export function expandHolidays(from, to, list = holidays) {
  const out = []
  const fromT = from.getTime()
  const toT = to.getTime()
  for (const h of list) {
    const [y, m, d] = String(h.date).split('-').map(Number)
    if (!y || !m || !d) continue
    const at = new Date(y, m - 1, d, 12, 0, 0)
    if (at.getTime() < fromT || at.getTime() >= toT) continue
    out.push({
      id: `holiday-${h.date}-${slug(h.name)}`,
      title: h.name,
      kind: 'holiday',
      status: 'published',
      starts_at: at.toISOString(),
      isHoliday: true,
      holidayType: h.type === 'special' ? 'special' : 'regular',
    })
  }
  return out
}

function slug(s) {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

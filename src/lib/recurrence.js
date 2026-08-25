// The recurrence engine — pure, no database, no Supabase. Given a repeat rule (the shape of
// an event_series row, migration 0034) and a half-open window [from, to), it works out the
// dates the rule implies. This is the single source of truth for "when does this repeat":
// the Calendar, Week, Agenda, the series list, and the delete/edit counts all read it, so a
// repeat date is never computed two different ways.
//
// TIME-OF-DAY AND TIMEZONE. Dates are built in LOCAL time (new Date(y, m, d, hh, mm)) and the
// window bounds are local too, the same convention expandWeeklySchedules/expandBirthdays keep.
// The app runs in one church timezone; anchoring locally keeps a Sunday on Sunday through the
// serialise round-trip the grid does (see the noon note in events.js expandBirthdays).
//
// A "rule" object:
//   cadence      'weekly' | 'monthly' | 'twice_monthly'
//   intervalN    every N weeks (weekly) or every N months (monthly); ignored by twice_monthly
//   weekday      0–6, Sunday = 0 — the day (weekly; monthly/twice_monthly weekday anchor)
//   weekOfMonth  1–5 or -1 (last) — nth weekday of the month (monthly/twice_monthly weekday)
//   dayOfMonth   1–31 — day-of-month (monthly/twice_monthly date anchor)
//   weekday2 / weekOfMonth2 / dayOfMonth2 — the SECOND anchor, twice_monthly only
//   anchor       'weekday' | 'date' — how monthly/twice_monthly pick the day
//   startsOn     'YYYY-MM-DD' — the series' first eligible date (inclusive)
//   endsOn       'YYYY-MM-DD' | null — last eligible date (inclusive), or open-ended
//   countN       number | null — cap the series to N occurrences from startsOn
//   timeStart    'HH:MM' — time of day the occurrence starts
//   timeEnd      'HH:MM' | null — optional end time (duration; null renders as a default block)

function parseYmd(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number)
  return new Date(y, m - 1, d)
}

function parseHm(hm) {
  const [h, m] = String(hm ?? '00:00').split(':').map(Number)
  return [h || 0, m || 0]
}

// One dated occurrence, anchored at the rule's start time. Kept minimal — callers decorate
// it with the series' title/kind/etc; the engine only owns the date.
function makeOccurrence(year, monthIndex, day, rule) {
  const [hh, mm] = parseHm(rule.timeStart)
  return { date: new Date(year, monthIndex, day, hh, mm, 0, 0) }
}

/**
 * The dates a rule implies within [from, to). `from`/`to` are Date objects (local). Returns
 * `[{ date }]` ordered ascending. Occurrences before startsOn, after endsOn, or beyond countN
 * are never emitted, so the window is clipped to the series' real life.
 */
export function expandSeries(rule, from, to) {
  const start = parseYmd(rule.startsOn)
  // endsOn is inclusive: an occurrence exactly on endsOn still counts, so compare against the
  // day AFTER it. A null end is open-ended.
  const endExclusive = rule.endsOn ? addDays(parseYmd(rule.endsOn), 1) : null
  const out = []

  if (rule.cadence === 'weekly') {
    const step = 7 * (rule.intervalN || 1)
    // First occurrence: the rule's weekday on or after startsOn.
    const cursor = new Date(start)
    while (cursor.getDay() !== rule.weekday) cursor.setDate(cursor.getDate() + 1)
    let n = 0
    for (; cursor < to; cursor.setDate(cursor.getDate() + step)) {
      if (rule.countN != null && n >= rule.countN) break
      if (endExclusive && cursor >= endExclusive) break
      n++
      if (cursor < start) continue
      if (cursor >= from) {
        out.push(makeOccurrence(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), rule))
      }
    }
  }

  if (rule.cadence === 'monthly' || rule.cadence === 'twice_monthly') {
    // twice_monthly always steps one month at a time and yields two anchored days; monthly
    // steps by intervalN and yields one. Both share the per-month day-list stepper.
    const step = rule.cadence === 'twice_monthly' ? 1 : rule.intervalN || 1
    const [hh, mm] = parseHm(rule.timeStart)
    let year = start.getFullYear()
    let month = start.getMonth()
    let n = 0
    outer: for (let guard = 0; guard < 1200; guard++) {
      for (const day of monthlyDays(rule, year, month)) {
        const occ = new Date(year, month, day, hh, mm, 0, 0)
        if (occ >= to) break outer
        if (endExclusive && occ >= endExclusive) break outer
        if (rule.countN != null && n >= rule.countN) break outer
        n++
        if (occ >= start && occ >= from) {
          out.push(makeOccurrence(year, month, day, rule))
        }
      }
      month += step
      year += Math.floor(month / 12)
      month = ((month % 12) + 12) % 12
    }
  }

  return out
}

// The day(s)-of-month a monthly-family rule falls on in a given year/month, ascending. A month
// that cannot satisfy an anchor (the 31st of a 30-day month, a missing 5th weekday) drops that
// anchor rather than clamping it. Returns [] when no anchor lands.
function monthlyDays(rule, year, month) {
  const days = []
  if (rule.anchor === 'date') {
    const dim = daysInMonth(year, month)
    if (rule.dayOfMonth <= dim) days.push(rule.dayOfMonth)
    if (rule.cadence === 'twice_monthly' && rule.dayOfMonth2 <= dim) days.push(rule.dayOfMonth2)
  } else {
    const d1 = nthWeekdayOfMonth(year, month, rule.weekday, rule.weekOfMonth)
    if (d1) days.push(d1)
    if (rule.cadence === 'twice_monthly') {
      const d2 = nthWeekdayOfMonth(year, month, rule.weekday2, rule.weekOfMonth2)
      if (d2) days.push(d2)
    }
  }
  return [...new Set(days)].sort((a, b) => a - b)
}

// The day-of-month of the nth `weekday` in a month, or null if that month has no such nth.
// `nth` is 1–5, or -1 for "the last". Sunday = 0.
function nthWeekdayOfMonth(year, month, weekday, nth) {
  const dim = daysInMonth(year, month)
  if (nth === -1) {
    // Walk back from the last day to the most recent matching weekday.
    for (let day = dim; day >= 1; day--) {
      if (new Date(year, month, day).getDay() === weekday) return day
    }
    return null
  }
  const firstDow = new Date(year, month, 1).getDay()
  // Days until the first occurrence of `weekday`, then step by weeks.
  const offset = (weekday - firstDow + 7) % 7
  const day = 1 + offset + (nth - 1) * 7
  return day <= dim ? day : null
}

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate()
}

export function addDays(date, days) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// "1st", "2nd", "3rd", "15th", "21st" — English ordinal for a day-of-month or nth.
function ordinal(n) {
  const abs = Math.abs(n)
  const tens = abs % 100
  const ones = abs % 10
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ones === 1 ? 'st' : ones === 2 ? 'nd' : ones === 3 ? 'rd' : 'th'
  return `${n}${suffix}`
}

// '09:00' → '9:00 am', '19:00' → '7:00 pm'. 12-hour, church-facing.
function describeTime(hm) {
  const [h, m] = parseHm(hm)
  const period = h < 12 ? 'am' : 'pm'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}

// The nth as words: -1 → "last", otherwise the ordinal ("3rd").
function nthWord(n) {
  return n === -1 ? 'last' : ordinal(n)
}

/**
 * The repeat rule in plain words, e.g. "Every Sunday, 9:00 am" or "The 3rd Saturday of every
 * month, 2:00 pm". Used by the series list and the "Series" chip so a rule can be read without
 * opening it. Never throws on a partial rule — an unknown cadence returns 'Repeats'.
 */
export function describeRule(rule) {
  const time = describeTime(rule.timeStart)
  if (rule.cadence === 'weekly') {
    const day = WEEKDAY_NAMES[rule.weekday]
    const n = rule.intervalN || 1
    const cadence = n === 1 ? `Every ${day}` : `Every ${n} weeks on ${day}`
    return `${cadence}, ${time}`
  }
  if (rule.cadence === 'monthly') {
    const n = rule.intervalN || 1
    const every = n === 1 ? 'every month' : `every ${n} months`
    if (rule.anchor === 'date') {
      return `On the ${ordinal(rule.dayOfMonth)} of ${every}, ${time}`
    }
    return `The ${nthWord(rule.weekOfMonth)} ${WEEKDAY_NAMES[rule.weekday]} of ${every}, ${time}`
  }
  if (rule.cadence === 'twice_monthly') {
    if (rule.anchor === 'date') {
      const [a, b] = [rule.dayOfMonth, rule.dayOfMonth2].sort((x, y) => x - y)
      return `Twice a month (${ordinal(a)} and ${ordinal(b)}), ${time}`
    }
    const first = `${nthWord(rule.weekOfMonth)} ${WEEKDAY_NAMES[rule.weekday]}`
    const second = `${nthWord(rule.weekOfMonth2)} ${WEEKDAY_NAMES[rule.weekday2]}`
    return `Twice a month (${first} and ${second}), ${time}`
  }
  return 'Repeats'
}

/**
 * The first occurrence strictly after `after` (a Date), or null if the series has none left
 * (ended, or capped by countN). Reads through expandSeries so it can never disagree with the
 * calendar. Looks ahead up to two years, enough for any cadence here.
 */
export function nextOccurrence(rule, after) {
  const from = new Date(after.getTime() + 1000) // strictly after
  const to = addDays(from, 366 * 2)
  const [first] = expandSeries(rule, from, to)
  return first ? first.date : null
}

// Local YYYY-MM-DD, exported as the one date-key helper the data layer and views share so a
// day is never keyed two different ways (see events.js's noon/timezone note).
export function ymd(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// A virtual occurrence's calendar item — the shape the Calendar/Week/Agenda already expect
// from a plain event, plus the series tags. Kept parallel to a real events row so the views
// render both the same way.
function virtualItem(series, date) {
  const [hh, mm] = parseHm(series.timeEnd || '')
  const ends = series.timeEnd ? new Date(date.getFullYear(), date.getMonth(), date.getDate(), hh, mm, 0, 0) : null
  return {
    id: `series-${series.id}-${ymd(date)}`,
    seriesId: series.id,
    occurrence_date: ymd(date),
    title: series.title,
    kind: series.kind,
    status: 'published',
    location: series.location ?? null,
    description: series.description ?? null,
    starts_at: date.toISOString(),
    ends_at: ends ? ends.toISOString() : null,
    isSeries: true,
    virtual: true,
  }
}

/**
 * Merge each series' worked-out (virtual) occurrences with the real saved rows that override
 * them, for the window [from, to). A saved row is an "exception": a date the team moved,
 * cancelled, or otherwise edited. It carries series_id and occurrence_date — the slot it
 * replaces — so the virtual occupant of that slot is suppressed and never double-counts.
 *
 * The rules, all of which the tests pin:
 *   - A slot with an exception shows the REAL row (at its own time/status), not the virtual one.
 *   - An exception whose real start moved out of the window disappears from it — its slot is
 *     suppressed and the row itself is out of range, so neither shows.
 *   - Untouched slots stay virtual and unchanged, which is how "edit one, leave the rest alone"
 *     holds.
 *
 * `seriesList` items carry the rule fields plus display fields (title, kind, location, …).
 * `exceptions` are real events rows with series_id + occurrence_date. Returns calendar items
 * ordered by start.
 */
export function mergeSeriesOccurrences({ seriesList, exceptions, from, to }) {
  const out = []

  // Index exceptions by series → set of suppressed occurrence_date, and keep the rows to place.
  const suppressed = new Map() // seriesId -> Set(occurrence_date)
  for (const ex of exceptions) {
    if (!suppressed.has(ex.series_id)) suppressed.set(ex.series_id, new Set())
    suppressed.get(ex.series_id).add(ex.occurrence_date)
  }

  for (const series of seriesList) {
    const skip = suppressed.get(series.id) ?? new Set()
    for (const occ of expandSeries(series, from, to)) {
      if (skip.has(ymd(occ.date))) continue
      out.push(virtualItem(series, occ.date))
    }
  }

  // Place each exception row by its real start, if that falls inside the window.
  const fromT = from.getTime()
  const toT = to.getTime()
  for (const ex of exceptions) {
    const t = new Date(ex.starts_at).getTime()
    if (t >= fromT && t < toT) {
      out.push({ ...ex, seriesId: ex.series_id, isSeries: true, virtual: false })
    }
  }

  out.sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))
  return out
}

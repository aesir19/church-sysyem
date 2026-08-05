/**
 * Attendance scheduling and window helpers.
 *
 * Everything here is pure so it can be tested without mounting a view. The
 * database is the authority on whether check-in is actually open — these
 * helpers only decide what to render.
 */

/** 0 = Sunday, matching both `extract(dow ...)` in SQL and `Date#getDay()` in JS. */
export const WEEKDAY_LABELS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]

export function weekdayLabel(weekday) {
  return WEEKDAY_LABELS[Number(weekday)] ?? ''
}

/**
 * Collapse a name to its comparison form.
 *
 * This MUST stay character-identical to the SQL expression used by
 * `members_church_fullname_idx` and by `attendance.guest_name_norm`:
 *
 *   lower(regexp_replace(btrim(x), '\s+', ' ', 'g'))
 *
 * If the two drift, the index stops matching and the anonymous check-in path
 * degrades to a sequential scan over `members` — silently, and only under load.
 * Control characters are stripped first because `submit_checkin` strips them
 * before it normalises; member names never contain any.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeName(value) {
  return String(value ?? '')
    // A SPACE, not ''. \p{Cc} includes tab and newline, so deleting the class
    // would glue 'Juan\tDela' into 'JuanDela' and stop it matching the member
    // 'Juan Dela'. submit_checkin does the same substitution for the same reason.
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * The name a member would type to match themselves. Middle names are excluded
 * deliberately — the database index covers `first_name || ' ' || last_name` only,
 * and matching on a wider expression would not use it.
 */
export function memberMatchName(member) {
  return normalizeName(`${member?.first_name ?? ''} ${member?.last_name ?? ''}`)
}

/** Display name for a member row, middle name included when present. */
export function memberDisplayName(member) {
  return [member?.first_name, member?.middle_name, member?.last_name]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * How an attendance row should be labelled in the roster. Mirrors the three
 * states the table can hold: a resolved member, a named guest, or a member row
 * whose embed came back empty because RLS hid it.
 */
export function attendeeLabel(row) {
  if (row?.guest_name) return row.guest_name
  const embedded = row?.members
  if (embedded) return memberDisplayName(embedded)
  if (row?.member_id) return 'Unknown'
  return 'Unknown'
}

/**
 * Whether a window is currently open. `closesAt` and `opensAt` are ISO strings
 * from the database; both bounds are compared inclusively-then-exclusively to
 * match the SQL predicate `now() >= opens_at AND now() < closes_at`.
 */
export function isWindowOpen(opensAt, closesAt, now = new Date()) {
  if (!opensAt || !closesAt) return false
  const start = new Date(opensAt).getTime()
  const end = new Date(closesAt).getTime()
  if (Number.isNaN(start) || Number.isNaN(end)) return false
  const current = now.getTime()
  return current >= start && current < end
}

/** Whole minutes remaining until `closesAt`, floored at zero. */
export function minutesUntil(closesAt, now = new Date()) {
  if (!closesAt) return 0
  const end = new Date(closesAt).getTime()
  if (Number.isNaN(end)) return 0
  return Math.max(0, Math.floor((end - now.getTime()) / 60000))
}

/**
 * Human phrasing for the time left in a window, e.g. "closes in 2h 15m".
 * Returns 'closed' once the window has passed.
 */
export function formatTimeRemaining(closesAt, now = new Date()) {
  const minutes = minutesUntil(closesAt, now)
  if (minutes <= 0) return 'closed'
  if (minutes < 60) return `closes in ${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `closes in ${hours}h` : `closes in ${hours}h ${rest}m`
}

/**
 * Render a `HH:MM:SS` time column from Postgres as `8:00 AM`.
 * Kept string-based: constructing a Date to format a time-of-day is how
 * timezone bugs get in (docs/DEFECTS.md D8).
 */
export function formatClockTime(value) {
  if (!value) return ''
  const [rawHour, rawMinute] = String(value).split(':')
  const hour = Number(rawHour)
  const minute = Number(rawMinute)
  if (Number.isNaN(hour) || Number.isNaN(minute)) return ''
  const suffix = hour >= 12 ? 'PM' : 'AM'
  const display = hour % 12 === 0 ? 12 : hour % 12
  return `${display}:${String(minute).padStart(2, '0')} ${suffix}`
}

/** `8:00 AM – 11:00 AM` for a schedule row. */
export function formatScheduleRange(schedule) {
  const start = formatClockTime(schedule?.starts_at)
  const end = formatClockTime(schedule?.ends_at)
  if (!start || !end) return ''
  return `${start} – ${end}`
}

/**
 * Validate a schedule form before it reaches the database, so the user sees a
 * sentence rather than a constraint name (docs/SECURITY.md §3.5).
 * Mirrors service_schedules_label_shape / _weekday_check / _window_check.
 *
 * @returns {string} error message, or '' when valid
 */
export function validateSchedule(form) {
  const label = String(form?.label ?? '').trim()
  if (label.length < 2 || label.length > 60) {
    return 'Service name must be between 2 and 60 characters.'
  }
  const weekday = Number(form?.weekday)
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    return 'Choose a day of the week.'
  }
  if (!form?.startsAt || !form?.endsAt) {
    return 'Set both a start and an end time.'
  }
  if (form.endsAt <= form.startsAt) {
    return 'End time must be after the start time. For an overnight service, add it as a one-off instead.'
  }
  return ''
}

/**
 * Build the insert payload for a recurring schedule. `timezone` is omitted
 * deliberately — the column is not in the INSERT grant and is check-pinned to
 * Asia/Manila in the database.
 */
export function buildSchedulePayload(form, churchId) {
  return {
    church_id: churchId,
    label: String(form.label ?? '').trim(),
    weekday: Number(form.weekday),
    starts_at: form.startsAt,
    ends_at: form.endsAt,
  }
}

/**
 * Build the insert payload for a one-off service.
 *
 * `opens_at` / `closes_at` are sent as local wall-clock strings without a zone
 * suffix so Postgres interprets them in the connection's timezone... which is
 * exactly the trap. They are converted to real instants here, from the browser's
 * own clock, because the browser is in Manila and `new Date(local).toISOString()`
 * is the only conversion that does not assume UTC input.
 */
export function buildAdhocServicePayload(form, churchId) {
  return {
    church_id: churchId,
    schedule_id: null,
    label: String(form.label ?? '').trim(),
    opens_at: new Date(`${form.date}T${form.startsAt}`).toISOString(),
    closes_at: new Date(`${form.date}T${form.endsAt}`).toISOString(),
  }
}

/** Mirrors services_label_shape and services_window_check. */
export function validateAdhocService(form) {
  const label = String(form?.label ?? '').trim()
  if (label.length < 2 || label.length > 60) {
    return 'Service name must be between 2 and 60 characters.'
  }
  if (!form?.date) return 'Choose a date.'
  if (!form?.startsAt || !form?.endsAt) {
    return 'Set both a start and an end time.'
  }
  const opens = new Date(`${form.date}T${form.startsAt}`)
  const closes = new Date(`${form.date}T${form.endsAt}`)
  if (Number.isNaN(opens.getTime()) || Number.isNaN(closes.getTime())) {
    return 'That date or time is not valid.'
  }
  if (closes.getTime() < opens.getTime()) {
    return 'End time must not be before the start time.'
  }
  if (closes.getTime() - opens.getTime() > 24 * 60 * 60 * 1000) {
    return 'A service window cannot be longer than 24 hours.'
  }
  return ''
}

/**
 * Split a roster into counts the header shows. `source` is surfaced everywhere
 * because a 'self' row is an unverified self-assertion — see
 * docs/decisions/0007-public-checkin-endpoint.md.
 */
export function summariseRoster(rows) {
  const list = Array.isArray(rows) ? rows : []
  return {
    total: list.length,
    members: list.filter((row) => row.member_id).length,
    guests: list.filter((row) => !row.member_id).length,
    selfRecorded: list.filter((row) => row.source === 'self').length,
    staffRecorded: list.filter((row) => row.source === 'staff').length,
  }
}

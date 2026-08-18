import { describe, expect, it } from 'vitest'
import {
  attendeeLabel,
  buildAdhocServicePayload,
  buildSchedulePayload,
  describeNextWindow,
  formatClockTime,
  formatScheduleRange,
  formatTimeRemaining,
  isWindowOpen,
  memberDisplayName,
  memberMatchName,
  minutesUntil,
  nextWindow,
  normalizeName,
  summariseRoster,
  validateAdhocService,
  validateSchedule,
  weekdayLabel,
  WEEKDAY_LABELS,
} from '../../src/utils/attendanceWindow.js'

describe('normalizeName', () => {
  // These cases mirror the SQL expression
  //   lower(regexp_replace(btrim(x), '\s+', ' ', 'g'))
  // used by members_church_fullname_idx and attendance.guest_name_norm. If this
  // block starts failing, the index has stopped matching and the anonymous
  // check-in path has quietly become a sequential scan.
  it('lowercases and trims', () => {
    expect(normalizeName('  Juan Cruz  ')).toBe('juan cruz')
    expect(normalizeName('JUAN CRUZ')).toBe('juan cruz')
  })

  it('collapses internal whitespace runs to a single space', () => {
    expect(normalizeName('Juan   Dela   Cruz')).toBe('juan dela cruz')
    expect(normalizeName('Juan\tDela\nCruz')).toBe('juan dela cruz')
  })

  it('strips control characters', () => {
    expect(normalizeName('Juan\u0000\u0007 Cruz')).toBe('juan cruz')
  })

  it('treats spacing variants of the same name as equal', () => {
    const variants = ['Juan Cruz', ' Juan Cruz', 'Juan  Cruz', 'juan cruz ']
    const normalized = new Set(variants.map(normalizeName))
    expect(normalized.size).toBe(1)
  })

  it('does not fold diacritics — a documented limit, not a bug', () => {
    expect(normalizeName('Juán Cruz')).not.toBe(normalizeName('Juan Cruz'))
  })

  it('handles null and undefined', () => {
    expect(normalizeName(null)).toBe('')
    expect(normalizeName(undefined)).toBe('')
  })
})

describe('memberMatchName', () => {
  it('joins first and last name only, matching the database index', () => {
    expect(memberMatchName({ first_name: 'Juan', middle_name: 'Dela', last_name: 'Cruz' }))
      .toBe('juan cruz')
  })
})

describe('memberDisplayName', () => {
  it('includes the middle name when present', () => {
    expect(memberDisplayName({ first_name: 'Juan', middle_name: 'Dela', last_name: 'Cruz' }))
      .toBe('Juan Dela Cruz')
  })

  it('omits a missing middle name without leaving a double space', () => {
    expect(memberDisplayName({ first_name: 'Juan', last_name: 'Cruz' })).toBe('Juan Cruz')
  })
})

describe('attendeeLabel', () => {
  it('prefers the guest name', () => {
    expect(attendeeLabel({ guest_name: 'Maria Santos' })).toBe('Maria Santos')
  })

  it('uses the embedded member when there is no guest name', () => {
    expect(attendeeLabel({ member_id: 'm1', members: { first_name: 'Juan', last_name: 'Cruz' } }))
      .toBe('Juan Cruz')
  })

  it('reports Unknown when the member embed came back empty and no directory is given', () => {
    // RLS hid the row rather than the join failing — a real data condition, not
    // a rendering bug. Mirrors contributorLabel() on the collections side.
    expect(attendeeLabel({ member_id: 'm1', members: null })).toBe('Unknown')
  })

  it('resolves the name from the directory map when the embed was blanked by RLS', () => {
    // Welcome Team cannot read member detail, so members(...) comes back null; the
    // directory (directory_search) is readable by them and carries the same names.
    const nameById = new Map([['m1', 'Juan Cruz']])
    expect(attendeeLabel({ member_id: 'm1', members: null }, nameById)).toBe('Juan Cruz')
  })

  it('still reports Unknown for a member_id absent from the directory map', () => {
    const nameById = new Map([['m2', 'Ana Reyes']])
    expect(attendeeLabel({ member_id: 'm1', members: null }, nameById)).toBe('Unknown')
  })

  it('prefers the embed over the directory map when both are present', () => {
    const nameById = new Map([['m1', 'Directory Name']])
    expect(attendeeLabel({ member_id: 'm1', members: { first_name: 'Embed', last_name: 'Name' } }, nameById))
      .toBe('Embed Name')
  })
})

describe('isWindowOpen', () => {
  const opens = '2026-08-09T00:00:00.000Z'
  const closes = '2026-08-09T03:00:00.000Z'

  it('is open inside the window', () => {
    expect(isWindowOpen(opens, closes, new Date('2026-08-09T01:00:00.000Z'))).toBe(true)
  })

  it('is open exactly at opens_at and closed exactly at closes_at', () => {
    // Matches the SQL predicate: now() >= opens_at AND now() < closes_at.
    expect(isWindowOpen(opens, closes, new Date(opens))).toBe(true)
    expect(isWindowOpen(opens, closes, new Date(closes))).toBe(false)
  })

  it('is closed before and after', () => {
    expect(isWindowOpen(opens, closes, new Date('2026-08-08T23:59:59.000Z'))).toBe(false)
    expect(isWindowOpen(opens, closes, new Date('2026-08-09T04:00:00.000Z'))).toBe(false)
  })

  it('is closed when a bound is missing or unparseable', () => {
    expect(isWindowOpen(null, closes)).toBe(false)
    expect(isWindowOpen(opens, null)).toBe(false)
    expect(isWindowOpen('not-a-date', closes, new Date(opens))).toBe(false)
  })
})

describe('minutesUntil / formatTimeRemaining', () => {
  const now = new Date('2026-08-09T01:00:00.000Z')

  it('floors to whole minutes', () => {
    expect(minutesUntil('2026-08-09T01:30:45.000Z', now)).toBe(30)
  })

  it('never goes negative', () => {
    expect(minutesUntil('2026-08-09T00:00:00.000Z', now)).toBe(0)
  })

  it('phrases minutes, hours, and hours with minutes', () => {
    expect(formatTimeRemaining('2026-08-09T01:42:00.000Z', now)).toBe('closes in 42 min')
    expect(formatTimeRemaining('2026-08-09T03:00:00.000Z', now)).toBe('closes in 2h')
    expect(formatTimeRemaining('2026-08-09T03:15:00.000Z', now)).toBe('closes in 2h 15m')
  })

  it('reports closed once the window has passed', () => {
    expect(formatTimeRemaining('2026-08-09T00:30:00.000Z', now)).toBe('closed')
  })
})

describe('formatClockTime', () => {
  it('renders a Postgres time column in 12-hour form', () => {
    expect(formatClockTime('08:00:00')).toBe('8:00 AM')
    expect(formatClockTime('18:30:00')).toBe('6:30 PM')
  })

  it('renders both noon and midnight as 12', () => {
    expect(formatClockTime('00:00:00')).toBe('12:00 AM')
    expect(formatClockTime('12:00:00')).toBe('12:00 PM')
  })

  it('returns empty for missing or malformed input', () => {
    expect(formatClockTime(null)).toBe('')
    expect(formatClockTime('not-a-time')).toBe('')
  })

  it('formats a schedule range', () => {
    expect(formatScheduleRange({ starts_at: '08:00:00', ends_at: '11:00:00' }))
      .toBe('8:00 AM – 11:00 AM')
  })
})

describe('weekdayLabel', () => {
  it('uses 0 = Sunday, matching extract(dow ...) and Date#getDay()', () => {
    expect(WEEKDAY_LABELS[0]).toBe('Sunday')
    expect(weekdayLabel(0)).toBe('Sunday')
    expect(weekdayLabel(3)).toBe('Wednesday')
    expect(weekdayLabel(6)).toBe('Saturday')
  })

  it('returns empty for an out-of-range value', () => {
    expect(weekdayLabel(7)).toBe('')
  })
})

describe('validateSchedule', () => {
  const valid = { label: 'Sunday Service', weekday: 0, startsAt: '08:00', endsAt: '11:00' }

  it('accepts a well-formed schedule', () => {
    expect(validateSchedule(valid)).toBe('')
  })

  it('rejects labels outside 2–60 characters, matching the CHECK', () => {
    expect(validateSchedule({ ...valid, label: 'S' })).toMatch(/2 and 60/)
    expect(validateSchedule({ ...valid, label: 'x'.repeat(61) })).toMatch(/2 and 60/)
  })

  it('rejects an out-of-range weekday', () => {
    expect(validateSchedule({ ...valid, weekday: 7 })).toMatch(/day of the week/)
    expect(validateSchedule({ ...valid, weekday: -1 })).toMatch(/day of the week/)
  })

  it('rejects an overnight window and points at the one-off path', () => {
    // CHECK (ends_at > starts_at) forbids this in the recurring schedule; the
    // message has to say what to do instead or the user is simply stuck.
    const result = validateSchedule({ ...valid, startsAt: '22:00', endsAt: '01:00' })
    expect(result).toMatch(/one-off/)
  })
})

describe('buildSchedulePayload', () => {
  it('omits timezone, which is not in the INSERT grant', () => {
    const payload = buildSchedulePayload(
      { label: '  Sunday Service  ', weekday: '0', startsAt: '08:00', endsAt: '11:00' },
      'church-1'
    )
    expect(payload).toEqual({
      church_id: 'church-1',
      label: 'Sunday Service',
      weekday: 0,
      starts_at: '08:00',
      ends_at: '11:00',
    })
    expect(payload).not.toHaveProperty('timezone')
    expect(payload).not.toHaveProperty('created_by')
  })
})

describe('validateAdhocService', () => {
  const valid = { label: 'Watchnight', date: '2026-12-31', startsAt: '22:00', endsAt: '23:59' }

  it('accepts a well-formed one-off', () => {
    expect(validateAdhocService(valid)).toBe('')
  })

  it('rejects a window longer than 24 hours, matching services_window_check', () => {
    // The cap is what stops a mistyped year leaving an unauthenticated write
    // endpoint open indefinitely.
    const result = validateAdhocService({ ...valid, date: '2026-12-31', startsAt: '00:00', endsAt: '23:59' })
    expect(result).toBe('')
  })

  it('rejects an end before the start', () => {
    expect(validateAdhocService({ ...valid, startsAt: '10:00', endsAt: '09:00' }))
      .toMatch(/not be before/)
  })

  it('requires a date', () => {
    expect(validateAdhocService({ ...valid, date: '' })).toMatch(/date/)
  })
})

describe('buildAdhocServicePayload', () => {
  it('sends real instants and a null schedule_id', () => {
    const payload = buildAdhocServicePayload(
      { label: 'Revival', date: '2026-08-09', startsAt: '18:00', endsAt: '20:00' },
      'church-1'
    )
    expect(payload.church_id).toBe('church-1')
    expect(payload.schedule_id).toBeNull()
    expect(payload.label).toBe('Revival')
    // Converted through Date so the browser's own offset is applied, rather than
    // handing Postgres a bare wall-clock string it would read as UTC (D8).
    expect(payload.opens_at).toBe(new Date('2026-08-09T18:00').toISOString())
    expect(payload.closes_at).toBe(new Date('2026-08-09T20:00').toISOString())
  })
})

describe('summariseRoster', () => {
  const rows = [
    { member_id: 'm1', source: 'self' },
    { member_id: 'm2', source: 'staff' },
    { member_id: null, guest_name: 'Visitor', source: 'self' },
  ]

  it('counts members, guests, and provenance separately', () => {
    // Provenance is surfaced because a 'self' row is an unverified self-assertion.
    expect(summariseRoster(rows)).toEqual({
      total: 3,
      members: 2,
      guests: 1,
      selfRecorded: 2,
      staffRecorded: 1,
    })
  })

  it('handles a missing roster', () => {
    expect(summariseRoster(null).total).toBe(0)
  })
})

describe('nextWindow / describeNextWindow', () => {
  const sunday = { id: 's1', label: 'Sunday Service', weekday: 0, starts_at: '08:00:00', ends_at: '11:00:00', is_active: true }
  const wednesday = { id: 's2', label: 'Prayer Meeting', weekday: 3, starts_at: '18:00:00', ends_at: '20:00:00', is_active: true }

  // Local-time constructor throughout, matching how the helper reads the clock.
  const wedMorning = new Date(2026, 7, 5, 9, 0) // Wednesday 5 Aug 2026, 9:00 AM

  it('finds a slot later the same day', () => {
    const result = nextWindow([wednesday], wedMorning)
    expect(result.schedule.id).toBe('s2')
    expect(result.startsAt.getDate()).toBe(5)
    expect(describeNextWindow([wednesday], wedMorning)).toBe('Prayer Meeting opens today at 6:00 PM')
  })

  it('rolls to the next week when the slot has already passed today', () => {
    const wedEvening = new Date(2026, 7, 5, 21, 0)
    const result = nextWindow([wednesday], wedEvening)
    expect(result.startsAt.getDate()).toBe(12)
    expect(describeNextWindow([wednesday], wedEvening)).toBe('Prayer Meeting opens Wednesday at 6:00 PM')
  })

  it('picks the soonest across several slots', () => {
    // Sunday is four days out, Wednesday is nine hours out.
    expect(describeNextWindow([sunday, wednesday], wedMorning)).toBe('Prayer Meeting opens today at 6:00 PM')
  })

  it('names the next calendar day as tomorrow', () => {
    const saturdayNight = new Date(2026, 7, 8, 23, 0) // Saturday
    expect(describeNextWindow([sunday], saturdayNight)).toBe('Sunday Service opens tomorrow at 8:00 AM')
  })

  it('ignores paused slots', () => {
    expect(nextWindow([{ ...wednesday, is_active: false }], wedMorning)).toBeNull()
    expect(describeNextWindow([{ ...wednesday, is_active: false }], wedMorning)).toBe('')
  })

  it('handles an empty or malformed schedule', () => {
    expect(nextWindow([], wedMorning)).toBeNull()
    expect(nextWindow(null, wedMorning)).toBeNull()
    expect(nextWindow([{ ...wednesday, starts_at: '' }], wedMorning)).toBeNull()
  })
})

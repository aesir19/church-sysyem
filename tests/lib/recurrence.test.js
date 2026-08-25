import { describe, it, expect } from 'vitest'
import { expandSeries, describeRule, nextOccurrence, mergeSeriesOccurrences } from '../../src/lib/recurrence'

// A rule mirrors the event_series columns (migration 0034). Dates are worked out in local
// time and anchored at the rule's time-of-day; the window [from, to) is half-open, the same
// convention expandWeeklySchedules already uses on the Calendar.

describe('expandSeries — weekly', () => {
  const sundayNine = {
    cadence: 'weekly',
    intervalN: 1,
    weekday: 0, // Sunday, Postgres/JS DOW convention (Sunday = 0)
    startsOn: '2026-08-01',
    endsOn: null,
    countN: null,
    timeStart: '09:00',
    timeEnd: '10:30',
  }

  it('emits one occurrence per week on the chosen weekday, inside the window', () => {
    const out = expandSeries(sundayNine, new Date(2026, 7, 1), new Date(2026, 7, 22))
    // Sundays in [1 Aug, 22 Aug): 2, 9, 16 Aug.
    expect(out.map((o) => o.date.toISOString().slice(0, 10))).toEqual([
      '2026-08-02',
      '2026-08-09',
      '2026-08-16',
    ])
  })

  it('places each occurrence at the rule’s start time', () => {
    const [first] = expandSeries(sundayNine, new Date(2026, 7, 1), new Date(2026, 7, 8))
    expect(first.date.getHours()).toBe(9)
    expect(first.date.getMinutes()).toBe(0)
  })

  it('every 2 weeks (fortnightly) skips the off weeks', () => {
    const rule = { ...sundayNine, intervalN: 2, startsOn: '2026-08-02' }
    const out = expandSeries(rule, new Date(2026, 7, 1), new Date(2026, 8, 1))
    // From 2 Aug, every 2nd Sunday: 2, 16, 30 Aug (9 and 23 are the off weeks).
    expect(out.map((o) => o.date.toISOString().slice(0, 10))).toEqual([
      '2026-08-02',
      '2026-08-16',
      '2026-08-30',
    ])
  })

  it('stops at endsOn (inclusive)', () => {
    const rule = { ...sundayNine, startsOn: '2026-08-02', endsOn: '2026-08-16' }
    const out = expandSeries(rule, new Date(2026, 7, 1), new Date(2026, 9, 1))
    expect(out.map((o) => o.date.toISOString().slice(0, 10))).toEqual([
      '2026-08-02',
      '2026-08-09',
      '2026-08-16',
    ])
  })

  it('stops after countN occurrences, even across windows', () => {
    const rule = { ...sundayNine, startsOn: '2026-08-02', countN: 2 }
    const out = expandSeries(rule, new Date(2026, 7, 1), new Date(2026, 9, 1))
    expect(out.map((o) => o.date.toISOString().slice(0, 10))).toEqual([
      '2026-08-02',
      '2026-08-09',
    ])
  })
})

describe('expandSeries — monthly by date', () => {
  const fifteenth = {
    cadence: 'monthly',
    anchor: 'date',
    intervalN: 1,
    dayOfMonth: 15,
    startsOn: '2026-08-01',
    endsOn: null,
    countN: null,
    timeStart: '18:00',
    timeEnd: null,
  }

  it('lands on the day-of-month each month', () => {
    const out = expandSeries(fifteenth, new Date(2026, 7, 1), new Date(2026, 10, 1))
    expect(out.map((o) => o.date.toISOString().slice(0, 10))).toEqual([
      '2026-08-15',
      '2026-09-15',
      '2026-10-15',
    ])
  })

  it('every 3 months (quarterly) skips the between months', () => {
    const out = expandSeries({ ...fifteenth, intervalN: 3 }, new Date(2026, 7, 1), new Date(2027, 2, 1))
    // From Aug, quarterly on the 15th: Aug, Nov, Feb.
    expect(out.map((o) => o.date.toISOString().slice(0, 10))).toEqual([
      '2026-08-15',
      '2026-11-15',
      '2027-02-15',
    ])
  })

  it('a day-of-month past the month’s length is skipped, not clamped', () => {
    // The 31st in a monthly rule: Sept/Nov/etc have no 31st, so they produce nothing rather
    // than silently sliding to the 30th or the 1st of next month.
    const out = expandSeries(
      { ...fifteenth, dayOfMonth: 31 },
      new Date(2026, 7, 1), // Aug
      new Date(2026, 11, 1), // Dec
    )
    // Aug 31 ✓, Sep 31 ✗, Oct 31 ✓, Nov 31 ✗.
    expect(out.map((o) => o.date.toISOString().slice(0, 10))).toEqual([
      '2026-08-31',
      '2026-10-31',
    ])
  })
})

describe('expandSeries — monthly by weekday', () => {
  const thirdSaturday = {
    cadence: 'monthly',
    anchor: 'weekday',
    intervalN: 1,
    weekday: 6, // Saturday
    weekOfMonth: 3, // the third
    startsOn: '2026-08-01',
    endsOn: null,
    countN: null,
    timeStart: '14:00',
    timeEnd: null,
  }

  it('lands on the nth weekday of each month', () => {
    const out = expandSeries(thirdSaturday, new Date(2026, 7, 1), new Date(2026, 10, 1))
    // Third Saturdays: 15 Aug, 19 Sep, 17 Oct 2026.
    expect(out.map((o) => o.date.toISOString().slice(0, 10))).toEqual([
      '2026-08-15',
      '2026-09-19',
      '2026-10-17',
    ])
  })

  it('weekOfMonth -1 means the LAST weekday of the month', () => {
    const out = expandSeries(
      { ...thirdSaturday, weekOfMonth: -1, weekday: 0 }, // last Sunday
      new Date(2026, 7, 1),
      new Date(2026, 10, 1),
    )
    // Last Sundays: 30 Aug, 27 Sep, 25 Oct 2026.
    expect(out.map((o) => o.date.toISOString().slice(0, 10))).toEqual([
      '2026-08-30',
      '2026-09-27',
      '2026-10-25',
    ])
  })

  it('a 5th-weekday month that has no 5th is skipped', () => {
    // The 5th Sunday exists only in some months. Aug 2026 has 5 Sundays (30th is the 5th);
    // Sep 2026 has only 4, so it produces nothing.
    const out = expandSeries(
      { ...thirdSaturday, weekOfMonth: 5, weekday: 0 },
      new Date(2026, 7, 1),
      new Date(2026, 9, 1),
    )
    expect(out.map((o) => o.date.toISOString().slice(0, 10))).toEqual(['2026-08-30'])
  })
})

describe('expandSeries — twice a month', () => {
  it('two dates: the 1st and the 15th, in date order each month', () => {
    const rule = {
      cadence: 'twice_monthly',
      anchor: 'date',
      dayOfMonth: 15,
      dayOfMonth2: 1,
      startsOn: '2026-08-01',
      endsOn: null,
      countN: null,
      timeStart: '09:00',
      timeEnd: null,
    }
    const out = expandSeries(rule, new Date(2026, 7, 1), new Date(2026, 9, 1))
    // Emitted in date order regardless of which anchor is "first".
    expect(out.map((o) => o.date.toISOString().slice(0, 10))).toEqual([
      '2026-08-01',
      '2026-08-15',
      '2026-09-01',
      '2026-09-15',
    ])
  })

  it('two weekdays: the 1st and 3rd Sunday each month', () => {
    const rule = {
      cadence: 'twice_monthly',
      anchor: 'weekday',
      weekday: 0,
      weekOfMonth: 1,
      weekday2: 0,
      weekOfMonth2: 3,
      startsOn: '2026-08-01',
      endsOn: null,
      countN: null,
      timeStart: '09:00',
      timeEnd: null,
    }
    const out = expandSeries(rule, new Date(2026, 7, 1), new Date(2026, 8, 1))
    // Aug 2026: 1st Sunday = 2 Aug, 3rd Sunday = 16 Aug.
    expect(out.map((o) => o.date.toISOString().slice(0, 10))).toEqual([
      '2026-08-02',
      '2026-08-16',
    ])
  })
})

describe('describeRule — plain words', () => {
  it('weekly, interval 1', () => {
    expect(describeRule({ cadence: 'weekly', intervalN: 1, weekday: 0, timeStart: '09:00' }))
      .toBe('Every Sunday, 9:00 am')
  })

  it('weekly, interval 2 reads fortnightly', () => {
    expect(describeRule({ cadence: 'weekly', intervalN: 2, weekday: 3, timeStart: '19:00' }))
      .toBe('Every 2 weeks on Wednesday, 7:00 pm')
  })

  it('monthly by date', () => {
    expect(describeRule({ cadence: 'monthly', anchor: 'date', intervalN: 1, dayOfMonth: 15, timeStart: '18:00' }))
      .toBe('On the 15th of every month, 6:00 pm')
  })

  it('monthly by date, quarterly', () => {
    expect(describeRule({ cadence: 'monthly', anchor: 'date', intervalN: 3, dayOfMonth: 1, timeStart: '10:00' }))
      .toBe('On the 1st of every 3 months, 10:00 am')
  })

  it('monthly by weekday', () => {
    expect(describeRule({ cadence: 'monthly', anchor: 'weekday', intervalN: 1, weekday: 6, weekOfMonth: 3, timeStart: '14:00' }))
      .toBe('The 3rd Saturday of every month, 2:00 pm')
  })

  it('monthly by weekday, last', () => {
    expect(describeRule({ cadence: 'monthly', anchor: 'weekday', intervalN: 1, weekday: 0, weekOfMonth: -1, timeStart: '16:00' }))
      .toBe('The last Sunday of every month, 4:00 pm')
  })

  it('twice a month, dates', () => {
    expect(describeRule({ cadence: 'twice_monthly', anchor: 'date', dayOfMonth: 15, dayOfMonth2: 1, timeStart: '09:00' }))
      .toBe('Twice a month (1st and 15th), 9:00 am')
  })
})

describe('nextOccurrence', () => {
  const rule = { cadence: 'weekly', intervalN: 1, weekday: 0, startsOn: '2026-08-01', endsOn: null, countN: null, timeStart: '09:00', timeEnd: null }

  it('returns the first occurrence strictly after the given moment', () => {
    const next = nextOccurrence(rule, new Date(2026, 7, 10)) // Mon 10 Aug
    expect(next.toISOString().slice(0, 10)).toBe('2026-08-16')
  })

  it('returns null when the series has ended', () => {
    const ended = { ...rule, endsOn: '2026-08-09' }
    expect(nextOccurrence(ended, new Date(2026, 7, 10))).toBe(null)
  })
})

describe('mergeSeriesOccurrences — worked-out dates + saved exceptions', () => {
  // A weekly Sunday 9am series. Its occurrence dates in Aug 2026 are 2, 9, 16, 23, 30.
  const series = {
    id: 'ser1',
    title: 'Sunday Service',
    kind: 'service',
    cadence: 'weekly',
    intervalN: 1,
    weekday: 0,
    startsOn: '2026-08-01',
    endsOn: null,
    countN: null,
    timeStart: '09:00',
    timeEnd: '10:30',
  }
  const from = new Date(2026, 7, 1)
  const to = new Date(2026, 8, 1)

  it('with no exceptions, every date is a worked-out (virtual) occurrence tagged to its series', () => {
    const out = mergeSeriesOccurrences({ seriesList: [series], exceptions: [], from, to })
    expect(out.map((o) => o.starts_at.slice(0, 10))).toEqual([
      '2026-08-02', '2026-08-09', '2026-08-16', '2026-08-23', '2026-08-30',
    ])
    expect(out.every((o) => o.seriesId === 'ser1' && o.isSeries && o.virtual)).toBe(true)
    expect(out[0].title).toBe('Sunday Service')
  })

  it('a moved date shows at its new time and its old slot disappears — the others are untouched', () => {
    // 16 Aug was moved to 16 Aug 10:00 (a deliberate one-off change). occurrence_date pins it
    // to the 16 Aug slot it replaces.
    const moved = {
      id: 'ev-moved', series_id: 'ser1', occurrence_date: '2026-08-16',
      title: 'Sunday Service (later)', kind: 'service', status: 'published',
      starts_at: '2026-08-16T10:00:00', ends_at: '2026-08-16T11:30:00',
    }
    const out = mergeSeriesOccurrences({ seriesList: [series], exceptions: [moved], from, to })
    const sixteenth = out.filter((o) => o.starts_at.slice(0, 10) === '2026-08-16')
    // Exactly one entry for the 16th — the saved (real) one at 10:00, not a duplicate virtual 9am.
    expect(sixteenth).toHaveLength(1)
    expect(sixteenth[0].virtual).toBe(false)
    expect(sixteenth[0].id).toBe('ev-moved')
    expect(new Date(sixteenth[0].starts_at).getHours()).toBe(10)
    // The other four dates are still their normal worked-out 9am selves.
    expect(out.filter((o) => o.virtual)).toHaveLength(4)
  })

  it('a cancelled date is shown once, marked cancelled, with no live occurrence underneath it', () => {
    const cancelled = {
      id: 'ev-cx', series_id: 'ser1', occurrence_date: '2026-08-09',
      title: 'Sunday Service', kind: 'service', status: 'cancelled',
      starts_at: '2026-08-09T09:00:00', ends_at: null, cancel_reason: 'Typhoon',
    }
    const out = mergeSeriesOccurrences({ seriesList: [series], exceptions: [cancelled], from, to })
    const ninth = out.filter((o) => o.starts_at.slice(0, 10) === '2026-08-09')
    expect(ninth).toHaveLength(1)
    expect(ninth[0].status).toBe('cancelled')
    expect(ninth[0].virtual).toBe(false)
  })

  it('a date moved OUT of the window vanishes from it (its old slot is suppressed too)', () => {
    // 30 Aug pushed into September. It should not appear in the August window at all.
    const pushed = {
      id: 'ev-push', series_id: 'ser1', occurrence_date: '2026-08-30',
      title: 'Sunday Service', kind: 'service', status: 'published',
      starts_at: '2026-09-02T09:00:00', ends_at: null,
    }
    const out = mergeSeriesOccurrences({ seriesList: [series], exceptions: [pushed], from, to })
    expect(out.map((o) => o.starts_at.slice(0, 10))).toEqual([
      '2026-08-02', '2026-08-09', '2026-08-16', '2026-08-23',
    ])
  })
})

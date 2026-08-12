import { describe, it, expect } from 'vitest'
import {
  getDefaultServiceDate,
  isWithinEditWindow,
  formatDateISO,
  recentServiceDates,
  formatServiceDateShort,
} from '../../src/utils/collectionsDate'

describe('getDefaultServiceDate', () => {
  it('returns today when today is Sunday (day 0)', () => {
    const sunday = new Date('2026-06-28T10:00:00') // June 28 2026 is a Sunday
    expect(getDefaultServiceDate(sunday)).toBe('2026-06-28')
  })

  it('returns Friday (yesterday) when today is Saturday (day 6)', () => {
    const saturday = new Date('2026-06-27T10:00:00') // June 27 2026 is a Saturday
    expect(getDefaultServiceDate(saturday)).toBe('2026-06-26')
  })

  it('returns today when today is Friday (day 5)', () => {
    const friday = new Date('2026-06-26T10:00:00') // June 26 2026 is a Friday
    expect(getDefaultServiceDate(friday)).toBe('2026-06-26')
  })

  it('returns previous Sunday when today is Monday (day 1)', () => {
    const monday = new Date('2026-06-29T10:00:00') // June 29 2026 is a Monday
    expect(getDefaultServiceDate(monday)).toBe('2026-06-28')
  })

  it('returns previous Sunday when today is Tuesday (day 2)', () => {
    const tuesday = new Date('2026-06-30T10:00:00') // June 30 2026 is a Tuesday
    expect(getDefaultServiceDate(tuesday)).toBe('2026-06-28')
  })

  it('returns previous Sunday when today is Wednesday (day 3)', () => {
    const wednesday = new Date('2026-07-01T10:00:00') // July 1 2026 is a Wednesday
    expect(getDefaultServiceDate(wednesday)).toBe('2026-06-28')
  })

  it('returns previous Sunday when today is Thursday (day 4)', () => {
    const thursday = new Date('2026-07-02T10:00:00') // July 2 2026 is a Thursday
    expect(getDefaultServiceDate(thursday)).toBe('2026-06-28')
  })
})

describe('recentServiceDates', () => {
  it('leads with the default service date', () => {
    const wednesday = new Date('2026-07-01T10:00:00')
    expect(recentServiceDates({ today: wednesday })[0]).toBe('2026-06-28')
  })

  it('walks back a Sunday at a time', () => {
    const sunday = new Date('2026-08-02T10:00:00')
    expect(recentServiceDates({ today: sunday })).toEqual([
      '2026-08-02',
      '2026-07-26',
      '2026-07-19',
      '2026-07-12',
    ])
  })

  // The case that makes stepping back from the PILL rather than from today
  // matter: on a Friday the first pill is Friday itself, and the one before it
  // is the Sunday five days earlier — not the Sunday before that.
  it('follows a Friday default with the Sunday of that same week', () => {
    const friday = new Date('2026-07-31T10:00:00')
    const dates = recentServiceDates({ today: friday })
    expect(dates[0]).toBe('2026-07-31')
    expect(dates[1]).toBe('2026-07-26')
  })

  it('honours the requested count', () => {
    const sunday = new Date('2026-08-02T10:00:00')
    expect(recentServiceDates({ today: sunday, count: 2 })).toEqual(['2026-08-02', '2026-07-26'])
  })

  it('crosses a month and a year boundary correctly', () => {
    const newYear = new Date('2027-01-03T10:00:00') // a Sunday
    expect(recentServiceDates({ today: newYear, count: 3 })).toEqual([
      '2027-01-03',
      '2026-12-27',
      '2026-12-20',
    ])
  })
})

describe('formatServiceDateShort', () => {
  // D8 again: the bare string parses as UTC midnight, which is the day before
  // in Manila for eight hours out of every day.
  it('renders the date itself, not the day before it', () => {
    expect(formatServiceDateShort('2026-08-02')).toBe('Aug 2')
    expect(formatServiceDateShort('2026-01-01')).toBe('Jan 1')
  })

  it('renders nothing for a missing or unparseable date', () => {
    expect(formatServiceDateShort('')).toBe('')
    expect(formatServiceDateShort(null)).toBe('')
    expect(formatServiceDateShort('nope')).toBe('')
  })
})

describe('isWithinEditWindow', () => {
  it('returns true if created less than 3 hours ago', () => {
    const now = new Date('2026-07-01T12:00:00Z')
    const createdAt = '2026-07-01T10:00:00Z' // 2 hours ago
    expect(isWithinEditWindow(createdAt, now)).toBe(true)
  })

  it('returns true if created exactly 3 hours ago', () => {
    const now = new Date('2026-07-01T13:00:00Z')
    const createdAt = '2026-07-01T10:00:00Z' // exactly 3 hours
    expect(isWithinEditWindow(createdAt, now)).toBe(true)
  })

  it('returns false if created more than 3 hours ago', () => {
    const now = new Date('2026-07-01T13:00:01Z')
    const createdAt = '2026-07-01T10:00:00Z' // 3h + 1s
    expect(isWithinEditWindow(createdAt, now)).toBe(false)
  })

  it('returns false for entries from yesterday', () => {
    const now = new Date('2026-07-01T10:00:00Z')
    const createdAt = '2026-06-30T10:00:00Z'
    expect(isWithinEditWindow(createdAt, now)).toBe(false)
  })
})

describe('formatDateISO', () => {
  it('formats date as YYYY-MM-DD', () => {
    expect(formatDateISO(new Date('2026-01-05T00:00:00'))).toBe('2026-01-05')
  })

  it('zero-pads single-digit months and days', () => {
    expect(formatDateISO(new Date('2026-03-09T00:00:00'))).toBe('2026-03-09')
  })
})

import { describe, expect, it } from 'vitest'
import {
  defaultMonthKey,
  getMonthRange,
  monthKeyFromDate,
  parseMonthKey,
} from '../../src/utils/expensesMonth'

describe('parseMonthKey', () => {
  it('parses valid yyyy-mm month keys', () => {
    expect(parseMonthKey('2026-07')).toEqual({ year: 2026, month: 7 })
  })

  it('returns null for invalid month keys', () => {
    expect(parseMonthKey('2026-13')).toBeNull()
    expect(parseMonthKey('2026-00')).toBeNull()
    expect(parseMonthKey('2026-7')).toBeNull()
    expect(parseMonthKey('invalid')).toBeNull()
  })
})

describe('getMonthRange', () => {
  it('returns month start and exclusive end boundaries', () => {
    expect(getMonthRange('2026-07')).toEqual({
      start: '2026-07-01',
      endExclusive: '2026-08-01',
    })
  })

  it('handles year rollover for december', () => {
    expect(getMonthRange('2026-12')).toEqual({
      start: '2026-12-01',
      endExclusive: '2027-01-01',
    })
  })
})

describe('monthKeyFromDate', () => {
  it('extracts yyyy-mm from date iso strings', () => {
    expect(monthKeyFromDate('2026-07-06')).toBe('2026-07')
  })

  it('returns empty string for non-string values', () => {
    expect(monthKeyFromDate(null)).toBe('')
  })
})

describe('defaultMonthKey', () => {
  it('builds month key from date object', () => {
    const fakeDate = new Date(2026, 6, 6)
    expect(defaultMonthKey(fakeDate)).toBe('2026-07')
  })
})

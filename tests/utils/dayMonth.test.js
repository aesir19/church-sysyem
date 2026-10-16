import { describe, it, expect } from 'vitest'
import { dayMonth } from '../../src/utils/dayMonth'

describe('dayMonth — "2 Aug", as mockup 13 writes dates', () => {
  it('writes day then short month, with September as "Sep" (not ICU\'s "Sept")', () => {
    expect(dayMonth('2026-09-24')).toBe('24 Sep')
    expect(dayMonth('2026-08-02T03:00:00Z')).toBe('2 Aug')
  })

  it('reads an instant as a Manila date', () => {
    // 23:30 UTC on 1 Aug is 07:30 on 2 Aug in Manila.
    expect(dayMonth('2026-08-01T23:30:00Z')).toBe('2 Aug')
  })

  it('writes the month in full when asked', () => {
    expect(dayMonth('2026-08-01', { long: true })).toBe('1 August')
  })
})

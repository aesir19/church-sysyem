import { describe, it, expect } from 'vitest'
import {
  buildServiceBars,
  averageOf,
  describeAgainstAverage,
  previousValues,
  shortDate,
  longDate,
  CHART_SERVICES,
} from '../../src/utils/attendanceStats'

/** Services as the view holds them: newest first. */
function services(dates) {
  return dates.map((d, i) => ({ id: `s${i}`, label: 'Sunday Service', service_date: d }))
}

describe('buildServiceBars', () => {
  // The list arrives newest-first because that is what the service picker
  // needs; a chart read left to right is the opposite.
  it('charts the most recent services, oldest on the left', () => {
    const rows = services(['2026-08-02', '2026-07-26', '2026-07-19'])
    const bars = buildServiceBars(rows, new Map([['s0', 128], ['s1', 115], ['s2', 119]]))

    expect(bars.map((b) => b.value)).toEqual([119, 115, 128])
    expect(bars.at(-1).isLatest).toBe(true)
    expect(bars[0].isLatest).toBe(false)
  })

  it('keeps only the last ten, and takes them from the newest end', () => {
    const dates = Array.from({ length: 14 }, (_, i) => `2026-08-${String(14 - i).padStart(2, '0')}`)
    const bars = buildServiceBars(services(dates), new Map())

    expect(CHART_SERVICES).toBe(10)
    expect(bars).toHaveLength(10)
    // s0 is the newest row, so it must be the LAST bar — not absent.
    expect(bars.at(-1).id).toBe('s0')
    expect(bars[0].id).toBe('s9')
  })

  it('scales every bar against the tallest one', () => {
    const bars = buildServiceBars(services(['2026-08-02', '2026-07-26']), { s0: 100, s1: 50 })
    expect(bars.map((b) => b.heightPercent)).toEqual([50, 100])
  })

  it('draws nothing rather than dividing by zero when every service was empty', () => {
    const bars = buildServiceBars(services(['2026-08-02', '2026-07-26']), { s0: 0, s1: 0 })
    expect(bars.map((b) => b.heightPercent)).toEqual([0, 0])
  })

  // The distinction the chart depends on: a count that failed to load is not a
  // service nobody came to.
  it('reports a missing count as null, not as zero', () => {
    const bars = buildServiceBars(services(['2026-08-02', '2026-07-26']), new Map([['s0', 128]]))
    expect(bars[0].value).toBeNull()
    expect(bars[0].heightPercent).toBe(0)
    expect(bars[1].value).toBe(128)
  })

  it('keeps a genuine zero as zero', () => {
    const bars = buildServiceBars(services(['2026-08-02']), new Map([['s0', 0]]))
    expect(bars[0].value).toBe(0)
  })

  it('accepts a plain object as well as a Map', () => {
    expect(buildServiceBars(services(['2026-08-02']), { s0: 7 })[0].value).toBe(7)
    expect(buildServiceBars(services(['2026-08-02']), {})[0].value).toBeNull()
  })

  it('survives an empty or absent service list', () => {
    expect(buildServiceBars([], new Map())).toEqual([])
    expect(buildServiceBars(null, new Map())).toEqual([])
  })

  it('labels each bar with its date and names the service in full', () => {
    const bars = buildServiceBars(services(['2026-08-02']), { s0: 1 })
    expect(bars[0].label).toBe('Aug 2')
    expect(bars[0].fullLabel).toBe('Sunday Service · 2 August 2026')
  })
})

describe('describeAgainstAverage', () => {
  it('states how far above the average the latest service was', () => {
    expect(describeAgainstAverage(128, [110, 115, 120, 116])).toBe('11% above the 4-service average')
  })

  it('states below just as plainly', () => {
    expect(describeAgainstAverage(90, [110, 115, 120, 116])).toBe('22% below the 4-service average')
  })

  it('says in line rather than "0% above"', () => {
    expect(describeAgainstAverage(100, [100, 100, 100])).toBe('in line with the 3-service average')
  })

  // One previous service is last week, not an average, and calling it one
  // overstates what is known.
  it('says nothing at all with fewer than two previous services', () => {
    expect(describeAgainstAverage(128, [115])).toBe('')
    expect(describeAgainstAverage(128, [])).toBe('')
    expect(describeAgainstAverage(128, null)).toBe('')
  })

  // Every non-zero turnout is infinitely above nothing.
  it('refuses to compare against an average of zero', () => {
    expect(describeAgainstAverage(128, [0, 0, 0])).toBe('')
  })

  it('ignores services whose count is unknown', () => {
    expect(describeAgainstAverage(120, [100, null, 100, undefined])).toBe('20% above the 2-service average')
  })
})

describe('previousValues', () => {
  it('takes the four bars before the latest, not including it', () => {
    const bars = [10, 20, 30, 40, 50, 60].map((value, i) => ({ id: `b${i}`, value }))
    expect(previousValues(bars)).toEqual([20, 30, 40, 50])
  })

  it('takes what there is when there are fewer than four', () => {
    const bars = [10, 20, 30].map((value, i) => ({ id: `b${i}`, value }))
    expect(previousValues(bars)).toEqual([10, 20])
  })

  it('returns nothing when the latest bar is the only one', () => {
    expect(previousValues([{ id: 'b0', value: 10 }])).toEqual([])
    expect(previousValues([])).toEqual([])
  })
})

describe('averageOf', () => {
  it('averages the finite values', () => {
    expect(averageOf([10, 20, 30])).toBe(20)
  })

  it('returns null rather than NaN for nothing to average', () => {
    expect(averageOf([])).toBeNull()
    expect(averageOf([null, undefined])).toBeNull()
  })
})

describe('date labels', () => {
  // D8. `new Date('2026-08-02')` is UTC midnight, which is 2 August at 8am in
  // Manila — so for the first eight hours of every day it renders the day
  // before. Both labels parse through an explicit local midnight instead.
  it('renders the service date itself, not the day before it', () => {
    expect(shortDate('2026-08-02')).toBe('Aug 2')
    expect(longDate('2026-08-02')).toBe('2 August 2026')
    expect(longDate('2026-01-01')).toBe('1 January 2026')
  })

  it('renders nothing for a missing or unparseable date', () => {
    expect(shortDate('')).toBe('')
    expect(shortDate(null)).toBe('')
    expect(longDate('not-a-date')).toBe('')
  })
})

import { describe, expect, it } from 'vitest'
import {
  buildLedgerWeeks,
  buildMonthSourceFromCollections,
  openingBalanceForMonth,
} from '../../src/utils/collectivesSource.js'
import { computeMonthlyReport } from '../../src/utils/collectivesReport.js'

function collectionRow(overrides = {}) {
  return {
    id: 1,
    from: '11111111-1111-1111-1111-111111111111',
    amount: 100,
    is_tithes: true,
    collectedOn: '2026-05-03',
    members: { first_name: 'Mary', last_name: 'Lago' },
    ...overrides,
  }
}

describe('buildMonthSourceFromCollections', () => {
  it('groups rows into one week per service date, sorted ascending', () => {
    const source = buildMonthSourceFromCollections(
      [
        collectionRow({ id: 3, collectedOn: '2026-05-10' }),
        collectionRow({ id: 1, collectedOn: '2026-05-03' }),
        collectionRow({ id: 2, collectedOn: '2026-05-03' }),
      ],
      { year: 2026, month: 5, openingBalance: 500 },
    )

    expect(source.year).toBe(2026)
    expect(source.month).toBe(5)
    expect(source.openingBalance).toBe(500)
    expect(source.weeks.map((w) => w.date)).toEqual(['2026-05-03', '2026-05-10'])
    expect(source.weeks[0].contributions).toHaveLength(2)
    expect(source.weeks[1].contributions).toHaveLength(1)
  })

  it('starts every week with an empty expenses array for the live-expense merge', () => {
    const source = buildMonthSourceFromCollections([collectionRow()], { year: 2026, month: 5 })
    expect(source.weeks[0].expenses).toEqual([])
  })

  it('splits the amount into tithes or offering from is_tithes, never others', () => {
    const source = buildMonthSourceFromCollections(
      [
        collectionRow({ id: 1, amount: 780, is_tithes: true }),
        collectionRow({ id: 2, amount: 20, is_tithes: false }),
      ],
      { year: 2026, month: 5 },
    )

    const [tithe, offering] = source.weeks[0].contributions
    expect(tithe).toMatchObject({ tithes: 780, offering: 0 })
    expect(offering).toMatchObject({ tithes: 0, offering: 20 })
    // `others` has no column in `collections` and must not be invented.
    expect(tithe.others).toBeUndefined()
  })

  it('labels a readable member by name', () => {
    const source = buildMonthSourceFromCollections([collectionRow()], { year: 2026, month: 5 })
    expect(source.weeks[0].contributions[0]).toMatchObject({
      name: 'Mary Lago',
      anonymous: false,
    })
  })

  it('labels a null `from` as Anonymous and flags it, keeping the row id', () => {
    const source = buildMonthSourceFromCollections(
      [collectionRow({ id: 42, from: null, members: null })],
      { year: 2026, month: 5 },
    )

    expect(source.weeks[0].contributions[0]).toMatchObject({
      name: 'Anonymous',
      anonymous: true,
      sourceId: '42',
    })
  })

  it('keeps an unreadable member distinct from an anonymous gift', () => {
    const source = buildMonthSourceFromCollections(
      [
        collectionRow({ id: 1, from: null, members: null }),
        // `from` is set but the embed came back empty — RLS filtered the member.
        collectionRow({ id: 2, members: null }),
      ],
      { year: 2026, month: 5 },
    )

    const [anon, unreadable] = source.weeks[0].contributions
    expect(anon).toMatchObject({ name: 'Anonymous', anonymous: true })
    expect(unreadable).toMatchObject({ name: 'Unknown', anonymous: false })
  })

  it('skips rows with no usable service date and tolerates non-array input', () => {
    const source = buildMonthSourceFromCollections(
      [collectionRow({ collectedOn: null }), collectionRow({ collectedOn: '2026-05-03' })],
      { year: 2026, month: 5 },
    )
    expect(source.weeks).toHaveLength(1)

    expect(buildMonthSourceFromCollections(null).weeks).toEqual([])
    expect(buildMonthSourceFromCollections(undefined).openingBalance).toBe(0)
  })

  it('groups by day if collectedOn ever arrives as a timestamp', () => {
    const source = buildMonthSourceFromCollections(
      [
        collectionRow({ id: 1, collectedOn: '2026-05-03T08:00:00+08:00' }),
        collectionRow({ id: 2, collectedOn: '2026-05-03T17:30:00+08:00' }),
      ],
      { year: 2026, month: 5 },
    )

    expect(source.weeks).toHaveLength(1)
    expect(source.weeks[0].date).toBe('2026-05-03')
  })
})

describe('buildLedgerWeeks', () => {
  it('carries each view row into one week of synthetic totals', () => {
    const weeks = buildLedgerWeeks([
      { service_date: '2026-05-03', tithes: 1000, offering: 100, expenses: 250 },
    ])

    expect(weeks).toEqual([
      {
        date: '2026-05-03',
        contributions: [{ tithes: 1000, offering: 100 }],
        expenses: [{ amount: 250 }],
      },
    ])
  })

  it('coerces the numeric strings PostgREST returns for numeric columns', () => {
    const weeks = buildLedgerWeeks([
      { service_date: '2026-05-03', tithes: '1000.00', offering: '100.00', expenses: '250.00' },
    ])

    expect(weeks[0].contributions[0]).toEqual({ tithes: 1000, offering: 100 })
    expect(weeks[0].expenses[0]).toEqual({ amount: 250 })
  })

  it('sorts by date and drops rows without one', () => {
    const weeks = buildLedgerWeeks([
      { service_date: '2026-05-10', tithes: 1 },
      { service_date: null, tithes: 999 },
      { service_date: '2026-05-03', tithes: 2 },
    ])

    expect(weeks.map((w) => w.date)).toEqual(['2026-05-03', '2026-05-10'])
  })

  it('returns an empty list for non-array input', () => {
    expect(buildLedgerWeeks(null)).toEqual([])
  })
})

describe('openingBalanceForMonth', () => {
  // One service: 1,000 total funds → 10% + 5% + 5% withheld leaves 800,
  // split 50/50 → 400 church allocation, less 100 expenses → 300 net.
  const priorRows = [
    { service_date: '2026-04-05', tithes: 1000, offering: 0, expenses: 100 },
    { service_date: '2026-04-12', tithes: 1000, offering: 0, expenses: 100 },
  ]

  it('accumulates every service before the month', () => {
    expect(openingBalanceForMonth(priorRows, '2026-05')).toBe(600)
  })

  it('excludes services inside the month itself', () => {
    const rows = [...priorRows, { service_date: '2026-05-03', tithes: 1000, offering: 0, expenses: 100 }]
    expect(openingBalanceForMonth(rows, '2026-05')).toBe(600)
  })

  it('returns 0 when nothing precedes the month', () => {
    expect(openingBalanceForMonth(priorRows, '2026-04')).toBe(0)
    expect(openingBalanceForMonth([], '2026-05')).toBe(0)
  })

  it('returns 0 for an unparseable month key rather than guessing', () => {
    expect(openingBalanceForMonth(priorRows, 'nonsense')).toBe(0)
    expect(openingBalanceForMonth(priorRows, '2026-13')).toBe(0)
  })

  it('matches the closing balance the calculator produces for the same services', () => {
    // The carry-forward must agree with what the report itself would show, or
    // April's closing balance and May's opening balance would disagree on screen.
    const april = computeMonthlyReport({
      year: 2026,
      month: 4,
      openingBalance: 0,
      weeks: buildLedgerWeeks(priorRows),
    })

    expect(openingBalanceForMonth(priorRows, '2026-05')).toBe(april.closingBalance)
  })

  it('crosses a year boundary', () => {
    const rows = [{ service_date: '2025-12-28', tithes: 1000, offering: 0, expenses: 100 }]
    expect(openingBalanceForMonth(rows, '2026-01')).toBe(300)
  })
})

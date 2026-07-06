import { describe, expect, it } from 'vitest'
import { mergeMonthSourceWithLiveExpenses } from '../../src/utils/reportExpenseMerge'

describe('mergeMonthSourceWithLiveExpenses', () => {
  it('returns original month weeks when no live expenses are provided', () => {
    const source = {
      year: 2026,
      month: 7,
      openingBalance: 100,
      weeks: [
        {
          date: '2026-07-06',
          contributions: [{ name: 'A', tithes: 100 }],
          expenses: [{ description: 'Sample', amount: 10 }],
        },
      ],
    }

    const merged = mergeMonthSourceWithLiveExpenses(source, [])
    expect(merged.weeks[0].expenses).toEqual([{ description: 'Sample', amount: 10 }])
  })

  it('replaces sample expenses and injects live expenses by exact spent date', () => {
    const source = {
      year: 2026,
      month: 7,
      openingBalance: 100,
      weeks: [
        {
          date: '2026-07-06',
          contributions: [{ name: 'A', tithes: 100 }],
          expenses: [{ description: 'Sample', amount: 10 }],
        },
      ],
    }

    const merged = mergeMonthSourceWithLiveExpenses(source, [
      { spent_on: '2026-07-06', description: 'Electricity', amount: 500 },
      { spent_on: '2026-07-20', description: 'Water', amount: 200 },
    ])

    expect(merged.weeks).toHaveLength(2)
    expect(merged.weeks[0].date).toBe('2026-07-06')
    expect(merged.weeks[0].expenses).toEqual([{ description: 'Electricity', amount: 500 }])
    expect(merged.weeks[1].date).toBe('2026-07-20')
    expect(merged.weeks[1].expenses).toEqual([{ description: 'Water', amount: 200 }])
    expect(merged.weeks[1].contributions).toEqual([])
  })

  it('normalizes missing description labels to Other', () => {
    const merged = mergeMonthSourceWithLiveExpenses(
      { year: 2026, month: 7, weeks: [] },
      [{ spent_on: '2026-07-01', description: '  ', amount: 25 }],
    )

    expect(merged.weeks[0].expenses[0]).toEqual({ description: 'Other', amount: 25 })
  })
})

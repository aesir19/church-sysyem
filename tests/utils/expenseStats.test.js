import { describe, it, expect } from 'vitest'
import { summariseByDescription, largestLine, rankDescriptions } from '../../src/utils/expenseStats'

const MONTH = [
  { description: 'Electricity', amount: 4200 },
  { description: 'Honorarium', amount: 2500 },
  { description: 'Supplies', amount: 1600 },
  { description: 'Internet', amount: 1850 },
  { description: 'Supplies', amount: 800 },
  { description: 'Water', amount: 1150 },
]

describe('summariseByDescription', () => {
  it('sums repeated descriptions into one line', () => {
    const supplies = summariseByDescription(MONTH).find((l) => l.description === 'Supplies')
    expect(supplies).toMatchObject({ amount: 2400, count: 2 })
  })

  it('orders the lines largest first', () => {
    expect(summariseByDescription(MONTH).map((l) => l.description)).toEqual([
      'Electricity',
      'Honorarium',
      'Supplies',
      'Internet',
      'Water',
    ])
  })

  it('breaks an exact tie alphabetically so the order does not shuffle between renders', () => {
    const tied = [
      { description: 'Water', amount: 500 },
      { description: 'Internet', amount: 500 },
    ]
    expect(summariseByDescription(tied).map((l) => l.description)).toEqual(['Internet', 'Water'])
  })

  // Free text: two spellings of the same bill are one line to the treasurer.
  it('folds case and edge whitespace, keeping the first spelling seen', () => {
    const rows = [
      { description: 'Electricity', amount: 100 },
      { description: ' electricity ', amount: 50 },
    ]
    expect(summariseByDescription(rows)).toEqual([
      { description: 'Electricity', amount: 150, count: 2, width: '100%' },
    ])
  })

  it('drops rows with no description at all', () => {
    const rows = [
      { description: 'Water', amount: 100 },
      { description: '   ', amount: 999 },
      { description: null, amount: 999 },
    ]
    expect(summariseByDescription(rows)).toHaveLength(1)
  })

  it('measures the bars against the largest line, not the month total', () => {
    const widths = summariseByDescription(MONTH).map((l) => l.width)
    expect(widths[0]).toBe('100%')
    // 2,500 of 4,200
    expect(widths[1]).toBe(`${(2500 / 4200) * 100}%`)
  })

  it('keeps a tiny line visible rather than drawing a bar of nothing', () => {
    const rows = [
      { description: 'Electricity', amount: 10000 },
      { description: 'Water', amount: 1 },
    ]
    expect(summariseByDescription(rows)[1].width).toBe('2%')
  })

  // A NaN width lands in a style attribute, where it silently keeps whatever
  // the previous render drew.
  it('draws no bar at all when every amount is zero', () => {
    const rows = [{ description: 'Water', amount: 0 }]
    expect(summariseByDescription(rows)[0].width).toBe('0%')
  })

  it('treats a missing or unparseable amount as zero', () => {
    const rows = [{ description: 'Water' }, { description: 'Water', amount: 'abc' }]
    expect(summariseByDescription(rows)[0].amount).toBe(0)
  })

  it('returns an empty list for an empty or absent month', () => {
    expect(summariseByDescription([])).toEqual([])
    expect(summariseByDescription(undefined)).toEqual([])
    expect(summariseByDescription(null)).toEqual([])
  })
})

describe('largestLine', () => {
  it('names the biggest description and its share of the month', () => {
    const top = largestLine(MONTH)
    expect(top.description).toBe('Electricity')
    expect(top.amount).toBe(4200)
    // 4,200 of 12,100
    expect(top.share).toBeCloseTo(0.347, 3)
  })

  it('counts the summed line, not the single biggest row', () => {
    const rows = [
      { description: 'Supplies', amount: 600 },
      { description: 'Supplies', amount: 600 },
      { description: 'Water', amount: 1000 },
    ]
    expect(largestLine(rows).description).toBe('Supplies')
  })

  it('is null for a month with nothing in it', () => {
    expect(largestLine([])).toBeNull()
  })

  it('reports a zero share rather than NaN when the month totals nothing', () => {
    expect(largestLine([{ description: 'Water', amount: 0 }]).share).toBe(0)
  })
})

describe('rankDescriptions', () => {
  it('ranks by how often a description is used, not by amount', () => {
    // Supplies is the smallest line but the most-used description.
    expect(rankDescriptions(MONTH)[0]).toBe('Supplies')
  })

  it('breaks ties alphabetically', () => {
    expect(rankDescriptions(MONTH)).toEqual([
      'Supplies',
      'Electricity',
      'Honorarium',
      'Internet',
      'Water',
    ])
  })

  it('honours the limit', () => {
    expect(rankDescriptions(MONTH, { limit: 2 })).toEqual(['Supplies', 'Electricity'])
    expect(rankDescriptions(MONTH, { limit: 0 })).toEqual([])
  })

  it('counts two spellings as one chip', () => {
    const rows = [{ description: 'Water' }, { description: 'WATER ' }, { description: 'Internet' }]
    expect(rankDescriptions(rows)).toEqual(['Water', 'Internet'])
  })

  it('returns nothing for an empty or absent history', () => {
    expect(rankDescriptions([])).toEqual([])
    expect(rankDescriptions(undefined)).toEqual([])
  })
})

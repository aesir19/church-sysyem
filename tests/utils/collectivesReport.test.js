import { describe, expect, it } from 'vitest'
import {
  ALLOCATION_RATES,
  computeMonthlyReport,
  computeWeeklyReport,
} from '../../src/utils/collectivesReport.js'

// The Feb 1, 2026 sheet from "DRAFT DFC SUMMARY REPORT.xlsx" is the reference
// for these expected numbers. Keep this fixture in sync with the workbook.
const feb1Week = {
  date: '2026-02-01',
  studentProgramDeduction: 98.35,
  contributions: [
    { name: 'Lago, Mary Joyce', tithes: 780, offering: 20 },
    { name: 'Sabando, Cielo', tithes: 1397 },
    { name: 'Pagaygay, Jhonel', tithes: 500, offering: 50 },
    { name: 'Ado Family', tithes: 80, offering: 20 },
    { name: 'Gabayne, Erica', tithes: 50 },
    { name: 'Martinez, Sally', tithes: 200 },
    { name: 'Caliwan, Snooky', tithes: 100 },
    { name: 'Gabayne, Jenica', tithes: 100 },
    { name: 'Gabayne, Jing', tithes: 100 },
    { name: 'Unknown', tithes: 50 },
    { name: 'Unknown', tithes: 20 },
    { name: 'Unknown', tithes: 200 },
    { name: 'Unknown', tithes: 100 },
    { name: 'Unknown', tithes: 200 },
  ],
  expenses: [
    { description: 'Umpukan', amount: 1500 },
    { description: 'Kuryente', amount: 750 },
  ],
  openingBalance: 7769,
}

describe('ALLOCATION_RATES', () => {
  it('freezes the rate table so callers cannot mutate the shared constants', () => {
    expect(Object.isFrozen(ALLOCATION_RATES)).toBe(true)
    expect(ALLOCATION_RATES.tithesOfTithes).toBe(0.10)
    expect(ALLOCATION_RATES.project).toBe(0.05)
    expect(ALLOCATION_RATES.studentProgram).toBe(0.05)
    expect(ALLOCATION_RATES.pastorShare + ALLOCATION_RATES.churchShare).toBe(1)
  })
})

describe('computeWeeklyReport', () => {
  it('matches the Feb 1, 2026 reference sheet from the DFC summary workbook', () => {
    const r = computeWeeklyReport(feb1Week)

    expect(r.tithes).toBe(3877)
    expect(r.offering).toBe(90)
    expect(r.others).toBe(0)
    expect(r.totalFunds).toBe(3967)

    expect(r.tithesOfTithes).toBe(396.7)
    expect(r.project).toBe(198.35)
    expect(r.studentProgramGross).toBe(198.35)
    expect(r.studentProgramDeduction).toBe(98.35)
    expect(r.studentProgramNet).toBe(100)
    expect(r.remainingFunds).toBe(3271.95)

    expect(r.pastorAllowance).toBe(1635.98)
    expect(r.churchAllocation).toBe(1635.98)

    expect(r.totalExpenses).toBe(2250)
    // Workbook shows -614.025 raw; rounds to -614.02 under half-up rounding.
    expect(r.netChurchFunds).toBe(-614.02)

    expect(r.openingBalance).toBe(7769)
    expect(r.closingBalance).toBe(7154.98)
  })

  it('returns all zeros for a week with no contributions or expenses', () => {
    const r = computeWeeklyReport({ date: '2026-03-01' })
    expect(r.tithes).toBe(0)
    expect(r.offering).toBe(0)
    expect(r.totalFunds).toBe(0)
    expect(r.tithesOfTithes).toBe(0)
    expect(r.pastorAllowance).toBe(0)
    expect(r.churchAllocation).toBe(0)
    expect(r.totalExpenses).toBe(0)
    expect(r.netChurchFunds).toBe(0)
    expect(r.closingBalance).toBe(0)
  })

  it('coerces non-numeric contribution amounts to zero without crashing', () => {
    const r = computeWeeklyReport({
      date: '2026-03-08',
      contributions: [
        { name: 'A', tithes: '100' },
        { name: 'B', tithes: null, offering: undefined },
        { name: 'C', tithes: 'not a number' },
      ],
    })
    expect(r.tithes).toBe(100)
    expect(r.totalFunds).toBe(100)
  })
})

describe('computeMonthlyReport', () => {
  it('rolls the closing balance from one week into the next', () => {
    const month = {
      month: 3,
      year: 2026,
      openingBalance: 1000,
      weeks: [
        {
          date: '2026-03-01',
          contributions: [{ name: 'A', tithes: 1000 }],
          expenses: [{ description: 'X', amount: 0 }],
        },
        {
          date: '2026-03-08',
          contributions: [{ name: 'A', tithes: 1000 }],
          expenses: [{ description: 'X', amount: 0 }],
        },
      ],
    }

    const r = computeMonthlyReport(month)
    // Each week: totalFunds 1000, tithesOfTithes 100, project 50, studentProgram 50,
    // remaining 800, church allocation 400, net (no expenses) = 400.
    expect(r.totals.totalFunds).toBe(2000)
    expect(r.totals.churchAllocation).toBe(800)
    expect(r.totals.netChurchFunds).toBe(800)
    // Opening 1000 + week1 +400 = 1400 closing after week 1, then +400 = 1800.
    expect(r.weeks[0].closingBalance).toBe(1400)
    expect(r.weeks[1].openingBalance).toBe(1400)
    expect(r.weeks[1].closingBalance).toBe(1800)
    expect(r.closingBalance).toBe(1800)
  })

  it('sorts weeks by date regardless of input order', () => {
    const r = computeMonthlyReport({
      month: 4,
      year: 2026,
      openingBalance: 0,
      weeks: [
        { date: '2026-04-19', contributions: [{ name: 'A', tithes: 100 }] },
        { date: '2026-04-05', contributions: [{ name: 'A', tithes: 100 }] },
        { date: '2026-04-12', contributions: [{ name: 'A', tithes: 100 }] },
      ],
    })
    expect(r.weeks.map((w) => w.date)).toEqual([
      '2026-04-05',
      '2026-04-12',
      '2026-04-19',
    ])
  })

  it('aggregates contributors across weeks and sorts by total desc', () => {
    const r = computeMonthlyReport({
      month: 5,
      year: 2026,
      openingBalance: 0,
      weeks: [
        {
          date: '2026-05-03',
          contributions: [
            { name: 'Alice', tithes: 100, offering: 10 },
            { name: 'Bob', tithes: 50 },
            { name: '  ', tithes: 25 }, // becomes "Unknown"
          ],
        },
        {
          date: '2026-05-10',
          contributions: [
            { name: 'Alice', tithes: 200 },
            { name: 'Bob', tithes: 50, others: 20 },
            { name: 'Unknown', tithes: 15 },
          ],
        },
      ],
    })

    expect(r.contributors.map((c) => c.name)).toEqual(['Alice', 'Bob', 'Unknown'])
    expect(r.contributors[0]).toMatchObject({
      name: 'Alice',
      tithes: 300,
      offering: 10,
      others: 0,
      total: 310,
    })
    expect(r.contributors[2]).toMatchObject({ name: 'Unknown', total: 40 })
  })

  it('aggregates expenses by description and sorts by amount desc', () => {
    const r = computeMonthlyReport({
      month: 6,
      year: 2026,
      openingBalance: 0,
      weeks: [
        {
          date: '2026-06-07',
          contributions: [{ name: 'A', tithes: 1000 }],
          expenses: [
            { description: 'Kuryente', amount: 500 },
            { description: 'Tubig', amount: 100 },
          ],
        },
        {
          date: '2026-06-14',
          contributions: [{ name: 'A', tithes: 1000 }],
          expenses: [
            { description: 'Kuryente', amount: 300 },
            { description: 'Snacks', amount: 250 },
          ],
        },
      ],
    })

    expect(r.expenseSummary).toEqual([
      { description: 'Kuryente', amount: 800 },
      { description: 'Snacks', amount: 250 },
      { description: 'Tubig', amount: 100 },
    ])
    expect(r.totals.expenses).toBe(1150)
  })

  it('renders an empty report when no weeks are provided', () => {
    const r = computeMonthlyReport({ month: 7, year: 2026, openingBalance: 500 })
    expect(r.weeks).toEqual([])
    expect(r.contributors).toEqual([])
    expect(r.expenseSummary).toEqual([])
    expect(r.totals.totalFunds).toBe(0)
    expect(r.openingBalance).toBe(500)
    expect(r.closingBalance).toBe(500)
  })
})

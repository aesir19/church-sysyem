// Monthly collectives report calculator.
//
// Mirrors the allocation logic used in the "DFC SUMMARY REPORT" workbook's
// weekly Collectives sheets so the on-screen report matches the paper report.
//
// Percentages (of TOTAL FUNDS collected that service):
//   - Tithes of Tithes: 10%
//   - Project Fund:      5%
//   - Student Program:   5%  (a per-week personal draw may be deducted from this)
//
// The remainder after those three deductions is split 50/50 between the
// Pastor's Allowance and the Church Allocation. Weekly expenses are then
// subtracted from the Church Allocation to produce the week's net church
// funds, which accumulate onto the previous week's closing balance.

export const ALLOCATION_RATES = Object.freeze({
  tithesOfTithes: 0.10,
  project: 0.05,
  studentProgram: 0.05,
  pastorShare: 0.5,
  churchShare: 0.5,
})

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Compute a single weekly (per-service) report.
 *
 * @param {{
 *   date: string,
 *   contributions?: Array<{ name?: string, tithes?: number, offering?: number, others?: number, particular?: string }>,
 *   expenses?: Array<{ description?: string, amount?: number }>,
 *   studentProgramDeduction?: number,
 *   openingBalance?: number,
 * }} week
 */
export function computeWeeklyReport(week) {
  const contributions = Array.isArray(week?.contributions) ? week.contributions : []
  const expenses = Array.isArray(week?.expenses) ? week.expenses : []

  const tithes = contributions.reduce((s, c) => s + num(c.tithes), 0)
  const offering = contributions.reduce((s, c) => s + num(c.offering), 0)
  const others = contributions.reduce((s, c) => s + num(c.others), 0)
  const totalFunds = tithes + offering + others

  const tithesOfTithes = totalFunds * ALLOCATION_RATES.tithesOfTithes
  const project = totalFunds * ALLOCATION_RATES.project
  const studentProgramGross = totalFunds * ALLOCATION_RATES.studentProgram
  const studentProgramDeduction = num(week?.studentProgramDeduction)
  const studentProgramNet = studentProgramGross - studentProgramDeduction

  const remainingFunds =
    totalFunds - tithesOfTithes - project - studentProgramNet

  const pastorAllowance = remainingFunds * ALLOCATION_RATES.pastorShare
  const churchAllocation = remainingFunds * ALLOCATION_RATES.churchShare

  const totalExpenses = expenses.reduce((s, e) => s + num(e.amount), 0)
  const netChurchFunds = churchAllocation - totalExpenses

  const openingBalance = num(week?.openingBalance)
  const closingBalance = openingBalance + netChurchFunds

  return {
    date: week?.date ?? '',
    tithes: round2(tithes),
    offering: round2(offering),
    others: round2(others),
    totalFunds: round2(totalFunds),
    tithesOfTithes: round2(tithesOfTithes),
    project: round2(project),
    studentProgramGross: round2(studentProgramGross),
    studentProgramDeduction: round2(studentProgramDeduction),
    studentProgramNet: round2(studentProgramNet),
    remainingFunds: round2(remainingFunds),
    pastorAllowance: round2(pastorAllowance),
    churchAllocation: round2(churchAllocation),
    totalExpenses: round2(totalExpenses),
    netChurchFunds: round2(netChurchFunds),
    openingBalance: round2(openingBalance),
    closingBalance: round2(closingBalance),
    contributions,
    expenses,
  }
}

/**
 * Aggregate the weekly services into a monthly report.
 *
 * @param {{
 *   month: number,
 *   year: number,
 *   openingBalance?: number,
 *   weeks?: Array<Parameters<typeof computeWeeklyReport>[0]>,
 * }} month
 */
export function computeMonthlyReport(month) {
  const weeks = Array.isArray(month?.weeks) ? month.weeks.slice() : []
  weeks.sort((a, b) => String(a?.date).localeCompare(String(b?.date)))

  let runningBalance = num(month?.openingBalance)
  const weeklyReports = weeks.map((w) => {
    const report = computeWeeklyReport({ ...w, openingBalance: runningBalance })
    runningBalance = report.closingBalance
    return report
  })

  const sum = (field) => weeklyReports.reduce((s, w) => s + w[field], 0)

  const contributors = aggregateContributors(weeklyReports)
  const expenses = aggregateExpenses(weeklyReports)

  return {
    month: Number(month?.month) || 0,
    year: Number(month?.year) || 0,
    openingBalance: round2(num(month?.openingBalance)),
    closingBalance: round2(runningBalance),
    totals: {
      tithes: round2(sum('tithes')),
      offering: round2(sum('offering')),
      others: round2(sum('others')),
      totalFunds: round2(sum('totalFunds')),
      tithesOfTithes: round2(sum('tithesOfTithes')),
      project: round2(sum('project')),
      studentProgramGross: round2(sum('studentProgramGross')),
      studentProgramDeduction: round2(sum('studentProgramDeduction')),
      studentProgramNet: round2(sum('studentProgramNet')),
      remainingFunds: round2(sum('remainingFunds')),
      pastorAllowance: round2(sum('pastorAllowance')),
      churchAllocation: round2(sum('churchAllocation')),
      expenses: round2(sum('totalExpenses')),
      netChurchFunds: round2(sum('netChurchFunds')),
    },
    weeks: weeklyReports,
    contributors,
    expenseSummary: expenses,
  }
}

function aggregateContributors(weeklyReports) {
  const byName = new Map()
  for (const w of weeklyReports) {
    for (const c of w.contributions) {
      const key = normalizeName(c?.name)
      const existing = byName.get(key) || { name: key, tithes: 0, offering: 0, others: 0 }
      existing.tithes += num(c.tithes)
      existing.offering += num(c.offering)
      existing.others += num(c.others)
      byName.set(key, existing)
    }
  }
  return Array.from(byName.values())
    .map((c) => ({
      name: c.name,
      tithes: round2(c.tithes),
      offering: round2(c.offering),
      others: round2(c.others),
      total: round2(c.tithes + c.offering + c.others),
    }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
}

function aggregateExpenses(weeklyReports) {
  const byDesc = new Map()
  for (const w of weeklyReports) {
    for (const e of w.expenses) {
      const key = normalizeDescription(e?.description)
      const existing = byDesc.get(key) || { description: key, amount: 0 }
      existing.amount += num(e.amount)
      byDesc.set(key, existing)
    }
  }
  return Array.from(byDesc.values())
    .map((e) => ({ description: e.description, amount: round2(e.amount) }))
    .sort((a, b) => b.amount - a.amount || a.description.localeCompare(b.description))
}

function normalizeName(raw) {
  const trimmed = typeof raw === 'string' ? raw.trim() : ''
  return trimmed || 'Unknown'
}

function normalizeDescription(raw) {
  const trimmed = typeof raw === 'string' ? raw.trim() : ''
  return trimmed || 'Other'
}

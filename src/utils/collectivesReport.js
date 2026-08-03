// Monthly collectives report calculator.
//
// Mirrors the allocation logic used in the "DFC SUMMARY REPORT" workbook's
// weekly Collectives sheets so the on-screen report matches the paper report.
//
// Percentages (of TOTAL FUNDS collected that service):
//   - Tithes of Tithes: 10%
//   - Project Fund:      5%
//   - Student Program:   5%  (a per-week personal draw may be deducted from this)
//   - Pastor's Allowance: 40%
//   - Church Allocation:  40%
//                        ----
//                        100%
//
// The last two are computed as a 50/50 split of the 80% remainder, which is the
// same thing — see SHARE_OF_TOTAL_FUNDS below for why both forms exist and which
// one belongs on screen. Weekly expenses are then subtracted from the Church
// Allocation to produce the week's net church funds, which accumulate onto the
// previous week's closing balance.

// NOTE ON DENOMINATORS — the two families below are not interchangeable.
// `pastorShare` / `churchShare` are shares of the REMAINDER; the other three are
// shares of TOTAL FUNDS. Multiplying total funds by pastorShare, or displaying
// pastorShare as a percentage next to the other three, is wrong by a factor of
// the remainder. Use SHARE_OF_TOTAL_FUNDS for anything user-facing.
export const ALLOCATION_RATES = Object.freeze({
  tithesOfTithes: 0.10,
  project: 0.05,
  studentProgram: 0.05,
  pastorShare: 0.5,
  churchShare: 0.5,
})

const AFTER_DEDUCTIONS =
  1 - ALLOCATION_RATES.tithesOfTithes - ALLOCATION_RATES.project - ALLOCATION_RATES.studentProgram

// Every allocation restated against one denominator — total funds collected —
// so the five figures can be read down the column and add to 100%. This is the
// only form fit to put on screen: the report showed "50%" beside the pastor and
// church lines, which is true of the remainder but reads as half the collection
// next to "10%" and "5%" of the total. Same pesos, wrong story.
//
// These are NOMINAL rates from the table above, deliberately not measured off a
// month's actual figures: a per-service personal draw shrinks the student
// program and enlarges the remainder, so the realised shares drift above 40%.
// The label should keep describing the rule, not one month's rounding.
export const SHARE_OF_TOTAL_FUNDS = Object.freeze({
  tithesOfTithes: ALLOCATION_RATES.tithesOfTithes,
  project: ALLOCATION_RATES.project,
  studentProgram: ALLOCATION_RATES.studentProgram,
  pastor: ALLOCATION_RATES.pastorShare * AFTER_DEDUCTIONS,
  church: ALLOCATION_RATES.churchShare * AFTER_DEDUCTIONS,
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
 *   contributions?: Array<{ name?: string, tithes?: number, offering?: number, others?: number,
 *                           particular?: string, anonymous?: boolean, sourceId?: string }>,
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

// Named contributors aggregate across the month — one line per person, summed.
// Anonymous gifts deliberately do not: each stays its own line, so the count of
// anonymous givers and the spread of their amounts both survive into the report.
// That is the behaviour the nullable-`from` design exists to protect; bucketing
// them by their shared "Anonymous" label would throw it away.
function aggregateContributors(weeklyReports) {
  const byKey = new Map()
  let anonymousSeen = 0

  for (const w of weeklyReports) {
    for (const c of w.contributions) {
      const name = normalizeName(c?.name)
      // sourceId is the collection row id. The counter is only a fallback for
      // callers that build contributions by hand (tests, fixtures) — without it
      // those would all collapse onto the same empty key.
      const key = c?.anonymous
        ? `anon:${c.sourceId || `#${anonymousSeen}`}`
        : name
      if (c?.anonymous) anonymousSeen += 1

      const existing = byKey.get(key) || { key, name, tithes: 0, offering: 0, others: 0 }
      existing.tithes += num(c.tithes)
      existing.offering += num(c.offering)
      existing.others += num(c.others)
      byKey.set(key, existing)
    }
  }

  return Array.from(byKey.values())
    .map((c) => ({
      key: c.key,
      name: c.name,
      tithes: round2(c.tithes),
      offering: round2(c.offering),
      others: round2(c.others),
      total: round2(c.tithes + c.offering + c.others),
    }))
    // `key` is the final tie-break because `name` no longer identifies a row —
    // several rows read "Anonymous" — and an unstable sort would reorder them
    // between renders.
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name) || a.key.localeCompare(b.key))
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

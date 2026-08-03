// Adapters that turn live Supabase rows into the shapes collectivesReport.js
// already consumes. Kept separate from the calculator so the money rules stay in
// one file and this one only reshapes data — it performs no allocation math.

import { computeMonthlyReport } from './collectivesReport'
import { contributorLabel, isAnonymousRow } from './collectionPayload'
import { getMonthRange } from './expensesMonth'

function num(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

// PostgREST returns `date` columns as 'YYYY-MM-DD'. Slicing is defensive: if a
// column is ever widened to a timestamp, the report must keep grouping by day
// rather than splitting one service across two columns.
function toDateKey(value) {
  return typeof value === 'string' ? value.slice(0, 10) : ''
}

function byDateAsc(a, b) {
  return String(a.date).localeCompare(String(b.date))
}

function toContribution(row) {
  const amount = num(row?.amount)

  return {
    // contributorLabel keeps the three states apart — "Anonymous" (from IS NULL),
    // the member's name, and "Unknown" (a set `from` whose member the caller
    // cannot read). Do not re-derive the label here; see 0011.
    name: contributorLabel(row),
    // `collections` stores a single boolean, so a gift is either tithes or
    // offering. `others` has no column to come from and is deliberately never
    // set — the calculator still sums it, so a future category column needs no
    // change here.
    tithes: row?.is_tithes ? amount : 0,
    offering: row?.is_tithes ? 0 : amount,
    anonymous: isAnonymousRow(row),
    // What keeps each anonymous gift its own contributor line. Several rows
    // legitimately read "Anonymous" and must not merge into one, which is the
    // spread of amounts the nullable-`from` design in 0011 exists to preserve.
    sourceId: row?.id != null ? String(row.id) : '',
  }
}

/**
 * Group live `collections` rows into the per-service week shape that
 * computeMonthlyReport consumes.
 *
 * @param {Array<{ id?: any, from?: string|null, amount?: number, is_tithes?: boolean,
 *                 collectedOn?: string, members?: object|null }>} rows
 * @param {{ year?: number, month?: number, openingBalance?: number }} [meta]
 */
export function buildMonthSourceFromCollections(rows, meta = {}) {
  const byDate = new Map()

  for (const row of Array.isArray(rows) ? rows : []) {
    const date = toDateKey(row?.collectedOn)
    if (!date) continue

    if (!byDate.has(date)) {
      byDate.set(date, { date, contributions: [], expenses: [] })
    }
    byDate.get(date).contributions.push(toContribution(row))
  }

  return {
    year: Number(meta?.year) || 0,
    month: Number(meta?.month) || 0,
    openingBalance: num(meta?.openingBalance),
    weeks: Array.from(byDate.values()).sort(byDateAsc),
  }
}

/**
 * Turn rows of the `collectives_service_totals` view into minimal week objects.
 *
 * The view is already aggregated per service date, so each week gets a single
 * synthetic contribution and a single synthetic expense carrying that date's
 * sums. They exist only so the rows can be run back through the one calculator;
 * they are never rendered.
 *
 * @param {Array<{ service_date?: string, tithes?: number, offering?: number, expenses?: number }>} rows
 */
export function buildLedgerWeeks(rows) {
  const weeks = []

  for (const row of Array.isArray(rows) ? rows : []) {
    const date = toDateKey(row?.service_date)
    if (!date) continue

    weeks.push({
      date,
      contributions: [{ tithes: num(row?.tithes), offering: num(row?.offering) }],
      expenses: [{ amount: num(row?.expenses) }],
    })
  }

  return weeks.sort(byDateAsc)
}

/**
 * The accumulated net church funds of every service before `monthKey` — i.e.
 * the month's opening balance.
 *
 * This adds no arithmetic of its own. computeMonthlyReport already sorts weeks
 * by date and carries each week's closing balance into the next, so replaying
 * the whole prior ledger through it and reading `closingBalance` yields the
 * carry-forward using the same allocation rules the month itself is rendered
 * with. Any change to those rules stays automatically consistent.
 *
 * @param {Array<object>} serviceTotalRows rows from `collectives_service_totals`
 * @param {string} monthKey 'YYYY-MM'
 * @returns {number}
 */
export function openingBalanceForMonth(serviceTotalRows, monthKey) {
  const range = getMonthRange(monthKey)
  if (!range) return 0

  // ISO dates compare correctly as strings, so no Date parsing (and no timezone
  // exposure) is needed to find "everything before this month".
  const prior = buildLedgerWeeks(serviceTotalRows).filter((week) => week.date < range.start)
  if (prior.length === 0) return 0

  return computeMonthlyReport({ openingBalance: 0, weeks: prior }).closingBalance
}

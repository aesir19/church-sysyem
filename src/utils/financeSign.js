// Append-only finance (migration 0039). A correction never edits a row: it adds a
// REVERSAL row that carries a positive amount tagged kind='reversal' and counts as
// negative in every total. This is the client mirror of the SQL sign term
//   amount * CASE kind WHEN 'reversal' THEN -1 ELSE 1 END
// used by collectives_service_totals and event_collection_total. Any client that
// sums raw collections/expenses rows must go through here, or a reversed entry
// double-counts instead of cancelling.

/** -1 for a reversal row, +1 for an entry. */
export function amountSign (row) {
  return row?.kind === 'reversal' ? -1 : 1
}

/** A single row's signed contribution to a total. */
export function signedAmount (row) {
  return Number(row?.amount || 0) * amountSign(row)
}

/**
 * Net sum of raw finance rows, reversals subtracted.
 * @param {Array} rows
 * @param {(row: any) => number} [pick] - which numeric field to sum (default: amount)
 */
export function netSum (rows, pick = (r) => r.amount) {
  return (rows || []).reduce((sum, r) => sum + Number(pick(r) || 0) * amountSign(r), 0)
}

/** Is this row a reversal (the negating half of a correction)? */
export function isReversal (row) {
  return row?.kind === 'reversal'
}

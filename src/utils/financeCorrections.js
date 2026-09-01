// Collapse an append-only ledger (migration 0039) into display units.
//
// A logical record is a CHAIN: an original entry, and — if it was corrected — a
// reversal that cancels it plus (unless it was voided) a replacement entry, which
// may itself have been corrected again. The list shows ONE row per chain at its
// live value; the history is one tap away.
//
// Rows must carry { id, kind, correctsId }. Reversals and replacements inherit the
// original's period date, so a chain normally arrives whole in one month's query.
// The exception is a date correction that moves the replacement to another month:
// there the replacement is an "orphan" (its parent isn't loaded), and we surface it
// as its own root so the money still shows where it now lands.

/**
 * @param {Array<{id:any, kind:string, correctsId:any}>} rows
 * @returns {Array<{ rootId:any, original:object, live:object|null, voided:boolean, corrected:boolean, history:Array<{step:object, reversal:object}> }>}
 */
export function buildUnits (rows) {
  const byId = new Map(rows.map((r) => [r.id, r]))
  const kids = new Map() // parentId -> { reversal?, replacement? }
  for (const r of rows) {
    if (r.correctsId == null) continue
    const slot = kids.get(r.correctsId) || {}
    if (r.kind === 'reversal') slot.reversal = r
    else slot.replacement = r
    kids.set(r.correctsId, slot)
  }

  const units = []
  for (const r of rows) {
    if (r.kind !== 'entry') continue
    // A replacement whose parent is in this set is shown under that parent, not as
    // a root. A replacement whose parent is absent (date moved to another month) is
    // surfaced as its own root.
    if (r.correctsId != null && byId.has(r.correctsId)) continue

    const history = []
    let current = r
    let voided = false
    let corrected = false
    // Guard against a cycle (shouldn't happen — the FK + "live row only" rule
    // prevent it — but never loop forever on unexpected data).
    const seen = new Set()
    while (!seen.has(current.id)) {
      seen.add(current.id)
      const slot = kids.get(current.id)
      if (!slot || !slot.reversal) break // current is live
      corrected = true
      history.push({ step: current, reversal: slot.reversal })
      if (slot.replacement) { current = slot.replacement; continue }
      voided = true
      break
    }

    units.push({
      rootId: r.id,
      original: r,
      live: voided ? null : current,
      voided,
      corrected,
      history,
    })
  }
  return units
}

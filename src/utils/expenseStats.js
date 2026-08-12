/**
 * The two derived views of a month's expenses: the "By description" bars and
 * the "Largest line" tile.
 *
 * Kept out of the view because they are the only arithmetic on the screen, and
 * arithmetic about money is the part worth testing. Everything here is pure —
 * it takes the rows the view already holds and returns numbers.
 */

function amountOf (row) {
  const value = Number(row?.amount)
  return Number.isFinite(value) ? value : 0
}

/**
 * Descriptions are free text, so "Electricity" and "electricity " are the same
 * line to a treasurer and two lines to a Map. Grouping folds case and edge
 * whitespace; the label kept is the FIRST spelling seen, because the rows
 * arrive newest-first and the most recent spelling is the one being used now.
 */
function keyOf (row) {
  return String(row?.description ?? '').trim().toLowerCase()
}

/**
 * One row per description, largest first: `[{ description, amount, count, width }]`.
 *
 * `width` is the bar, as a percentage of the LARGEST line rather than of the
 * month's total. The mockup draws the top bar full-width, and that is the more
 * readable chart: shares of a total leave every bar short and similar when a
 * month has a dozen descriptions, which is exactly when the ranking matters.
 */
export function summariseByDescription (entries) {
  const rows = Array.isArray(entries) ? entries : []
  const byKey = new Map()

  for (const row of rows) {
    const key = keyOf(row)
    if (!key) continue
    const existing = byKey.get(key)
    if (existing) {
      existing.amount += amountOf(row)
      existing.count += 1
      continue
    }
    byKey.set(key, {
      description: String(row.description).trim(),
      amount: amountOf(row),
      count: 1
    })
  }

  const list = Array.from(byKey.values()).sort(
    (a, b) => b.amount - a.amount || a.description.localeCompare(b.description)
  )

  const largest = list.length ? list[0].amount : 0
  return list.map((line) => ({
    ...line,
    // A month of ₱0 entries is possible (an amount can be corrected to nothing
    // only by deleting, but a zero is not rejected by the database). Dividing
    // by it would put NaN% in a style attribute, which silently draws a bar of
    // whatever width the previous render left.
    width: largest > 0 ? `${Math.max((line.amount / largest) * 100, 2)}%` : '0%'
  }))
}

/**
 * The biggest single description in the month, with what fraction of the month
 * it accounts for: `{ description, amount, share }`, or null for an empty month.
 * `share` is a fraction (0–1), not a percentage — formatting is the view's job.
 */
export function largestLine (entries) {
  const lines = summariseByDescription(entries)
  if (!lines.length) return null

  const total = lines.reduce((sum, line) => sum + line.amount, 0)
  const top = lines[0]
  return {
    description: top.description,
    amount: top.amount,
    share: total > 0 ? top.amount / total : 0
  }
}

/**
 * Descriptions worth offering as one-tap chips, most-used first.
 *
 * Ranked by how often a description has been used rather than by amount: the
 * chips exist to stop "Electricity" becoming "electric bill" next month, and
 * the habit is what predicts the next entry — not the size of the bill.
 */
export function rankDescriptions (rows, { limit = 6 } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const byKey = new Map()

  for (const row of list) {
    const key = keyOf(row)
    if (!key) continue
    const existing = byKey.get(key)
    if (existing) {
      existing.count += 1
      continue
    }
    byKey.set(key, { description: String(row.description).trim(), count: 1 })
  }

  return Array.from(byKey.values())
    .sort((a, b) => b.count - a.count || a.description.localeCompare(b.description))
    .slice(0, Math.max(0, limit))
    .map((entry) => entry.description)
}

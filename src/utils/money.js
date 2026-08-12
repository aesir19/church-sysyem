/**
 * Peso formatting, in one place.
 *
 * The old finance screens each carried their own `'PHP ' + toLocaleString(...)`
 * helper, so the same amount rendered as "PHP 2,500.00" on Collections and
 * "PHP 2,500" on Funds. The mockups write ₱ everywhere, and money that changes
 * shape between two screens of the same app reads as two different numbers.
 */

const PESO = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
})

const PESO_WHOLE = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  maximumFractionDigits: 0
})

/**
 * '₱2,500.00'. Centavos always shown: this is an accounting figure, and a total
 * that silently rounds is a total somebody will try to reconcile.
 *
 * A missing amount is ₱0.00 rather than a blank, because these are sums — an
 * empty cell in a column of money reads as "unknown", and a row with no amount
 * cannot exist (`amount` is NOT NULL).
 */
export function formatPeso (value) {
  const number = Number(value)
  return PESO.format(Number.isFinite(number) ? number : 0)
}

/** '₱2,500' — for KPI tiles, where the centavos are noise at 20px. */
export function formatPesoWhole (value) {
  const number = Number(value)
  return PESO_WHOLE.format(Number.isFinite(number) ? number : 0)
}

/**
 * '₱60.5k' once the figure passes a thousand. Only for the small summary tiles
 * that have to fit a number beside a label; never for a table cell or a total
 * anybody reconciles against.
 */
export function formatPesoShort (value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return PESO_WHOLE.format(0)
  if (Math.abs(number) < 1000) return PESO_WHOLE.format(number)
  const thousands = number / 1000
  // One decimal, and the trailing '.0' dropped: ₱60.5k, but ₱61k not ₱61.0k.
  return `₱${thousands.toFixed(1).replace(/\.0$/, '')}k`
}

/**
 * What percentage `part` is of `whole`, as '69.4%'. Empty string when there is
 * no whole to be a part of — "0.0%" of nothing is a statement, and a blank is
 * the absence of one.
 */
export function formatShare (part, whole) {
  const total = Number(whole)
  if (!Number.isFinite(total) || total <= 0) return ''
  return `${((Number(part) / total) * 100).toFixed(1)}%`
}

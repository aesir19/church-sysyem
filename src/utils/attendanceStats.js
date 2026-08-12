/**
 * The two derived numbers the attendance screen draws: the bar chart of recent
 * services, and the sentence comparing today with what came before it.
 *
 * Pure, so both can be tested without a database or a mounted view. Neither is
 * an authority on anything — the counts come from lib/data/attendance.js.
 */

/** How many services the chart shows. The mockup draws ten. */
export const CHART_SERVICES = 10

/**
 * Bars for the chart, oldest on the left.
 *
 * `services` arrives NEWEST first (that is the order the services select needs),
 * so this takes the head of the list and reverses it. Taking the tail instead
 * would chart the ten OLDEST services, which is the same code with the same
 * shape and completely the wrong answer.
 *
 * @param {object[]} services rows with { id, label, service_date }
 * @param {Map<string, number>|object} counts attendance total per service id
 * @param {{ limit?: number }} [options]
 */
export function buildServiceBars (services, counts, { limit = CHART_SERVICES } = {}) {
  const list = (Array.isArray(services) ? services : []).slice(0, limit).reverse()

  // A MISSING count is null, not 0. Only counts that actually came back are in
  // the map, and drawing an empty bar for a service whose count failed to load
  // would state a turnout of nobody — which is a claim, not a gap.
  const read = (id) => {
    if (counts instanceof Map) return counts.has(id) ? counts.get(id) : null
    if (counts && Object.prototype.hasOwnProperty.call(counts, id)) return Number(counts[id])
    return null
  }

  const values = list.map((service) => read(service.id))
  const max = values.reduce((m, v) => (Number.isFinite(v) ? Math.max(m, v) : m), 0)

  return list.map((service, index) => ({
    id: service.id,
    label: shortDate(service.service_date),
    fullLabel: `${service.label} · ${longDate(service.service_date)}`,
    value: values[index],
    // Share of the tallest bar, not of some fixed ceiling: a chart of ten
    // services is a comparison between them.
    heightPercent: max && Number.isFinite(values[index])
      ? Math.round((values[index] / max) * 100)
      : 0,
    isLatest: index === list.length - 1
  }))
}

/** Mean of the values, or null when there is nothing to average. */
export function averageOf (values) {
  const list = (Array.isArray(values) ? values : []).filter((v) => Number.isFinite(v))
  if (!list.length) return null
  return list.reduce((sum, v) => sum + v, 0) / list.length
}

/**
 * "11% above the four-service average", or '' when there is not enough history
 * to say anything.
 *
 * Two services is the floor: comparing today against a single previous Sunday
 * is not an average, it is last week, and phrasing it as one overstates what is
 * known. A previous average of zero is also refused — every non-zero turnout is
 * infinitely above nothing, so the percentage would be meaningless rather than
 * dramatic.
 */
export function describeAgainstAverage (current, previous) {
  const list = (Array.isArray(previous) ? previous : []).filter((v) => Number.isFinite(v))
  if (list.length < 2) return ''

  const average = averageOf(list)
  if (!average) return ''

  const noun = `${list.length}-service average`
  const percent = Math.round(((current - average) / average) * 100)

  if (percent === 0) return `in line with the ${noun}`
  return `${Math.abs(percent)}% ${percent > 0 ? 'above' : 'below'} the ${noun}`
}

/**
 * The values immediately before the latest bar — what the sentence above
 * compares against. Defaults to four, which is the mockup's "four-week average".
 */
export function previousValues (bars, count = 4) {
  const list = Array.isArray(bars) ? bars : []
  if (list.length < 2) return []
  return list.slice(Math.max(0, list.length - 1 - count), list.length - 1).map((b) => b.value)
}

/**
 * `service_date` is a DATE column — '2026-08-02', with no time and no zone.
 * Parsed with an explicit T00:00:00 so it is read as local midnight; passing the
 * bare string to `new Date` reads it as UTC midnight, which is the previous day
 * in Manila for the first eight hours of every day (docs/DEFECTS.md D8).
 */
function parseServiceDate (value) {
  if (!value) return null
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

/** 'Aug 2' — the axis label under each bar. */
export function shortDate (value) {
  const date = parseServiceDate(value)
  if (!date) return ''
  return date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })
}

/**
 * '2 August 2026' — the page subtitle and the chart tooltip.
 *
 * en-GB rather than the en-PH used elsewhere, purely for the order: en-PH
 * formats this as 'August 2, 2026' and the design writes the day first. Both
 * are read the same way; matching the mockup is the tiebreak.
 */
export function longDate (value) {
  const date = parseServiceDate(value)
  if (!date) return ''
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

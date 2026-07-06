function pad2(value) {
  return String(value).padStart(2, '0')
}

export function parseMonthKey(monthKey) {
  if (typeof monthKey !== 'string') return null
  const match = monthKey.match(/^(\d{4})-(\d{2})$/)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null
  }

  return { year, month }
}

export function getMonthRange(monthKey) {
  const parsed = parseMonthKey(monthKey)
  if (!parsed) return null

  const { year, month } = parsed
  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1

  return {
    start: `${year}-${pad2(month)}-01`,
    endExclusive: `${nextYear}-${pad2(nextMonth)}-01`,
  }
}

export function monthKeyFromDate(dateIso) {
  if (typeof dateIso !== 'string') return ''
  return dateIso.slice(0, 7)
}

export function defaultMonthKey(now = new Date()) {
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  return `${year}-${pad2(month)}`
}

export function sanitizeMemberSearchTerm(input) {
  return String(input ?? '')
    .replace(/[%(),]/g, ' ')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64)
}

export function buildMemberNameOrFilter(rawQuery) {
  const safe = sanitizeMemberSearchTerm(rawQuery).toLowerCase()
  if (safe.length < 2) return null
  const pattern = `%${safe}%`
  return `first_name.ilike.${pattern},last_name.ilike.${pattern}`
}
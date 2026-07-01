import { describe, expect, it } from 'vitest'
import { buildMemberNameOrFilter, sanitizeMemberSearchTerm } from '../../src/utils/searchFilters'

describe('search filter safety', () => {
  it('sanitizes dangerous control characters and filter separators', () => {
    const raw = "john%),or(id.gt.0)\n\t"
    const safe = sanitizeMemberSearchTerm(raw)

    expect(safe).toBe('john or id.gt.0')
    expect(safe.includes('%')).toBe(false)
    expect(safe.includes(',')).toBe(false)
    expect(safe.includes('(')).toBe(false)
    expect(safe.includes(')')).toBe(false)
  })

  it('returns null for short terms', () => {
    expect(buildMemberNameOrFilter('a')).toBe(null)
  })

  it('builds a bounded ilike filter from safe input only', () => {
    const filter = buildMemberNameOrFilter("Jane),or(member_of.not.is.null)")

    expect(filter).toBe('first_name.ilike.%jane or member_of.not.is.null%,last_name.ilike.%jane or member_of.not.is.null%')
    expect(filter.includes('),')).toBe(false)
  })
})

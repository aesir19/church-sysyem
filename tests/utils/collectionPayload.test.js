import { describe, expect, it } from 'vitest'
import {
  buildCollectionPayload,
  contributorLabel,
  isAnonymousRow,
} from '../../src/utils/collectionPayload'

const CHURCH_ID = '11111111-1111-1111-1111-111111111111'
const MEMBER_ID = '22222222-2222-2222-2222-222222222222'

describe('buildCollectionPayload', () => {
  it('maps a named contributor onto the collections columns', () => {
    const payload = buildCollectionPayload(
      { memberId: MEMBER_ID, type: 'tithes', amount: 500, date: '2026-08-02' },
      CHURCH_ID,
    )

    expect(payload).toEqual({
      from: MEMBER_ID,
      amount: 500,
      is_tithes: true,
      collectedOn: '2026-08-02',
      from_church: CHURCH_ID,
    })
  })

  it('sends an explicit null for `from` when the contributor is anonymous', () => {
    const payload = buildCollectionPayload(
      { memberId: '', type: 'offering', amount: 250, date: '2026-08-02' },
      CHURCH_ID,
    )

    // The key must be present. Omitting it is the 23503 bug fixed by
    // 0011_collections_anonymous_from.
    expect('from' in payload).toBe(true)
    expect(payload.from).toBeNull()
    expect(payload.is_tithes).toBe(false)
  })

  it('does not merge two anonymous gifts — each build is its own row', () => {
    const form = { memberId: '', type: 'tithes', amount: 100, date: '2026-08-02' }
    const first = buildCollectionPayload(form, CHURCH_ID)
    const second = buildCollectionPayload({ ...form, amount: 300 }, CHURCH_ID)

    expect(first.amount).toBe(100)
    expect(second.amount).toBe(300)
    expect(first.from).toBeNull()
    expect(second.from).toBeNull()
  })

  it('flags anything other than "tithes" as an offering', () => {
    expect(buildCollectionPayload({ type: 'offering' }, CHURCH_ID).is_tithes).toBe(false)
    expect(buildCollectionPayload({}, CHURCH_ID).is_tithes).toBe(false)
  })

  it('tolerates a missing form object', () => {
    expect(buildCollectionPayload(null, CHURCH_ID)).toEqual({
      from: null,
      amount: undefined,
      is_tithes: false,
      collectedOn: undefined,
      from_church: CHURCH_ID,
    })
  })
})

describe('contributorLabel', () => {
  it('labels a null `from` as Anonymous', () => {
    expect(contributorLabel({ from: null, members: null })).toBe('Anonymous')
  })

  it('labels a readable member by name', () => {
    const row = { from: MEMBER_ID, members: { first_name: 'Jane', last_name: 'Doe' } }
    expect(contributorLabel(row)).toBe('Jane Doe')
  })

  it('keeps Unknown for a set `from` whose member could not be read', () => {
    // RLS filtered the embed — distinct from an anonymous gift, and the two
    // must not render identically.
    expect(contributorLabel({ from: MEMBER_ID, members: null })).toBe('Unknown')
  })

  it('falls back to Unknown when the joined member has no name', () => {
    expect(contributorLabel({ from: MEMBER_ID, members: {} })).toBe('Unknown')
  })

  it('handles a member with only one name part', () => {
    expect(contributorLabel({ from: MEMBER_ID, members: { first_name: 'Prince' } })).toBe('Prince')
  })

  it('returns Unknown for a missing row', () => {
    expect(contributorLabel(null)).toBe('Unknown')
  })
})

describe('isAnonymousRow', () => {
  it('is true only for a null `from`', () => {
    expect(isAnonymousRow({ from: null })).toBe(true)
    expect(isAnonymousRow({ from: undefined })).toBe(true)
    expect(isAnonymousRow({ from: MEMBER_ID })).toBe(false)
    expect(isAnonymousRow(null)).toBe(false)
  })
})

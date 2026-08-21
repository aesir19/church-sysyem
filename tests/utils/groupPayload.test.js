import { describe, expect, it } from 'vitest'
import {
  buildSmallGroupCreatePayload,
  buildSmallGroupUpdatePayload,
} from '../../src/utils/groupPayload'

describe('small-group payloads', () => {
  // `type` is no longer part of the payload, and that is the point of 0026: a
  // small group is a row in `small_groups`, so the kind of group is the table
  // rather than a column. The stray fields below are still passed in to prove
  // the builder is an allowlist — anything not named is dropped, whether it is a
  // column that never existed, one that was removed (color_slot, 0025), or one
  // that moved into the table name (type).
  it('pins creates to the resolved church and drops everything else', () => {
    expect(buildSmallGroupCreatePayload({
      name: '  Young Adults  ',
      color: 'teal',
      color_slot: 100,
      type: 'Ministry',
      church_id: 'other-church',
    }, 'my-church')).toEqual({
      name: 'Young Adults',
      church_id: 'my-church',
    })
  })

  it('allows updates only to the name', () => {
    expect(buildSmallGroupUpdatePayload({
      name: '  Families  ',
      color: 'not-allowed',
      color_slot: 100,
      type: 'Ministry',
      church_id: 'other-church',
    })).toEqual({
      name: 'Families',
    })
  })
})

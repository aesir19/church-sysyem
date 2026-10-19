import { describe, expect, it } from 'vitest'
import {
  buildDGroupCreatePayload,
  buildDGroupUpdatePayload,
} from '../../src/utils/groupPayload'

describe('D-Group payloads', () => {
  // `type` is no longer part of the payload, and that is the point of 0026: a
  // D-Group is a row in `small_groups`, so the kind of group is the table
  // rather than a column. The stray fields below are still passed in to prove
  // the builder is an allowlist — anything not named is dropped, whether it is a
  // column that never existed, one that was removed (color_slot, 0025), or one
  // that moved into the table name (type).
  it('pins creates to the resolved church and drops everything else', () => {
    expect(buildDGroupCreatePayload({
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
    expect(buildDGroupUpdatePayload({
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

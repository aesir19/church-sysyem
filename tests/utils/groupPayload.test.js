import { describe, expect, it } from 'vitest'
import {
  buildSmallGroupCreatePayload,
  buildSmallGroupUpdatePayload,
} from '../../src/utils/groupPayload'

describe('small-group payloads', () => {
  it('pins creates to Small Group and the resolved church', () => {
    expect(buildSmallGroupCreatePayload({
      name: '  Young Adults  ',
      color: 'teal',
      color_slot: 100,
      type: 'Ministry',
      church_id: 'other-church',
    }, 'my-church')).toEqual({
      name: 'Young Adults',
      type: 'Small Group',
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

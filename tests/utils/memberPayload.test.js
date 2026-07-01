import { describe, expect, it } from 'vitest'
import { buildMemberPayload } from '../../src/utils/memberPayload'

describe('buildMemberPayload', () => {
  it('trims required and optional text fields and nulls empty optionals', () => {
    const payload = buildMemberPayload({
      first_name: '  Jane ',
      last_name: ' Doe  ',
      middle_name: '   ',
      birthdate: '1990-01-01',
      gender: 'Female',
      address: '   ',
      date_joined: '',
      contact_number: ' 09171234567 ',
      email: ' jane@example.com ',
      marital_status: 'Single',
      wedding_anniversarry: '',
      facebook_link: '  https://facebook.com/jane ',
      is_one_to_one_completed: 1,
      is_turning_point_completed: 0,
      is_baptized: true,
    })

    expect(payload).toEqual({
      first_name: 'Jane',
      last_name: 'Doe',
      middle_name: null,
      birthdate: '1990-01-01',
      gender: 'Female',
      address: null,
      date_joined: null,
      contact_number: '09171234567',
      email: 'jane@example.com',
      marital_status: 'Single',
      wedding_anniversarry: null,
      facebook_link: 'https://facebook.com/jane',
      is_one_to_one_completed: true,
      is_turning_point_completed: false,
      is_baptized: true,
    })
  })

  it('treats SQL-like input as inert string data', () => {
    const payload = buildMemberPayload({
      first_name: "  Robert'); DROP TABLE members;--  ",
      last_name: 'Smith',
      marital_status: 'Single',
    })

    expect(payload.first_name).toBe("Robert'); DROP TABLE members;--")
    expect(payload.last_name).toBe('Smith')
  })
})

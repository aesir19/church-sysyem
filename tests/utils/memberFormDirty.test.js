import { describe, expect, it } from 'vitest'
import { isMemberFormDirty, snapshotMemberForm } from '../../src/utils/memberFormDirty'

describe('member form dirty state', () => {
  it('keeps a new untouched form pristine', () => {
    const form = {
      first_name: '',
      last_name: '',
      is_baptized: false,
    }
    const initial = snapshotMemberForm(form)

    expect(isMemberFormDirty(form, initial)).toBe(false)
  })

  it('detects unfinished text and checkbox entries', () => {
    const initial = snapshotMemberForm({ first_name: '', is_baptized: false })

    expect(isMemberFormDirty({ first_name: 'Jane', is_baptized: false }, initial)).toBe(true)
    expect(isMemberFormDirty({ first_name: '', is_baptized: true }, initial)).toBe(true)
  })

  it('compares edits with the member values captured when editing began', () => {
    const initial = snapshotMemberForm({
      first_name: 'Jane',
      contact_number: 12345,
      is_baptized: true,
    })
    const form = {
      first_name: 'Janet',
      contact_number: '12345',
      is_baptized: true,
    }

    expect(isMemberFormDirty(form, initial)).toBe(true)

    form.first_name = 'Jane'
    expect(isMemberFormDirty(form, initial)).toBe(false)
  })
})
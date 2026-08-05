import { describe, expect, it } from 'vitest'
import {
  buildCheckinArgs,
  buildStaffAttendancePayload,
  interpretCheckin,
  NAME_MAX_LENGTH,
  readCheckinToken,
  sanitizeCheckinContact,
  sanitizeCheckinName,
  validateCheckinContact,
  validateCheckinName,
} from '../../src/utils/checkinPayload.js'

const VALID_TOKEN = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6'

describe('readCheckinToken', () => {
  // The token lives in the fragment, never the path, so it is not sent to the
  // server and cannot land in Netlify access logs or a Referer header.
  it('reads a valid token from a fragment', () => {
    expect(readCheckinToken(`#t=${VALID_TOKEN}`)).toBe(VALID_TOKEN)
  })

  it('accepts a fragment without the leading hash', () => {
    expect(readCheckinToken(`t=${VALID_TOKEN}`)).toBe(VALID_TOKEN)
  })

  it('reads the token when other fragment params are present', () => {
    expect(readCheckinToken(`#foo=1&t=${VALID_TOKEN}&bar=2`)).toBe(VALID_TOKEN)
  })

  it('lowercases so a QR scanned in caps still resolves', () => {
    expect(readCheckinToken(`#t=${VALID_TOKEN.toUpperCase()}`)).toBe(VALID_TOKEN)
  })

  it('rejects anything that is not 32 hex characters', () => {
    // Mirrors churches_checkin_token_shape. Rejecting here means a mistyped QR
    // never reaches the network at all.
    expect(readCheckinToken('#t=short')).toBe('')
    expect(readCheckinToken(`#t=${'z'.repeat(32)}`)).toBe('')
    expect(readCheckinToken(`#t=${VALID_TOKEN}extra`)).toBe('')
  })

  it('returns empty for an absent or empty fragment', () => {
    expect(readCheckinToken('')).toBe('')
    expect(readCheckinToken('#')).toBe('')
    expect(readCheckinToken(null)).toBe('')
    expect(readCheckinToken(undefined)).toBe('')
  })

  it('returns empty when the fragment carries no t param', () => {
    expect(readCheckinToken('#access_token=abc&type=invite')).toBe('')
  })
})

describe('sanitizeCheckinName', () => {
  // Mirrors submit_checkin step 5, in the same order.
  it('collapses whitespace and trims', () => {
    expect(sanitizeCheckinName('  Juan   Dela  Cruz  ')).toBe('Juan Dela Cruz')
  })

  it('replaces control characters with a space rather than deleting them', () => {
    // Deleting would join words the database keeps apart, because \p{Cc} and
    // [[:cntrl:]] both cover tab and newline. Both sides substitute a space, so
    // 'Juan<TAB>Dela' still matches the member 'Juan Dela'.
    expect(sanitizeCheckinName('Juan\u0000\u001fCruz')).toBe('Juan Cruz')
    expect(sanitizeCheckinName('Juan\tDela\nCruz')).toBe('Juan Dela Cruz')
  })

  it('caps at 80 characters and re-trims', () => {
    // slice() can sever mid-space, and attendance_guest_name_shape requires an
    // already-trimmed value — so the second trim is load-bearing, not cosmetic.
    const long = `${'a'.repeat(79)} bcdef`
    const result = sanitizeCheckinName(long)
    expect(result.length).toBeLessThanOrEqual(NAME_MAX_LENGTH)
    expect(result).toBe(result.trim())
    expect(result).toBe('a'.repeat(79))
  })

  it('preserves casing — only the match is case-insensitive', () => {
    expect(sanitizeCheckinName('Juan Cruz')).toBe('Juan Cruz')
  })

  it('handles null', () => {
    expect(sanitizeCheckinName(null)).toBe('')
  })
})

describe('validateCheckinName', () => {
  it('accepts an ordinary name', () => {
    expect(validateCheckinName('Juan Cruz')).toBe('')
  })

  it('asks for a name when blank or whitespace only', () => {
    expect(validateCheckinName('')).toBe('Enter your name.')
    expect(validateCheckinName('   ')).toBe('Enter your name.')
  })

  it('rejects a single character, matching the 2-character CHECK', () => {
    expect(validateCheckinName('J')).toMatch(/too short/)
  })
})

describe('validateCheckinContact', () => {
  it('accepts a blank contact — the field is optional', () => {
    expect(validateCheckinContact('')).toBe('')
    expect(validateCheckinContact(null)).toBe('')
  })

  it('accepts common Philippine formats', () => {
    // Stored as text, not Decimal: members.contact_number is Decimal and drops
    // the leading zero (defect D3). These must survive intact.
    expect(validateCheckinContact('09175551234')).toBe('')
    expect(validateCheckinContact('0917 555 1234')).toBe('')
    expect(validateCheckinContact('+63 917 555 1234')).toBe('')
    expect(validateCheckinContact('(02) 8123-4567')).toBe('')
  })

  it('rejects letters and too-short input', () => {
    expect(validateCheckinContact('not a number')).toMatch(/valid contact/)
    expect(validateCheckinContact('12345')).toMatch(/valid contact/)
  })

  it('rejects a value longer than 32 characters', () => {
    expect(validateCheckinContact('0'.repeat(33))).toMatch(/valid contact/)
  })

  it('preserves a leading zero', () => {
    expect(sanitizeCheckinContact('09175551234')).toBe('09175551234')
  })
})

describe('buildCheckinArgs', () => {
  it('sends sanitized values under the RPC parameter names', () => {
    expect(buildCheckinArgs(VALID_TOKEN, { name: '  Juan  Cruz ', contact: ' 0917 555 1234 ' }))
      .toEqual({
        p_token: VALID_TOKEN,
        p_name: 'Juan Cruz',
        p_contact: '0917 555 1234',
      })
  })

  it('sends null rather than empty string for a blank contact', () => {
    // attendance_guest_contact_shape would reject '' — the column is nullable.
    expect(buildCheckinArgs(VALID_TOKEN, { name: 'Juan Cruz', contact: '' }).p_contact).toBeNull()
    expect(buildCheckinArgs(VALID_TOKEN, { name: 'Juan Cruz' }).p_contact).toBeNull()
  })
})

describe('interpretCheckin', () => {
  it('treats recorded as success', () => {
    expect(interpretCheckin('recorded')).toEqual({
      ok: true,
      message: "You're checked in. Thank you!",
    })
  })

  it('gives the same reply for closed, an unknown status, and null', () => {
    // The RPC deliberately returns only 'recorded' or 'closed' — never whether a
    // member matched or whether this person had already checked in. Collapsing
    // everything else to one message is what keeps this from being an oracle for
    // "is X a member" and "is X here today".
    const closed = interpretCheckin('closed')
    expect(closed.ok).toBe(false)
    expect(interpretCheckin('already')).toEqual(closed)
    expect(interpretCheckin(null)).toEqual(closed)
    expect(interpretCheckin(undefined)).toEqual(closed)
  })
})

describe('buildStaffAttendancePayload', () => {
  const base = { serviceId: 'svc-1', churchId: 'church-1' }

  it('never sends source or recorded_by', () => {
    // Neither column is in the INSERT grant. Sending them produces a 42501, and
    // that omission is exactly what makes provenance unforgeable from a client.
    const payload = buildStaffAttendancePayload({ ...base, memberId: 'm1' })
    expect(payload).not.toHaveProperty('source')
    expect(payload).not.toHaveProperty('recorded_by')
  })

  it('sets member_id and nulls the guest columns for a member', () => {
    expect(buildStaffAttendancePayload({ ...base, memberId: 'm1' })).toEqual({
      service_id: 'svc-1',
      church_id: 'church-1',
      member_id: 'm1',
      guest_name: null,
      guest_contact: null,
    })
  })

  it('sets guest columns and nulls member_id for a visitor', () => {
    // attendance_identity_check requires exactly one of the two.
    expect(buildStaffAttendancePayload({
      ...base,
      guestName: '  Maria  Santos ',
      guestContact: ' 0917 555 1234 ',
    })).toEqual({
      service_id: 'svc-1',
      church_id: 'church-1',
      member_id: null,
      guest_name: 'Maria Santos',
      guest_contact: '0917 555 1234',
    })
  })

  it('nulls a blank guest contact', () => {
    const payload = buildStaffAttendancePayload({ ...base, guestName: 'Maria Santos', guestContact: '' })
    expect(payload.guest_contact).toBeNull()
  })
})

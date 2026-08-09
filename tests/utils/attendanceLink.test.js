import { describe, expect, it } from 'vitest'
import {
  buildGuestLinkPayload,
  isDuplicateMemberConflict,
  isPolicyViolation,
} from '../../src/utils/attendanceLink.js'

describe('buildGuestLinkPayload', () => {
  it('sets the member and clears both guest fields in one payload', () => {
    // attendance_identity_check requires exactly one of member_id / guest_name, and
    // attendance_contact_needs_guest forbids a contact on a member row. Setting
    // member_id without nulling both is rejected by the database, so the keys are
    // never optional and never split across statements.
    expect(buildGuestLinkPayload('a3f1c2d4-0000-4000-8000-000000000001')).toEqual({
      member_id: 'a3f1c2d4-0000-4000-8000-000000000001',
      guest_name: null,
      guest_contact: null,
    })
  })

  it('always carries all three keys', () => {
    const payload = buildGuestLinkPayload('member-1')
    expect(Object.keys(payload).sort()).toEqual(['guest_contact', 'guest_name', 'member_id'])
  })

  it('trims the id', () => {
    expect(buildGuestLinkPayload('  member-1  ').member_id).toBe('member-1')
  })

  it('returns null when nothing was chosen, so the caller can stop before the write', () => {
    expect(buildGuestLinkPayload('')).toBeNull()
    expect(buildGuestLinkPayload('   ')).toBeNull()
    expect(buildGuestLinkPayload(undefined)).toBeNull()
    expect(buildGuestLinkPayload(null)).toBeNull()
  })
})

describe('isDuplicateMemberConflict', () => {
  // The shape PostgREST returns for a unique violation raised by the index that
  // makes a member's check-in idempotent (migration 0013).
  const memberConflict = {
    code: '23505',
    message: 'duplicate key value violates unique constraint "attendance_service_member_key"',
    details: 'Key (service_id, member_id)=(svc-1, mem-1) already exists.',
  }

  it('recognises the member-already-on-this-roster collision', () => {
    expect(isDuplicateMemberConflict(memberConflict)).toBe(true)
  })

  it('matches on details alone when the message omits the constraint name', () => {
    expect(
      isDuplicateMemberConflict({
        code: '23505',
        message: 'duplicate key value violates unique constraint',
        details: 'conflicting key value violates attendance_service_member_key',
      })
    ).toBe(true)
  })

  it('does not treat a different unique violation as the merge signal', () => {
    // The self check-in guest-name index. Merging on this would delete somebody's
    // attendance in response to an unrelated collision.
    expect(
      isDuplicateMemberConflict({
        code: '23505',
        message: 'duplicate key value violates unique constraint "attendance_self_guest_key"',
        details: 'Key (service_id, guest_name_norm)=(svc-1, juan cruz) already exists.',
      })
    ).toBe(false)
  })

  it('does not treat other errors as a conflict', () => {
    expect(isDuplicateMemberConflict(null)).toBe(false)
    expect(isDuplicateMemberConflict(undefined)).toBe(false)
    expect(isDuplicateMemberConflict({})).toBe(false)
    // A check-constraint failure and a permission denial are real errors.
    expect(isDuplicateMemberConflict({ code: '23514', message: 'attendance_identity_check' })).toBe(false)
    expect(isDuplicateMemberConflict({ code: '42501', message: 'permission denied' })).toBe(false)
  })

  it('tolerates an error object with no message or details', () => {
    expect(isDuplicateMemberConflict({ code: '23505' })).toBe(false)
  })
})

describe('isPolicyViolation', () => {
  // Verbatim from running the VERIFICATION.md §4.1 matrix against staging: the
  // WITH CHECK half of attendance_update_link_guest RAISES rather than filtering,
  // so this error is what a cross-church link attempt actually produces. The USING
  // half filters to zero rows and never reaches here.
  it('recognises the WITH CHECK rejection', () => {
    expect(
      isPolicyViolation({
        code: '42501',
        message: 'new row violates row-level security policy for table "attendance"',
      })
    ).toBe(true)
  })

  it('is case-insensitive about the message', () => {
    expect(isPolicyViolation({ message: 'New Row Violates Row-Level Security Policy' })).toBe(true)
  })

  it('falls back to the SQLSTATE only when there is no message', () => {
    expect(isPolicyViolation({ code: '42501' })).toBe(true)
    // With a message present, an ordinary missing-grant denial is left alone so it
    // surfaces as itself rather than as a misleading cross-church explanation.
    expect(isPolicyViolation({ code: '42501', message: 'permission denied for table attendance' })).toBe(false)
  })

  it('does not claim unrelated failures', () => {
    expect(isPolicyViolation(null)).toBe(false)
    expect(isPolicyViolation(undefined)).toBe(false)
    expect(isPolicyViolation({})).toBe(false)
    expect(isPolicyViolation({ code: '23505', message: 'duplicate key value' })).toBe(false)
    expect(isPolicyViolation({ code: '23514', message: 'attendance_identity_check' })).toBe(false)
  })
})

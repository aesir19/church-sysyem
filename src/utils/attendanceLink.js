/**
 * Linking a guest attendance row to the member it was really meant to be.
 *
 * A self check-in is matched to a member by normalized full name, so a member who
 * mistypes their name on the public QR page lands as a guest row. The correction
 * is an in-place UPDATE — not delete-and-re-add — so that `source`, `created_at`
 * and `recorded_by` survive it and the roster keeps telling the truth about who
 * self-asserted. Migration 0019 authorizes exactly that one transition.
 *
 * The logic lives here rather than in AttendanceView so it can be tested without
 * mounting the view.
 */

/** The unique index that makes a member's check-in idempotent (migration 0013). */
const MEMBER_UNIQUE_CONSTRAINT = 'attendance_service_member_key'

/** Postgres `unique_violation`. */
const UNIQUE_VIOLATION = '23505'

/**
 * The payload that turns a guest row into a member row.
 *
 * All three keys are always present. `attendance_identity_check` requires exactly
 * one of member_id / guest_name to be non-NULL, and `attendance_contact_needs_guest`
 * forbids a contact number on a member row — so setting member_id without clearing
 * both guest fields in the SAME statement is rejected by the database. They are one
 * write, never three.
 *
 * @param {string} memberId - the chosen member's id
 * @returns {{ member_id: string, guest_name: null, guest_contact: null } | null}
 *   null when no member was chosen, so the caller can stop before the round-trip
 */
export function buildGuestLinkPayload(memberId) {
  const id = typeof memberId === 'string' ? memberId.trim() : ''
  if (!id) return null

  return { member_id: id, guest_name: null, guest_contact: null }
}

/**
 * Is this the "that member is already on this roster" collision?
 *
 * Linking a guest to someone who already has a member row for the service trips
 * `attendance_service_member_key`. That is not a failure — the member is already
 * counted, and the guest row is the duplicate. The caller treats it as the signal
 * to merge by deleting the guest row.
 *
 * The constraint name is checked as well as the SQLSTATE, so an unrelated unique
 * violation (the self check-in guest-name index, say) is reported as an error
 * rather than silently deleting somebody's attendance.
 *
 * @param {{ code?: string, message?: string, details?: string } | null | undefined} error
 * @returns {boolean}
 */
export function isDuplicateMemberConflict(error) {
  if (!error || error.code !== UNIQUE_VIOLATION) return false

  const text = `${error.message || ''} ${error.details || ''}`
  return text.includes(MEMBER_UNIQUE_CONSTRAINT)
}

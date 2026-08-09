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

/** Postgres `insufficient_privilege` — also what an RLS WITH CHECK failure raises. */
const INSUFFICIENT_PRIVILEGE = '42501'

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

/**
 * Was the link rejected by the policy's WITH CHECK clause?
 *
 * The two halves of attendance_update_link_guest fail in two DIFFERENT ways, and
 * this is easy to get wrong — it was, until the isolation matrix was actually run
 * against staging:
 *
 *   USING      filters. A row it excludes is simply not visible to the UPDATE, so
 *              PostgREST returns success with zero rows and interpretMutation is
 *              what catches it.
 *   WITH CHECK raises. A row that would violate it aborts the statement with
 *              42501 'new row violates row-level security policy'.
 *
 * So the second case never reaches interpretMutation's blocked-message path, and
 * without this the raw Postgres text would be shown to a volunteer. That is the
 * class of leak docs/SECURITY.md §3.5 objects to.
 *
 * @param {{ code?: string, message?: string } | null | undefined} error
 * @returns {boolean}
 */
export function isPolicyViolation(error) {
  if (!error) return false
  if (/row-level security policy/i.test(error.message || '')) return true

  // Fall back to the SQLSTATE only when there is no message to read; 42501 also
  // covers a plain missing grant, which this call site cannot produce because its
  // payload is fixed to the three granted columns.
  return !error.message && error.code === INSUFFICIENT_PRIVILEGE
}

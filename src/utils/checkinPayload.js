/**
 * Public check-in input handling.
 *
 * Every rule here is duplicated in the database, by design. `submit_checkin`
 * sanitises and length-caps its own arguments and the CHECK constraints reject
 * anything malformed — this layer exists so a person gets a sentence instead of
 * a raw Postgres error, which would otherwise leak constraint names and column
 * types to an unauthenticated caller (docs/SECURITY.md §3.5).
 *
 * Nothing here is a security control. The browser is not trusted.
 */

/** Mirrors churches_checkin_token_shape. */
const TOKEN_PATTERN = /^[0-9a-f]{32}$/

/**
 * Mirrors attendance_guest_contact_shape: 7–32 chars, digits/+/spaces/()/-.
 * '(' is allowed to lead because Philippine landlines are routinely written with
 * a parenthesised area code, e.g. (02) 8123-4567. This bounds the field; it does
 * not validate PH numbering plans.
 */
const CONTACT_PATTERN = /^[0-9+(][0-9 ()+-]{6,31}$/

/** Mirrors attendance_guest_name_shape. */
export const NAME_MIN_LENGTH = 2
export const NAME_MAX_LENGTH = 80

/**
 * Read the check-in token from a URL fragment such as `#t=<32 hex chars>`.
 *
 * The token lives in the fragment rather than the path deliberately: fragments
 * are never sent to the server, so the token stays out of Netlify access logs,
 * out of any Referer header, and out of the browser history entry that gets
 * shared. See docs/decisions/0007-public-checkin-endpoint.md.
 *
 * @param {string} hash - typically `window.location.hash`
 * @returns {string} the token, or '' when absent or malformed
 */
export function readCheckinToken(hash) {
  const raw = String(hash ?? '')
  const query = raw.startsWith('#') ? raw.slice(1) : raw
  if (!query) return ''

  let value = ''
  try {
    value = new URLSearchParams(query).get('t') || ''
  } catch {
    return ''
  }

  const token = value.trim().toLowerCase()
  return TOKEN_PATTERN.test(token) ? token : ''
}

/**
 * Collapse a typed name to the form the database will store.
 *
 * Order matters and matches `submit_checkin` step 5: strip control characters,
 * collapse runs of whitespace, trim, cap, then trim again — because slicing at
 * 80 can sever mid-space and attendance_guest_name_shape requires an
 * already-trimmed value.
 */
export function sanitizeCheckinName(input) {
  const collapsed = String(input ?? '')
    // A SPACE, not '' — see normalizeName in attendanceWindow.js and step 5 of
    // submit_checkin. \p{Cc} covers tab and newline; deleting them would join
    // words that the database would have kept apart.
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return collapsed.slice(0, NAME_MAX_LENGTH).trim()
}

/** @returns {string} error message, or '' when valid */
export function validateCheckinName(input) {
  const name = sanitizeCheckinName(input)
  if (name.length === 0) return 'Enter your name.'
  if (name.length < NAME_MIN_LENGTH) return 'That name is too short.'
  return ''
}

/**
 * Normalise an optional contact number.
 *
 * Returns '' for blank input — the field is optional, and a guest declining to
 * give a number is an ordinary outcome, not an error.
 */
export function sanitizeCheckinContact(input) {
  return String(input ?? '')
    // A SPACE, not '' — see normalizeName in attendanceWindow.js and step 5 of
    // submit_checkin. \p{Cc} covers tab and newline; deleting them would join
    // words that the database would have kept apart.
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** @returns {string} error message, or '' when valid or empty */
export function validateCheckinContact(input) {
  const contact = sanitizeCheckinContact(input)
  if (contact.length === 0) return ''
  if (!CONTACT_PATTERN.test(contact)) {
    return 'Enter a valid contact number, or leave it blank.'
  }
  return ''
}

/**
 * Arguments for the `submit_checkin` RPC.
 *
 * `p_contact` is sent as null rather than '' when blank: the column is nullable
 * and attendance_guest_contact_shape would reject an empty string.
 */
export function buildCheckinArgs(token, form) {
  const contact = sanitizeCheckinContact(form?.contact)
  return {
    p_token: String(token ?? ''),
    p_name: sanitizeCheckinName(form?.name),
    p_contact: contact.length > 0 ? contact : null,
  }
}

/**
 * Interpret the RPC's reply.
 *
 * The function returns 'recorded' or 'closed' and nothing else — never whether a
 * member matched, and never whether this person had already checked in.
 * Distinguishing those would turn the endpoint into an oracle for "is X a member
 * of this church" and "is X here today", answerable by anyone holding a token
 * that is printed on a wall. Do not add cases here hoping for a friendlier
 * message; the reply genuinely carries no more information than this.
 *
 * @returns {{ ok: boolean, message: string }}
 */
export function interpretCheckin(status) {
  if (status === 'recorded') {
    return { ok: true, message: "You're checked in. Thank you!" }
  }
  return {
    ok: false,
    message: 'Check-in is not open right now. Please ask a volunteer for help.',
  }
}

/**
 * Payload for a staff-recorded attendance row.
 *
 * `source` and `recorded_by` are absent deliberately — neither column is in the
 * INSERT grant. The database defaults `source` to 'staff' and a trigger derives
 * `recorded_by` from auth.uid(). Adding them here produces a 42501, and that is
 * the intended behaviour: the column grant is what makes provenance unforgeable.
 */
export function buildStaffAttendancePayload({ serviceId, churchId, memberId, guestName, guestContact }) {
  const base = { service_id: serviceId, church_id: churchId }

  if (memberId) {
    return { ...base, member_id: memberId, guest_name: null, guest_contact: null }
  }

  const contact = sanitizeCheckinContact(guestContact)
  return {
    ...base,
    member_id: null,
    guest_name: sanitizeCheckinName(guestName),
    guest_contact: contact.length > 0 ? contact : null,
  }
}

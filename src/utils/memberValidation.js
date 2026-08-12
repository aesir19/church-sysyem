// What the member form refuses to send.
//
// OUT HERE RATHER THAN IN THE DIALOG, for two reasons. It is the load-bearing
// half of that component — everything else is layout — and it is the half a
// test can reach: the dialog renders through Reka's DialogPortal, whose content
// is teleported and therefore never appears in `renderToString` output. A rule
// that only exists inside the SFC is a rule nothing can assert.
//
// THE RULE SET IS THE FIVE NOT NULL COLUMNS ON `members`, and nothing else.
// Postgres refuses these writes anyway; this exists so the refusal is a
// sentence beside the field instead of a constraint name in a toast. It is
// deliberately NOT a second opinion about what a good record looks like —
// the mockup draws "a mobile number is required" and "the address is too short
// to be useful for visitation", which are that church's policies rather than
// this app's, and adopting them during a redesign would start rejecting
// records that save perfectly well today.
//
// Validation is not a security control. RLS decides what may be written; this
// decides what is worth sending.

/** The five required fields, in the order the form lays them out. */
export const REQUIRED_FIELDS = Object.freeze([
  'last_name',
  'first_name',
  'birthdate',
  'gender',
  'marital_status'
])

/** Which tab each rule's field lives on, so a summary can point at the right one. */
export const FIELD_TAB = Object.freeze({
  last_name: 'personal',
  first_name: 'personal',
  birthdate: 'personal',
  gender: 'personal',
  marital_status: 'personal'
})

const asText = (value) => (typeof value === 'string' ? value : value == null ? '' : String(value))

/**
 * @param {object} form the member form state
 * @param {{ today?: string }} [options] today as YYYY-MM-DD; injected so the
 *   future-birthdate rule is testable without freezing the clock
 * @returns {Record<string, string>} field name → message, empty when valid
 */
export function validateMemberForm (form, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const f = form || {}
  const errors = {}

  if (!asText(f.last_name).trim()) errors.last_name = 'A last name is required.'
  if (!asText(f.first_name).trim()) errors.first_name = 'A first name is required.'

  const birthdate = asText(f.birthdate)
  if (!birthdate) errors.birthdate = 'A birthdate is required.'
  // String comparison is safe and correct for ISO dates, and avoids a Date
  // round-trip that would drag the browser's timezone into a calendar answer —
  // `new Date('2026-08-12')` is UTC midnight, which is still 11 August in
  // Manila for eight hours of every day.
  else if (birthdate > today) errors.birthdate = 'A birthdate cannot be in the future.'

  if (!asText(f.gender)) errors.gender = 'Choose a gender.'
  if (!asText(f.marital_status)) errors.marital_status = 'Choose a marital status.'

  return errors
}

/** How many unresolved fields sit on a given tab. */
export function errorsOnTab (errors, tab) {
  return Object.keys(errors || {}).filter(field => FIELD_TAB[field] === tab).length
}

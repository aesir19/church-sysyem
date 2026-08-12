// The discipleship journey.
//
// FOUR STEPS, AND THEY ARE NOT GATES. The owner's rule: "each step is not a
// hard entry into the other step" — baptism in particular can happen at any
// point. The order below is the intended path and nothing more. Every step is
// independently completable, no UI anywhere disables a later step because an
// earlier one is open, and progress is a COUNT rather than a furthest-reached
// position.
//
// That distinction is load-bearing. A "furthest step" model would render a
// member who was baptized before their one-to-one as further along than they
// are, and would quietly re-introduce ordering the moment someone wrote
// `steps.slice(0, progress)`. The staging fixture deliberately contains dozens
// of out-of-order members so this cannot regress unnoticed.
//
// COLUMN NAMES. `has_submitted_membership_form` is the fourth step. The column
// predates the redesign and is misnamed for what it now represents — the owner
// calls this milestone Membership Certification — so the label lives here and
// the column keeps its name until a migration that is not tangled up in a
// redesign can rename it.

export const JOURNEY_STEPS = Object.freeze([
  { key: 'is_one_to_one_completed', label: 'One-to-one', short: 'One-to-one' },
  { key: 'is_turning_point_completed', label: 'Turning Point', short: 'Turning Pt' },
  { key: 'is_baptized', label: 'Baptism', short: 'Baptism' },
  { key: 'has_submitted_membership_form', label: 'Membership Certification', short: 'Certified' }
])

export const JOURNEY_TOTAL = JOURNEY_STEPS.length

/** Which steps a member has completed, in display order. */
export function journeySteps (member) {
  return JOURNEY_STEPS.map(step => ({ ...step, done: !!member?.[step.key] }))
}

/** How many of the four are done. Order-independent, by design. */
export function journeyProgress (member) {
  if (!member) return 0
  return JOURNEY_STEPS.reduce((n, step) => n + (member[step.key] ? 1 : 0), 0)
}

/**
 * The label beside the track: "Not started", "2/4", or "Complete".
 *
 * The mockups show exactly these three forms. "Complete" rather than "4/4"
 * because the end of the journey deserves a word, not an arithmetic identity.
 */
export function journeyLabel (member) {
  const done = journeyProgress(member)
  if (done === 0) return 'Not started'
  if (done === JOURNEY_TOTAL) return 'Complete'
  return `${done}/${JOURNEY_TOTAL}`
}

/** Drives the track's colour: magenta at zero, cyan in progress, green done. */
export function journeyTone (member) {
  const done = journeyProgress(member)
  if (done === 0) return 'none'
  if (done === JOURNEY_TOTAL) return 'complete'
  return 'partial'
}

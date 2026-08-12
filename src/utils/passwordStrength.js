// The four-bar meter under the new-password field.
//
// WHAT THIS IS NOT. It is not the rule that decides whether a password is
// accepted — that is validateNewPassword in utils/authValidation.js, and it
// stays where it is. Raising the enforced minimum is a policy decision for the
// owner, not something to slip in under a repaint, so this advises and refuses
// nothing. The meter can read "Weak" on a password the form will happily save.
//
// It is also not an entropy estimate. A real one needs a dictionary and a
// keyboard-adjacency model, and shipping a wrong number dressed as a
// measurement is worse than shipping an honest heuristic: somebody reading
// "Strong" believes it.
//
// So it scores the things the mockup's own caption names — length, mixed case,
// a number, a symbol — and says which of them are missing. Advice you can act
// on beats a score you cannot.

/** Where the meter stops nagging. The mockup's caption says twelve. */
export const RECOMMENDED_LENGTH = 12

/** @typedef {{ score: number, label: string, hint: string }} PasswordStrength */

const LABELS = ['', 'Weak', 'Fair', 'Good', 'Strong']

/**
 * @param {string} password
 * @returns {PasswordStrength} score 0–4 (bars lit), a label, and what to add
 */
export function passwordStrength (password) {
  const value = String(password ?? '')
  if (!value) return { score: 0, label: '', hint: '' }

  const hasLower = /[a-z]/.test(value)
  const hasUpper = /[A-Z]/.test(value)
  const hasNumber = /\d/.test(value)
  const hasSymbol = /[^A-Za-z0-9]/.test(value)
  const longEnough = value.length >= RECOMMENDED_LENGTH

  // Length is worth two of the four points. A twenty-character passphrase of
  // lowercase words beats "Aa1!x" by every measure that matters, and a meter
  // that rewards decoration over length teaches the opposite.
  let score = 0
  if (value.length >= 8) score += 1
  if (longEnough) score += 1
  if (hasLower && hasUpper) score += 1
  if (hasNumber || hasSymbol) score += 1

  // Nothing reaches the top bar while it is still short, whatever else it has.
  if (!longEnough) score = Math.min(score, 3)

  const missing = []
  if (!longEnough) missing.push(`${RECOMMENDED_LENGTH} characters or more`)
  if (!(hasLower && hasUpper)) missing.push('mixed case')
  if (!hasNumber && !hasSymbol) missing.push('a number or symbol')

  return {
    score,
    label: LABELS[score] || 'Weak',
    hint: missing.length ? `Add ${missing.join(', ')}` : 'Long, mixed case, and not just letters'
  }
}

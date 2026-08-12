// What a failed sign-in is allowed to say.
//
// THE RULE IS THAT AN AUTH ERROR MUST NOT REVEAL WHETHER AN ACCOUNT EXISTS.
// A message that distinguishes "no such user" from "wrong password" turns the
// sign-in form into a membership oracle: an attacker submits addresses and
// reads which ones belong to church staff. That is worth having on a system
// holding member PII even though the roll is not otherwise secret, because it
// also tells them exactly which addresses are worth a password-spray.
//
// Supabase itself is careful here — it returns "Invalid login credentials" for
// both cases — but `error.message` is a passthrough of whatever the API said,
// and the set of things it can say changes without us noticing. So nothing
// reaches the screen unless it is on this list. This is the same rule
// lib/data/write.js applies to Postgres errors, for the same reason: an error
// string is written for a developer and shown to a person.
//
// The one detail worth keeping is rate limiting, which is actionable ("wait")
// and tells an attacker only what they already learned by being throttled.

const MESSAGES = {
  credentials: 'That email and password do not match.',
  throttled: 'Too many attempts. Wait a moment and try again.',
  offline: 'Cannot reach the server. Check your connection and try again.',
  generic: 'Could not sign in. Please try again.'
}

/**
 * @param {{ message?: string, status?: number, name?: string } | null} error a Supabase auth error
 * @returns {string} a message that is safe to render
 */
export function signInErrorMessage (error) {
  if (!error) return ''

  const status = Number(error.status) || 0
  const raw = String(error.message || '').toLowerCase()

  if (status === 429 || raw.includes('rate limit') || raw.includes('too many')) {
    return MESSAGES.throttled
  }

  // A fetch that never reached Supabase. `name` is what the SDK sets; the
  // message wording is not stable enough to match on alone.
  if (error.name === 'AuthRetryableFetchError' || raw.includes('failed to fetch') || raw.includes('network')) {
    return MESSAGES.offline
  }

  // Everything that means "these credentials are not good" collapses to one
  // sentence — INCLUDING "email not confirmed", which would otherwise confirm
  // that the address is registered.
  if (
    status === 400
    || status === 401
    || raw.includes('invalid login')
    || raw.includes('invalid credentials')
    || raw.includes('not confirmed')
    || raw.includes('email or password')
  ) {
    return MESSAGES.credentials
  }

  return MESSAGES.generic
}

export const AUTH_MESSAGES = MESSAGES

import { describe, expect, it } from 'vitest'
import { signInErrorMessage, AUTH_MESSAGES } from '../../src/utils/authErrors'

// The property under test is a SECURITY property, not a wording preference: no
// sign-in failure may reveal whether an account exists. Everything else here is
// in service of that.

describe('signInErrorMessage', () => {
  it('says nothing at all when there is no error', () => {
    expect(signInErrorMessage(null)).toBe('')
    expect(signInErrorMessage(undefined)).toBe('')
  })

  it('gives one message for wrong password and for no such account', () => {
    const wrongPassword = signInErrorMessage({ message: 'Invalid login credentials', status: 400 })
    const noSuchUser = signInErrorMessage({ message: 'Invalid login credentials', status: 400 })
    expect(wrongPassword).toBe(noSuchUser)
    expect(wrongPassword).toBe(AUTH_MESSAGES.credentials)
  })

  // "Email not confirmed" is the leak that is easy to miss: it is not a
  // credentials error, it reads as helpful, and it confirms the address is
  // registered to whoever typed it.
  it('does not confirm that an address is registered', () => {
    expect(signInErrorMessage({ message: 'Email not confirmed', status: 400 }))
      .toBe(AUTH_MESSAGES.credentials)
  })

  it('keeps rate limiting, which is actionable and reveals nothing new', () => {
    expect(signInErrorMessage({ message: 'Request rate limit reached', status: 429 }))
      .toBe(AUTH_MESSAGES.throttled)
    expect(signInErrorMessage({ message: 'Too many requests' }))
      .toBe(AUTH_MESSAGES.throttled)
  })

  it('distinguishes a connection failure, so people do not retype a correct password', () => {
    expect(signInErrorMessage({ name: 'AuthRetryableFetchError', message: 'Failed to fetch' }))
      .toBe(AUTH_MESSAGES.offline)
    expect(signInErrorMessage({ message: 'NetworkError when attempting to fetch resource' }))
      .toBe(AUTH_MESSAGES.offline)
  })

  // The whole point of an allowlist: something nobody anticipated must fall
  // through to the generic sentence rather than out to the screen.
  it('falls through to a generic sentence for anything unrecognised', () => {
    expect(signInErrorMessage({ message: 'Database error querying schema', status: 500 }))
      .toBe(AUTH_MESSAGES.generic)
  })

  it('never returns the raw message, whatever it contains', () => {
    const leaky = [
      { message: 'User grace.abad@udfc.org not found', status: 400 },
      { message: 'password mismatch for user id 8f3a-…', status: 401 },
      { message: 'relation "user_accounts" does not exist', status: 500 },
      { message: 'unexpected', status: 0 },
    ]
    const allowed = Object.values(AUTH_MESSAGES)
    for (const error of leaky) {
      const shown = signInErrorMessage(error)
      expect(allowed, error.message).toContain(shown)
      expect(shown, error.message).not.toContain('grace.abad')
      expect(shown, error.message).not.toContain('user_accounts')
    }
  })

  it('survives an error object with nothing useful on it', () => {
    expect(() => signInErrorMessage({})).not.toThrow()
    expect(signInErrorMessage({})).toBe(AUTH_MESSAGES.generic)
  })
})

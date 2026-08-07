import { describe, it, expect } from 'vitest'
import {
  isDatabaseError,
  redactPii,
  stripUrlParams,
  scrubEvent,
  scrubBreadcrumb,
} from '../../src/utils/sentryScrub'

describe('isDatabaseError', () => {
  it('recognises a unique violation carrying member names', () => {
    expect(isDatabaseError(
      'duplicate key value violates unique constraint "members_name_key"'
    )).toBe(true)
  })

  it('recognises the Key (...)=(...) construct that quotes row values', () => {
    expect(isDatabaseError('Key (first_name, last_name)=(Juan, Dela Cruz) already exists.')).toBe(true)
  })

  it('recognises RLS rejections and permission errors', () => {
    expect(isDatabaseError('new row violates row-level security policy for table "members"')).toBe(true)
    expect(isDatabaseError('permission denied for table members')).toBe(true)
  })

  it('recognises PostgREST error codes', () => {
    expect(isDatabaseError('PGRST116: JSON object requested, multiple rows returned')).toBe(true)
  })

  it('leaves ordinary JavaScript errors alone', () => {
    expect(isDatabaseError("Cannot read properties of undefined (reading 'first_name')")).toBe(false)
    expect(isDatabaseError('myUndefinedFunction is not defined')).toBe(false)
  })

  it('tolerates non-string input', () => {
    expect(isDatabaseError(null)).toBe(false)
    expect(isDatabaseError(undefined)).toBe(false)
    expect(isDatabaseError({ message: 'violates unique constraint ' })).toBe(false)
  })
})

describe('redactPii', () => {
  it('redacts email addresses', () => {
    expect(redactPii('failed for juan.delacruz@example.com')).toBe('failed for [email]')
  })

  it('redacts birthdates in both formats the codebase produces', () => {
    expect(redactPii('birthdate 1990-01-15 invalid')).toBe('birthdate [date] invalid')
    expect(redactPii('birthdate 01/15/1990 invalid')).toBe('birthdate [date] invalid')
  })

  it('redacts Philippine mobile numbers, spaced or not', () => {
    expect(redactPii('contact 09171234567')).toBe('contact [phone]')
    expect(redactPii('contact +63 917 123 4567')).toBe('contact [phone]')
  })

  it('redacts UUIDs before the digit rule can mangle them', () => {
    expect(redactPii('member f83e7825-713b-4ced-9f9f-9079d425dee2 missing'))
      .toBe('member [uuid] missing')
  })

  it('redacts long digit runs', () => {
    expect(redactPii('amount 1234567 rejected')).toBe('amount [number] rejected')
  })

  it('leaves short numbers and ordinary text intact, so real errors stay readable', () => {
    expect(redactPii("Cannot read properties of undefined (reading 'id')"))
      .toBe("Cannot read properties of undefined (reading 'id')")
    expect(redactPii('retry 3 of 5')).toBe('retry 3 of 5')
  })

  it('tolerates non-string input', () => {
    expect(redactPii(null)).toBe(null)
    expect(redactPii(42)).toBe(42)
  })
})

describe('stripUrlParams', () => {
  it('drops a PostgREST filter query string', () => {
    expect(stripUrlParams('https://x.supabase.co/rest/v1/members?first_name=eq.Juan'))
      .toBe('https://x.supabase.co/rest/v1/members')
  })

  it('drops a hash fragment, which carries the check-in token', () => {
    expect(stripUrlParams('https://app.example.com/checkin#t=secret'))
      .toBe('https://app.example.com/checkin')
  })

  it('leaves a bare path unchanged', () => {
    expect(stripUrlParams('/dashboard/members')).toBe('/dashboard/members')
  })

  it('tolerates non-string input', () => {
    expect(stripUrlParams(undefined)).toBe(undefined)
  })
})

describe('scrubEvent', () => {
  it('drops an event whose exception is a database error', () => {
    const event = {
      exception: {
        values: [{ value: 'Key (first_name, last_name)=(Juan, Dela Cruz) already exists.' }],
      },
    }
    expect(scrubEvent(event)).toBe(null)
  })

  it('drops an event whose top-level message is a database error', () => {
    expect(scrubEvent({ message: 'permission denied for table members' })).toBe(null)
  })

  it('redacts PII inside an ordinary exception rather than dropping it', () => {
    const event = {
      exception: { values: [{ value: 'lookup failed for juan@example.com' }] },
    }
    const result = scrubEvent(event)
    expect(result).not.toBe(null)
    expect(result.exception.values[0].value).toBe('lookup failed for [email]')
  })

  it('strips the query string from the request URL', () => {
    const result = scrubEvent({ request: { url: 'https://app.example.com/dashboard?q=Juan' } })
    expect(result.request.url).toBe('https://app.example.com/dashboard')
  })

  it('removes user identity even if the SDK attached it', () => {
    const result = scrubEvent({ user: { id: 'abc', ip_address: '1.2.3.4' } })
    expect(result.user).toBe(undefined)
  })

  it('tolerates a minimal or empty event', () => {
    expect(scrubEvent({})).toEqual({})
    expect(scrubEvent(null)).toBe(null)
  })
})

describe('scrubBreadcrumb', () => {
  it('drops console breadcrumbs entirely, since their args can be member objects', () => {
    expect(scrubBreadcrumb({ category: 'console', message: 'anything' })).toBe(null)
  })

  it('strips the query string from fetch breadcrumbs', () => {
    const result = scrubBreadcrumb({
      category: 'fetch',
      data: { url: 'https://x.supabase.co/rest/v1/members?select=first_name&id=eq.1' },
    })
    expect(result.data.url).toBe('https://x.supabase.co/rest/v1/members')
  })

  it('strips the check-in token from navigation breadcrumbs (ADR-0007)', () => {
    // The default history breadcrumb uses to/from, not url, and builds them
    // from path + query + fragment — so the fragment token rides along unless
    // these fields are scrubbed too.
    const result = scrubBreadcrumb({
      category: 'navigation',
      data: { from: '/login', to: '/checkin#t=zEK3s9QpLm2x' },
    })
    expect(result.data.to).toBe('/checkin')
    expect(result.data.from).toBe('/login')
  })

  it('strips query strings from navigation breadcrumb to/from', () => {
    const result = scrubBreadcrumb({
      category: 'navigation',
      data: { from: '/dashboard/members?q=Juan', to: '/dashboard/attendance?id=7' },
    })
    expect(result.data.from).toBe('/dashboard/members')
    expect(result.data.to).toBe('/dashboard/attendance')
  })

  it('redacts PII in a breadcrumb message', () => {
    const result = scrubBreadcrumb({ category: 'navigation', message: 'went to juan@example.com' })
    expect(result.message).toBe('went to [email]')
  })

  it('tolerates a breadcrumb with no data or message', () => {
    expect(scrubBreadcrumb({ category: 'navigation' })).toEqual({ category: 'navigation' })
    expect(scrubBreadcrumb(null)).toBe(null)
  })
})

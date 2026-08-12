// Rendering `facebook_link` as a link turns a documented-safe plain-text field
// into an active sink: a clickable <a> inside a staff dashboard, built from a
// member-editable column. These are the four conditions it ships under,
// expressed as tests.
//
// The one that matters most is condition 1 — VALIDATED AT RENDER, not just on
// write. Write-time validation only ever protects rows written after it lands.
// Render-time validation covers what is already in that column today, which
// nobody has audited.

import { describe, expect, it } from 'vitest'
import { FACEBOOK_HOSTS, safeFacebookUrl } from '../../src/utils/memberLink'

describe('safeFacebookUrl — what it lets through', () => {
  it('accepts the allowlisted hosts over https', () => {
    for (const host of FACEBOOK_HOSTS) {
      expect(safeFacebookUrl(`https://${host}/juan.delacruz`)).toBe(
        `https://${host}/juan.delacruz`,
      )
    }
  })

  it('accepts a www. prefix, which is what people actually paste', () => {
    expect(safeFacebookUrl('https://www.facebook.com/juan')).toBe('https://www.facebook.com/juan')
  })

  it('keeps the path, query and fragment — profile links carry ids in all three', () => {
    expect(safeFacebookUrl('https://facebook.com/profile.php?id=100001#about')).toBe(
      'https://facebook.com/profile.php?id=100001#about',
    )
  })

  it('normalises case, so a shouted host is still the same host', () => {
    expect(safeFacebookUrl('HTTPS://FaceBook.COM/juan')).toBe('https://facebook.com/juan')
  })

  it('tolerates surrounding whitespace from a paste', () => {
    expect(safeFacebookUrl('  https://fb.com/juan \n')).toBe('https://fb.com/juan')
  })
})

describe('safeFacebookUrl — what it refuses', () => {
  it('refuses anything that is not https, including http', () => {
    expect(safeFacebookUrl('http://facebook.com/juan')).toBe(null)
  })

  // The reason the scheme check is an allowlist and not a `!== 'javascript:'`
  // denylist: there is always another scheme.
  it('refuses script and data schemes outright', () => {
    expect(safeFacebookUrl('javascript:alert(1)')).toBe(null)
    expect(safeFacebookUrl('JaVaScRiPt:alert(1)')).toBe(null)
    expect(safeFacebookUrl('data:text/html,<script>alert(1)</script>')).toBe(null)
    expect(safeFacebookUrl('vbscript:msgbox(1)')).toBe(null)
  })

  // The whole point of the allowlist. The field is NAMED facebook_link; a
  // member-editable field accepting arbitrary URLs and rendered as a clickable
  // link inside a staff dashboard is a phishing pivot.
  it('refuses a host that merely contains an allowlisted one', () => {
    expect(safeFacebookUrl('https://facebook.com.evil.example/juan')).toBe(null)
    expect(safeFacebookUrl('https://evilfacebook.com/juan')).toBe(null)
    expect(safeFacebookUrl('https://notfb.com/juan')).toBe(null)
  })

  it('refuses an unlisted subdomain', () => {
    expect(safeFacebookUrl('https://evil.facebook.com.attacker.test/juan')).toBe(null)
  })

  // https://facebook.com@evil.example/ reads as Facebook to a human and
  // resolves to evil.example in a browser. The URL parser is what separates
  // them; a string prefix check is not.
  it('refuses a userinfo-disguised host', () => {
    expect(safeFacebookUrl('https://facebook.com@evil.example/juan')).toBe(null)
    expect(safeFacebookUrl('https://www.facebook.com:pass@evil.example/')).toBe(null)
  })

  // A Cyrillic 'о' in "faceboоk" is a different codepoint. The parser
  // punycodes it, so it can never equal the ASCII host.
  it('refuses a homograph host', () => {
    expect(safeFacebookUrl('https://faceboоk.com/juan')).toBe(null)
  })

  it('refuses a relative or protocol-relative link, which has no host to check', () => {
    expect(safeFacebookUrl('//facebook.com/juan')).toBe(null)
    expect(safeFacebookUrl('/juan')).toBe(null)
    expect(safeFacebookUrl('facebook.com/juan')).toBe(null)
  })

  it('refuses empty, missing and non-string values without throwing', () => {
    expect(safeFacebookUrl('')).toBe(null)
    expect(safeFacebookUrl('   ')).toBe(null)
    expect(safeFacebookUrl(null)).toBe(null)
    expect(safeFacebookUrl(undefined)).toBe(null)
    expect(safeFacebookUrl(42)).toBe(null)
    expect(safeFacebookUrl({})).toBe(null)
  })

  it('refuses unparseable junk rather than throwing', () => {
    expect(safeFacebookUrl('https://')).toBe(null)
    expect(safeFacebookUrl('https://[')).toBe(null)
    expect(safeFacebookUrl('not a url at all')).toBe(null)
  })
})

describe('FACEBOOK_HOSTS', () => {
  it('is exactly the three allowed hosts, and is frozen', () => {
    expect([...FACEBOOK_HOSTS].sort()).toEqual(['facebook.com', 'fb.com', 'm.facebook.com'])
    expect(Object.isFrozen(FACEBOOK_HOSTS)).toBe(true)
  })
})

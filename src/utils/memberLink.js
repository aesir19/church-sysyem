/**
 * Whether a member's `facebook_link` may be rendered as a link.
 *
 * The default recommendation was to add no link behaviour at all. The owner
 * asked for it, and it ships under four conditions. This module is 1 and 2 —
 * https only, host-allowlisted. The view carries 3 (`target="_blank"` +
 * `rel="noopener noreferrer"`) and 4 (anything refused renders as plain text,
 * never as a broken or stripped link).
 *
 * WHY VALIDATION AT RENDER AND NOT ONLY AT WRITE. Write-time validation only
 * ever protects rows written after it lands. Nobody has audited what is in that
 * column today — it has accepted arbitrary text since the column existed — so
 * render-time validation is the half that actually protects. Write-time
 * validation goes in too, but it only ever buys a better error message.
 *
 * WHY AN ALLOWLIST AND NOT A `javascript:` CHECK. The field is NAMED
 * facebook_link. A member-editable field accepting arbitrary URLs and rendered
 * as a clickable link inside a staff dashboard is a phishing pivot, and
 * requiring it to be what it claims costs nothing. A denylist of bad schemes is
 * a list you have to keep adding to; an allowlist of two schemes and three
 * hosts is a list that is already complete.
 */

/** The only hosts accepted. A `www.` prefix on any of them is fine. */
export const FACEBOOK_HOSTS = Object.freeze(['facebook.com', 'fb.com', 'm.facebook.com'])

/**
 * The href to render, or null if the value must stay plain text.
 *
 * Returns the PARSED url's href rather than the input: parsing normalises the
 * scheme and host to lowercase and percent-encodes what needs it, so the string
 * that reaches the `href` attribute is the same string that was validated.
 * Handing back the raw input would leave a gap between the two.
 *
 * @param {unknown} raw the `facebook_link` column value, unaudited
 * @returns {string|null}
 */
export function safeFacebookUrl(raw) {
  if (typeof raw !== 'string') return null

  const trimmed = raw.trim()
  if (!trimmed) return null

  let url
  try {
    // No base argument on purpose. Without one a relative or protocol-relative
    // value throws instead of silently resolving against the dashboard's own
    // origin, which is how `/juan` would otherwise become a same-origin link.
    url = new URL(trimmed)
  } catch {
    return null
  }

  if (url.protocol !== 'https:') return null

  // A URL carrying credentials is refused rather than having them stripped.
  // `https://facebook.com@evil.example/` reads as Facebook to a human and
  // resolves to evil.example in a browser; the host check below already catches
  // it, and this makes the refusal explicit rather than incidental.
  if (url.username || url.password) return null

  // Exact match after one optional `www.`, never `endsWith` — `endsWith` would
  // accept `facebook.com.evil.example`, which is the entire attack.
  const host = url.hostname.replace(/^www\./, '')
  if (!FACEBOOK_HOSTS.includes(host)) return null

  return url.href
}

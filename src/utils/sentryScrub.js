// Redaction policy for Sentry payloads, kept as pure functions so it can be
// tested without initialising the SDK or mounting a view.
//
// This is the precondition ADR-0006 set on adopting Sentry at all: member PII
// (names, birthdates, addresses, contact details) must not leave the Supabase
// account inside an error payload. See ADR-0008 for the full reasoning.

// Postgres and PostgREST error text is the one class that reliably carries
// member data, because constraint violations quote the offending row values
// verbatim — `Key (first_name, last_name)=(Juan, Dela Cruz) already exists`.
//
// Events matching these are dropped whole rather than redacted. Rewriting the
// message would be a blocklist, and a blocklist fails open on the message
// formats we have not seen; ADR-0006 already designates `public.client_errors`
// as the sink for database failures, so nothing is lost by not sending them here.
const DATABASE_ERROR_SIGNATURES = [
  /\bviolates (unique|foreign key|check|not-null|row-level security) /i,
  /\bduplicate key value\b/i,
  /\bKey \([^)]*\)=\(/i,
  /\bpermission denied for\b/i,
  /\bnew row for relation\b/i,
  /\brow-level security policy\b/i,
  /\bPGRST\d{3}\b/,
]

// Defence in depth for everything that is not a recognised database error.
// Order matters: the broad digit-run rule at the end would otherwise chew
// through the more specific patterns before they get a chance to match.
const PII_PATTERNS = [
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]'],
  // Birthdates are PII under this app's threat model, in both formats the
  // codebase currently produces (DEFECTS.md D14).
  [/\b\d{4}-\d{2}-\d{2}\b/g, '[date]'],
  [/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, '[date]'],
  [/(?:\+?63|\b0)[\s-]?9\d{2}[\s-]?\d{3}[\s-]?\d{4}\b/g, '[phone]'],
  // A UUID identifies a specific member row. Must run before the digit rule,
  // which would otherwise mangle the hex segments into something unmatchable.
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[uuid]'],
  [/\b\d{5,}\b/g, '[number]'],
]

export function isDatabaseError(text) {
  if (typeof text !== 'string') return false
  return DATABASE_ERROR_SIGNATURES.some((pattern) => pattern.test(text))
}

export function redactPii(text) {
  if (typeof text !== 'string') return text
  return PII_PATTERNS.reduce(
    (acc, [pattern, replacement]) => acc.replace(pattern, replacement),
    text
  )
}

// Deliberately string slicing rather than `new URL()`, which throws on the
// relative URLs that show up in breadcrumbs.
export function stripUrlParams(url) {
  if (typeof url !== 'string') return url
  const cut = url.search(/[?#]/)
  return cut === -1 ? url : url.slice(0, cut)
}

// `beforeSend`. Returning null drops the event entirely.
export function scrubEvent(event) {
  if (!event) return event

  const exceptionValues = event.exception?.values ?? []
  const candidates = [event.message, ...exceptionValues.map((entry) => entry?.value)]
  if (candidates.some(isDatabaseError)) return null

  if (typeof event.message === 'string') {
    event.message = redactPii(event.message)
  }
  for (const entry of exceptionValues) {
    if (entry && typeof entry.value === 'string') {
      entry.value = redactPii(entry.value)
    }
  }
  // PostgREST puts row filters in the query string (`?first_name=eq.Juan`), so
  // the path is the only part of a URL safe to keep.
  if (event.request?.url) {
    event.request.url = stripUrlParams(event.request.url)
  }
  // `dataCollection.userInfo: false` already suppresses this. Deleting it here
  // too means a future change to that option cannot silently reintroduce it.
  delete event.user

  return event
}

// Every breadcrumb field that can hold a URL. `url` covers fetch/xhr; `to` and
// `from` are what the default history breadcrumb uses for navigation, and they
// are built from `path + query + fragment` — fragment included.
//
// That last part is load-bearing. ADR-0007 puts the check-in token in the URL
// *fragment* (`/checkin#t=<token>`) precisely because fragments are never sent
// to a server, so the token "never appears in a server-side error report".
// A navigation breadcrumb would have carried it to Sentry anyway, which is
// exactly the channel that record assumed did not exist.
const URL_BEARING_BREADCRUMB_FIELDS = ['url', 'to', 'from']

// `beforeBreadcrumb`. Returning null drops the breadcrumb.
export function scrubBreadcrumb(breadcrumb) {
  if (!breadcrumb) return breadcrumb

  // console.* arguments routinely hold whole member objects during debugging,
  // and there is no way to redact an arbitrary serialised object reliably.
  if (breadcrumb.category === 'console') return null

  for (const field of URL_BEARING_BREADCRUMB_FIELDS) {
    if (typeof breadcrumb.data?.[field] === 'string') {
      breadcrumb.data[field] = stripUrlParams(breadcrumb.data[field])
    }
  }
  if (typeof breadcrumb.message === 'string') {
    breadcrumb.message = redactPii(breadcrumb.message)
  }

  return breadcrumb
}

# ADR-0008 — Sentry is adopted alongside the in-stack sink, conditional on scrubbing

**Status:** Accepted · **Date:** 2026-08-07 · **Answers:** the question
[ADR-0006](0006-error-sink-in-stack.md) left open

## Context

ADR-0006 chose a `public.client_errors` table over a third-party processor and closed with one
question deliberately unresolved: *whether to additionally adopt Sentry for stack traces and
release tracking.* BACKLOG.md recorded the condition — "if ever revisited, it
needs a PII-scrubbing plan before error payloads leave the stack."

The owner has decided to adopt it. This record is that decision plus the scrubbing plan the
condition required, because the trade-offs ADR-0006 named are real and none of them went away:

1. **Bundle.** Measured, not estimated: the entry chunk goes from 96.59 KB to 136.45 KB gzip
   (+40 KB, ~41%). `main.js` imports the SDK statically, so it lands in the entry chunk that boots
   the app — every visit pays it regardless of route, and the lazily-loaded view chunks don't
   change that. A priority-1 cost against Netlify bandwidth.
2. **CSP.** `connect-src` had to gain a third-party origin, which is the control
   [ADR-0005](0005-jwt-in-localstorage-accepted.md) leans on to contain a stolen `localStorage`
   JWT.
3. **PII.** The sharpest one, and worse than ADR-0006 assumed. Reviewing the SDK's actual v10
   defaults found that several collection categories are **on unless disabled**:
   `httpHeaders` (which carries `Authorization: Bearer <JWT>` — the session token itself),
   `httpBodies` (a POST to `/rest/v1/members` is a complete member record), `cookies`,
   `urlQueryParams` (PostgREST puts row filters in the query string, `?first_name=eq.Juan`), and
   Vue's `attachProps` (a prop in this app is routinely a whole member object). The wizard's
   generated snippet leaves all of this at defaults, with the mitigating options present only as
   commented-out lines.

A fourth fact decided the shape of the answer: **as originally wired, Sentry could not have worked
in production at all.** `netlify.toml`'s `connect-src` did not include the ingest host, so the
browser would have blocked every report silently. It appeared to work only in local `vite dev`,
which does not apply `netlify.toml` headers.

## Decision

**Adopt Sentry for JavaScript failures only, with collection defaults inverted and a scrubbing
layer in front of the transport.** `client_errors` from ADR-0006 remains the designated sink for
database failures and for the CSP `report-uri` (SECURITY.md §3.17); this does not replace it.

Four controls, all in [src/main.js](../../src/main.js) and
[src/utils/sentryScrub.js](../../src/utils/sentryScrub.js):

- **`attachProps: false`** — no Vue component props.
- **`dataCollection`** — `userInfo`, `cookies`, `httpHeaders` (both directions), `httpBodies`, and
  `urlQueryParams` all explicitly off. Every one of these is a default-on category.
- **`beforeSend` drops database-shaped events whole** rather than redacting them. Constraint
  violations quote row values verbatim (`Key (first_name, last_name)=(Juan, Dela Cruz)`), and a
  rewrite rule is a blocklist that fails open on formats not yet seen. Dropping costs nothing
  because ADR-0006 already routes that class to `client_errors`.
- **`beforeSend`/`beforeBreadcrumb` redact what remains** — emails, birthdates, PH mobile numbers,
  UUIDs, long digit runs — strip query strings and fragments from URLs, and drop `console`
  breadcrumbs entirely, whose arguments cannot be reliably redacted once serialised.

Two non-obvious traps were found in review and are the reason two of those controls look
over-specified:

- **`dataCollection` must list every field, including irrelevant ones.** Passing *any*
  `dataCollection` object switches the SDK's base from its safe defaults to a fully-permissive
  `DEFAULTS` set, so an omitted field resolves to `true` — the opposite of what omitting it looks
  like it means. A partial list is more dangerous than no list, because it reads as locked down.
  `stackFrameVariables` and `databaseQueryData` were both silently `true` under the first draft.
- **Navigation breadcrumbs would have leaked the check-in token.**
  [ADR-0007](0007-public-checkin-endpoint.md) puts that token in the URL *fragment* specifically
  because fragments never reach a server, so it "never appears in a server-side error report."
  Sentry's default history breadcrumb builds its `to`/`from` from `path + query + fragment` and
  ships them — a report channel that record's reasoning assumed did not exist. `scrubBreadcrumb`
  therefore strips `to` and `from`, not just `url`. **This is the concrete example of why adding a
  third-party processor is not a local change:** it can quietly invalidate a security property
  argued somewhere else entirely.

The CSP entry is the **exact project ingest host**, not a wildcard, so a swapped DSN cannot
redirect payloads to another Sentry project without a matching `netlify.toml` change.

No tracing and no session replay. `browserTracingIntegration` was removed: it adds bundle weight
and, at the `tracesSampleRate: 1.0` the wizard generates, would burn the free-tier event quota on
routine navigation.

## Consequences

- **The scrubbing layer is load-bearing, not hygiene.** Relaxing any `dataCollection` field, or
  setting `attachProps: true`, re-opens a PII path this record exists to close. The policy is pure
  functions in `src/utils/` with tests precisely so a change to it is visible in review.
- **Redaction is defence in depth, not a guarantee.** The drop rule is fail-closed for the known
  dangerous class; the pattern redactor is a best-effort net for everything else. A genuinely
  novel message embedding member data could still get through. Accepted, and the reason `userInfo`
  and bodies are off rather than merely filtered.
- **`netlify.toml` and the DSN are coupled by hand.** Nothing enforces it. Repointing one without
  the other fails silently — reporting just stops.
- **+40 KB gzip ships to every visitor on every uncached load** — but *only* when the DSN is set.
  Vite inlines `VITE_SENTRY_DSN` at build time, so an unset DSN makes the `if (sentryDsn)` guard
  statically false and Rollup drops `@sentry/vue` entirely (measured: a DSN-less build is 320 KB,
  identical to before Sentry). Tracked against the Netlify budget in
  [OPERATIONS.md](../OPERATIONS.md) §1.
- **Local `vite dev` does not enforce the CSP**, so "it worked locally" is not evidence the
  production path works. Verify against a real deploy, or `npm run preview` with headers applied.
- Sentry's free tier is a quota, not an unlimited sink. A render error in a hot loop can exhaust a
  month's events; this is the residual reason to keep tracing off.

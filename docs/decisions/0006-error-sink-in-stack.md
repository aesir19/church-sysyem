# ADR-0006 — Error monitoring is an in-stack table, not a third-party processor

**Status:** Accepted · **Date:** 2026-08-03 · **Supersedes:** the original Tier 3 classification of error monitoring

## Context

Error monitoring was originally filed as **Tier 3 — "has a cost, evaluate per need"** and
deferred. That verdict evaluated *vendor* monitoring (Sentry, Logflare, Bugsnag) and rejected it
correctly: each adds ~50–100 KB to the bundle, a third-party `connect-src` entry that weakens the
CSP that [ADR-0005](0005-jwt-in-localstorage-accepted.md) depends on, and a privacy footprint —
error payloads carry URL paths, user agents, sometimes user IDs, and can carry member PII lifted
out of constraint-violation text.

What the original analysis missed is that it never considered an in-stack option, so a
"costs money" verdict was recorded for a capability available at $0.

Two facts sharpened the reconsideration:

1. **"Supabase Logs cover it" does not hold for client-side failures.** Supabase sees requests
   that arrive. It cannot see a render-time throw, an `unhandledrejection`, a CSP violation, or
   any failure that prevents the request being made. `main.js` sets no `app.config.errorHandler`,
   so a render error is a white screen recorded nowhere. The current detection channel is a staff
   member choosing to mention it.
2. **Several controls in SECURITY.md are unobservable without a sink.** CSP reports (§3.17), abuse
   signals (§3.18), and credential-stuffing detection (§3.6) all need somewhere to land. Deferring
   the sink defers the evidence for all three.

## Decision

**A bounded `public.client_errors` table inside the existing Supabase project.** No new vendor, no
new processor, no bundle growth beyond a few hundred bytes of handler code, and no data leaving
the account that already holds the PII.

```sql
create table if not exists public.client_errors (
  id          bigserial primary key,
  occurred_at timestamptz not null default now(),
  kind        text not null check (kind in ('render','unhandled','csp','network')),
  code        text,                    -- whitelisted code, never a raw message
  route       text,
  user_id     uuid default auth.uid()
);
alter table public.client_errors enable row level security;
-- INSERT only for `authenticated`; no SELECT grant to application roles.
-- Reading is an operator action via the SQL editor.
```

Three constraints are what make it safe rather than merely cheap:

- **Scrub before insert.** Send a whitelisted `code`, never `error.message`. Raw Supabase messages
  are SECURITY.md §3.5's information-disclosure finding — writing them into a table the client can
  insert into relocates that problem rather than solving it, and can persist member PII lifted
  from constraint-violation text.
- **Cap the rows.** A trigger keeping the most recent ~5,000 bounds both storage against the
  free-tier budget and the table's value to an attacker holding a credential — an insert-only
  endpoint is a log-flooding target (§3.18).
- **No `SELECT` for `authenticated`.** Insert-only from the browser. Operators read via the SQL
  editor.

Follow [ADR-0001](0001-rls-is-the-only-authz.md)'s rule when creating it: `REVOKE ALL FROM anon,
authenticated` **first**, then grant back only `INSERT` to `authenticated`.

## Consequences

- This is the destination for CSP `report-uri` (§3.17), so those two items should land together.
- It gives §3.18's abuse signals and §3.6's credential-stuffing detection somewhere to be seen.
- It needs the global handlers to exist — `app.config.errorHandler`, `window.onerror`,
  `unhandledrejection` — which are [OPERATIONS.md](../OPERATIONS.md) O2 and O3.
- Reading it is a manual operator action. There is no alerting. That is a deliberate limit of the
  $0 path: this closes "we never find out", not "we find out immediately".

## Answered by ADR-0008

Whether to *additionally* adopt Sentry for stack traces and release tracking was left open here.
**[ADR-0008](0008-sentry-alongside-in-stack-sink.md) answers it: yes, conditional on the scrubbing
plan this record's trade-offs demanded.** The bundle, CSP, and privacy costs named above are all
real and were paid explicitly rather than waived — see that record for what they cost and what
controls hold them.

**This decision is not superseded.** `public.client_errors` remains the sink for database failures
and for the CSP `report-uri` (§3.17). ADR-0008 deliberately routes database-shaped errors *away*
from Sentry and back to this table, because constraint-violation text carries member PII.

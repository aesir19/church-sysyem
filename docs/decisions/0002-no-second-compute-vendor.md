# ADR-0002 — No second compute vendor

**Status:** Accepted · **Date:** 2026-08-05

## Context

The question recurs in roughly this form: *should this become a "real" fullstack app with a
custom backend, deployed somewhere like Render?*

Two framing corrections first.

**It is already fullstack.** There is real server-side logic — RLS policies, `SECURITY DEFINER`
functions, triggers, a `security_invoker` view. It is written in SQL rather than JavaScript.
Adding a Node service would not make the system fullstack; it would add a third tier between two
that already talk to each other directly.

**"Don't trust the client" is already satisfied.** The usual argument for an API layer is that
the browser cannot be trusted. This architecture assumes exactly that and puts the boundary in
Postgres instead ([ADR-0001](0001-rls-is-the-only-authz.md)). The anon key is public *by design*.

## Decision

**All logic stays in the SPA plus Postgres. No Netlify Functions, no Render/Fly/Railway service,
no separate API server.**

If server-side code ever becomes genuinely necessary, the sanctioned escape hatch is a
**Supabase Edge Function** — same vendor, same JWT, free tier, no second deploy target, and it
runs with the caller's auth so RLS still applies. That is a narrower rule than the one it
replaces (which named Netlify Functions specifically) and it names the exit rather than pretending
there isn't one.

## Rationale

**1. Free-tier compute is hostile to this app's usage pattern.** Render free web services spin
down after ~15 minutes idle and cold-start in roughly 30–60 seconds (verify current terms). Peak
load here is Sunday-morning collections entry, on a phone, on church wifi — the moment a cold
start hurts most. Today that path is CDN-static plus always-warm PostgREST. It would also stack a
second dormancy problem on top of Supabase's 7-day auto-pause: two things that can be asleep, with
the slower one in front.

**2. It weakens the security model rather than strengthening it.** A Node tier in practice ends up
holding the `service_role` key, which bypasses RLS. Every policy in `0004`–`0012` becomes
decorative while authorization is re-implemented in JavaScript with no
`capture-security-state.sql` equivalent to audit it. Done *correctly* it would forward the
caller's JWT to PostgREST so RLS still evaluates — at which point it is a proxy that adds a hop
and holds no authority.

**3. Nothing on the current backlog needs one.** Reviewed against
BACKLOG.md, DEFECTS.md, and [OPERATIONS.md](../OPERATIONS.md):

| Want | What it actually needs |
|---|---|
| CSV/XLSX export, annual giving statements (B18) | Client-side — the report already loads the rows |
| Bulk CSV import (B19) | Client-side parse, batched insert under existing RLS |
| Error sink (O4) | The in-stack `client_errors` table already designed |
| Ledger audit trail (O5) | A Postgres trigger |
| Backups (O11) | GitHub Actions cron running `pg_dump` |
| Uptime check (O7) | External pinger |
| Restore-archived, ministry admin (B1, B24) | `SECURITY DEFINER` RPCs — the existing pattern |
| **Data-access layer (D16)** | **`src/api/*.js` — a frontend refactor, not a tier** |

That last row is the substitution that matters. The instinct that this codebase needs "a backend"
is usually the correct observation that Supabase calls are scattered inline across 555–1,773-line
view files with no shared layer. The fix is D16, and it costs no vendor.

**4. The scarce resource is operations attention, not money.** [OPERATIONS.md](../OPERATIONS.md)
records no monitoring, no staging, and no tested restore path. A second vendor adds a deploy
pipeline, CORS config, duplicated secrets, and another thing to watch — spent on the tier that
buys the least.

## Consequences

- The JWT stays in `localStorage` and cannot be made `HttpOnly`, because that needs a server-side
  auth proxy. Accepted, compensated by a strict CSP — [SECURITY.md](../SECURITY.md) §3.4, §5.2.
- Anything requiring a secret the browser must not see is **blocked** until this record is
  superseded: transactional email/SMS, payment webhooks, third-party API keys.
- Scheduled work has no home. `pg_cron` inside Supabase covers database-side jobs; anything else
  goes to GitHub Actions.
- Leaving Supabase entirely is out of scope under priority 1 — Render's free Postgres expires
  after 30 days, so that path is a paid-tier conversation.

## What would supersede this

Needing to **hold a secret the browser must never see**, or to **act with no user present**:
sending giving statements by email, a scheduled monthly close, a payment-processor webhook. When
that arrives, write a record choosing Supabase Edge Functions and stating the invocation budget —
do not reopen the vendor question from scratch.

*(This originally said "write ADR-0005". That number went to the JWT/`localStorage` record instead;
forward-referencing an unwritten ADR by number does not survive contact with an ADR log. Refer to
the next free number at the time, or to no number at all.)*

**First case to arrive: AI features.** [ADR-0010](0010-ai-features-need-an-edge-function.md) takes
exactly this path for the "third-party API keys" line above — a vendor key held as an Edge Function
secret, the caller's JWT forwarded so RLS still applies, aggregates only. It does **not** yet
supersede this record: it names the constraints and blocks implementation until a further record
pins a vendor and budget.

If the motivation is instead *wanting fullstack experience* or a stronger portfolio piece, that is
a legitimate goal, and it should be pursued as an explicit owner decision rather than justified on
architecture grounds it does not win on.

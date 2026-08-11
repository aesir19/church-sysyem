# ADR-0005 — The JWT lives in `localStorage`, and that is accepted

**Status:** Accepted (residual risk) · **Date:** 2026-08-03 (recorded retroactively)

## Context

`@supabase/supabase-js` v2 stores the access and refresh tokens in `localStorage` by default.
Any script running in the page's origin can read them. The access token is a bearer credential —
possession equals full impersonation for its remaining lifetime (1 hour by default). The refresh
token is longer-lived.

This is threat **T3**: a compromised browser — XSS via an unknown sink, a malicious extension, or
a supply-chain attack on an npm dependency — exfiltrating the token.

The structural fix is `HttpOnly` cookies. Those require a server-side auth proxy: something that
handles `signInWithPassword` server-side, sets the cookie, exposes a `/me` endpoint for the SPA to
discover session state on boot, and rotates refresh tokens server-side. That is a second compute
tier, which [ADR-0002](0002-no-second-compute-vendor.md) forbids.

## Decision

**Keep the SDK default. Accept the residual risk and pay for it with compensating controls.**

The compensating controls, all free and all currently in place except where noted:

1. **A strict CSP is the primary control.** With `script-src 'self'` and no inline scripts, an
   attacker must compromise the Vite build pipeline or find a sink in Vue itself — both far harder
   than a typical XSS. This is why the CSP in [netlify.toml](../../netlify.toml) is load-bearing
   rather than decorative.
2. **Eliminate XSS sinks.** Vue interpolation only. The one existing `v-html` (nav icons in
   `AppSidebar.vue`) renders a hardcoded module constant and must never become data-driven.
   Validate `:href` schemes before any user-supplied URL becomes clickable — see SECURITY.md §4.1.
3. **Keep the access-token lifetime short.** Leave Supabase at the 1-hour default; do not raise it.
4. **Sign-out must clear state.** Verify the SDK wipes its own keys, and that app caches
   (`udfc.myChurchName`, `udfc.myUserName`) are cleared on every sign-out path — they are not
   today, see [issue #35](https://github.com/aesir19/church-sysyem/issues/35).

## Consequences

**The CSP is now a security control, not a nicety.** Weakening it weakens the compensation for
this decision. The current `connect-src` uses `https://*.supabase.co` rather than the specific
project ref, which materially undercuts it: an injected script could exfiltrate the token to an
attacker's *own* Supabase project without violating the policy. That is a one-line fix and it is
still open — SECURITY.md §3.1.

**CSP violations must be observable.** A blocked injection attempt is the exact event that would
tell you this residual risk had become real. Today it produces no signal anywhere
(SECURITY.md §3.17). The sink from [ADR-0006](0006-error-sink-in-stack.md) is where those reports
should land.

**This decision is documented so it is not silently re-litigated.** A future contributor
proposing HttpOnly cookies is proposing a second compute tier, and should read
[ADR-0002](0002-no-second-compute-vendor.md) first.

## What would supersede this

A CSP-bypass XSS found in the wild against this app. Short of that, the cost of the auth proxy —
a function invocation on every page load, plus latency, plus a second deploy target — is not
justified by the risk reduction.

If it is reconsidered, the cheapest shape is a single Supabase Edge Function exchanging the SDK
login for an `HttpOnly` cookie on the Netlify domain, with the SPA reading session state via
`/me`. File a successor ADR that supersedes both this record and ADR-0002, with the invocation
budget stated.

## Related, and deliberately not adopted

**Cloudflare in front of Netlify.** Free tier would add WAF / Bot Fight (mitigating
credential-stuffing), edge rate limiting (relevant to SECURITY.md §3.18), and custom header
control (overlapping §3.1). Not adopted: the §3.6 auth hardening plus the existing headers cover
most of the same territory at zero ops cost, and a DNS/TLS cutover is a real operational risk on a
system with no staging. Revisit if §3.18 throttling proves insufficient in practice.

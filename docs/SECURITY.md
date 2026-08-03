# UDFC Church Dashboard — Security Analysis & Mitigation Plan

> **Purpose.** Identify the realistic security risks of this project as deployed today and prescribe mitigations that respect the project's binding constraint: **$0/month operating cost first, security a close second** (see [ARCHITECTURE.md](ARCHITECTURE.md) §0 and §12).
>
> **Scope.** Public-internet deployment of an internal-organization tool: Vue 3 SPA on Netlify + Supabase (Postgres + Auth + RLS). No custom backend, no Edge/Netlify Functions.
>
> **Audience.** The repository owner and any AI/human contributor proposing changes. Every mitigation below is annotated with cost and effort so trade-offs are explicit.
>
> **Audit 2026-08-03.** A full-codebase architecture review added findings **§3.14–§3.20** and reclassified **§5.1** (error monitoring) from Tier 3 to Tier 1 after identifying a $0 in-stack implementation. The non-security findings from the same review are in [ARCHITECTURE.md](ARCHITECTURE.md) §13 (confirmed defects) and §14 (operational readiness); the two documents cross-reference by ID.

---

## 0. TL;DR — What to fix first

The findings below are sorted by impact × likelihood within the current threat model (anonymous internet attacker + low-privilege authenticated user). The top of this list is the recommended order of work; everything in **Tier 1** is **free** and should be done before adding more features.

### Tier 1 — Free, do now (highest ROI)

| # | Finding | Severity | Where |
|---|---|---|---|
| 1 | HTTP security headers | **Implemented**, with one caveat on `connect-src` | [netlify.toml](../netlify.toml) — §3.1 |
| 2 | `user_accounts` RLS verified self-read-only; `groups` / `group_members` explicitly protected | **Resolved** | Supabase — §3.2 |
| 2a | `members` `FOR ALL` policy permitted hard DELETE, and blocked the archive UPDATE | **Resolved** — `0007` | §3.11 |
| 2b | `collections` had no UPDATE/DELETE policy — the in-window edit/delete UI could not work | **Resolved** — `0008` | §3.11 |
| 2c | Finance-role authorization was browser-only; no policy checked it | **Resolved** — `0008` | §3.11 |
| 2d | Default `GRANT ALL` to `anon`/`authenticated` never revoked on five tables | **Resolved** — `0009` | §3.12 |
| 2e | Two load-bearing triggers outside `public` are not in any migration | Medium — **open** | Supabase — §3.13 |
| 3 | `churches` RLS was `using (true)` — leaked every church's name + address | **Resolved** — `0009` | §3.3 |
| 4 | JWT stored in `localStorage` is exfiltratable by any XSS — must be paired with strict CSP | **High** | Supabase SDK default — §3.4 |
| 5 | Raw Supabase `error.message` rendered verbatim in UI (info disclosure) | Medium | [LoginView.vue](../src/views/LoginView.vue), [DashboardView.vue](../src/views/DashboardView.vue) — §3.5 |
| 6 | Auth hardening: MFA off, no CAPTCHA, no leaked-password check, weak default min length | **High** | Supabase dashboard — §3.6 |
| 7 | No audit trail (who edited / archived which member) | Medium | Supabase schema — §3.7 |
| 8 | No dependency-update automation; `npm audit` not in CI | Medium | Repo settings — §3.8 |
| 9 | Placeholder Supabase URL fallback in [supabase.js](../src/lib/supabase.js) silently runs the app against a domain we don't own | Medium | §3.9 |
| 10 | No data-retention policy; soft-deleted PII is kept forever | Medium | Supabase — §3.10 |
| 10a | Finance authorization binds to a **mutable group display name**; `user_accounts.role` is a decoy | **High** — open | [router/index.js](../src/router/index.js), [useFinanceMember.js](../src/composables/useFinanceMember.js) — §3.14 |
| 10b | Client identity state survives sign-out — next user inherits the previous user's finance flag | Medium — open | [useFinanceMember.js](../src/composables/useFinanceMember.js) — §3.15 |
| 10c | **No audit trail on the financial ledger** — `collections` has no `created_by` at all | **High** — open | Supabase schema — §3.16 |
| 10d | CSP violations are unreported — a blocked injection attempt produces no signal | Low — open | [netlify.toml](../netlify.toml) — §3.17 |
| 10e | No throttling on authenticated mutation paths | Medium — open | Supabase — §3.18 |
| 10f | **The repository cannot rebuild the system** — DR depends on undocumented manual steps | **High** — open | §3.19 (extends §3.13) |
| 10g | Deploys are not gated on CI; no secret-rotation runbook | Medium — open | Netlify / repo settings — §3.20 |
| 10h | No error monitoring — **reclassified from Tier 3**, a $0 in-stack path exists | Medium — open | §5.1 |

### Tier 2 — Free but add minor friction

| # | Finding | Severity | Where |
|---|---|---|---|
| 11 | No client-side validation of `facebook_link` scheme; future `:href` binding could enable `javascript:` URLs | Low | [DashboardView.vue](../src/views/DashboardView.vue) — §4.1 |
| 12 | No `security.txt` for vulnerability reporting | Low | §4.2 |
| 13 | Verbose console output (`console.warn` for missing env) leaks operational hints | Low | §4.3 |
| 14 | Default Netlify subdomain is in DNS — consider HSTS preload only on the custom domain | Low | §4.4 |

### Tier 3 — Has a cost or trade-off, evaluate per need

| # | Finding | Severity | Cost note |
|---|---|---|---|
| 15 | No error/security monitoring (Sentry, Logflare) | Medium | Free tier exists (5K events/mo) but adds JS bundle bytes and a third-party dependency — see §5.1 |
| 16 | JWT cannot be made `HttpOnly` without an Edge Function as auth proxy | High | Adds Supabase compute + Netlify Function minutes — explicitly **rejected** under §12.3 rule 5 of [ARCHITECTURE.md](ARCHITECTURE.md). Mitigated by CSP — §5.2 |
| 17 | Cloudflare WAF / Bot Fight in front of Netlify | Medium | Free Cloudflare tier; adds DNS hop and configuration — §5.3 |
| 18 | Hard-delete (right-to-erasure) workflow | Medium | Schema + manual SQL effort — §5.4 |

---

## 1. System Under Review

| Surface | Detail |
|---|---|
| Frontend | Vue 3 SPA (`<script setup>`), Vue Router 4, Vite 6, no UI lib |
| Hosting | Netlify (static CDN, SPA fallback redirect) |
| Backend | None custom. Supabase = Postgres + Auth (bcrypt) + PostgREST |
| Auth | Email + password via `@supabase/supabase-js` v2; JWT stored in `localStorage` (SDK default) |
| AuthZ | Postgres Row Level Security + a `SECURITY DEFINER` helper `public.get_my_church_id()` |
| Public surface | The Netlify URL + the Supabase API URL + the `VITE_SUPABASE_ANON_KEY` (intentionally public; safe **iff** RLS is correctly configured) |
| Secrets in repo | None. `VITE_SUPABASE_*` come from Netlify environment variables; `.env` is gitignored. Service-role key is **never** referenced by the frontend |

### Threat model in scope

- **T1.** Anonymous internet attacker probing the public Netlify URL and the Supabase API.
- **T2.** Authenticated low-privilege user (any signed-in church staff member) trying to read or modify another church's data.
- **T3.** Compromised browser — XSS via a yet-unknown sink, malicious extension, or supply-chain attack on an npm dep — exfiltrating the JWT from `localStorage`.
- **T4.** Stolen credentials (phishing, credential reuse, leaked passwords) used against the production sign-in.
- **T5.** Operator misconfiguration of Supabase (RLS disabled on a table, helper function rewritten without `SECURITY DEFINER`, service-role key copied somewhere public).

### Threat model out of scope

- **OOS-1.** Insider with direct Supabase dashboard access. The Supabase project owner can do anything; this is treated as trusted.
- **OOS-2.** Physical device theft after the user is already signed in. Mitigated by Supabase JWT expiration only.
- **OOS-3.** Denial of service against Supabase / Netlify themselves. Provider responsibility.

---

## 2. Posture overview (before mitigations)

Mapped to the [OWASP Top 10 (2021)](https://owasp.org/www-project-top-ten/).

| OWASP | Status today | Notes |
|---|---|---|
| A01 — Broken Access Control | **Partial** | RLS is the only line of defense; `churches` is too permissive and `user_accounts` still needs remote verification. Group definitions and memberships now have source-controlled tenant policies. **Added 2026-08-03:** finance authorization keys on a user-editable group name (§3.14), and client-side entitlement state survives sign-out (§3.15). |
| A02 — Cryptographic Failures | **OK** | HTTPS everywhere; bcrypt by Supabase; no plaintext secrets in repo. JWT-in-localStorage is a transport-layer concern, covered under A07. |
| A03 — Injection | **OK** | PostgREST parameterizes queries; Vue auto-escapes interpolation; no `v-html` or `innerHTML` usage. (See §4.1 for a future-risk note.) |
| A04 — Insecure Design | **Partial** | No MFA; no rate-limit/CAPTCHA on sign-in; no audit trail; soft-delete only (no purge). **Added 2026-08-03:** the financial ledger permits in-window edit and delete while recording no actor (§3.16), and no mutation path is throttled (§3.18). |
| A05 — Security Misconfiguration | **Weak** | No HTTP security headers; default Supabase Auth settings; placeholder URL fallback in client code. |
| A06 — Vulnerable Components | **Partial** | Dependencies are current as of writing, but no automated scanning, no CI, no Dependabot. |
| A07 — Identification & Auth Failures | **Weak** | No MFA, no CAPTCHA, no leaked-password protection, JWT in `localStorage` (XSS-exfiltratable). |
| A08 — Software & Data Integrity | **Partial** (was OK) | Vite-bundled SDK, content-hashed assets, immutable cache, no external runtime scripts. **Revised 2026-08-03:** CI is advisory rather than gating, so an untested commit can reach production (§3.20), and the repository cannot reconstruct the database it deploys against (§3.19). |
| A09 — Logging & Monitoring | **Weak** | No app-level logging or alerting; Supabase logs are not aggregated. **Added 2026-08-03:** no global error handler in [main.js](../src/main.js), so client-side failures are unobservable by any channel (§5.1); CSP violations are unreported (§3.17); no uptime monitoring, so free-tier auto-pause is detected by a user phoning in ([ARCHITECTURE.md](ARCHITECTURE.md) §14.2). |
| A10 — SSRF | **N/A** | No server-side fetch surface. |

---

## 3. Tier 1 findings (free, high-impact)

### 3.1 HTTP security headers — Implemented, one caveat outstanding

**Status.** All seven headers below are present in [netlify.toml](../netlify.toml). The original finding — that none were set — no longer applies.

**Outstanding caveat.** The deployed `connect-src` is `https://*.supabase.co wss://*.supabase.co`, not the specific project ref this section prescribes. The wildcard makes *every* Supabase project on the internet a valid destination, which materially weakens the control that §3.4 relies on as the compensation for JWT-in-`localStorage`: an injected script could exfiltrate the token to an attacker's own Supabase project without violating the policy. Replace both wildcards with the real project ref — a one-line edit, no behaviour change.

**Original finding, retained for context.** [netlify.toml](../netlify.toml) set cache headers but no security headers. The browser received no Content-Security-Policy, no `Strict-Transport-Security`, no `X-Frame-Options` / frame-ancestors, no `X-Content-Type-Options`, no `Referrer-Policy`, and no `Permissions-Policy`.

**Why it matters.**
- Without CSP, **any** JavaScript that lands on the page (XSS, malicious browser extension impersonating the page, supply-chain compromise of a build dep) can call `localStorage.getItem('sb-…-auth-token')` and exfiltrate the Supabase JWT. CSP is the single most cost-effective compensating control for the localStorage-token model.
- Without `frame-ancestors 'none'` (or `X-Frame-Options: DENY`), the dashboard can be iframed by any other site → clickjacking risk on the Add / Edit / Archive buttons.
- Without HSTS, a downgrade attack on first contact over HTTP is theoretically possible (Netlify still redirects, but HSTS hardens the redirect).

**Mitigation (free, single-file edit).** Append to [netlify.toml](../netlify.toml):

```toml
# Security headers — apply to every response (overridden per-path where needed).
[[headers]]
  for = "/*"
  [headers.values]
    Strict-Transport-Security  = "max-age=31536000; includeSubDomains"
    X-Content-Type-Options     = "nosniff"
    X-Frame-Options            = "DENY"
    Referrer-Policy            = "strict-origin-when-cross-origin"
    Permissions-Policy         = "camera=(), microphone=(), geolocation=(), interest-cohort=()"
    Content-Security-Policy    = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' https://<your-project-ref>.supabase.co wss://<your-project-ref>.supabase.co; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; upgrade-insecure-requests"
    Cross-Origin-Opener-Policy = "same-origin"
```

Notes:
- Replace `<your-project-ref>` with the real Supabase project reference (it's the same value embedded in `VITE_SUPABASE_URL`). The `wss://` entry is only needed if/when realtime is enabled; harmless to leave in place.
- `style-src 'unsafe-inline'` is required because Vue SFC `<style scoped>` injects style tags at runtime. This is the standard Vue trade-off and is acceptable as long as `script-src` stays strict.
- Once stable, consider tightening `style-src` with hashes/nonces and add HSTS `preload` after registering the custom domain in [hstspreload.org](https://hstspreload.org).

**Verification.** Curl `-I` the deployed site or run [securityheaders.com](https://securityheaders.com) — expect a grade of A or higher.

**Cost.** $0. Header bytes are negligible.

---

### 3.2 Tenant RLS on `user_accounts`, `groups`, and `group_members` — High / partially mitigated

**Current status — resolved.** Migration `0004_church_scoped_groups` enables RLS, removes every legacy policy, resets grants, and installs the complete policy set for `groups` and `group_members`. The `user_accounts` verification item is now closed: the live capture (`scripts/sql/capture-security-state.sql`) confirms exactly one policy, `Users can read their own account`, `FOR SELECT TO authenticated USING (id = auth.uid())`, with no write policies — so writes are denied and rows are created only by the `SECURITY DEFINER` `handle_new_user()` trigger. That policy is now source-controlled in `0006_baseline_rls`.

**Exact group policy contract.**

| Table / operation | Authenticated grant | RLS rule |
|---|---:|---|
| `groups SELECT` | Yes | The caller must have a non-null `get_my_church_id()`. A row is then visible when it is a global Ministry (`type = 'Ministry' AND church_id IS NULL`) or an own-church Small Group (`type = 'Small Group' AND church_id = get_my_church_id()`). |
| `groups INSERT` | Columns only | The grant permits only `name`, `type`, and `church_id`; `WITH CHECK` requires a Small Group owned by `get_my_church_id()`. PostgreSQL generates `color_slot`. |
| `groups UPDATE` | `name` only | The column grant blocks changes to `color_slot`, `type`, and `church_id`; both `USING` and `WITH CHECK` still require an own-church Small Group. |
| `groups DELETE` | Yes | `USING` requires an own-church Small Group. Ministry deletion is denied. |
| `group_members SELECT` | Yes | `is_member_in_my_church(member_id)` and `is_group_available_to_my_church(group_id)` must both be true. |
| `group_members INSERT` | Yes | The same two predicates are required by `WITH CHECK`. |
| `group_members DELETE` | Yes | The same two predicates are required by `USING`. |
| `group_members UPDATE` | **No** | No grant and no policy; memberships are add/remove only. |

The membership predicates are `SECURITY DEFINER`, `STABLE`, fixed-`search_path` functions. The member predicate requires `members.member_of = get_my_church_id()` and `archived_at IS NULL`. The group predicate accepts only a valid global ministry or own-church small group. Using these narrow predicates avoids policy recursion when PostgREST performs nested `groups` / `members` reads. It also lets the Finance Team guard read only the signed-in user's own-church Finance Team membership.

**Threat boundaries.**
- Ordinary users can never create, rename, tenant-assign, or delete global Ministry definitions through PostgREST. Trusted operators manage them manually in Supabase. Ordinary users also cannot choose or update any group's generated `color_slot`.
- A church A user cannot discover church B small groups, membership rows, member counts, or nested member data; direct ID probing returns no row or an RLS error.
- A user cannot attach a church B member to any group, attach an own member to a church B small group, or mutate an archived member's memberships.
- The database check constraint independently enforces Ministry/global and Small Group/church ownership even for privileged maintenance.
- Direct Supabase project-owner access remains trusted and out of scope. `user_accounts` remains a separate verification item.

**Verification matrix.**

| Scenario | Expected result |
|---|---|
| Church A / B list groups | Both see all global ministries; each sees only its own small groups. |
| Church A reads a global ministry's memberships/count | Only active church A members are returned/counted. |
| Church A probes church B group or membership UUID | Zero rows or RLS rejection. |
| Ordinary user inserts/updates/deletes a Ministry | RLS rejection. |
| Ordinary user CRUDs own Small Group | Allowed; insert returns the generated `color_slot`; changing `color_slot`, `church_id`, or `type` is rejected by column grants. |
| Two transactions concurrently insert groups | Advisory locking serializes slot search; both receive different slots or the full-capacity insert fails clearly. |
| User inserts duplicate membership | Unique-constraint rejection. |
| Linked Finance Team member runs nested auth query | Own membership and global Ministry join resolve; an unassigned user gets no row. |
| Anonymous caller accesses either table | Denied (grants revoked and no anonymous policy). |
| Authenticated but unlinked caller lists groups | Zero rows, including for global ministries. |
| Authenticated user reads `user_accounts` | Exactly its own row. **Confirmed** against the live policy; captured in `0006_baseline_rls`. |

**Cost.** $0. No service, function host, realtime subscription, or runtime dependency was added.

---

### 3.3 `churches` RLS leaked every church's data to every user — Resolved (`0009_narrow_grants`)

**Resolution.** Fixed more decisively than the mitigation below proposes. Enumerating every `supabase.from(...)` call showed the SPA **never queries `churches` directly** — it reads the table only through the `SECURITY DEFINER` `get_my_church()` RPC. So `0009` revokes the table grant from `anon` and `authenticated` entirely, which makes the permissive policy unreachable rather than merely narrower. The policy is *also* scoped to `id = get_my_church_id()`, as defence in depth should the grant ever be restored.

**Verify:** as an authenticated user, `supabase.from('churches').select('*')` returns a permission error rather than rows; the dashboard title still renders on cold load, because it comes from the RPC.

**Original finding, retained for context.** Per [README.md](../README.md) the policy was:

```sql
create policy "Authenticated users can view churches"
  on public.churches for select
  to authenticated
  using (true);
```

This was added so the now-removed `select('*, churches(name)')` join could resolve. Per [ARCHITECTURE.md](ARCHITECTURE.md) §12.5 #1 the join was eliminated; the page now uses the dedicated `get_my_church()` RPC. The blanket policy is therefore both **unnecessary** and a quiet cross-tenant info-disclosure: any authenticated user (i.e. any staff member of any church) can `supabase.from('churches').select('*')` and read every church's `id`, `name`, **and `address`** in the system.

**Mitigation (free).**

```sql
drop policy if exists "Authenticated users can view churches" on public.churches;

create policy "churches_select_own_only"
  on public.churches
  for select
  to authenticated
  using (id = public.get_my_church_id());
```

The `get_my_church()` RPC runs as `SECURITY DEFINER` and reads `churches` with the definer's privileges, so it continues to return the caller's church name even after this tightening. Both the RPC and the permissive policy are now captured in `0006_baseline_rls`, so this fix can finally land as a reviewable migration against a known baseline rather than as an untracked dashboard edit.

**Verification.**
- As any authenticated user, `supabase.from('churches').select('*')` returns exactly one row (their own).
- The dashboard page title still renders correctly on cold load.

**Cost.** $0.

---

### 3.4 JWT in `localStorage` is XSS-exfiltratable — High (residual)

**Finding.** `@supabase/supabase-js` v2 stores the access + refresh tokens in `localStorage` by default. Any script running in the page's origin can read them. The access token is a bearer credential — possession = full impersonation for its remaining lifetime (typically 1 hour). The refresh token is even longer-lived.

**Why this is partially unavoidable here.** A truly XSS-resistant model requires `HttpOnly` cookies, which require a server-side auth proxy (a Supabase Edge Function or a Netlify Function that brokers the JWT into a cookie on the user's behalf). [ARCHITECTURE.md](ARCHITECTURE.md) §12.3 rule 5 explicitly forbids that to stay on the free tier.

**Compensating controls (all free).**
1. **Strict CSP (§3.1)** — the most effective mitigation. With `script-src 'self'` and no inline scripts, an attacker has to either compromise the Vite build pipeline or find a sink in Vue itself; both are far harder than a typical XSS.
2. **Eliminate XSS sinks** — keep using only Vue interpolation; never introduce `v-html`; validate `:href` URLs (§4.1).
3. **Short access-token lifetime** — leave Supabase at the 1-hour default; do **not** raise it.
4. **Sign-out clears state** — already implemented (`handleLogout` calls `supabase.auth.signOut()` and clears the `udfc.myChurchName` cache). Verify the SDK also wipes its own keys on sign-out.
5. **Document the residual risk** in this file (this paragraph) so future contributors don't pursue HttpOnly cookies without weighing the cost.

**If this risk later becomes unacceptable.** The cheapest escalation path is a single Supabase Edge Function that exchanges the SDK login for an `HttpOnly` cookie set on the Netlify domain, with the SPA reading session state via a `/me` endpoint. This costs Edge-Function invocations + adds latency; track it in [ARCHITECTURE.md](ARCHITECTURE.md) §12 if/when triggered.

**Cost.** $0 today.

---

### 3.5 Raw Supabase error messages render verbatim in the UI — Medium

**Finding.**
- [LoginView.vue](../src/views/LoginView.vue): `errorMessage.value = error.message` and renders it under the form.
- [DashboardView.vue](../src/views/DashboardView.vue): `error.value = `Failed to load members: ${fetchError.message}`` and `formError.value = insertError.message` (and similarly for update / archive).

Supabase error messages can include constraint names, column names, RLS policy names ("new row violates row-level security policy `members_insert_own_church`"), and Postgres error codes. Together these reveal schema and policy details that aid an attacker shaping further probes.

**Mitigation (free).** Map known errors to user-friendly strings; surface the raw message only in `import.meta.env.DEV`. Pattern:

```js
function userFacing(err) {
  if (!err) return ''
  if (import.meta.env.DEV) return err.message
  // Auth
  if (err.status === 400 && /invalid login/i.test(err.message)) {
    return 'Invalid email or password.'
  }
  if (err.code === '42501' || /row-level security/i.test(err.message)) {
    return 'You do not have permission to perform this action.'
  }
  if (err.code === '23505') return 'That record already exists.'
  if (err.code === '23502') return 'A required field is missing.'
  return 'Something went wrong. Please try again.'
}
```

Apply at every call site that currently does `error.message`.

**Cost.** $0. Small bundle increase.

---

### 3.6 Auth hardening defaults — High (collectively)

**Finding.** The Supabase project's auth settings are not configured-as-code; they are dashboard toggles. Defaults that need explicit opt-in:

| Setting | Default | Recommended | Why |
|---|---|---|---|
| Minimum password length | 6 | **12+** | 6 is below NIST SP 800-63B guidance |
| Password strength check (HIBP / leaked-password) | Off | **On** | Free; blocks credential-stuffing on known-leaked passwords |
| MFA (TOTP) | Off | **On (enforced for all users)** | Single-factor on a public-internet admin tool is the largest residual auth risk after T4 |
| CAPTCHA on sign-in/sign-up | Off | **On (hCaptcha free tier)** | Slows brute-force / credential-stuffing |
| Email confirmations | On | **Keep on** | Already enforced by the manual-link flow |
| Sign-up enabled | Varies | **Off for production** | Users are provisioned manually via SQL |
| JWT expiry | 3600 s | Keep ≤ 3600 s | Smaller exfiltration window |
| Refresh-token rotation | On | Keep on | Detects stolen refresh tokens |

**Mitigation (free).** Open Supabase Dashboard → **Authentication → Providers / Settings**, apply each row above, then mirror the chosen values in [README.md](../README.md) "Operations" section so future operators don't drift.

**Verification.**
- Try to set the password `password1234` on a test account → should be rejected by leaked-password check.
- Sign in without TOTP after enabling MFA → expect challenge step.
- New user attempts `supabase.auth.signUp(...)` from the SPA → expect 400 with sign-ups disabled.

**Cost.** $0. CAPTCHA service has a free hCaptcha tier; MFA TOTP is built into Supabase.

---

### 3.7 No audit trail for member edits / archives — Medium

**Finding.** The `members` schema captures `archived_at` and `archived_reason` but **not who** archived the row, **when** it was last edited, or **by whom**. With one user per church (per [ARCHITECTURE.md](ARCHITECTURE.md) §9.8) the blast radius is small, but if two staff members ever share the same church account or a future admin role is added, root-cause analysis of "who changed this record?" becomes impossible.

**Mitigation (cheap).** Add four nullable columns and a trigger:

```sql
alter table public.members
  add column if not exists created_at  timestamptz default now(),
  add column if not exists created_by  uuid,
  add column if not exists updated_at  timestamptz,
  add column if not exists updated_by  uuid,
  add column if not exists archived_by uuid;

create or replace function public.members_set_audit()
returns trigger language plpgsql as $$
begin
  if (tg_op = 'INSERT') then
    new.created_at := coalesce(new.created_at, now());
    new.created_by := auth.uid();
  elsif (tg_op = 'UPDATE') then
    new.updated_at := now();
    new.updated_by := auth.uid();
    if new.archived_at is not null and old.archived_at is null then
      new.archived_by := auth.uid();
    end if;
  end if;
  return new;
end $$;

drop trigger if exists members_audit on public.members;
create trigger members_audit
  before insert or update on public.members
  for each row execute function public.members_set_audit();
```

The trigger runs as the row owner; it reads `auth.uid()` from the JWT claims. Frontend code does **not** need to send these fields (and should not — the UPDATE policy doesn't include them in `with check`).

**Mitigation (cheaper alternative if storage budget tightens).** Skip per-row columns and capture only `archived_by` (the highest-value forensic field). Defer `created_by` / `updated_by` until a real second user exists.

**Cost.** ~24 bytes per row + minor storage for timestamps. Negligible against the 500 MB free-tier ceiling.

---

### 3.8 No dependency scanning — Medium

**Finding.** No `dependabot.yml`, no GitHub Actions workflow, no `npm audit` step. Vulnerable transitive deps would only be caught manually.

**Mitigation (free).** Add `.github/dependabot.yml`:

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
    open-pull-requests-limit: 5
    groups:
      vue:
        patterns:
          - "vue"
          - "vue-router"
          - "@vitejs/plugin-vue"
      supabase:
        patterns:
          - "@supabase/*"
      build:
        patterns:
          - "vite"
```

Optionally add a tiny GitHub Actions workflow (`.github/workflows/audit.yml`) that runs `npm ci && npm audit --audit-level=high` on push and PR. This stays well inside the GitHub free-tier minutes for a small project.

**Cost.** $0.

---

### 3.9 Placeholder Supabase URL fallback — Medium

**Finding.** [src/lib/supabase.js](../src/lib/supabase.js) falls back to `https://placeholder.supabase.co` and `'placeholder-key'` when env vars are missing, with only a `console.warn`. If the build ever ships without env vars (e.g. a Netlify env var deleted by mistake, a preview deploy of a fork), the SPA will load and quietly attempt requests against a domain we do not own. If `placeholder.supabase.co` is later registered or DNS-squatted, that creates a stored phishing surface (login form posting credentials to an attacker-controlled host).

**Mitigation (free).** Fail closed — don't render the app if config is missing.

```js
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  // Hard-stop: do not let the SPA mount with placeholder config.
  throw new Error(
    'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are missing. ' +
    'Set them in Netlify (Site settings → Environment variables) and rebuild.'
  )
}

export const supabase = createClient(url, key)
```

Catch it in [main.js](../src/main.js) to render a friendly "configuration error" page if desired; the important part is that no sign-in form is shown.

**Cost.** $0.

---

### 3.10 No data-retention / right-to-erasure policy — Medium

**Finding.** [ARCHITECTURE.md](ARCHITECTURE.md) §6.2.1 deliberately replaces hard delete with soft delete (`archived_at`) for audit reasons. There is no documented purge policy. PII collected by the app — full name, birthdate, address, contact number, email, Facebook link, wedding anniversary, baptismal status — is therefore retained indefinitely.

For an organization in the Philippines, the **Data Privacy Act of 2012 (RA 10173)** grants data subjects a right to erasure of personal data that is no longer necessary for the declared purpose. The current "archive forever" model is not compatible with that right.

**Mitigation (free, policy + script).**
1. **Document a retention policy** in [README.md](../README.md): e.g. "archived members are kept for 5 years, then hard-deleted unless a documented operational/legal reason requires longer retention."
2. **Add an erasure SQL playbook.** A privileged operator runs (manually, in the Supabase SQL editor):

   ```sql
   delete from public.group_members where member_id = '<uuid>';
   delete from public.user_accounts where member_id = '<uuid>';
   delete from public.members where id = '<uuid>';
   ```

   Because no `DELETE` policy exists on `members` (per [ARCHITECTURE.md](ARCHITECTURE.md) §6.2), this works only from the SQL editor where RLS is bypassed by default for the project owner. That is the desired posture: erasure is privileged.
3. **Optional later:** automate via a Supabase scheduled job that hard-deletes rows where `archived_at < now() - interval '5 years'`. Defer until volume justifies it.

**Cost.** $0.

---

### 3.11 `members` and `collections` policies did not match their documented intent — Resolved (`0007`, `0008`)

**Resolution.** `0007_members_policy_split` replaced the `members` `FOR ALL` policy with per-command policies and no `DELETE` policy, fixing finding A. `0010_members_select_allow_archived` fixed finding B — see the correction below, because the cause was **not** what this section originally claimed. `0008_funds_write_policies` added the missing `collections` UPDATE/DELETE policies and the `is_finance_member()` predicate, fixing finding C and closing the separate gap that finance-role authorization was enforced only in the browser.

Two design decisions worth recording, because they are not obvious from the SQL:

- **Reads are church-scoped; writes are finance-gated.** `SELECT` policies on `collections` and `expenses` are deliberately *not* finance-gated. `ChurchFundsView.vue` builds the monthly report from `expenses` and is not a finance-only route, so gating `SELECT` would break reports for every non-finance user. The same reasoning keeps `collections SELECT` open, since [ARCHITECTURE.md](ARCHITECTURE.md) §9.14 plans to feed contributions into that report.
- **The 3-hour edit window moved into RLS** and is no longer advisory. This required a column-scoped `UPDATE (amount)` grant: with table-wide `UPDATE`, a caller could set `created_at = now()` and extend their own window indefinitely, making the policy predicate useless.

**How this surfaced.** Baselining the previously untracked policies into `0006_baseline_rls` required capturing what was actually deployed. Three of the captured policies differed from what [ARCHITECTURE.md](ARCHITECTURE.md) §6.2 described. They are transcribed unchanged in `0006` — that migration is a record, not a fix. The findings below are retained for context.

**Finding A — `members` permits hard DELETE (High).** The deployed policy is a single `FOR ALL` policy, not the four separate policies previously documented:

```sql
CREATE POLICY "Only same church members can CRUD data"
ON public.members FOR ALL TO public
USING (member_of = public.get_my_church_id() AND archived_at IS NULL);
```

`FOR ALL` covers `DELETE`, and `authenticated` holds the `DELETE` grant (§3.12). Any signed-in staff member can therefore permanently delete an active member record of their own church directly through PostgREST. The soft-delete-only guarantee that §3.10's retention model and §6.2.1's audit rationale both rest on **does not exist in the database**.

**Finding B — the archive flow is blocked (High, correctness).** `DashboardView.handleArchive()` fails with `42501: new row violates row-level security policy for table "members"`. Production data confirms this has never worked: 27 members across three churches, **zero archived rows**.

> **Correction.** This finding originally attributed the failure to the missing `WITH CHECK` on the `FOR ALL` policy, reasoning that Postgres reuses `USING` as the write check. That was wrong, and `0007_members_policy_split` consequently did not fix it.
>
> The real cause is the **SELECT** policy. Postgres evaluates it against the **new** row during an `UPDATE`; setting `archived_at` makes the updated row invisible under `archived_at IS NULL`, so the statement is rejected. Verified empirically against production inside rolled-back transactions: holding the UPDATE policy at `WITH CHECK (true)` still failed, while removing `archived_at IS NULL` from the SELECT policy alone succeeded. The pre-`0007` `FOR ALL` policy carried the same condition in its `USING` clause and failed identically, which is why this is long-standing rather than a regression.
>
> Fixed by `0010_members_select_allow_archived`. The condition moved out of the policy and into the application, so **archived rows are now readable over PostgREST by staff of the owning church** and hiding them is a UI responsibility — four member reads carry an explicit `.is('archived_at', null)`. Tenant isolation is unaffected. The alternative, a `SECURITY DEFINER` `archive_member()` RPC preserving the invisible-once-archived model, was considered and not taken.

Findings A and B compounded: before `0007`, the only deletion path that worked was the destructive one.

**Finding C — `collections` cannot be edited or deleted (Medium).** Only `SELECT` and `INSERT` policies exist. With RLS enabled and no `UPDATE` or `DELETE` policy, both operations are denied for every caller. `CollectionsInputView.vue` calls `.update()` and `.delete()` inside its 3-hour edit window; those calls are rejected.

**Mitigation (free).** Replace the `members` `FOR ALL` policy with explicit per-command policies, and add the two missing `collections` policies gated on the existing 3-hour window. Sketch — **not yet reviewed or applied**, and it must land as its own migration:

```sql
DROP POLICY "Only same church members can CRUD data" ON public.members;

CREATE POLICY members_select_own_church ON public.members
  FOR SELECT TO authenticated
  USING (member_of = public.get_my_church_id() AND archived_at IS NULL);

CREATE POLICY members_insert_own_church ON public.members
  FOR INSERT TO authenticated
  WITH CHECK (member_of = public.get_my_church_id() AND archived_at IS NULL);

-- WITH CHECK omits `archived_at IS NULL` so archiving is permitted;
-- it still pins member_of, so cross-church reassignment stays blocked.
CREATE POLICY members_update_own_church ON public.members
  FOR UPDATE TO authenticated
  USING (member_of = public.get_my_church_id())
  WITH CHECK (member_of = public.get_my_church_id());

-- No DELETE policy: this is what makes archiving the only deletion path.
```

**Verification.** As an authenticated user: `delete from members` via PostgREST returns zero affected rows; archiving a member succeeds and the row leaves the list; editing a collection inside the 3-hour window succeeds and outside it is refused by the UI.

**Cost.** $0.

---

### 3.12 Supabase default `GRANT ALL` never revoked on five tables — Resolved (`0009_narrow_grants`)

**Resolution.** `0009` revokes all privileges on `churches`, `collections`, `expenses`, `members` and `user_accounts` from both `anon` and `authenticated`, then re-grants only what the SPA demonstrably uses — a set derived by enumerating every `supabase.from(...)` call rather than estimated. `anon` ends with **no table privileges at all**, which is correct: the pre-auth views use only `supabase.auth.*`, which talks to GoTrue rather than PostgREST. The `TRUNCATE`-bypasses-RLS concern below is closed as a side effect. `service_role` is untouched — it bypasses RLS by design and the frontend never uses it.

`0009` also revokes `anon`'s `EXECUTE` on the helper functions. `0004` had attempted this with `REVOKE ALL ... FROM PUBLIC`, which does not work: `anon`'s grant comes from Supabase's default privileges, granted to the role directly rather than via `PUBLIC`.

The full resulting grant table is in [ARCHITECTURE.md](ARCHITECTURE.md) §6.2.

**Original finding, retained for context.** Table privileges are the gate *in front of* RLS. `0004_church_scoped_groups` revokes Supabase's defaults before re-granting narrowly, so `groups` and `group_members` really are limited to their intended operations. No such revoke exists for `churches`, `collections`, `expenses`, `members` or `user_accounts` — all five still carry the default `GRANT ALL` (`SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER`) to **both `anon` and `authenticated`**.

Note that `0003_expenses`' `GRANT SELECT, INSERT, UPDATE ... TO authenticated` reads as though it scopes access, but `GRANT` is additive and `0003` never revokes — so it changed nothing about the effective privilege set.

**Why it matters.** These tables are protected by RLS alone, with no defence in depth. Two specifics:
- `TRUNCATE` is **not subject to RLS**. It is not reachable through PostgREST, so this is not exploitable with the anon key today, but it means a single future misconfiguration — one table with RLS accidentally disabled — escalates from "readable" to "erasable".
- `anon` holding write privileges on the PII table is unnecessary under any current flow.

`anon` likewise holds `EXECUTE` on every `public` function including the `SECURITY DEFINER` predicates. `0004`'s `REVOKE ALL ... FROM PUBLIC` did not strip this, because `anon`'s grant comes from Supabase's default privileges rather than via `PUBLIC`. Harmless in itself — `auth.uid()` is `NULL` without a JWT, so the helpers return nothing — but it is not what `0004` intended.

**Mitigation (free).** Follow the `0004` pattern per table: `REVOKE ALL ... FROM anon, authenticated;` then grant only what the app uses. Revoke `EXECUTE` from `anon` explicitly rather than from `PUBLIC`. Apply per table and verify the app after each — an over-tight grant here breaks the SPA at runtime, and there is no staging project to catch it.

**Cost.** $0.

---

### 3.13 Two load-bearing triggers exist in no migration — Medium

**Finding.** `0006_baseline_rls` captures every function in `public`, but two triggers that invoke them sit outside the `public` schema and are therefore still untracked:

| Trigger | Location | What breaks without it |
|---|---|---|
| calls `public.handle_new_user()` | `auth.users` | New auth users get no `user_accounts` row, so `get_my_church_id()` returns `NULL` and **every** RLS policy denies **every** row. Sign-in succeeds; the app is empty. |
| calls `public.rls_auto_enable()` | database-level event trigger | New tables are created without RLS. Given §3.12's blanket grants, a new table would be fully world-accessible to any anon caller. |

This is a **disaster-recovery gap**, and the second one is a latent security gap for any table added later.

**Mitigation (free).** Capture both definitions and add them to a follow-up migration:

```sql
SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger
WHERE NOT tgisinternal AND tgrelid = 'auth.users'::regclass;

SELECT evtname, pg_get_userbyid(evtowner), evtevent, evtenabled
FROM pg_event_trigger;
```

Recreating a trigger on `auth.users` requires elevated privileges and may not survive a Supabase platform upgrade — document it as a manual rebuild step regardless.

**Cost.** $0.

---

### 3.14 Finance authorization binds to a mutable display name — High

**Finding.** There are two role models in the schema and the wrong one is authoritative.

`user_accounts.role` exists with `DEFAULT 'unassigned'` and is **read by no code in `src/`**. Actual finance authorization — in the router guard ([router/index.js:87](../src/router/index.js#L87)), in the UI composable ([useFinanceMember.js:18](../src/composables/useFinanceMember.js#L18)), and in the `is_finance_member()` policy helper added by `0008` — asks whether the caller's member row belongs to a group whose `name` equals the literal string `'Finance Team'`.

Group names are user-editable through the Ministries & Small Groups screen. The consequences:

1. **Renaming that group silently revokes finance access for every user of that church.** No error, no audit entry, no obvious cause. Under §3.16 (no ledger audit trail) there is also no record of who renamed it.
2. **Authorization state is mutable by a lower-privileged action than the one it gates.** A user who may edit group names thereby controls who may write the financial ledger. That is a privilege-escalation-adjacent shape even if no current user can exploit it usefully.
3. `0004` makes ministry names globally unique but small-group names unique only per church, so the blast radius depends on `groups.type` — an implementation detail no reader of the policy would expect to matter.

**Threat model.** T2 (authenticated low-privilege user). Not remotely exploitable, and RLS still confines every read to the caller's church — but it makes the authorization boundary depend on a display string, which is the wrong kind of thing to depend on.

**Mitigation (free).** Pick one authority and delete the other. Either:

- **Promote `user_accounts.role`** — rewrite `is_finance_member()` to read it, and drop the group-name lookup from both the guard and the composable; or
- **Add an immutable key to `groups`** — a `slug` or `is_system boolean` column, keyed on by the policy, with an `UPDATE` policy that forbids changing it.

The second is closer to the current data model and preserves "finance team is a group you belong to" as the mental model. Whichever is chosen, the loser must be dropped rather than left in place — a column that looks authoritative and is not is a trap for the next contributor.

**Cost.** $0. One migration + one policy rewrite.

---

### 3.15 Client identity state outlives the session — Medium

**Finding.** `isFinance` and `loaded` in [useFinanceMember.js:4](../src/composables/useFinanceMember.js#L4) are declared at **module scope**, outside the exported factory, so they are process-global for the life of the page. Sign-out (`supabase.auth.signOut()` followed by `router.push('/login')`) is SPA navigation with no reload, so the module is never re-evaluated.

A second user signing in on the same browser tab therefore inherits the first user's finance flag: `FundsTabs` renders the Collections and Expenses links, and the contributors section renders in the funds report.

**What this is not.** This is **not a data leak**. `0008` and `0009` enforce finance authorization server-side, and the router guard re-queries `hasFinanceRole()` on every navigation, so the second user cannot actually read or write anything they shouldn't. The damage is that the UI asserts an entitlement the server will refuse — which erodes trust in the authorization model and generates support noise indistinguishable from a real breach.

**Related.** The single `onAuthStateChange` listener ([router/index.js:69](../src/router/index.js#L69)) handles only `PASSWORD_RECOVERY`. On refresh-token expiry the user sees a raw `JWT expired` string in an inline error box rather than being returned to sign-in — a §3.5-class information disclosure with a worse UX.

**Mitigation (free).** One session-scoped identity store subscribed to `onAuthStateChange`, cleared on `SIGNED_OUT` and on refresh failure, holding `{ churchId, churchName, linked, isFinance }`. This also closes [ARCHITECTURE.md](ARCHITECTURE.md) §13 D7 (2–4 auth round trips per navigation, a §12.3 budget item), so the security fix and the cost fix are the same change.

**Cost.** $0, and net-negative egress.

---

### 3.16 No audit trail on the financial ledger — High

**Finding.** §3.7 scopes the audit-trail gap to `members`. The more serious case is `collections`:

| | `expenses` | `collections` |
|---|---|---|
| `created_by` | present | **absent** |
| `created_at` | present | present |
| `updated_by` / `updated_at` | absent | absent |
| In-window `UPDATE` allowed | — | **yes** (3 h, per `0008`) |
| In-window `DELETE` allowed | — | **yes** (3 h, per `0008`) |

So the one table that permits destructive edits by design records nothing about who performed them. The system cannot answer *"who changed this amount, from what, to what, and when"* — the first question anyone asks about a financial discrepancy, and the entire premise of the planned Report Discrepancy workflow ([ARCHITECTURE.md](ARCHITECTURE.md) §9.15), which has no substrate to build on until this exists.

The 3-hour window is a *containment* control, not an accountability one: it bounds how long a row stays mutable, but within that window an edit is invisible after the fact.

**Threat model.** T2 and T4 — a compromised or misused staff credential can alter recorded giving within the window and leave no trace. Given one-user-per-church (§9.8), the person best positioned to do this is also the only person who would notice.

**Mitigation (free).** Append-only history, trigger-written, so the frontend needs no changes and cannot forge entries:

```sql
alter table public.collections
  add column if not exists created_by uuid default auth.uid();

create table if not exists public.collections_history (
  id           bigserial primary key,
  collection_id bigint not null,
  op           text    not null check (op in ('UPDATE','DELETE')),
  old_amount   numeric(12,2),
  new_amount   numeric(12,2),
  changed_by   uuid    not null,
  changed_at   timestamptz not null default now()
);
alter table public.collections_history enable row level security;
-- no INSERT/UPDATE/DELETE policy for `authenticated`: the trigger writes as definer,
-- application roles can never write or rewrite history.
```

Pair with a `SECURITY DEFINER` trigger on `collections` for `UPDATE` and `DELETE`. Grant `SELECT` only to whichever role §3.14 settles on as the finance authority.

**Note on ordering.** `collections.amount` is currently `real` (4-byte float) — [ARCHITECTURE.md](ARCHITECTURE.md) §13 D1. Fix that to `numeric(12,2)` **before** adding history, or the history table faithfully records drifting values.

**Cost.** ~40 bytes per mutation. Negligible against the 500 MB ceiling; mutations are rare by design.

---

### 3.17 CSP violations are silent — Low

**Finding.** [netlify.toml](../netlify.toml) sets a genuinely strict policy — `default-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, no `unsafe-eval`. But it carries no `report-uri` or `report-to` directive, so when the policy blocks something, nothing is recorded anywhere.

The CSP is the primary compensating control for §3.4 (JWT in `localStorage`). Today it is doing that job blind: a blocked injection attempt — the exact event that would tell you §3.4's residual risk had become real — is indistinguishable from a quiet afternoon.

**Mitigation (free).** Add `report-uri` pointing at the §5.1 in-stack sink once it exists. `report-to` requires a companion `Reporting-Endpoints` header; `report-uri` alone is deprecated but still the most widely honoured, so emit both.

**Cost.** $0 — same table as §5.1.

---

### 3.18 No throttling on authenticated mutation paths — Medium

**Finding.** RLS answers *may this principal touch this row* but says nothing about *how often*. Once authenticated, a client may issue reads and writes at API speed. There is no application-level throttle, no Supabase-side quota beyond platform defaults, and no WAF (§5.3 remains unadopted).

Concretely, a single stolen credential (T4) can enumerate the entire congregation's PII at line rate, or write unbounded rows into `collections` and `expenses` — the latter being both a data-integrity attack and a §12 cost attack, since the free-tier egress and storage budgets are what stand between this project and a bill.

Supabase Auth's own sign-in rate limits are dashboard configuration and are listed as unreviewed under §3.6.

**Mitigation (free, partial).**
1. Review and tighten Supabase Auth rate limits alongside the §3.6 hardening — same dashboard visit.
2. For the ledger tables, a `BEFORE INSERT` trigger enforcing a per-user ceiling (e.g. 100 rows/minute) costs one function and converts an unbounded write into a bounded one. Choose the ceiling well above realistic Sunday entry rates.
3. Add egress and row-count anomalies to the §6 monthly checklist so a slow-burn abuse shows up.

Full edge rate limiting requires §5.3 (Cloudflare) and remains a Tier 3 decision.

**Cost.** $0 for all three steps above.

---

### 3.19 The repository cannot rebuild the system — High

**Finding.** This extends §3.13. Two separately-documented facts combine into something worse than either:

1. `0006_baseline_rls` is a **record of live state that must not be executed** — it was registered with `prisma migrate resolve --applied` and never run ([README.md](../README.md)).
2. The trigger on `auth.users` calling `handle_new_user()` and the event trigger calling `rls_auto_enable()` exist in **no migration** (§3.13).

Therefore: `prisma/migrations/` cannot reconstruct a working database, and the one migration that describes the missing security state is by design non-runnable. Add that no `pg_dump` runs anywhere and no restore has ever been tested ([ARCHITECTURE.md](ARCHITECTURE.md) §14.3 O11), and recovery from a lost Supabase project depends on institutional memory of manual dashboard steps.

**Why this is a security finding and not merely an operational one.** Availability and integrity are security properties. §3.13 already notes that a missing `rls_auto_enable()` event trigger means new tables are created *without RLS* — so a hand-rebuilt database is not just incomplete, it is **insecure in a way that produces no error**. The rebuild would appear to work. That failure mode is the reason this is filed High rather than Medium.

**Mitigation (free).**
1. `scripts/sql/bootstrap-triggers.sql` — idempotent, covering both out-of-schema triggers, captured via the queries already given in §3.13.
2. A scheduled `pg_dump` to a GitHub Actions artifact (private repo, restricted retention — the dump contains the full congregation's PII, so treat the artifact as production data and do not widen repo visibility while this exists).
3. **One dated restore drill**, recorded in [README.md](../README.md). An untested backup is not a backup.
4. Extend `scripts/sql/capture-security-state.sql` to assert the two triggers exist, so drift is detected by the existing tooling rather than by an incident.

**Cost.** $0. Artifact storage is within the GitHub free allowance at this data size.

---

### 3.20 Release integrity — deploys are not gated, secrets have no rotation path — Medium

**Finding.** Three gaps in the path from commit to production:

1. **CI is advisory.** [ci.yml](../.github/workflows/ci.yml) runs `npm test` and `npm run build` on PRs and pushes to `main`, but Netlify builds from the repository independently. Unless the Netlify dashboard is configured otherwise — **verify this** — a commit whose tests fail still deploys. The guard exists and is not wired to anything.
2. **Migration ordering is enforced by human memory.** [README.md](../README.md) requires database migrations to land before the matching SPA release. Nothing checks it. The failure mode is a live `column does not exist` error for every user, and it is most likely during exactly the §13 D1/D2 schema work this audit recommends.
3. **No secret-rotation runbook.** There is no documented procedure or trigger condition for rotating `VITE_SUPABASE_ANON_KEY`, `DATABASE_URL`, or `DIRECT_URL`, and no written statement of whether a service-role key exists or who holds it. §1 asserts the frontend never references one; that is a code fact, not an inventory.

**Mitigation (free).**
1. Gate the Netlify build on the GitHub check, or move deployment into the existing workflow so a red build cannot ship.
2. Add `npm run prisma:migrate:status` to CI and fail the job when the working tree expects a migration that is not deployed.
3. Write a short rotation runbook in [README.md](../README.md): what to rotate, in what order, what breaks during the window, and the trigger conditions (staff departure, suspected exposure, annual). Include an explicit line recording whether a service-role key exists.

**Cost.** $0.

---

## 4. Tier 2 findings (free, lower-impact)

### 4.1 Unvalidated `facebook_link` URL scheme — Low (latent)

**Finding.** `facebook_link` is captured as a free-text URL ([DashboardView.vue](../src/views/DashboardView.vue) "Facebook Link" field). It is currently rendered as plain text via `{{ selectedMember.facebook_link }}` — safe because Vue escapes interpolation. The risk is **latent**: any future change that binds it to an `<a :href="…">` opens the door to `javascript:` URI XSS or `data:` URI phishing.

**Mitigation (free).** Validate scheme on save (the form already uses `type="url"`, but that only checks shape, not scheme). In `buildPayload`:

```js
function safeFbLink(raw) {
  const v = (raw || '').trim()
  if (!v) return null
  try {
    const u = new URL(v)
    return u.protocol === 'https:' ? u.toString() : null
  } catch { return null }
}
// …
facebook_link: safeFbLink(f.facebook_link),
```

When the field eventually renders as a clickable link, also add `rel="noopener noreferrer"` and `target="_blank"`.

**Cost.** $0.

---

### 4.2 No `security.txt` — Low

**Finding.** No machine-readable contact for security reports.

**Mitigation (free).** Create `public/.well-known/security.txt`:

```
Contact: mailto:security@<your-org-domain>
Expires: <YYYY-12-31T00:00:00.000Z>
Preferred-Languages: en, fil
Canonical: https://<your-netlify-or-custom-domain>/.well-known/security.txt
```

Vite copies `public/` verbatim to the build output. Update the `Expires` date yearly.

**Cost.** $0.

---

### 4.3 Verbose console output in production — Low

**Finding.** `console.warn('⚠️ Supabase credentials not configured…')` in [src/lib/supabase.js](../src/lib/supabase.js) prints in production builds. After the §3.9 fix this disappears, but a general principle stands: do not ship dev-oriented diagnostics to end users.

**Mitigation (free).** Wrap any future diagnostic logging in `if (import.meta.env.DEV) { … }`. Do not add a logging helper that swallows errors silently — that creates blind spots worse than `console.error`.

**Cost.** $0.

---

### 4.4 Default Netlify subdomain visible in DNS — Low

**Finding.** Without a custom domain, the deploy is reachable at `<site-name>.netlify.app`. Subdomain takeover is not a realistic risk on Netlify (they hold the apex), but the default subdomain is enumerable via certificate transparency logs.

**Mitigation (free).** Move to a custom domain controlled by UDFC, set DNS, enable Netlify TLS (Let's Encrypt, free), and after stability submit the custom domain to the [HSTS preload list](https://hstspreload.org).

**Cost.** $0 if a UDFC-owned domain already exists; otherwise the cost of a domain registration (out of scope of this document).

---

## 5. Tier 3 findings (cost trade-offs)

### 5.1 No security/error monitoring — **reclassified to Tier 1 (2026-08-03)**

**Original position (retained for the record).** Sentry / Logflare / Bugsnag have free tiers but each adds ~50–100 KB to the JS bundle, a third-party `connect-src` entry in CSP, and a privacy footprint (errors include URL paths, user agent, sometimes user IDs). The recommendation was to defer until a real incident would have been caught by it, leaning on the Supabase Logs and Netlify deploy panels in the meantime.

**Why this was reconsidered.** The original analysis evaluated *vendor* monitoring and correctly rejected it on cost and privacy. It did not consider an in-stack option, and so a Tier 3 "costs money" verdict was recorded for a capability that is available for $0. Two further facts sharpen this:

1. **The premise that Supabase Logs cover it does not hold for client-side failures.** Supabase sees requests that arrive. It cannot see a render-time throw, an `unhandledrejection`, a CSP violation (§3.17), or any failure that prevents the request from being made. [main.js](../src/main.js) sets no `app.config.errorHandler`, so a render error is a white screen recorded nowhere. The current detection channel for these is a staff member choosing to mention it.
2. **Several controls in this document are unobservable without a sink.** §3.17 CSP reports, §3.18 abuse signals, and §3.6's credential-stuffing detection all need somewhere to land. Deferring the sink defers the evidence for those too.

**Mitigation (free, in-stack, no new processor).** A bounded table in the existing Supabase project:

```sql
create table if not exists public.client_errors (
  id         bigserial primary key,
  occurred_at timestamptz not null default now(),
  kind       text not null check (kind in ('render','unhandled','csp','network')),
  code       text,                    -- whitelisted code, never a raw message
  route      text,
  user_id    uuid default auth.uid()
);
alter table public.client_errors enable row level security;
-- INSERT only for `authenticated`; no SELECT grant to application roles.
-- Reading is an operator action via the SQL editor.
```

Three constraints make this safe and free:

- **Scrub before insert.** Send a whitelisted `code`, never `error.message`. Raw Supabase messages are §3.5's information-disclosure finding; writing them to a table the client can insert into would relocate that problem rather than solve it, and could persist member PII from constraint-violation text.
- **Cap the rows.** A trigger keeping the most recent ~5,000 bounds both storage (§12 budget) and the value of the table to an attacker who obtains a credential (§3.18 — an insert-only endpoint is a log-flooding target).
- **No `SELECT` for `authenticated`.** Insert-only from the browser; operators read via the SQL editor.

**Cost.** $0, no new dependency, no bundle growth beyond a few hundred bytes of handler code, and no data leaving the account that already holds the PII.

**Remaining Tier 3 decision.** Whether to *additionally* adopt Sentry for stack traces and release tracking. The trade-offs in the original position above are unchanged and still argue against it; the in-stack sink covers detection, which was the part that mattered.

---

### 5.2 HttpOnly-cookie session via Edge Function

**Decision needed.** The only structural fix for §3.4 (JWT in `localStorage`) is moving session tokens into `HttpOnly` cookies. That requires:
- A Supabase Edge Function (or Netlify Function) that handles `signInWithPassword` server-side and sets cookies.
- A `/me` Edge Function the SPA calls on boot to discover session state.
- Refresh-token rotation handled server-side.

**Cost impact.** Edge / Netlify Function invocations against the free tier — every page load adds at least one function call. Not catastrophic, but enough that [ARCHITECTURE.md](ARCHITECTURE.md) §12.3 rule 5 currently forbids it.

**Recommendation.** Do not adopt unless a CSP-bypass XSS is found in the wild against this app. If reconsidered, file an explicit ADR weighing it against the §12 budgets.

---

### 5.3 Cloudflare in front of Netlify

**Decision needed.** Free Cloudflare adds:
- WAF / Bot Fight Mode (mitigates credential-stuffing).
- Rate limiting at the edge (the free tier has limited rules but covers basic cases).
- Custom HSTS, TLS, headers — overlaps §3.1.

**Cost impact.** Configuration time; potential DNS/TLS confusion during cutover.

**Recommendation.** Optional. The §3.6 auth hardening + §3.1 headers cover most of the same territory at zero ops cost.

---

### 5.4 Hard-delete workflow

Covered under §3.10. Treated as Tier 3 because the documentation work is free but the decision to actually purge data has policy implications that need a human decision.

---

## 6. Operational checklist

A monthly 10-minute review keeps the posture from drifting:

- [ ] Supabase **Authentication → Settings**: MFA still required, sign-up disabled, leaked-password check on, min length unchanged.
- [ ] Supabase **Database → Roles → policies**: every table in `public` shows `RLS Enabled`. Spot-check the `members`, `churches`, `user_accounts` policies match this document.
- [ ] Supabase **Logs**: scan for repeated 401/403 spikes (credential-stuffing signal).
- [ ] Netlify **Deploy logs**: latest deploy succeeded; no warnings about missing env vars.
- [ ] [securityheaders.com](https://securityheaders.com) grade against the production URL is still ≥ A.
- [ ] Open Dependabot PRs reviewed and merged.
- [ ] [README.md](../README.md) free-tier health checklist (egress, bandwidth, DB size) — see [ARCHITECTURE.md](ARCHITECTURE.md) §12.4 thresholds.

Added by the 2026-08-03 audit:

- [ ] **Finance group name unchanged.** `select name from public.groups where name = 'Finance Team'` still returns a row per church that needs finance access — until §3.14 removes the name dependency, a rename is a silent outage.
- [ ] **`client_errors` reviewed** (once §5.1 lands): scan for repeated `csp` rows (injection attempts) and `network` spikes (§3.18 abuse signal). Confirm the row cap is holding.
- [ ] **Backup exists and is recent.** Confirm the scheduled `pg_dump` artifact from §3.19 ran; check its age against the retention window.
- [ ] **Uptime monitor is green** and actually alerting — confirm it detects a paused project, not just a served `index.html`.
- [ ] **CI is gating, not advisory.** Netlify's deploy settings still require the GitHub check to pass (§3.20).
- [ ] **Triggers still present.** `scripts/sql/capture-security-state.sql` reports both §3.13 triggers; investigate immediately if either is missing after a Supabase platform upgrade.

Annually:

- [ ] **Secret rotation** per the §3.20 runbook, plus a re-read of who holds a service-role key.
- [ ] **Restore drill** — restore the §3.19 dump into a throwaway project and confirm the app boots against it. Record the date.

---

## 7. Verification matrix

| Finding | Verification step |
|---|---|
| §3.1 Headers | `curl -I https://<site>` → all six headers present; [securityheaders.com](https://securityheaders.com) grade ≥ A. |
| §3.2 RLS | Run the §3.2 two-church matrix; inspect `pg_policies` for the seven exact group policies; confirm both tables have `relrowsecurity = true`; separately verify `user_accounts` returns only the caller's row. |
| §3.3 Churches RLS | As authenticated user, `supabase.from('churches').select('*')` returns exactly one row. |
| §3.4 JWT | Application Tab → Local Storage → token present. Confirmed compensating controls (CSP) are active per §3.1. |
| §3.5 Errors | Force a duplicate insert (constraint violation) → UI shows generic message; raw `error.message` only visible in `npm run dev`. |
| §3.6 Auth | Test password `password1234` rejected; sign-in without TOTP fails after MFA enrollment; `signUp()` from SDK rejected. |
| §3.7 Audit | Insert / update / archive a member as user A; `select created_by, updated_by, archived_by from members where id=…` matches `auth.uid()`. |
| §3.8 Deps | Dependabot PR opened on a deliberately out-of-date dep; CI `npm audit` job runs on PR. |
| §3.9 Placeholder | Build with env vars unset → app refuses to start with a clear error. |
| §3.10 Retention | Erasure SQL playbook present in [README.md](../README.md); test a hard-delete on a throwaway record removes it from all four tables. |
| §3.14 Finance authz | Rename the finance group in the UI → confirm finance access is **unaffected**. Under the current build it is revoked, which is the defect. Then confirm `user_accounts.role` is either authoritative or dropped. |
| §3.15 Identity state | Sign in as a finance user, sign out, sign in as a non-finance user **in the same tab without reloading** → `FundsTabs` must not render Collections/Expenses links. Separately, expire the JWT and confirm redirect to `/login` rather than a raw `JWT expired` string. |
| §3.16 Ledger audit | Record a collection, edit it in-window, delete another in-window → `collections_history` holds one `UPDATE` row with both old and new amounts and one `DELETE` row, each with the correct `changed_by`. Then confirm `authenticated` cannot `INSERT`, `UPDATE`, or `DELETE` that table directly. |
| §3.17 CSP reports | Temporarily add an inline `<script>` to a built page → a `csp` row appears in the sink. Remove it. |
| §3.18 Throttling | Script >100 `collections` inserts in a minute as one user → the trigger rejects the excess. Confirm a realistic Sunday entry rate stays well under the ceiling. |
| §3.19 Recovery | Restore the latest dump into a throwaway Supabase project, run `bootstrap-triggers.sql`, sign in → the dashboard shows data (proves `handle_new_user()`), and `create table t(...)` lands with `relrowsecurity = true` (proves `rls_auto_enable()`). Record the drill date. |
| §3.20 Release | Push a commit with a deliberately failing test → Netlify must **not** publish. Deploy a schema-dependent build without its migration → CI `prisma:migrate:status` must fail the job. |
| §5.1 Monitoring | Throw inside a view's `setup()` → a `render` row appears in `client_errors` with a whitelisted code and **no raw message or PII**. Insert >5,000 rows → the cap trigger holds. Confirm `authenticated` has no `SELECT` grant. |

---

## 8. Out of scope for this document

- Penetration testing of Supabase or Netlify themselves (provider responsibility).
- DDoS mitigation beyond what providers offer.
- Insider risk by the Supabase project owner.
- Mobile-device-management posture of staff devices.
- Cryptographic review of bcrypt parameters used by Supabase Auth.

If any of these become relevant, raise them as a new section in this document with the cost trade-off explicit.

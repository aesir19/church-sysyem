# UDFC Church Dashboard — Security Analysis & Mitigation Plan

> **Purpose.** Identify the realistic security risks of this project as deployed today and prescribe mitigations that respect the project's binding constraint: **$0/month operating cost first, security a close second** (see [ARCHITECTURE.md](ARCHITECTURE.md) §0 and §12).
>
> **Scope.** Public-internet deployment of an internal-organization tool: Vue 3 SPA on Netlify + Supabase (Postgres + Auth + RLS). No custom backend, no Edge/Netlify Functions.
>
> **Audience.** The repository owner and any AI/human contributor proposing changes. Every mitigation below is annotated with cost and effort so trade-offs are explicit.

---

## 0. TL;DR — What to fix first

The findings below are sorted by impact × likelihood within the current threat model (anonymous internet attacker + low-privilege authenticated user). The top of this list is the recommended order of work; everything in **Tier 1** is **free** and should be done before adding more features.

### Tier 1 — Free, do now (highest ROI)

| # | Finding | Severity | Where |
|---|---|---|---|
| 1 | No HTTP security headers (CSP, HSTS, X-Frame-Options, etc.) | **High** | [netlify.toml](../netlify.toml) — §3.1 |
| 2 | `user_accounts` RLS still requires remote verification; `groups` / `group_members` are now explicitly protected | **High / mitigated in part** | Supabase — §3.2 |
| 3 | `churches` RLS is `using (true)` — leaks every church's name + address to every authenticated user | **High** | Supabase — §3.3 |
| 4 | JWT stored in `localStorage` is exfiltratable by any XSS — must be paired with strict CSP | **High** | Supabase SDK default — §3.4 |
| 5 | Raw Supabase `error.message` rendered verbatim in UI (info disclosure) | Medium | [LoginView.vue](../src/views/LoginView.vue), [DashboardView.vue](../src/views/DashboardView.vue) — §3.5 |
| 6 | Auth hardening: MFA off, no CAPTCHA, no leaked-password check, weak default min length | **High** | Supabase dashboard — §3.6 |
| 7 | No audit trail (who edited / archived which member) | Medium | Supabase schema — §3.7 |
| 8 | No dependency-update automation; `npm audit` not in CI | Medium | Repo settings — §3.8 |
| 9 | Placeholder Supabase URL fallback in [supabase.js](../src/lib/supabase.js) silently runs the app against a domain we don't own | Medium | §3.9 |
| 10 | No data-retention policy; soft-deleted PII is kept forever | Medium | Supabase — §3.10 |

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
| A01 — Broken Access Control | **Partial** | RLS is the only line of defense; `churches` is too permissive and `user_accounts` still needs remote verification. Group definitions and memberships now have source-controlled tenant policies. |
| A02 — Cryptographic Failures | **OK** | HTTPS everywhere; bcrypt by Supabase; no plaintext secrets in repo. JWT-in-localStorage is a transport-layer concern, covered under A07. |
| A03 — Injection | **OK** | PostgREST parameterizes queries; Vue auto-escapes interpolation; no `v-html` or `innerHTML` usage. (See §4.1 for a future-risk note.) |
| A04 — Insecure Design | **Partial** | No MFA; no rate-limit/CAPTCHA on sign-in; no audit trail; soft-delete only (no purge). |
| A05 — Security Misconfiguration | **Weak** | No HTTP security headers; default Supabase Auth settings; placeholder URL fallback in client code. |
| A06 — Vulnerable Components | **Partial** | Dependencies are current as of writing, but no automated scanning, no CI, no Dependabot. |
| A07 — Identification & Auth Failures | **Weak** | No MFA, no CAPTCHA, no leaked-password protection, JWT in `localStorage` (XSS-exfiltratable). |
| A08 — Software & Data Integrity | **OK** | Vite-bundled SDK, content-hashed assets, immutable cache. No external runtime scripts. |
| A09 — Logging & Monitoring | **Weak** | No app-level logging or alerting; Supabase logs are not aggregated. |
| A10 — SSRF | **N/A** | No server-side fetch surface. |

---

## 3. Tier 1 findings (free, high-impact)

### 3.1 No HTTP security headers — High

**Finding.** [netlify.toml](../netlify.toml) sets cache headers but no security headers. The browser receives no Content-Security-Policy, no `Strict-Transport-Security`, no `X-Frame-Options` / frame-ancestors, no `X-Content-Type-Options`, no `Referrer-Policy`, and no `Permissions-Policy`.

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

**Current status.** Migration `0004_church_scoped_groups` enables RLS, removes every legacy policy, resets grants, and installs the complete policy set for `groups` and `group_members`. The migration does not alter `user_accounts`; its self-only SELECT policy must still be verified remotely because account linking is part of the existing auth flow.

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
| Authenticated user reads `user_accounts` | Exactly its own row; this must be confirmed against the remote policy. |

**Cost.** $0. No service, function host, realtime subscription, or runtime dependency was added.

---

### 3.3 `churches` RLS leaks every church's data to every user — High

**Finding.** Per [README.md](../README.md) the policy is:

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

The `get_my_church()` RPC runs as `SECURITY DEFINER` and reads `churches` with the definer's privileges, so it continues to return the caller's church name even after this tightening.

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

### 5.1 No security/error monitoring

**Decision needed.** Sentry / Logflare / Bugsnag have free tiers but each adds:
- ~50–100 KB to the JS bundle (every uncached visit re-downloads it).
- A third-party `connect-src` entry in CSP.
- A privacy footprint (errors include URL paths, user agent, sometimes user IDs).

**Recommendation.** Defer until there is a real incident this would have caught. In the meantime, the Supabase Logs panel + Netlify deploy logs cover the vast majority of "what went wrong" questions for a single-tenant tool. If adopted later, prefer a self-hosted [Logflare](https://logflare.app) Postgres sink that lives in the same Supabase project — keeps everything inside the existing account.

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

---

## 8. Out of scope for this document

- Penetration testing of Supabase or Netlify themselves (provider responsibility).
- DDoS mitigation beyond what providers offer.
- Insider risk by the Supabase project owner.
- Mobile-device-management posture of staff devices.
- Cryptographic review of bcrypt parameters used by Supabase Auth.

If any of these become relevant, raise them as a new section in this document with the cost trade-off explicit.

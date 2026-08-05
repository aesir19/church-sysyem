# Security — analysis and open findings

> **Purpose.** The realistic security risks of this project as deployed today, and mitigations
> that respect the binding constraint: **$0/month operating cost first, security a close second**
> (priority order in [CLAUDE.md](../CLAUDE.md), budgets in [OPERATIONS.md](OPERATIONS.md)).
>
> **Scope.** Public-internet deployment of an internal-organization tool: Vue 3 SPA on Netlify +
> Supabase (Postgres + Auth + RLS). No custom backend, no Edge/Netlify Functions.
>
> **Audience.** The repository owner and any contributor — human or AI — proposing changes. Every
> mitigation is annotated with cost so trade-offs stay explicit.

**This file lists work still to do.** Related material lives elsewhere:

| For | See |
|---|---|
| Findings already closed, and why each fix took its shape | [security/RESOLVED.md](security/RESOLVED.md) |
| How to prove a control works; the monthly review | [security/VERIFICATION.md](security/VERIFICATION.md) |
| Accepted risks and rejected controls | [decisions/](decisions/) — ADR-0001, 0002, 0005, 0006 |
| Non-security defects | [DEFECTS.md](DEFECTS.md) (`D1`–`D16`) |
| Operational gaps | [OPERATIONS.md](OPERATIONS.md) (`O1`–`O25`) |

Section numbers are stable and match their historical positions, so gaps are intentional — a
missing number means that finding moved to `RESOLVED.md`.

---

## 0. What to fix first

Sorted by impact × likelihood within the threat model below. Everything in Tier 1 is **free**.

### Tier 1 — free, high impact

| # | Finding | Severity | § |
|---|---|---|---|
| 1 | `connect-src` is `https://*.supabase.co`, not the project ref — weakens the control compensating for the JWT model | **High** | 3.1 |
| 2 | Finance authorization binds to a **mutable group display name**; `user_accounts.role` is a decoy | **High** | 3.14 |
| 3 | **No audit trail on the financial ledger** — `collections` has no `created_by` at all | **High** | 3.16 |
| 4 | **The repository cannot rebuild the system** — DR depends on undocumented manual steps | **High** | 3.19 |
| 5 | Auth hardening: MFA off, no CAPTCHA, no leaked-password check, weak default min length | **High** | 3.6 |
| 6 | Two load-bearing triggers exist in no migration | Medium | 3.13 |
| 7 | Client identity state survives sign-out — the next user inherits the previous user's finance flag | Medium | 3.15 |
| 8 | Raw Supabase `error.message` rendered verbatim (information disclosure) | Medium | 3.5 |
| 9 | No throttling on authenticated mutation paths | Medium | 3.18 |
| 10 | Deploys are not gated on CI; no secret-rotation runbook | Medium | 3.20 |
| 11 | No audit trail for member edits / archives | Medium | 3.7 |
| 12 | No dependency-update automation; `npm audit` not in CI | Medium | 3.8 |
| 13 | No data-retention policy; soft-deleted PII is kept forever | Medium | 3.10 |
| 14 | CSP violations are unreported — a blocked injection produces no signal | Low | 3.17 |

**Ordering.** #3 depends on [DEFECTS.md](DEFECTS.md) D1 — fix `collections.amount` to
`numeric(12,2)` *before* adding ledger history, or the history faithfully records drifting float
values. #14 needs the sink from [ADR-0006](decisions/0006-error-sink-in-stack.md), so those two
land together.

### Tier 2 — free, lower impact

| # | Finding | Severity | § |
|---|---|---|---|
| 15 | No validation of `facebook_link` scheme; a future `:href` binding could enable `javascript:` URLs | Low (latent) | 4.1 |
| 16 | No `security.txt` for vulnerability reporting | Low | 4.2 |
| 17 | Default Netlify subdomain is enumerable via certificate transparency | Low | 4.4 |

### Decided — not open questions

| Question | Outcome |
|---|---|
| Move the JWT out of `localStorage` into `HttpOnly` cookies | **Rejected** — requires a second compute tier. [ADR-0005](decisions/0005-jwt-in-localstorage-accepted.md) |
| Adopt a third-party error monitor | **Rejected** in favour of an in-stack table. [ADR-0006](decisions/0006-error-sink-in-stack.md) |
| Put Cloudflare in front of Netlify | **Not adopted** — see ADR-0005's closing section |
| Hard-delete / right-to-erasure workflow | Documentation is free; the decision to purge has policy implications. Folded into §3.10 |

---

## 1. System under review

| Surface | Detail |
|---|---|
| Frontend | Vue 3 SPA (`<script setup>`), Vue Router 4, Vite 6, no UI library |
| Hosting | Netlify — static CDN, SPA fallback redirect |
| Backend | None custom. Supabase = Postgres + Auth (bcrypt) + PostgREST |
| Auth | Email + password via `@supabase/supabase-js` v2; JWT in `localStorage` (SDK default) |
| AuthZ | Postgres RLS + the `SECURITY DEFINER` helper `public.get_my_church_id()` |
| Public surface | The Netlify URL, the Supabase API URL, and `VITE_SUPABASE_ANON_KEY` — intentionally public, safe **iff** RLS is correct |
| Secrets in repo | None. `VITE_SUPABASE_*` come from Netlify env vars; `.env` is gitignored. The service-role key is never referenced by the frontend |

### Threat model — in scope

- **T1.** Anonymous internet attacker probing the public Netlify URL and the Supabase API.
- **T2.** Authenticated low-privilege user — any signed-in church staff member — trying to read or
  modify another church's data.
- **T3.** Compromised browser: XSS via an unknown sink, a malicious extension, or a supply-chain
  attack on an npm dependency, exfiltrating the JWT from `localStorage`.
- **T4.** Stolen credentials — phishing, reuse, leaked passwords — used against production sign-in.
- **T5.** Operator misconfiguration of Supabase: RLS disabled on a table, a helper function
  rewritten without `SECURITY DEFINER`, the service-role key copied somewhere public.

### Threat model — out of scope

- **OOS-1.** Insider with direct Supabase dashboard access. The project owner can do anything; this
  is treated as trusted.
- **OOS-2.** Physical device theft after sign-in. Mitigated only by JWT expiration.
- **OOS-3.** Denial of service against Supabase or Netlify themselves. Provider responsibility.

---

## 2. Posture — OWASP Top 10 (2021)

| OWASP | Status | Notes |
|---|---|---|
| A01 — Broken Access Control | **Partial** | RLS is the only line of defence, now source-controlled and verified. Remaining: finance authorization keys on a user-editable group name (§3.14), and client entitlement state survives sign-out (§3.15). |
| A02 — Cryptographic Failures | **OK** | HTTPS throughout; bcrypt by Supabase; no plaintext secrets in repo. JWT-in-`localStorage` is covered under A07. |
| A03 — Injection | **OK** | PostgREST parameterizes queries; Vue auto-escapes interpolation. One `v-html` exists (`AppSidebar.vue` nav icons) rendering a hardcoded module constant — not a sink today, but it must never become data-driven. See §4.1. |
| A04 — Insecure Design | **Partial** | No MFA; no rate limit or CAPTCHA on sign-in; no audit trail; soft-delete only. The financial ledger permits in-window edit and delete while recording no actor (§3.16), and no mutation path is throttled (§3.18). |
| A05 — Security Misconfiguration | **Partial** (was Weak) | All seven security headers now ship. Remaining: the `connect-src` wildcard (§3.1) and unreviewed Supabase Auth defaults (§3.6). |
| A06 — Vulnerable Components | **Partial** | Dependencies are current, but there is no automated scanning and no Dependabot (§3.8). |
| A07 — Identification & Auth Failures | **Weak** | No MFA, no CAPTCHA, no leaked-password protection; JWT in `localStorage` — accepted per [ADR-0005](decisions/0005-jwt-in-localstorage-accepted.md). |
| A08 — Software & Data Integrity | **Partial** | Content-hashed assets, immutable cache, no external runtime scripts. But CI is advisory rather than gating (§3.20), and the repository cannot reconstruct the database it deploys against (§3.19). |
| A09 — Logging & Monitoring | **Weak** | No app-level logging or alerting. No global error handler in `main.js`, so client failures are unobservable ([ADR-0006](decisions/0006-error-sink-in-stack.md)); CSP violations unreported (§3.17); no uptime monitoring, so free-tier auto-pause is detected by a user phoning in ([OPERATIONS.md](OPERATIONS.md) O7). |
| A10 — SSRF | **N/A** | No server-side fetch surface. |

---

## 3. Tier 1 findings

### 3.1 `connect-src` wildcard — High

**Status.** All seven headers are present in [netlify.toml](../netlify.toml) — CSP, HSTS,
X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, COOP. The original
finding, that none were set, is closed.

**Outstanding.** The deployed `connect-src` is `https://*.supabase.co wss://*.supabase.co`, not the
specific project ref. The wildcard makes **every Supabase project on the internet** a valid
destination, which materially weakens the control that
[ADR-0005](decisions/0005-jwt-in-localstorage-accepted.md) relies on: an injected script could
exfiltrate the token to an attacker's own Supabase project without violating the policy.

**Mitigation.** Replace both wildcards with the real project ref — the same value embedded in
`VITE_SUPABASE_URL`. One-line edit, no behaviour change.

Two notes for anyone tightening this further:

- `style-src 'unsafe-inline'` is required because Vue SFC `<style scoped>` injects style tags at
  runtime. Standard Vue trade-off, acceptable while `script-src` stays strict.
- The `wss://` entry is only needed if realtime is ever enabled; harmless meanwhile.

**Cost.** $0.

---

### 3.5 Raw Supabase error messages render verbatim — Medium

**Finding.** `LoginView.vue` sets `errorMessage.value = error.message` and renders it under the
form. `DashboardView.vue` does the same for load, insert, update, and archive failures.

Supabase messages can include constraint names, column names, RLS policy names (`new row violates
row-level security policy "members_insert_own_church"`), and Postgres error codes — together
revealing schema and policy details that help an attacker shape further probes.

**Mitigation (free).** Map known errors to user-facing strings; surface the raw message only in
`import.meta.env.DEV`:

```js
function userFacing(err) {
  if (!err) return ''
  if (import.meta.env.DEV) return err.message
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

Apply at every call site currently doing `error.message`. This belongs in the shared layer
[DEFECTS.md](DEFECTS.md) D16 proposes, not copied into each view.

**Cost.** $0.

---

### 3.6 Auth hardening defaults — High (collectively)

**Finding.** Supabase auth settings are dashboard toggles, not configuration-as-code. Defaults
needing explicit opt-in:

| Setting | Default | Recommended | Why |
|---|---|---|---|
| Minimum password length | 6 | **12+** | 6 is below NIST SP 800-63B guidance |
| Leaked-password check (HIBP) | Off | **On** | Free; blocks credential-stuffing on known-leaked passwords |
| MFA (TOTP) | Off | **On, enforced** | Single-factor on a public admin tool is the largest residual auth risk after T4 |
| CAPTCHA on sign-in/sign-up | Off | **On** (hCaptcha free tier) | Slows brute-force and credential-stuffing |
| Email confirmations | On | **Keep on** | Already relied on by the manual-invite flow |
| Sign-up enabled | Varies | **Off in production** | Users are provisioned manually |
| JWT expiry | 3600 s | Keep ≤ 3600 s | Smaller exfiltration window — load-bearing for ADR-0005 |
| Refresh-token rotation | On | Keep on | Detects stolen refresh tokens |

**Mitigation (free).** Apply each row in the dashboard, then record the chosen values in
[OPERATIONS.md](OPERATIONS.md) so a future operator can detect drift. Review the Auth rate limits
in the same visit — §3.18 depends on them.

**Cost.** $0. hCaptcha has a free tier; TOTP is built into Supabase.

---

### 3.7 No audit trail for member edits / archives — Medium

**Finding.** `members` captures `archived_at` and `archived_reason` but not **who** archived the
row, when it was last edited, or by whom. With one user per church
([BACKLOG.md](BACKLOG.md) B8) the blast radius is small — but if two staff ever share an account,
or an admin role is added, "who changed this record?" becomes unanswerable.

**Mitigation (cheap).** Five nullable columns plus a trigger reading `auth.uid()` from the JWT
claims. The frontend sends nothing — and should not, since the UPDATE policy does not include
these in its `with check`:

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

**Cheaper alternative.** Capture only `archived_by`, the highest-value forensic field, and defer
the rest until a real second user exists.

**Cost.** ~24 bytes per row. Negligible against the 500 MB ceiling.

> §3.16 is the more urgent case. Do the ledger first.

---

### 3.8 No dependency scanning — Medium

**Finding.** No `dependabot.yml` and no `npm audit` step. Vulnerable transitive dependencies would
only be caught by hand.

**Mitigation (free).** `.github/dependabot.yml`:

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
        patterns: ["vue", "vue-router", "@vitejs/plugin-vue"]
      supabase:
        patterns: ["@supabase/*"]
      build:
        patterns: ["vite"]
```

Add `npm audit --audit-level=high` to the existing CI workflow. Both are one-file changes and stay
well inside the GitHub free-tier minutes.

**Cost.** $0.

---

### 3.10 No data-retention / right-to-erasure policy — Medium

**Finding.** Soft delete is the only deletion path by design ([ARCHITECTURE.md](ARCHITECTURE.md)
§5.2) and there is no purge policy, so PII — full name, birthdate, address, contact number, email,
Facebook link, wedding anniversary, baptismal status — is retained indefinitely.

The **Data Privacy Act of 2012 (RA 10173)** grants Philippine data subjects a right to erasure of
personal data no longer necessary for the declared purpose. "Archive forever" is not compatible
with that right, and the church is the personal information controller.

**Mitigation (free — policy plus a playbook).**

1. Document a retention policy in [OPERATIONS.md](OPERATIONS.md): e.g. archived members are kept
   five years, then hard-deleted unless a documented operational or legal reason requires longer.
2. Add an erasure playbook a privileged operator runs manually in the SQL editor:

   ```sql
   delete from public.group_members where member_id = '<uuid>';
   delete from public.user_accounts where member_id = '<uuid>';
   delete from public.members       where id        = '<uuid>';
   ```

   Because no `DELETE` policy exists on `members`
   ([ADR-0001](decisions/0001-rls-is-the-only-authz.md)), this works only from the SQL editor,
   where the project owner bypasses RLS. **That is the desired posture: erasure is privileged.**
3. Optional later: a scheduled job hard-deleting rows where
   `archived_at < now() - interval '5 years'`. Defer until volume justifies it.

**Cost.** $0. The decision to actually purge has policy implications needing a human call — which
is why this stays a documentation task until the owner decides.

---

### 3.13 Two load-bearing triggers exist in no migration — Medium

**Finding.** `0006_baseline_rls` captures every function in `public`, but two triggers that invoke
them sit outside `public` and are untracked:

| Trigger | Location | What breaks without it |
|---|---|---|
| calls `public.handle_new_user()` | `auth.users` | New auth users get no `user_accounts` row, so `get_my_church_id()` returns `NULL` and **every** RLS policy denies **every** row. Sign-in succeeds; the app is empty. |
| calls `public.rls_auto_enable()` | database-level event trigger | New tables are created without RLS. |

A disaster-recovery gap, and the second is a latent security gap for any table added later.

**Mitigation (free).** Capture both definitions into `scripts/sql/bootstrap-triggers.sql`:

```sql
SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger
WHERE NOT tgisinternal AND tgrelid = 'auth.users'::regclass;

SELECT evtname, pg_get_userbyid(evtowner), evtevent, evtenabled
FROM pg_event_trigger;
```

Recreating a trigger on `auth.users` needs elevated privileges and may not survive a Supabase
platform upgrade — document it as a manual rebuild step regardless.

**Cost.** $0.

---

### 3.14 Finance authorization binds to a mutable display name — High

**Finding.** Two role models exist and the wrong one is authoritative.

`user_accounts.role` exists with `DEFAULT 'unassigned'` and is **read by no code in `src/`**.
Actual finance authorization — in the router guard
([router/index.js:98](../src/router/index.js#L98)), the UI composable
([useFinanceMember.js:22](../src/composables/useFinanceMember.js#L22)), and the
`is_finance_member()` policy helper from `0008` — asks whether the caller's member row belongs to
a group whose `name` equals the literal string `'Finance Team'`.

Group names are user-editable through the Ministries screen. So:

1. **Renaming that group silently revokes finance access for every user of that church.** No
   error, no audit entry, no obvious cause — and under §3.16 no record of who renamed it.
2. **Authorization state is mutable by a lower-privileged action than the one it gates.** A user
   who may edit group names thereby controls who may write the financial ledger. That shape is
   privilege-escalation-adjacent even if no current user can exploit it usefully.
3. `0004` makes ministry names globally unique but small-group names unique only per church, so the
   blast radius depends on `groups.type` — an implementation detail no reader of the policy would
   expect to matter.

**Threat model.** T2. Not remotely exploitable, and RLS still confines every read to the caller's
church — but the authorization boundary depends on a display string, which is the wrong kind of
thing to depend on.

**Mitigation (free).** Pick one authority and delete the other:

- **Promote `user_accounts.role`** — rewrite `is_finance_member()` to read it, and drop the
  group-name lookup from both the guard and the composable; or
- **Add an immutable key to `groups`** — a `slug` or `is_system boolean` keyed on by the policy,
  with an UPDATE policy forbidding changes to it.

The second is closer to the current data model and preserves "finance team is a group you belong
to" as the mental model. Whichever is chosen, **the loser must be dropped** — a column that looks
authoritative and is not is a trap for the next contributor. Same finding as
[DEFECTS.md](DEFECTS.md) D4.

**Cost.** $0. One migration plus one policy rewrite.

---

### 3.15 Client identity state outlives the session — Medium

**Finding.** `isFinance` and `loaded` in
[useFinanceMember.js:4](../src/composables/useFinanceMember.js#L4) are declared at **module
scope**, outside the exported factory, so they are process-global for the life of the page.
Sign-out is SPA navigation with no reload, so the module is never re-evaluated.

A second user signing in on the same tab therefore inherits the first user's finance flag:
`FundsTabs` renders the Collections and Expenses links, and the contributors section renders in
the funds report.

**What this is not.** **Not a data leak.** `0008` and `0009` enforce finance authorization
server-side and the guard re-queries on every navigation, so the second user cannot read or write
anything they shouldn't. The damage is that the UI asserts an entitlement the server will refuse —
which erodes trust in the authorization model and generates support noise indistinguishable from a
real breach.

**Related.** The single `onAuthStateChange` listener
([router/index.js:69](../src/router/index.js#L69)) handles only `PASSWORD_RECOVERY`. On
refresh-token expiry the user sees a raw `JWT expired` string in an inline error box — a
§3.5-class disclosure with worse UX.

**Mitigation (free).** One session-scoped identity store subscribed to `onAuthStateChange`,
cleared on `SIGNED_OUT` and on refresh failure, holding `{ churchId, churchName, linked, isFinance }`.
This also closes [DEFECTS.md](DEFECTS.md) D5, D6, and D7 — the security fix and the cost fix are
the same change.

**Cost.** $0, and net-negative egress.

---

### 3.16 No audit trail on the financial ledger — High

**Finding.** §3.7 scopes the audit gap to `members`. The more serious case is `collections`:

| | `expenses` | `collections` |
|---|---|---|
| `created_by` | present | **absent** |
| `created_at` | present | present |
| `updated_by` / `updated_at` | absent | absent |
| In-window `UPDATE` allowed | — | **yes** (3 h, per `0008`) |
| In-window `DELETE` allowed | — | **yes** (3 h, per `0008`) |

So the one table that permits destructive edits **by design** records nothing about who performed
them. The system cannot answer *"who changed this amount, from what, to what, and when"* — the
first question anyone asks about a financial discrepancy, and the entire premise of the planned
Report Discrepancy workflow ([BACKLOG.md](BACKLOG.md) B15), which has no substrate until this
exists.

The 3-hour window is a **containment** control, not an accountability one: it bounds how long a
row stays mutable, but within that window an edit is invisible after the fact.

**Threat model.** T2 and T4 — a compromised or misused staff credential can alter recorded giving
within the window and leave no trace. Given one user per church, the person best positioned to do
this is also the only person who would notice.

**Mitigation (free).** Append-only history, trigger-written, so the frontend needs no changes and
cannot forge entries:

```sql
alter table public.collections
  add column if not exists created_by uuid default auth.uid();

create table if not exists public.collections_history (
  id            bigserial primary key,
  collection_id bigint not null,
  op            text    not null check (op in ('UPDATE','DELETE')),
  old_amount    numeric(12,2),
  new_amount    numeric(12,2),
  changed_by    uuid    not null,
  changed_at    timestamptz not null default now()
);
alter table public.collections_history enable row level security;
-- No INSERT/UPDATE/DELETE policy for `authenticated`: the trigger writes as definer,
-- so application roles can never write or rewrite history.
```

Pair with a `SECURITY DEFINER` trigger on `collections` for `UPDATE` and `DELETE`. Grant `SELECT`
only to whichever role §3.14 settles on as the finance authority.

> **Ordering.** `collections.amount` is still `real` — [DEFECTS.md](DEFECTS.md) D1. **Fix that to
> `numeric(12,2)` first**, or the history table faithfully records drifting values.

**Cost.** ~40 bytes per mutation. Mutations are rare by design.

---

### 3.17 CSP violations are silent — Low

**Finding.** [netlify.toml](../netlify.toml) sets a genuinely strict policy — `default-src 'self'`,
`object-src 'none'`, `frame-ancestors 'none'`, no `unsafe-eval` — but carries no `report-uri` or
`report-to`, so when the policy blocks something, nothing is recorded anywhere.

The CSP is the primary compensating control for
[ADR-0005](decisions/0005-jwt-in-localstorage-accepted.md). Today it does that job **blind**: a
blocked injection attempt — the exact event that would tell you the residual risk had become real
— is indistinguishable from a quiet afternoon.

**Mitigation (free).** Point `report-uri` at the in-stack sink from
[ADR-0006](decisions/0006-error-sink-in-stack.md) once it exists. `report-to` needs a companion
`Reporting-Endpoints` header; `report-uri` alone is deprecated but still the most widely honoured,
so emit both.

**Cost.** $0 — same table as ADR-0006.

---

### 3.18 No throttling on authenticated mutation paths — Medium

**Finding.** RLS answers *may this principal touch this row*, not *how often*. Once authenticated,
a client may read and write at API speed. There is no application throttle, no Supabase quota
beyond platform defaults, and no WAF.

A single stolen credential (T4) can enumerate the entire congregation's PII at line rate, or write
unbounded rows into `collections` and `expenses` — both a data-integrity attack and a **cost**
attack, since the free-tier egress and storage budgets are what stand between this project and a
bill ([OPERATIONS.md](OPERATIONS.md) §1).

Supabase Auth's own sign-in rate limits are dashboard configuration and are unreviewed (§3.6).

**Mitigation (free, partial).**

1. Review and tighten Supabase Auth rate limits alongside the §3.6 hardening — same dashboard visit.
2. For the ledger tables, a `BEFORE INSERT` trigger enforcing a per-user ceiling (e.g. 100
   rows/minute) costs one function and converts an unbounded write into a bounded one. Set the
   ceiling well above realistic Sunday entry rates.
3. Add egress and row-count anomalies to the monthly review in
   [security/VERIFICATION.md](security/VERIFICATION.md) so slow-burn abuse surfaces.

Full edge rate limiting would need Cloudflare, which is not adopted — see
[ADR-0005](decisions/0005-jwt-in-localstorage-accepted.md).

**Cost.** $0 for all three.

---

### 3.19 The repository cannot rebuild the system — High

**Finding.** Extends §3.13. Two separately-documented facts combine into something worse than
either:

1. `0006_baseline_rls` is a **record of live state that must not be executed** — registered with
   `prisma migrate resolve --applied` and never run.
2. The trigger on `auth.users` calling `handle_new_user()` and the event trigger calling
   `rls_auto_enable()` exist in **no migration** (§3.13).

Therefore `prisma/migrations/` cannot reconstruct a working database, and the one migration
describing the missing security state is by design non-runnable. Add that no `pg_dump` runs
anywhere and no restore has ever been tested ([OPERATIONS.md](OPERATIONS.md) O11), and recovery
from a lost Supabase project depends on institutional memory of manual dashboard steps.

**Why this is a security finding, not merely operational.** Availability and integrity are
security properties. §3.13 notes that a missing `rls_auto_enable()` event trigger means new tables
are created *without RLS* — so a hand-rebuilt database is not just incomplete, it is **insecure in
a way that produces no error**. The rebuild would appear to work. That is why this is High.

**Mitigation (free).**

1. `scripts/sql/bootstrap-triggers.sql` — idempotent, covering both triggers, captured via §3.13's
   queries.
2. A scheduled `pg_dump` to a GitHub Actions artifact. **The dump contains the full
   congregation's PII** — treat the artifact as production data and do not widen repository
   visibility while it exists.
3. **One dated restore drill**, recorded in [OPERATIONS.md](OPERATIONS.md). An untested backup is
   not a backup.
4. Extend `scripts/sql/capture-security-state.sql` to assert both triggers exist, so drift is
   caught by existing tooling rather than by an incident.

**Cost.** $0. Artifact storage is within the GitHub free allowance at this data size.

---

### 3.20 Release integrity — deploys are not gated, secrets have no rotation path — Medium

**Finding.** Three gaps between commit and production:

1. **CI is advisory.** [ci.yml](../.github/workflows/ci.yml) runs `npm test` and `npm run build` on
   PRs and pushes to `main`, but Netlify builds from the repository independently. Unless the
   Netlify dashboard is configured otherwise — **verify this** — a commit whose tests fail still
   deploys. The guard exists and is wired to nothing.
2. **Migration ordering is enforced by human memory.** Migrations must land before the matching SPA
   release; nothing checks it. The failure mode is a live `column does not exist` error for every
   user — most likely during exactly the [DEFECTS.md](DEFECTS.md) D1/D2 schema work this document
   recommends.
3. **No secret-rotation runbook.** No procedure or trigger condition for rotating
   `VITE_SUPABASE_ANON_KEY`, `DATABASE_URL`, or `DIRECT_URL`, and no written statement of whether a
   service-role key exists or who holds it. §1 asserts the frontend never references one — that is
   a code fact, not an inventory.

**Mitigation (free).**

1. Gate the Netlify build on the GitHub check, or move deployment into the existing workflow so a
   red build cannot ship.
2. Add `npm run prisma:migrate:status` to CI and fail the job when the tree expects a migration
   that is not deployed.
3. Write a rotation runbook in [OPERATIONS.md](OPERATIONS.md): what to rotate, in what order, what
   breaks during the window, and the trigger conditions — staff departure, suspected exposure,
   annual. Include an explicit line recording whether a service-role key exists.

**Cost.** $0.

---

### 3.21 The public check-in endpoint is unauthenticated and cannot be throttled — Medium (accepted residual risk)

**Finding.** `0013_attendance_and_checkin` grants `anon` `EXECUTE` on two `SECURITY DEFINER`
functions — `checkin_session_status(text)` and `submit_checkin(text,text,text)` — so an attendee
can self-register from a QR code with no account. These are the **only two privileges `anon` holds
anywhere in the system**; it still has no table, view, or sequence grant, and no RLS policy names
it. See [ADR-0007](decisions/0007-public-checkin-endpoint.md) for the full reasoning.

This is a sibling of §3.18 and the harder half of it. **Postgres cannot rate-limit an
unauthenticated PostgREST endpoint**: by the time the function body runs, the connection, parse
and planning are already paid for. §3.18's proposed mitigation is a per-*user* insert ceiling, and
an anonymous caller has no user to key on, so it does not transfer. Cloudflare, the control that
would supply edge rate limiting, is not adopted (ADR-0005).

**What bounds it (all $0, all shipped).**

1. **The window.** The endpoint is inert roughly 166 hours out of every 168. Outside a configured
   service window a call costs two index probes and writes nothing. The order of operations inside
   `submit_checkin` is what preserves this and is commented at the site; reordering it for
   readability removes the control.
2. **A 500-row per-service ceiling** on self check-ins. This is an *integrity* guard, not a cost
   one — rows are ~100 bytes and 500 MB holds ~5M. When it trips, self check-in returns `'closed'`
   and **staff recording is unaffected**, so the failure degrades rather than denies.
3. **Idempotence.** Partial unique indexes on `(service_id, member_id)` and on
   `(service_id, guest_name_norm) WHERE source = 'self'` mean repeat submissions write no new
   rows, so the obvious flood does not grow storage.
4. **Bounded input.** Shape checks run before any table is touched; name is capped at 80
   characters and contact at 32, both by CHECK constraints.
5. **`closes_at <= opens_at + interval '24 hours'`.** A stuck-open window is the one drift that
   would quietly turn this into an unbounded write endpoint, so the database refuses to store one.

**What is not mitigated.** A determined attacker who holds a token and calls during a live window
can consume request capacity. The response is operational, not preventive: revoke the two `anon`
grants, which stops self check-in within seconds and leaves staff recording working —

```sql
REVOKE EXECUTE ON FUNCTION public.checkin_session_status(text)     FROM anon;
REVOKE EXECUTE ON FUNCTION public.submit_checkin(text, text, text) FROM anon;
```

— or rotate the church's token via `rotate_my_checkin_token()` if the link itself has leaked.

**Related exposure, deliberately accepted.** Self-registered attendance is **self-asserted, not
verified**: anyone holding the token can claim any member was present. `attendance.source` records
the distinction and every roster surfaces it. The column is withheld from the `INSERT` grant so no
client can forge it. Do not treat this data as evidence.

**New PII.** Guest names and optional contact numbers are now collected from people who are not
users, which enlarges §3.10 — the check-in page carries a collection notice, and `attendance`
cascades from `members` so erasing a member erases their attendance, but no retention policy
exists for guests who never become members.

**Monitoring.** [security/VERIFICATION.md](security/VERIFICATION.md) now checks monthly that
`anon`'s `EXECUTE` grants are *exactly* these two functions, and that no `services` row has a
window longer than 24 hours.

**Cost.** $0.

---

## 4. Tier 2 findings

### 4.1 Unvalidated `facebook_link` URL scheme — Low (latent)

**Finding.** `facebook_link` is captured as free text and currently rendered as plain
interpolation, which Vue escapes — so it is safe today. The risk is **latent**: any future change
binding it to `<a :href="…">` opens `javascript:` URI XSS or `data:` URI phishing.

The same reasoning applies to the one existing `v-html`
([AppSidebar.vue](../src/components/AppSidebar.vue)), which renders hardcoded SVG icons from a
module constant. Safe while the content is static; an injection sink the moment a value from the
database can reach it.

**Mitigation (free).** Validate the scheme on save — the form's `type="url"` checks shape, not
scheme:

```js
function safeFbLink(raw) {
  const v = (raw || '').trim()
  if (!v) return null
  try {
    const u = new URL(v)
    return u.protocol === 'https:' ? u.toString() : null
  } catch { return null }
}
```

When the field eventually renders as a link, add `rel="noopener noreferrer"` and `target="_blank"`.

**Cost.** $0.

---

### 4.2 No `security.txt` — Low

**Finding.** No machine-readable contact for security reports.

**Mitigation (free).** Create `public/.well-known/security.txt` — Vite copies `public/` verbatim
into the build:

```
Contact: mailto:security@<your-org-domain>
Expires: <YYYY-12-31T00:00:00.000Z>
Preferred-Languages: en, fil
Canonical: https://<your-domain>/.well-known/security.txt
```

Update `Expires` yearly.

**Cost.** $0.

---

### 4.4 Default Netlify subdomain visible in DNS — Low

**Finding.** Without a custom domain the deploy is reachable at `<site-name>.netlify.app`.
Subdomain takeover is not a realistic risk on Netlify (they hold the apex), but the default
subdomain is enumerable via certificate-transparency logs.

**Mitigation (free).** Move to a UDFC-controlled custom domain, enable Netlify TLS (Let's Encrypt,
free), and after stability submit it to the [HSTS preload list](https://hstspreload.org).

**Cost.** $0 if a UDFC domain already exists; otherwise a domain registration, out of scope here.

---

## 5. Out of scope for this document

- Penetration testing of Supabase or Netlify themselves — provider responsibility.
- DDoS mitigation beyond what providers offer.
- Insider risk by the Supabase project owner (OOS-1).
- Mobile-device-management posture of staff devices.
- Cryptographic review of the bcrypt parameters used by Supabase Auth.

If any becomes relevant, add it as a new finding here with the cost trade-off explicit — or, if it
resolves into a choice rather than a task, as an ADR in [decisions/](decisions/).

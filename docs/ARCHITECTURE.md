# Architecture — UDFC Church Dashboard

**What this document is:** a reference for how the system is wired *today*. It describes
structure, not policy and not plans.

- Rules that bind a change → [CLAUDE.md](../CLAUDE.md)
- *Why* a load-bearing choice was made → [decisions/](decisions/)
- Threat model and security findings → [SECURITY.md](SECURITY.md)
- Bugs and deferred features → the [issue tracker](https://github.com/aesir19/church-sysyem/issues) · Running it → [OPERATIONS.md](OPERATIONS.md)
- Tables, columns, policies, grants, functions → `prisma/schema.prisma` and `prisma/migrations/`,
  which are the source of truth. This document does not transcribe them.

---

## 1. Shape of the system

Two tiers. There is no application server.

```
┌────────────────────────────┐         HTTPS          ┌──────────────────────────┐
│  Browser — Vue 3 SPA       │  ───────────────────▶  │  Supabase                │
│  · Vue Router + auth guard │  @supabase/supabase-js │  ├─ GoTrue (Auth)        │
│  · Views own their queries │  ◀───────────────────  │  ├─ PostgREST            │
│  · Pure logic in src/utils │       JWT session      │  └─ Postgres + RLS       │
└────────────────────────────┘                        └──────────────────────────┘
        ▲
        │ static assets (dist/)
┌────────────────────────────┐
│  Netlify CDN               │
│  · SPA fallback → index    │
│  · CSP + cache headers     │
└────────────────────────────┘
```

The Supabase **anon key ships to the browser**. That is safe only because Row Level Security
gates every query — see [ADR-0001](decisions/0001-rls-is-the-only-authz.md). Prisma is
schema/migration tooling run from Node; it never executes in the browser.

| Attribute | Value |
|---|---|
| Product | UDFC Church Dashboard (`church-dashboard`) |
| Owner | United Door of Faith Church — internal use |
| Users | Authorized church staff; one user maps to exactly one church |
| Hosting | Netlify (static) + Supabase (free tiers) |

## 4. Frontend

### 4.1 Bootstrap

[main.js](../src/main.js) mounts `App.vue` (a bare `<router-view />`) with the router and global
styles. `Sentry.init({ app })` installs `app.config.errorHandler`, but **only when
`VITE_SENTRY_DSN` is set** — Vite inlines that at build time, so a DSN-less build tree-shakes
`@sentry/vue` out entirely and has no global handler at all. See
[ADR-0008](decisions/0008-sentry-alongside-in-stack-sink.md).

### 4.3 The navigation guard

`router.beforeEach` runs on every navigation and can issue up to three sequential queries.

**`/checkin` short-circuits before any of them.** It is reached by attendees with no account at
all, so the public page never costs an auth round-trip, and a staff member who scans the QR on
their own phone is not bounced to the dashboard by the signed-in redirect. See
[ADR-0007](decisions/0007-public-checkin-endpoint.md).

Otherwise:

1. `supabase.auth.getSession()` — always. No session on a `requiresAuth` route → `/login`.
2. `isAccountLinked()` — reads `user_accounts` by `auth.uid()`. An authenticated user with no
   linked row is sent to `/account-pending`. This is how invited-but-unlinked staff are held.
3. `fetchCapabilities()` — on routes carrying `meta.requiresCapability` only. One
   `get_my_permissions()` RPC, passed through `deriveCapabilities()` and `routeAllowed()` in
   `src/utils/capabilities.js`. A caller lacking the capability is sent to `/dashboard/members`,
   which is the safe fallback because it is reachable by every role.

Two things about this that matter:

- **The guard is UX, not security.** A user who defeats it still hits RLS. Authorization is
  enforced server-side by the RBAC predicates from `0014`–`0017`.
- **It is the project's main per-navigation cost.** The serial round-trips are still open —
  `useCurrentRole` already caches permissions per session, and the guard does not use that cache.

A separate `onAuthStateChange` listener handles only `PASSWORD_RECOVERY`; an invite or recovery
token in the URL hash sets `pendingPasswordSet`, which diverts to `/set-password`. **Nothing
handles session expiry** — on refresh-token failure the user sees a raw `JWT expired` string.

### 4.4 Supabase client

[src/lib/supabase.js](../src/lib/supabase.js) reads `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` from `import.meta.env` and **throws at startup** if either is missing,
so a misconfigured deploy fails closed rather than silently unauthenticated. It exports one
shared client. Do not construct another.

### 4.7 Styling

Global reset only in [src/style.css](../src/style.css); everything else is `<style scoped>` per
SFC. Palette and radius are in [CLAUDE.md](../CLAUDE.md). `ChurchFundsView` carries a print
stylesheet so the report saves to PDF from the browser.

One exception to the "no `v-html`" posture: [AppSidebar.vue](../src/components/AppSidebar.vue)
renders nav icons with `v-html` from a hardcoded module-level array. The content is static and
never user-derived, so it is not an injection path today — but any change that lets a value
reach that binding from the database is one.

## 5. Backend (Supabase)

### 5.1 Authorization

Per-church isolation is a `SECURITY DEFINER` helper plus RLS policies. `get_my_church_id()`
resolves `auth.uid() → user_accounts → members.member_of` and is `SECURITY DEFINER` because it
reads `members` itself — without that, the policy on `members` would recurse.

**The migrations are the source of truth for every policy and grant.** `0006_baseline_rls`
transcribes policies that had only ever existed in the Supabase dashboard; `0007`–`0009` fix the
defects that baseline exposed; `0014`–`0017` replace the original name-based finance check with
role and ministry predicates, keyed on the system-managed `groups.ministry_key` slug rather than
the editable `groups.name`. Re-run `scripts/sql/capture-security-state.sql` to check live state
against them.

The shape, in one paragraph: reads are church-scoped, writes on the funds tables are
additionally finance-gated. `members` has no DELETE policy at all — archiving is the only
deletion path. `churches` is reachable only through the `get_my_church()` RPC; `authenticated`
holds no grant on the table. Grants were narrowed in `0009` to exactly what the SPA calls, and
`anon` holds none. Two constraints on that grant table are load-bearing rather than tidy:
`collections.UPDATE` is column-scoped to `(amount)` so a caller cannot reset `created_at` to
extend their own edit window, and `groups` INSERT/UPDATE are column-scoped so the app cannot
submit `color_slot`.

Three consequences that bite in application code, all in
[ADR-0001](decisions/0001-rls-is-the-only-authz.md):

1. **`members SELECT` returns archived rows.** `0010` removed `archived_at IS NULL` from the
   policy because Postgres evaluates SELECT against the *new* row during an UPDATE, which made
   archiving impossible. Filtering is now the application's job on every read.
2. **`collections INSERT` deliberately does not validate the contributor's church.** Visiting
   members give at other churches' services. Do not add `is_member_in_my_church()` there — read
   [ADR-0003](decisions/0003-nullable-collections-from.md) first.
3. **Funds `SELECT` is not finance-gated.** The reports page is not a finance-only route, so
   gating reads would break it for everyone else.

> **RLS does not filter `archived_at`, and has not since `0010`.** The filter is the
> application's job on every read — see [CONTEXT.md](../CONTEXT.md) *Archive*. It now lives inside
> `listRecords()` in `src/lib/data/members.js` rather than being repeated at each call site.

### 5.2 Archiving

Members are never hard-deleted. `archived_at` (`NULL` = active) plus an optional
`archived_reason`, with an active-only partial index so filtering stays fast as archived rows
accumulate. Un-archiving is a manual SQL operation — no UI (issue #39).

### 5.3 Authentication

Supabase Auth, email + password, bcrypt server-side. The JWT session is persisted by the SDK in
`localStorage` (v2 default) — an accepted XSS exposure, compensated by CSP; the analysis is in
[SECURITY.md](SECURITY.md) §3.4. Linking a new auth user to a member row is a manual operation;
the `handle_new_user()` trigger on `auth.users` creates the `user_accounts` row.

### 5.4 `public.collectives_service_totals`

The only database view. `collections` and `expenses` each aggregated to one row per
`(from_church, service_date)` and `FULL OUTER JOIN`ed, so a date with only one of the two still
appears — roughly 52 rows per church per year.

It exists so the report can derive a running opening balance without downloading the whole
ledger, and it is a *view* rather than a stored balance so that correcting a three-month-old
entry immediately re-derives everything after it. There is no month-close step and nothing is
ever frozen.

`security_invoker = on` is **load-bearing**: without it the view would run as its owner, bypass
the base tables' policies, and expose every church's ledger summary to every authenticated user.
Grants follow `0009`'s pattern — `REVOKE ALL FROM anon, authenticated` *first*, because
Supabase's default privileges fire on every new object in `public` and `GRANT` is additive.

Verify with:

```sql
SELECT relname, reloptions FROM pg_class WHERE relname = 'collectives_service_totals';
-- reloptions must contain security_invoker=on
```

### 5.5 Prisma layer

Prisma owns the source-controlled schema and migration workflow against the existing Supabase
database. `DATABASE_URL` may be pooled; `DIRECT_URL` must be the non-pooled connection
(port 5432) that migrations use. Frontend runtime queries stay on `supabase-js` so RLS keeps
enforcing authorization. Commands and their preflight checks are in
[package.json](../package.json); the deploy procedure and its ordering constraint are in
[OPERATIONS.md](OPERATIONS.md).

## 6. Build and deploy

Vite builds to `dist/`; Netlify publishes it with an SPA fallback so deep links resolve.
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` must be present **at build time** and are set in
the Netlify dashboard, not committed. [netlify.toml](../netlify.toml) also carries the cache
headers (`/assets/*` immutable, `index.html` no-cache) and the full security header set — CSP,
HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, COOP.
GitHub Actions runs `npm test` and `npm run build` on PRs and pushes to `main`.

## 7. Data flows

**Sign in →** `signInWithPassword` stores the JWT in `localStorage` → guard sees a session →
`DashboardLayout` resolves the user's first name (cached in `localStorage` as `udfc.myUserName`)
→ `DashboardView` runs `get_my_church()` and the member fetch in parallel → PostgREST attaches
the JWT, Postgres evaluates `get_my_church_id()` inside each policy → rows return.

**Create →** modal opens with `member_of` pinned to the resolved church → `insert(...).select(MEMBER_COLUMNS).single()`
→ the INSERT policy re-checks the church and that the row starts un-archived → row prepended.

**Edit →** `update(...).eq('id', id).select(MEMBER_COLUMNS).single()` → the UPDATE policy's
`with check` blocks reassigning `member_of` to another church → row spliced in place.

**Archive →** `update({ archived_at, archived_reason })` → the row stays in the database and is
filtered out client-side. Subsequent reloads exclude it **because the query says
`.is('archived_at', null)`, not because RLS hides it.**

**Monthly report →** `collectives_service_totals` once for the opening balance, then
`collections` + `expenses` scoped to the month → reshaped by `collectivesSource.js` and
`reportExpenseMerge.js` → `computeMonthlyReport()` does all allocation → view renders.

---

## What this document deliberately does not contain

Sections 2, 3, 4.2, 4.5 and 4.6 were removed on 2026-08-11. They transcribed the stack, the
directory tree, the route table, the view inventory and the utils list — all of which the code
already states, and all of which had drifted (§3 still described `useFinanceMember.js`, deleted
months earlier).

Numbering is left with gaps on purpose, so existing `§5.1`-style references still resolve.

Read the code for structure:

| Question | Read |
|---|---|
| What is the stack, at what version? | `package.json` |
| What lives where? | `ls src/` |
| What routes exist, and which are guarded? | `src/router/index.js` |
| What does a view do? | the SFC |
| What pure logic exists? | `src/utils/`, each with a matching test |
| What tables, columns, policies, grants? | `prisma/schema.prisma`, `prisma/migrations/` |

What stays here is the part the code does not state: how the tiers fit together, why the anon key
is safe to ship, how authorization is meant to work, and how data flows through a request.

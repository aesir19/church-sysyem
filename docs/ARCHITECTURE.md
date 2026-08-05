# Architecture — UDFC Church Dashboard

**What this document is:** a reference for how the system is wired *today*. It describes
structure, not policy and not plans.

- Rules that bind a change → [CLAUDE.md](../CLAUDE.md)
- *Why* a load-bearing choice was made → [decisions/](decisions/)
- Threat model and security findings → [SECURITY.md](SECURITY.md)
- Bugs → [DEFECTS.md](DEFECTS.md) · Deferred features → [BACKLOG.md](BACKLOG.md) · Running it → [OPERATIONS.md](OPERATIONS.md)
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

## 2. Stack

| Layer | Choice |
|---|---|
| UI | Vue 3, Composition API, `<script setup>` |
| Routing | Vue Router 4 |
| Build | Vite 6 |
| Tests | Vitest (`environment: 'node'`) |
| Backend SDK | `@supabase/supabase-js` v2 |
| Schema tooling | Prisma CLI + migrations (Node only) |
| Database | Supabase Postgres + Auth |
| Modules | ESM |

Deliberately absent: TypeScript, a linter, a state library, a UI component kit, a data-access
layer. Versions live in [package.json](../package.json) — not repeated here.

## 3. Where things live

Directory purposes, not a file inventory (`ls src/` gives you that).

| Path | Holds |
|---|---|
| `src/views/` | One SFC per screen. Each **owns its own Supabase queries inline** — there is no API layer (see [DEFECTS.md](DEFECTS.md) D16) |
| `src/layouts/` | `DashboardLayout.vue` — sidebar shell wrapping every `/dashboard/*` child |
| `src/components/` | `AppSidebar.vue` (nav), `FundsTabs.vue` (finance-gated Funds sub-nav) |
| `src/composables/` | `useFinanceMember.js` — resolves the caller's Finance Team membership |
| `src/utils/` | **Pure functions, no I/O.** Every file here has a matching test in `tests/utils/` |
| `src/lib/` | `supabase.js` — the single client instance |
| `src/router/` | Routes plus the global `beforeEach` guard |
| `prisma/` | `schema.prisma` and numbered SQL migrations, each with an operational `rollback.sql` |
| `scripts/prisma/` | Env preflight checks that gate the Prisma npm scripts |
| `scripts/sql/` | `capture-security-state.sql` — read-only audit of live policies, grants, functions, views |
| `tests/` | Vitest suites, mirroring `src/` |

The `src/utils/` split is structural, not stylistic: it is the only reason any business logic in
this project is testable without mounting a view.

## 4. Frontend

### 4.1 Bootstrap

[main.js](../src/main.js) mounts `App.vue` (a bare `<router-view />`) with the router and global
styles. `app.config.errorHandler` is **unset** — see [OPERATIONS.md](OPERATIONS.md) O2.

### 4.2 Routes

Defined in [src/router/index.js](../src/router/index.js).

| Path | Name | Component | Meta |
|---|---|---|---|
| `/` | — | redirect → `/login` | — |
| `/login` | `Login` | `LoginView` | — |
| `/set-password` | `SetPassword` | `SetPasswordView` | `requiresAuth` |
| `/account-pending` | `AccountPending` | `AccountPendingView` | `requiresAuth` |
| `/dashboard` | — | `DashboardLayout` | `requiresAuth` |
| `/dashboard` (index) | — | redirect → `/dashboard/members` | inherited |
| `/dashboard/members` | `Members` | `DashboardView` | inherited |
| `/dashboard/ministry` | `Ministry` | `MinistrySmallGroupView` | inherited |
| `/dashboard/funds` | — | redirect → `/dashboard/funds/reports` | inherited |
| `/dashboard/funds/reports` | `ChurchFunds` | `ChurchFundsView` | inherited |
| `/dashboard/funds/collections` | `Collections` | `CollectionsInputView` | `+ requiresFinance` |
| `/dashboard/funds/expenses` | `Expenses` | `ExpensesInputView` | `+ requiresFinance` |

All components are **eagerly imported**; there is no lazy loading and no catch-all route
([DEFECTS.md](DEFECTS.md) D9, D13).

### 4.3 The navigation guard

`router.beforeEach` runs on every navigation and can issue up to three sequential queries:

1. `supabase.auth.getSession()` — always. No session on a `requiresAuth` route → `/login`.
2. `isAccountLinked()` — reads `user_accounts` by `auth.uid()`. An authenticated user with no
   linked row is sent to `/account-pending`. This is how invited-but-unlinked staff are held.
3. `hasFinanceRole()` — on `requiresFinance` routes only: `user_accounts → member_id`, then
   `group_members` joined to a group literally **named `'Finance Team'`**. Failure sends the
   user to `/dashboard/funds/reports`.

Two things about this that matter:

- **The guard is UX, not security.** A user who defeats it still hits RLS. Finance writes are
  gated server-side by `is_finance_member()` (`0008_funds_write_policies`).
- **It is the project's main per-navigation cost.** The serial round-trips are
  [DEFECTS.md](DEFECTS.md) D7; keying finance on a mutable display name is D4.

A separate `onAuthStateChange` listener handles only `PASSWORD_RECOVERY`; an invite or recovery
token in the URL hash sets `pendingPasswordSet`, which diverts to `/set-password`. Nothing
handles session expiry (D6).

### 4.4 Supabase client

[src/lib/supabase.js](../src/lib/supabase.js) reads `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` from `import.meta.env` and **throws at startup** if either is missing,
so a misconfigured deploy fails closed rather than silently unauthenticated. It exports one
shared client. Do not construct another.

### 4.5 Views

Each view fetches its own data on mount and mutates pessimistically — local state changes only
after Supabase confirms.

| View | Screen | Tables it touches |
|---|---|---|
| `LoginView` | Email/password sign-in | `auth` only |
| `SetPasswordView` | Invite/recovery password set | `auth` only |
| `AccountPendingView` | Holding page for an unlinked account | `auth` only |
| `DashboardView` | Member list, sortable, with a tri-mode modal (view/create/edit/archive-confirm) | `members`, `get_my_church()` |
| `MinistrySmallGroupView` | Ministry catalog (read-only) + church-owned small groups | `groups`, `group_members`, `members` |
| `ChurchFundsView` | Monthly collectives report, print-to-PDF | `collectives_service_totals`, `collections`, `expenses` |
| `CollectionsInputView` | Tithes/offering entry, 3-hour edit window | `collections`, `members`, `get_my_church()` |
| `ExpensesInputView` | Month-scoped expense entry | `expenses`, `get_my_church()` |

Two views carry logic worth knowing before editing them:

**`ChurchFundsView`** renders a monthly report modeled on the paper "DFC Summary Report"
workbook. It issues three live reads — the `collectives_service_totals` view once on mount (for
the opening balance, replayed by `openingBalanceForMonth()`), then `collections` and `expenses`
range-scoped per month, with a request-id guard discarding out-of-order responses from fast
prev/next clicking. **All allocation math lives in
[collectivesReport.js](../src/utils/collectivesReport.js)**, never in the view and never in SQL
— see [ADR-0004](decisions/0004-view-aggregates-but-does-not-allocate.md), which also explains
the two-denominator problem the allocation panel exists to avoid re-introducing.

**`MinistrySmallGroupView`** works against one `groups` table where a `Ministry` has
`church_id IS NULL` and a `Small Group` has a required `church_id`. Ministries are read-only in
the app; only small groups can be created, renamed, or deleted. Group colors are assigned by a
Postgres trigger from a 3,240-slot space with a global unique constraint — there is no color
picker, and `color_slot` is not in the app's column grants.

### 4.6 Pure logic layer

`src/utils/` holds thirteen I/O-free modules, each with a test. The ones that encode a rule
rather than a helper:

| Module | Encodes |
|---|---|
| `collectivesReport.js` | The whole allocation model — the single source of truth for it |
| `collectivesSource.js` | Live rows → calculator shapes; opening-balance replay |
| `reportExpenseMerge.js` | Folds expenses into per-service weeks; a date with expenses but no service becomes its own week |
| `collectionPayload.js` | Insert payload + `contributorLabel()`, which keeps "Anonymous" (`from IS NULL`) distinct from "Unknown" (unreadable member) — see [ADR-0003](decisions/0003-nullable-collections-from.md) |
| `collectionsDate.js` | Service-date auto-selection and the 3-hour edit-window check |
| `mutationResult.js` | Shared mutation outcome contract, incl. `EDIT_WINDOW_CLOSED_MESSAGE` |
| `expensesMonth.js` | Month parsing and range bounds for month-scoped queries |

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
defects that baseline exposed. Re-run `scripts/sql/capture-security-state.sql` to check live
state against them.

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
   members give at other churches' services. Do not add `is_member_in_my_church()` there — see
   [BACKLOG.md](BACKLOG.md) B17 first.
3. **Funds `SELECT` is not finance-gated.** The reports page is not a finance-only route, so
   gating reads would break it for everyone else.

> **Stale comment warning.** [DashboardView.vue:457](../src/views/DashboardView.vue#L457) still
> claims RLS filters `archived_at`. It does not, and has not since `0010`. The query below it is
> correct because it filters explicitly; the comment is not.

### 5.2 Archiving

Members are never hard-deleted. `archived_at` (`NULL` = active) plus an optional
`archived_reason`, with an active-only partial index so filtering stays fast as archived rows
accumulate. Un-archiving is a manual SQL operation — no UI ([BACKLOG.md](BACKLOG.md) B1).

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

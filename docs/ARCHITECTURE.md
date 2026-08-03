# UDFC Church Dashboard — Architecture & System Design (AI Context)

> **Purpose of this document:** Provide an AI assistant with a concise, structured, and accurate snapshot of the current system so it can reason about, modify, and extend the codebase without re-discovering context.
>
> **Last reviewed against source:** Reflects the state of `main` / `user-mgmt` branch as of the current workspace.

---

## 0. Project Goal & Priority Order

This is a public-internet deployment of an internal-organization tool. Every architectural and implementation decision MUST be evaluated against the following priority order, in order:

1. **Cost — keep operating cost at $0/month indefinitely.** Binding constraint. See §12 ("Free-Tier Operating Plan") for the budgets, principles, and thresholds that follow from this. Any change that risks pushing the project off the free tier requires an explicit owner decision before work begins.
2. **Security — close second.** The app is reachable from the public internet and stores PII (names, birthdates, addresses, contact info, baptismal status) for church members. Security controls MUST be applied unless they conflict with priority 1; when they do, prefer the controls in [SECURITY.md](SECURITY.md) Tier 1 (all free) and document any deferred control with its cost rationale. The default posture is "fail closed" — if a feature can't be made safe within the free-tier budget, it is not built.
3. Everything else (DX, polish, additional features) ranks below the two above.

When priorities 1 and 2 conflict, the resolution is captured in [SECURITY.md](SECURITY.md) — read that document alongside §12 of this file before proposing changes that touch auth, data exposure, or deployment configuration.

---

## 1. Project Identity

| Attribute | Value |
|---|---|
| Product name | UDFC Church Dashboard |
| Internal package name | `church-dashboard` (see [package.json](package.json)) |
| Owner | United Door of Faith Church (UDFC) — internal use |
| Domain | Church member records management |
| Primary user | Authorized church staff (one user → one church) |
| Deployment target | Netlify (static SPA) |

---

## 2. High-Level Architecture

The system is a **two-tier serverless web app**:

```
┌──────────────────────────┐         HTTPS          ┌──────────────────────────┐
│  Browser (Vue 3 SPA)     │  ───────────────────▶  │  Supabase                │
│  - Vue Router            │   @supabase/supabase-js│  ├─ Auth (bcrypt)        │
│  - Views: Login,         │  ◀───────────────────  │  ├─ PostgREST API        │
│    Dashboard             │       JWT session      │  └─ Postgres + RLS       │
└──────────────────────────┘                        └──────────────────────────┘
        ▲
        │ static assets
        │
┌──────────────────────────┐
│  Netlify CDN             │
│  - serves dist/          │
│  - SPA redirect → /index │
└──────────────────────────┘
```

- **No custom backend.** All business logic, authentication, and authorization run in Supabase.
- **Authorization is enforced by Postgres Row Level Security (RLS)** — never trust the client.
- The Supabase **anon key is shipped to the browser**; this is safe because RLS gates every query.

---

## 3. Tech Stack

| Layer | Technology | Version |
|---|---|---|
| UI framework | Vue 3 (Composition API, `<script setup>`) | `^3.5.13` |
| Routing | Vue Router 4 | `^4.5.0` |
| Build tool | Vite | `^6.3.5` |
| Vue plugin | `@vitejs/plugin-vue` | `^5.2.3` |
| Testing | Vitest | `^4.1.9` |
| Backend SDK | `@supabase/supabase-js` | `^2.49.1` |
| Database ORM tooling | Prisma CLI + Prisma Client | `^6.16.0` |
| Backend (BaaS) | Supabase (Postgres + Auth) | n/a |
| Hosting | Netlify | n/a |
| Module type | ESM (`"type": "module"`) | — |
| State management | None (local component state via `ref` / `computed`) | — |
| CSS | Plain CSS (scoped per SFC) + global [src/style.css](src/style.css) | — |

There is **no TypeScript, no linter, no Pinia/Vuex, and no UI component library.** Prisma is used for **schema introspection and migrations only** (Node CLI), not for browser runtime queries.

---

## 4. Repository Layout

```
dashboard-project/
├── .github/
│   └── workflows/
│       └── ci.yml            # GitHub Actions gate: npm test + npm run build
├── index.html                  # Single HTML entry; mounts #app
├── netlify.toml                # build = `npm run build`, publish = `dist`, SPA fallback redirect
├── package.json                # Scripts: dev, build, preview, test
├── vite.config.js              # Minimal — only registers @vitejs/plugin-vue
├── vitest.config.js            # Vitest runner config
├── README.md                   # Human-facing setup & deployment guide
├── prisma/
│   ├── schema.prisma           # Prisma data model mapped to Supabase Postgres
│   └── migrations/             # SQL migrations managed by Prisma
├── prisma.config.js            # Prisma CLI configuration
├── scripts/
│   └── prisma/
│       ├── check-env.js        # Prisma env preflight checks
│       └── env-utils.js        # Shared env validation helpers
├── public/
│   └── vite.svg                # Favicon (default Vite asset)
├── tests/                      # Unit tests (router guards + security/util logic)
│   └── prisma/                 # Prisma env validation tests
└── src/
    ├── main.js                 # createApp(App).use(router).mount('#app')
    ├── App.vue                 # Root component — renders <router-view /> only
    ├── style.css               # Global reset + body font (Segoe UI stack)
    ├── lib/
    │   └── supabase.js         # Singleton Supabase client (uses VITE_SUPABASE_*)
    ├── router/
    │   └── index.js            # Routes + global beforeEach auth guard
    ├── utils/
    │   └── collectivesReport.js # Pure calculator for the monthly collectives report
    │   └── collectionsDate.js   # Service-date auto-selection + 3-hour edit window check
   │   └── expensesMonth.js     # Month parsing and date-range helpers for expenses queries
    └── views/
        ├── LoginView.vue       # Email/password sign-in form
        ├── DashboardView.vue   # Members table + sortable columns + details modal
        ├── ChurchFundsView.vue # Monthly collectives report (allocations, expenses, balance)
      ├── CollectionsInputView.vue # Tithes & offerings data entry + recent entries
      └── ExpensesInputView.vue # Monthly expense entry with existing/new description flow
```

---

## 5. Frontend Architecture

### 5.1 Entry & Bootstrap
- [src/main.js](src/main.js) creates the Vue app, registers the router, imports global styles, mounts `#app`.
- [src/App.vue](src/App.vue) is intentionally minimal — only `<router-view />`.

### 5.2 Routing & Auth Guard

Defined in [src/router/index.js](src/router/index.js):

| Path | Name | Component | Meta |
|---|---|---|---|
| `/` | — | redirect → `/login` | — |
| `/login` | `Login` | `LoginView` | — |
| `/set-password` | — | `SetPasswordLayout` (children below) | `requiresAuth: true` |
| `/dashboard/members` | `Members` | `SetPasswordView` | (inherited) |
| `/dashboard/ministry` | `Ministry` | `MinistrySmallGroupView` | (inherited) |
| `/dashboard/reports` | `Reports` | `ReportsView` | (inherited) |
| `/dashboard/funds` | — | redirect → `/dashboard/funds/reports` | (inherited) |
| `/dashboard/funds/reports` | `ChurchFunds` | `ChurchFundsView` | (inherited) |
| `/dashboard/funds/collections` | `Collections` | `CollectionsInputView` | `requiresFinance: true` |
| `/dashboard/funds/expenses` | `Expenses` | `ExpensesInputView` | `requiresFinance: true` |
| `/account-pending` | `AccountPending` | `AccountPendingView` | `requiresAuth: true` |
| `/dashboard` | — | `DashboardLayout` | `requiresAuth: true` |

`/dashboard` child routes:
- `/dashboard/members` (`Members`)
- `/dashboard/ministry` (`Ministry`)
- `/dashboard/funds/reports` (`ChurchFunds`)
- `/dashboard/funds/collections` (`Collections`) — **finance role required**
- `/dashboard/funds/expenses` (`Expenses`) — **finance role required**

`router.beforeEach` calls `supabase.auth.getSession()` on every navigation:
- Redirects unauthenticated users away from `requiresAuth` routes → `/login`.
- Redirects authenticated users away from `/login` → `/dashboard`.
- Redirects non-finance users away from `requiresFinance` routes → `/dashboard/funds/reports`.
- **Note:** `getSession()` is awaited per navigation; this is acceptable because the session is cached client-side by the Supabase SDK.

### 5.3 Supabase Client

[src/lib/supabase.js](src/lib/supabase.js):
- Reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from `import.meta.env`.
- Throws a startup error if either variable is missing so invalid deployments fail closed.
- Exports a single shared `supabase` client.

### 5.4 Views

#### `LoginView.vue` — [src/views/LoginView.vue](src/views/LoginView.vue)
- Local `ref`s: `email`, `password`, `loading`, `errorMessage`.
- `handleLogin()` calls `supabase.auth.signInWithPassword({ email, password })` and on success pushes to `/dashboard`.
- Displays SDK error message verbatim on failure.
- Pure presentational + scoped CSS; gradient blue background, centered card.

#### `DashboardView.vue` — [src/views/DashboardView.vue](src/views/DashboardView.vue)
Single-screen view containing all member-management UX.

**State:**
- `members` — array fetched once on mount via `supabase.from('members').select(MEMBER_COLUMNS)` (column-explicit; no per-row church join — see §12.3 rule 1).
- `loading`, `error` — request lifecycle flags.
- `modalMode` — drives the tri-mode modal: `'view' | 'create' | 'edit' | 'archive-confirm' | null` (null = closed).
- `selectedMember` — the row being viewed / edited / archived (null in `create` mode).
- `formData`, `formError`, `formSaving` — shared by `create` and `edit` modes.
- `archiveReason` — captured by the in-modal archive confirmation panel.
- `myChurchId`, `myChurchName` — resolved on mount via a single `supabase.rpc('get_my_church')` returning `(id, name)`. `myChurchName` is also cached in `localStorage` (`udfc.myChurchName`) so the page title renders pre-fetch on cold opens; `handleLogout()` clears the cache. Used to pre-fill `member_of` on create and to label the read-only "Member Of" form field.
- `sortKey`, `sortDir` — current column sort.

**Behavior:**
- Fetches once `onMounted`. RLS at the DB level filters rows to the user's church AND `archived_at IS NULL` automatically.
- `pageTitle` computes `"UDFC <church> Members"` from `myChurchName` (which is hydrated synchronously from `localStorage` on cold open; falls back to `"Members"` until the RPC resolves on the very first run).
- `computeAge(birthdate)` — local calculation based on today's date.
- `setSort(key)` toggles direction or switches column; `sortedMembers` is a `computed` returning a stable copy with `localeCompare` for strings and numeric subtraction otherwise.
- Row click → `openDetails(member)` opens the modal in `view` mode; `Escape` closes it (listener attached/detached on mount/unmount).
- `openCreate()` opens the modal in `create` mode with a blank `formData` (disabled if `myChurchId` is unresolved).
- `startEdit()` (Edit icon in modal header, view mode only) copies `selectedMember` → `formData` and switches to `edit`.
- `startArchive()` (red "Archive member" link in the view footer) switches the modal body to an in-modal confirmation panel — no native `confirm()`, no second modal.
- `cancelForm()` — from `edit` returns to `view`; from `create` closes entirely.
- `cancelArchive()` — returns from `archive-confirm` back to `view`.
- `handleLogout()` → `supabase.auth.signOut()` then `router.push('/login')`.

**Mutation handlers (all pessimistic — local state only mutates after Supabase confirms):**
- `handleCreate()` → `supabase.from('members').insert({ ...buildPayload(), member_of: myChurchId }).select(MEMBER_COLUMNS).single()` → prepend to `members`, close modal. RLS rejects any other `member_of`.
- `handleUpdate()` → `supabase.update(buildPayload()).eq('id', id).select(MEMBER_COLUMNS).single()` → splice the row in `members` by id, return modal to `view` mode. The UPDATE policy's `with check` blocks reassigning `member_of` to another church.
- `handleArchive()` → `supabase.update({ archived_at: new Date().toISOString(), archived_reason })` → filter the row out of `members` (RLS will hide it on subsequent reloads too).
- `buildPayload()` trims strings and coerces empty optional fields to `null` so the DB stores `NULL` rather than `""`.

#### `ChurchFundsView.vue` — [src/views/ChurchFundsView.vue](src/views/ChurchFundsView.vue)
Renders a **monthly collectives report** modeled after the paper "DFC Summary Report" workbook (one weekly Collectives sheet per Sunday, rolled up into a month).

**Composition:**
- Funds tab navigation (Reports / Collections / Expenses) shared with the other Church Funds views.
- Header + preview banner (data source is a sample fixture; Supabase persistence is a follow-up).
- Month navigator (prev/next).
- KPI cards: Total Funds, Tithes, Offering, Expenses, Closing Balance.
- Weekly Breakdown table: one column per service Sunday + a Month total column.
- Allocations panel with a proportional distribution bar.
- Expenses table (aggregated by description).
- Contributors table (aggregated by name; anonymous entries grouped as "Unknown").
- Rolling balance card: Church Allocation − Expenses + Opening Balance = Current Church Funds.
- Print stylesheet so the page saves cleanly to PDF via the browser.

**Data flow:**
- `SAMPLE_COLLECTIVES` fixture in [src/utils/sampleCollectives.js](src/utils/sampleCollectives.js) feeds a `Map` of `"<year>-<month>" → month data`.
- Live rows from `public.expenses` are loaded month-by-month and merged into the report source via [src/utils/reportExpenseMerge.js](src/utils/reportExpenseMerge.js), replacing fixture expenses for that month when live expenses exist.
- The month cursor drives a `computed` that calls `computeMonthlyReport(...)` from [src/utils/collectivesReport.js](src/utils/collectivesReport.js).
- All allocation math (10 % tithes-of-tithes, 5 % project, 5 % student program with an optional personal draw, 50/50 pastor/church split of the remainder, expenses off church allocation, opening balance carry) lives in the calculator so the view stays presentational.
- Contribution lines remain sample-backed for now; expense persistence is live.

#### `CollectionsInputView.vue` — [src/views/CollectionsInputView.vue](src/views/CollectionsInputView.vue)
Data-entry view nested under Church Funds (`/dashboard/funds/collections`). Allows staff to record individual tithes and offerings.

**Composition:**
- Form: contributor lookup from the `members` table, type (tithes / offering), amount, and service date.
- Recent entries table (name + type + date only — amount is hidden until a row is clicked).
- Detail modal on row click shows amount; supports inline editing and deletion.

**Key logic:**
- **Auto service-date** — computed by `getDefaultServiceDate()` in [src/utils/collectionsDate.js](src/utils/collectionsDate.js): Sunday/Friday → today; Saturday → Friday; Mon–Thu → previous Sunday.
- **3-hour edit window** — `isWithinEditWindow(created_at)` returns `true` only within 3 hours of insertion. After that the record is locked (no edit/delete from the UI).
- **Pessimistic mutations** — insert/update/delete go through Supabase; local state updates only on success.

**Data flow:**
- Reads/writes the `collections` table via `supabase.from('collections')`, storing the contributor as `collections.from` (member UUID), the kind as `is_tithes`, and the service date as `collectedOn`. The 3-hour edit lock depends on `collections.created_at`. RLS enforces per-church isolation.

**Future plan:**
- A "Report Discrepancy" button will allow a user to request editing or deletion of a locked entry under the `collections` table. This will involve a `collection_discrepancies` table (or similar) where requests are queued for an admin to approve.
- **Multiple anonymous contributors per service (requested).** Tithes from people who are not named must be recordable as *several individual entries* — one per giver, each with its own amount — rather than a single collective total. The intent is that the count of anonymous givers and the distribution of their amounts both survive into the report, instead of collapsing into one lump sum. See §9.16 for the blocker and the design options.

#### `ExpensesInputView.vue` — [src/views/ExpensesInputView.vue](src/views/ExpensesInputView.vue)
Data-entry view nested under Church Funds (`/dashboard/funds/expenses`). Allows staff to record month-scoped operating expenses.

**Composition:**
- Funds tab navigation (Reports / Collections / Expenses).
- Month filter (`YYYY-MM`) that scopes the list and the "existing description" options.
- Expense form (date spent, amount, description choice, optional notes).
- Monthly table with per-row expense entries and a month total summary.

**Key logic:**
- Users can either select an existing description from expenses already recorded in the selected month, or choose "Create new description" and enter a new label.
- Date and month are synchronized so entering an expense date automatically targets that month for filtering.
- Mutations are pessimistic: the UI updates only after Supabase confirms INSERT success.

**Data flow:**
- Reads/writes the `expenses` table via `supabase.from('expenses')`.
- Month boundaries for queries are computed by [src/utils/expensesMonth.js](src/utils/expensesMonth.js).
- Per-church isolation is enforced by RLS on `expenses`.

#### `MinistrySmallGroupView.vue` — [src/views/MinistrySmallGroupView.vue](src/views/MinistrySmallGroupView.vue)
Manages a shared ministry catalog and church-owned small groups without introducing a central-admin role.

**Data model and bootstrap:**
- `public.groups` remains the unified table. A `Ministry` has `church_id IS NULL`; a `Small Group` has a required `church_id` referencing its owning church. Database checks reject every other type/ownership combination.
- On mount, the view resolves `get_my_church()` before loading groups. The client query requests global ministries plus small groups whose `church_id` matches the resolved church; RLS independently enforces the same boundary.
- Ministry definitions are read-only in the app and are maintained manually by a trusted operator in Supabase. Users can create, rename, and delete only their own church's small groups.
- `group_members` remains the membership join for both types. Every member search, picker, count, detail read, insert, and delete is limited to active members in the caller's church. This preserves the global `Finance Team` ministry authorization lookup while isolating its membership rows per church.
- Small-group deletion relies on the existing cascading foreign key to remove memberships. Ministries cannot be deleted or edited through the SPA.

**Presentation:**
- Every group stores one required, immutable-in-the-app `color_slot` generated by PostgreSQL from a 3,240-slot space. A global unique constraint strictly prevents repeated saved colors anywhere, which is intentionally stronger than uniqueness only among groups visible to one church.
- Migration `0005_group_color_slots` deterministically backfills existing rows, then a UUID-seeded `BEFORE INSERT` trigger searches for a free slot while holding a transaction-scoped advisory lock. The lock prevents concurrent inserts from choosing the same free slot; the unique constraint is the final integrity guard. The migration aborts before changing rows if existing groups exceed capacity.
- [src/utils/groupPresentation.js](src/utils/groupPresentation.js) normalizes malformed values and maps each slot through a coprime hue permutation plus nine dark saturation/lightness bands. Cards use the result only as a 4 px left accent and retain a textual type badge, neutral borders, a member-count icon, and visible keyboard focus. There is no user color picker.

### 5.5 Styling Conventions
- Global reset in [src/style.css](src/style.css) (`*` reset + body font stack).
- Component styles use `<style scoped>` per SFC.
- Color palette: primary `#1a56db` (blue), neutrals from the `slate` family (`#f8fafc`, `#e2e8f0`, `#1e293b`, `#64748b`), error `#dc2626`.
- Card aesthetic: `12px` radius, soft blue-tinted shadows.

---

## 6. Backend (Supabase)

### 6.1 Database Structure Source of Truth

The canonical database structure (tables, columns, relations, and constraints) is defined in `prisma/schema.prisma`.

To avoid drift, this architecture document intentionally does not duplicate full table/column inventories.

### 6.2 Authorization Model

Per-church data isolation is achieved via a **`SECURITY DEFINER` helper function + RLS policies**:

```sql
create or replace function public.get_my_church_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select m.member_of
  from public.user_accounts ua
  join public.members m on m.id = ua.member_id
  where ua.id = auth.uid()
  limit 1;
$$;
```

**Source of truth: `prisma/migrations/`.** Every policy is now source-controlled — `expenses` in `0003`, `groups` / `group_members` in `0004`, and `members` / `churches` / `user_accounts` / `collections` in `0006_baseline_rls`. `0006` is a verbatim capture of state that had previously only ever existed in the Supabase dashboard; re-capture with `scripts/sql/capture-security-state.sql` to verify the database still matches. The summary below is a convenience view and the migrations win on any disagreement.

- `members SELECT` → `using (member_of = get_my_church_id())` — same church, **including archived rows**.

  > `archived_at IS NULL` cannot live in this policy. Postgres evaluates the SELECT policy against the *new* row during an `UPDATE`, so the condition made archiving impossible — it had never once succeeded in production. `0010_members_select_allow_archived` removed it. **Filtering archived members is now the application's job:** every read of `members` must add `.is('archived_at', null)`, as `DashboardView`, `CollectionsInputView` and both `MinistrySmallGroupView` queries do. A new read that forgets it will show archived people in lists and pickers.
- `members INSERT` → `with check (member_of = get_my_church_id() AND archived_at IS NULL)` — must belong to the caller's church and start un-archived.
- `members UPDATE` → `using/with check (member_of = get_my_church_id())`. The `with check` deliberately omits `archived_at IS NULL` so archiving is permitted, while still blocking reassignment to another church.
- **No `members` DELETE policy.** That omission is the control that makes archiving the only deletion path.

  > `0006` captured a single `FOR ALL ... TO public` policy here, which both permitted hard deletes and — having no `with check` — blocked the archive UPDATE it was meant to allow. `0007_members_policy_split` replaced it with the four-policy model above. [SECURITY.md](SECURITY.md) §3.11.

- `churches SELECT` → `using (id = get_my_church_id())`, and `authenticated` holds **no grant on the table at all**, so the policy is unreachable from the SPA — `churches` is read only through the `SECURITY DEFINER` `get_my_church()` RPC. `0009_narrow_grants` closed the previous `using (true)` cross-tenant leak ([SECURITY.md](SECURITY.md) §3.3) this way; the scoped policy is defence in depth should the grant ever be restored.
- `collections SELECT` → church-scoped. `INSERT` → church-scoped **and** finance-gated. `UPDATE` / `DELETE` → church-scoped, finance-gated, and limited to rows with `created_at > now() - interval '3 hours'`.
- `expenses SELECT` → church-scoped only. `INSERT` → church-scoped **and** finance-gated.

  > **Funds rule: reads are church-scoped, writes are finance-gated.** `ChurchFundsView.vue` builds the monthly report from `expenses` and is not a finance-only route, so finance-gating `SELECT` would break reports for non-finance staff. `collections SELECT` stays church-scoped for the same reason — §9.14 plans to feed contributions into that report. Installed by `0008_funds_write_policies`; before it, finance-role authorization existed only in the browser.
- `user_accounts SELECT` → `using (id = auth.uid())`, self-read only. No write policies, so writes are denied; rows are created by the `SECURITY DEFINER` `handle_new_user()` trigger, which bypasses RLS. This closes the verification item previously open in [SECURITY.md](SECURITY.md) §3.2.
- `groups SELECT` → linked users see global ministries plus small groups where `church_id = get_my_church_id()`; unlinked authenticated users see no groups.
- `groups INSERT / UPDATE / DELETE` → only `type = 'Small Group'` rows owned by `get_my_church_id()`. There is no app policy permitting ministry catalog mutations.
- `group_members SELECT / INSERT / DELETE` → the referenced member must be active and in the caller's church, and the referenced group must be either a valid global ministry or the caller's own small group. There is no UPDATE policy.

Group membership policies call narrow `SECURITY DEFINER` predicates (`is_member_in_my_church` and `is_group_available_to_my_church`) rather than traversing policy-protected tables directly. This avoids RLS recursion and keeps nested PostgREST reads—including the `Finance Team` authorization check—available only for the current church's membership rows. On `groups`, authenticated users receive `SELECT` and `DELETE`, column-level `INSERT (name, type, church_id)`, and column-level `UPDATE (name)`; therefore app users cannot submit or modify `color_slot`, while RLS still denies ministry mutations. `group_members` grants remain `SELECT/INSERT/DELETE` only.

**Why `SECURITY DEFINER`?** The helper function reads `members` itself; without `SECURITY DEFINER` the policy on `members` would recurse, producing `stack depth limit exceeded`.

**Grants are the first gate; RLS is the second.** `0009_narrow_grants` replaced Supabase's default `GRANT ALL` on the five original tables with the minimum set the SPA actually uses, derived by enumerating every `supabase.from(...)` call:

| Table | `authenticated` | `anon` |
|---|---|---|
| `churches` | — (read via `get_my_church()` only) | — |
| `members` | `SELECT, INSERT, UPDATE` | — |
| `collections` | `SELECT, INSERT, DELETE`, `UPDATE (amount)` | — |
| `expenses` | `SELECT, INSERT` | — |
| `user_accounts` | `SELECT` | — |
| `groups` | `SELECT, DELETE`, `INSERT (name, type, church_id)`, `UPDATE (name)` | — |
| `group_members` | `SELECT, INSERT, DELETE` | — |

`anon` holds no table privileges: the pre-auth views use only `supabase.auth.*`, which talks to GoTrue rather than PostgREST. `service_role` is untouched — it bypasses RLS by design and the frontend never uses it.

The column scope on `collections.UPDATE (amount)` is load-bearing, not tidiness: a table-wide `UPDATE` would let a caller set `created_at = now()` and extend their own 3-hour edit window indefinitely. Any new write path must extend the grant deliberately — adding a column to a form is not enough.

**Helper functions are source-controlled.** `get_my_church_id`, `is_member_in_my_church`, `is_group_available_to_my_church` in `0004`; `assign_group_color_slot` in `0005`; `get_my_church`, `handle_new_user`, `rls_auto_enable` in `0006`; `is_finance_member` in `0008`. Two triggers remain uncaptured because they sit outside the `public` schema — the `auth.users` trigger calling `handle_new_user()` and the event trigger calling `rls_auto_enable()`. Both are load-bearing and must be recreated by hand in a rebuild; see [SECURITY.md](SECURITY.md) §3.13.

### 6.2.1 Archiving Model (soft delete)

Members are never hard-deleted. The model uses archive metadata plus an active-only index:

- `archived_at` — `NULL` = active, non-null = archived.
- `archived_reason` — optional free-text reason captured at archive time.
- Active-only index on church membership with `archived_at IS NULL` so SELECT policy filtering stays fast as archived rows grow.

**Storage rationale.** Nullable archive metadata keeps active-row overhead minimal, and an active-only partial index keeps lookups fast even when archived rows accumulate. Restoring an archived member is currently a manual SQL operation (no UI).

### 6.3 Authentication
- Supabase Auth, email + password, bcrypt-hashed server-side.
- JWT session is persisted by the SDK in `localStorage` (default behavior of `@supabase/supabase-js` v2).
- The frontend never sees or stores password hashes.

### 6.4 Linking a New Auth User to a Member
No UI yet. The operational rule is to link a new auth user to exactly one church member and one user account record, using the same auth user UUID for identity mapping.

### 6.5 Prisma Schema Management Layer
Prisma is now the source-controlled schema/migration workflow for the existing Supabase Postgres database.

- Prisma datasource targets the existing Supabase database via `DATABASE_URL` and `DIRECT_URL`.
- `DATABASE_URL` can be a pooled Supabase connection string.
- `DIRECT_URL` should be the non-transaction pooling connection used by Prisma migrations (typically port `5432`).
- Frontend runtime queries remain on `@supabase/supabase-js` so RLS continues to enforce authorization exactly as before.
- Schema lifecycle commands (from `package.json` scripts):
  - `npm run prisma:pull` — introspect current Supabase schema into `prisma/schema.prisma`.
  - `npm run prisma:migrate:create` — create a new SQL migration from schema changes.
  - `npm run prisma:migrate:deploy` — apply pending migrations to the target database.
  - `npm run prisma:migrate:status` — check migration state.

---

## 7. Build, Run, Deploy

### 7.1 Scripts ([package.json](package.json))
| Script | Command | Use |
|---|---|---|
| `dev` | `vite` | Dev server, HMR, default port 5173 |
| `build` | `vite build` | Outputs to `dist/` |
| `preview` | `vite preview` | Serves the production build locally |
| `test` | `vitest run` | Runs unit tests |

### 7.2 Environment Variables
Loaded by Vite from `.env` at the project root. Both must be present at **build time** for production:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

### 7.3 Netlify ([netlify.toml](netlify.toml))
- Build command: `npm run build`
- Publish directory: `dist`
- SPA fallback: every unknown path → `/index.html` with HTTP 200, so Vue Router deep links work.
- Env vars are configured in the Netlify dashboard (not committed).

---

## 8. Security Posture

For the full vulnerability analysis, threat model, OWASP Top 10 mapping, and prioritized mitigations (Tier 1 = free, do now), see **[SECURITY.md](SECURITY.md)**. The table below is a snapshot of the controls that exist today; gaps and remediations are tracked in that document.

| Concern | Status | Notes |
|---|---|---|
| Secrets in repo | None | Anon key is intentionally public; service-role key is **never** used in the frontend. |
| Authorization | Enforced server-side by Postgres RLS | Frontend cannot bypass it. `groups` and `group_members` have explicit church-scoped policies; `user_accounts` remains tracked separately in [SECURITY.md](SECURITY.md) §3.2. |
| Cross-tenant `churches` exposure | Resolved | `0009_narrow_grants` revoked the table grant and scoped the policy to `id = get_my_church_id()`. [SECURITY.md](SECURITY.md) §3.3. |
| Hard delete of member PII | Resolved | `0007_members_policy_split` removed the `FOR ALL` policy that permitted `DELETE`. [SECURITY.md](SECURITY.md) §3.11. |
| Finance-role authorization | Enforced server-side | `0008_funds_write_policies` added `is_finance_member()` to every funds write policy. Previously browser-only. |
| Table privileges | Narrowed to the SPA's actual usage | `0009_narrow_grants`; `anon` holds none. See §6.2. |
| Transport | HTTPS only | Supabase + Netlify. HSTS not yet emitted — [SECURITY.md](SECURITY.md) §3.1. |
| HTTP security headers | Implemented | CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy and COOP are all set in [netlify.toml](../netlify.toml). One caveat: `connect-src` uses `https://*.supabase.co` rather than the specific project ref, which weakens it — [SECURITY.md](SECURITY.md) §3.1. |
| XSS | Low risk today | Vue auto-escapes interpolation; no `v-html`; no `:href` to user-supplied URLs. Latent risk if `facebook_link` becomes a clickable link — [SECURITY.md](SECURITY.md) §4.1. |
| CSRF | N/A | Supabase uses Bearer JWTs in `Authorization` headers, not cookies. |
| Password storage | Handled by Supabase (bcrypt) | App never touches password material after submission. |
| Session storage | JWT in `localStorage` (Supabase SDK default) | XSS-exfiltratable. Compensated by strict CSP — [SECURITY.md](SECURITY.md) §3.4. HttpOnly-cookie alternative is rejected under §12.3 rule 5. |
| Auth hardening (MFA / CAPTCHA / leaked-password / sign-up disabled) | **Known gap** | Configured in the Supabase dashboard, not as code. [SECURITY.md](SECURITY.md) §3.6. |
| Audit trail | **Known gap** | No `created_by` / `updated_by` / `archived_by` on `members`. [SECURITY.md](SECURITY.md) §3.7. |
| Dependency scanning | **Known gap** | No Dependabot, no `npm audit` in CI. [SECURITY.md](SECURITY.md) §3.8. |
| Open redirects | Not present | Router only navigates to known named routes. |
| Data retention / right-to-erasure | **Known gap** | Soft-delete is the only deletion path; no purge policy. [SECURITY.md](SECURITY.md) §3.10. |

---

## 9. Known Gaps / Things AI Should Be Aware Of

These are **not bugs** but explicit non-features in the current build. If asked to add them, treat as new feature work:

1. **No restore UI for archived members** — archiving is exposed in the dashboard, but un-archiving (`update members set archived_at = null`) is a manual SQL operation. There is also no admin view for browsing archived rows.
2. **No pagination / virtualization** — entire member list is fetched at once. Fine for small congregations; revisit if a church exceeds a few thousand rows. See §12.4 for the free-tier threshold.
3. **No client-side search/filter.**
4. **No realtime subscriptions** — the table is a static snapshot until page reload. **Intentional** under the free-tier plan (§12.3).
5. **No global state store** — state lives in component `ref`s; if multiple views need shared data, introduce Pinia rather than prop-drilling.
6. **No integration/E2E tests yet** — Vitest unit coverage exists for router auth guards plus payload/search/password validation and Supabase bootstrap checks, and GitHub Actions now enforces `npm test` + `npm run build` on pull requests and pushes to `main`. There is still no Playwright/Cypress suite.
7. **No TypeScript** — adding types would require migrating `.vue`/`.js` files and updating `vite.config.js`.
8. **No multi-church admin role** — RLS assumes exactly one church per user. Cross-church access requires schema and policy changes.
9. **No error reporting** — errors are surfaced inline; no Sentry/logging integration.
10. **`App.vue` is empty of layout** — any global header/nav/toast container should be added here, not in individual views.
11. **Egress-wasteful list query** — ~~`select('*, churches(name)')` in [DashboardView.vue](src/views/DashboardView.vue) pulls all member columns plus a redundant per-row church name.~~ **Resolved**: `fetchMembers`, `handleCreate`, `handleUpdate` now share an explicit `MEMBER_COLUMNS` list and no longer join `churches(name)`. See §12.5.
12. **Two serial round-trips on mount** — ~~`fetchMyChurch()` does `rpc('get_my_church_id')` then a follow-up `churches` lookup.~~ **Resolved**: a new `public.get_my_church()` RPC returns `(id, name)` in a single call. The original `get_my_church_id()` is retained because the `members` RLS policies depend on it. See §12.5.
13. **No long-cache headers in [netlify.toml](netlify.toml)** — ~~Vite emits content-hashed assets that are safe to cache `immutable`.~~ **Resolved**: `netlify.toml` now serves `/assets/*` as `public, max-age=31536000, immutable` and `/index.html` as `no-cache`. See §12.5.
14. **Church Funds report is partially sample-backed** — [ChurchFundsView.vue](src/views/ChurchFundsView.vue) still uses `SAMPLE_COLLECTIVES` for contribution lines, but monthly expenses now come from `public.expenses` when available (merged in [src/utils/reportExpenseMerge.js](src/utils/reportExpenseMerge.js)). Full production parity still requires contributions/services persistence wired into `computeMonthlyReport`.
15. **Report Discrepancy workflow (future)** — When a `collections` entry passes the 3-hour edit window and is locked, there is currently no way for a user to request corrections. A planned feature will add a "Report Discrepancy" button in the detail modal that creates a request row (candidate table: `collection_discrepancies`) for an admin/treasurer to approve or reject the edit/delete. This enables an audit trail for post-lock corrections without weakening the time-lock policy.
16. **Anonymous contributions cannot be recorded at all, and multiple anonymous givers per service are a requested feature.**

    **Requested behaviour.** When several unnamed people give tithes at one service, each should be recordable as its own entry with its own amount — not merged into a single collective total. Both the number of anonymous givers and the spread of amounts should reach the monthly report.

    **Blocker — anonymous entry is currently broken.** `CollectionsInputView.handleSubmit()` has an "Anonymous" path that omits `from` from the insert payload. That does not produce a null contributor: `collections.from` is `NOT NULL` with `DEFAULT gen_random_uuid()`, so a random UUID is generated and the `collections_from_fkey` foreign key to `members` rejects it. Verified against production inside a rolled-back transaction:

    ```
    23503: insert or update on table "collections" violates foreign key constraint "collections_from_fkey"
    ```

    So the UI offers anonymous entry, but any attempt fails. The "anonymous entries grouped as Unknown" behaviour described for the report in §5.4 exists only in the `SAMPLE_COLLECTIVES` fixture — no real anonymous row can exist today.

    **Design options** (none chosen — needs an owner decision):
    - *Nullable `from`.* Drop `NOT NULL` and the `gen_random_uuid()` default, letting `from IS NULL` mean anonymous. Smallest schema change; each anonymous gift is naturally its own row, so "multiple anonymous givers" falls out for free. Requires auditing every read that joins `members` through `collections.from` to handle nulls, and the report's contributor aggregation must bucket nulls rather than dropping them.
    - *Sentinel "Anonymous" member row per church.* No schema change, but it pollutes the members table with non-people, would be caught by member counts and pickers, and interacts badly with the archived-member filters added in `0010`.
    - *Separate `anonymous_collections` table.* Cleanest separation, but duplicates the amount/date/church/window logic and doubles the read path in the report.

    A nullable `from` is the most likely fit, but it touches `MEMBER`-joined reads and the report calculator, so it should be planned before implementation rather than added ad hoc.

17. **No central ministry administrator or request workflow** — Ministry definitions are manually maintained in Supabase. A future design may add central-admin authorization and a request table for **new ministry definitions only**. Requests will carry requester/church identity, proposed name, status, reviewer, timestamps, and rejection reason; central approval/rejection will handle case-insensitive duplicate names before creating a global ministry. Rename and delete requests are explicitly excluded, and no broad admin UI, leader model, soft delete, or audit system is part of the current release.

---

## 10. Conventions for AI-Assisted Edits

When modifying this codebase, prefer the following:

- **Composition API + `<script setup>`** — match the existing style; do not introduce Options API.
- **Scoped styles per SFC** — only put truly global rules in [src/style.css](src/style.css).
- **Route-level code splitting** — when adding new views, register them in [src/router/index.js](src/router/index.js) and consider `() => import('...')` for lazy loading once the bundle grows.
- **Auth guard** — any new authenticated route must include `meta: { requiresAuth: true }`.
- **Database access (frontend runtime)** — go through the shared `supabase` import from [src/lib/supabase.js](src/lib/supabase.js); do not instantiate a new client.
- **Database schema changes** — use Prisma (`prisma/schema.prisma` + `prisma/migrations`) and apply with `npm run prisma:migrate:deploy`.
- **RLS first** — never replicate authorization logic in the frontend. If the user shouldn't see a row, the policy must reject it.
- **Errors** — surface Supabase error `.message` to the user (this is the existing pattern); avoid throwing.
- **No new dependencies** without a clear reason — the dep list is intentionally minimal. Prisma is the approved schema-management exception.
- **Color & spacing tokens** — match the existing slate/blue palette and `12px` card radius for visual consistency.
- **Free-tier discipline** — every change must respect the budget in §12. When in doubt, prefer the cheaper path: fewer columns, fewer round-trips, more client-side reuse, no new background traffic.

---

## 11. Quick Reference — Data Flows for the Dashboard

### 11.1 Sign in & initial load
1. User submits credentials in [LoginView.vue](src/views/LoginView.vue).
2. `supabase.auth.signInWithPassword` → JWT stored in `localStorage`.
3. `router.push('/dashboard')`.
4. Router guard sees a session → allows navigation.
5. [DashboardView.vue](src/views/DashboardView.vue) `onMounted` runs in parallel:
   - `supabase.rpc('get_my_church').single()` → caches `myChurchId` + `myChurchName` (the latter is also persisted to `localStorage` so the title renders pre-fetch on warm opens).
   - `supabase.from('members').select(MEMBER_COLUMNS)`.
6. PostgREST attaches the JWT, Postgres evaluates RLS:
   - `get_my_church_id()` resolves the user's church via `user_accounts → members.member_of`.
   - `members SELECT` policy filters to `member_of = get_my_church_id() AND archived_at IS NULL` (the partial index `members_active_church_idx` is used).
7. Rows return; Vue renders the sortable table.
8. Sign out → `supabase.auth.signOut()` clears session → guard sends user back to `/login`.

### 11.2 Create
1. User clicks **+ Add Member** → modal opens in `create` mode with a blank form; `member_of` is pinned to `myChurchId`.
2. Submit → `handleCreate()` → `insert(payload).select(MEMBER_COLUMNS).single()`.
3. The INSERT policy enforces `member_of = get_my_church_id() AND archived_at IS NULL`; any tampered payload is rejected.
4. On success, the new row is prepended to `members` and the modal closes. Badge increments.

### 11.3 Edit
1. From `view` mode, user clicks the Edit icon → modal switches to `edit`, `formData` is hydrated from `selectedMember`.
2. Submit → `handleUpdate()` → `update(payload).eq('id', id).select(MEMBER_COLUMNS).single()`.
3. The UPDATE policy's `with check` enforces `member_of = get_my_church_id()` — reassigning to another church is blocked.
4. On success, the row in `members` is replaced (splice by id), `selectedMember` is updated, modal returns to `view`.

### 11.4 Archive (soft delete)
1. From `view` mode, user clicks **Archive member** → modal body swaps to an in-modal confirmation panel with an optional reason textarea.
2. Confirm → `handleArchive()` → `update({ archived_at: now, archived_reason }).eq('id', id)`.
3. The UPDATE policy permits the change (same church); the row remains in the database.
4. On success, the row is filtered out of `members` and the modal closes. Badge decrements. Subsequent reloads exclude it because `fetchMembers` applies `.is('archived_at', null)` — **not** because RLS hides it. Since `0010_members_select_allow_archived` the SELECT policy deliberately returns archived rows, so that archiving is possible at all; see §6.2.

---

## 12. Free-Tier Operating Plan

> **Goal:** Run UDFC Church Dashboard on **$0/month for as long as possible.** This section is binding — every architectural change must respect the budgets and principles below. If a feature cannot be built within them, it must be raised explicitly with the owner before work begins.

### 12.1 Why this matters

The app is internal church tooling with no revenue stream. Hosting must remain free indefinitely. Every byte sent to a browser, every Postgres round-trip, every build minute consumed counts toward a hard limit. Efficiency is not a nice-to-have — it is a primary requirement of the design.

### 12.2 Free-tier budgets we live inside

Limits as published by the vendors (verify before any major change — vendors adjust quotas).

| Vendor | Resource | Free-tier limit | Risk for this app |
|---|---|---|---|
| **Supabase** | Database storage | 500 MB | Low — members table is narrow text data; even 100 K rows ≪ 500 MB. |
| **Supabase** | Egress / month | 5 GB | **Medium** — every dashboard load currently ships ~all member columns. The dominant cost as use grows. |
| **Supabase** | Monthly Active Users | 50 000 | Negligible — internal staff only. |
| **Supabase** | Storage (files) | 1 GB | None today (no photos / uploads). Re-evaluate if member photos are added. |
| **Supabase** | Free projects | 2 per org | Constrains multi-tenant expansion. |
| **Supabase** | Auto-pause | Project pauses after **7 days of inactivity** | **High operationally** — requires manual unpause on revisit. See §12.3 mitigation. |
| **Netlify** | Bandwidth / month | 100 GB | Low if static assets are properly cached (§12.3). |
| **Netlify** | Build minutes / month | 300 | Low — build is a fast Vite SPA; well under 1 min per deploy. |
| **Netlify** | Functions / Edge Functions | Limited | **Not used and must remain unused.** All logic lives in the SPA + Postgres. |

### 12.3 Efficiency principles (binding rules for AI edits)

These rules must be followed unless explicitly overridden by the owner.

1. **Select only what you render.**
   - Do **not** use `select('*')` on `members`. Enumerate columns: list views select the few columns the table renders; modals/forms can select the full row by id only when opened.
   - The shared `MEMBER_COLUMNS` constant in [DashboardView.vue](src/views/DashboardView.vue) is the canonical list. New code that reads `members` should reuse it.

2. **One round-trip per intent.**
   - Prefer a single RPC or a single PostgREST query over chained client-side awaits. If a workflow needs church id + church name + member list, it should be a single RPC returning all three or two parallel calls — never serial awaits.

3. **Cache the church identity for the session.**
   - `myChurchId` and `myChurchName` change essentially never. Resolve once on login and reuse. Do not re-query them on each navigation.

4. **No realtime subscriptions** unless explicitly requested. Realtime websockets count against egress, keep the project hot (good) but consume budget continuously (bad). The dashboard's static-snapshot model is intentional.

5. **No Netlify Functions / Edge Functions / scheduled functions.** All business logic stays in Postgres + RLS + the SPA.

6. **No Supabase Storage** without an explicit decision. Member photos, attachments, exports, etc. require a written sizing plan first.

7. **Long-cache hashed static assets.** Vite emits `index-<hash>.js` style filenames. The [netlify.toml](netlify.toml) config serves them with `Cache-Control: public, max-age=31536000, immutable` and serves `index.html` with `Cache-Control: no-cache`.

8. **Lazy-load routes once views >2.** When a third route is added, switch `router/index.js` to `() => import('../views/Foo.vue')` so first-paint JS stays small.

9. **Pagination kicks in at the threshold.** When any single church reaches **300 active members**, introduce server-side pagination (`.range()`) before the next list-view feature. Below that, the simpler full-list fetch is preferred for code clarity.

10. **Auto-pause mitigation.** A church using the dashboard at least once a week keeps the project warm. If a longer gap is expected (e.g. seasonal closures), the owner must accept a manual unpause from the Supabase dashboard. **Do not** add a synthetic keep-alive cron — it would consume budget for no real-user benefit and risks tripping abuse policies.

11. **No new runtime dependencies** without a free-tier impact note. UI libraries, state stores, charting libs, telemetry SDKs — each adds bundle bytes that ship to every user on every uncached visit.

12. **Never use the Supabase service role key in the frontend.** The RLS-only model is what makes the free tier safe; replacing it with bypass-the-policy server code would force a paid hosting tier.

### 12.4 Threshold quick-reference

If the project crosses any of these, revisit the plan:

| Signal | Threshold | Required response |
|---|---|---|
| Active members per church | 300 | Add `.range()` pagination before adding new list features. |
| Total Supabase egress | 60 % of 5 GB / month | Audit list queries; tighten column selection; add caching. |
| Netlify bandwidth | 60 % of 100 GB / month | Verify cache headers; check for an unminified asset; consider image optimization. |
| Database storage | 60 % of 500 MB | Audit text column sizes; archive old data offline. |
| Routes added | ≥ 3 | Convert to lazy imports in `router/index.js`. |

### 12.5 Follow-ups

The §12.3 rules listed above are now honored by the codebase. Items 1–5 below were the original gaps; all are resolved.

1. **Replace `select('*, churches(name)')`** in `fetchMembers`, `handleCreate`, `handleUpdate` ([src/views/DashboardView.vue](src/views/DashboardView.vue)) with an explicit column list. The church name is already cached as `myChurchName`; the per-row join is redundant under one-user-one-church RLS. — **Done.** Replaced by the shared `MEMBER_COLUMNS` constant; the per-row join was dropped.
2. **Collapse `fetchMyChurch()` into one round-trip.** Either extend `get_my_church_id()` to return `(id uuid, name text)` as a row, or replace it with a `SELECT id, name FROM churches WHERE id = (...)` RPC. Eliminates a serialized request on every dashboard mount. — **Done.** A new additive `public.get_my_church()` RPC returns `(id, name)` in one call. The original `get_my_church_id()` was kept untouched because the `members` RLS policies depend on its scalar return type.
3. **Add cache headers to [netlify.toml](netlify.toml):**
   ```toml
   [[headers]]
     for = "/assets/*"
     [headers.values]
       Cache-Control = "public, max-age=31536000, immutable"

   [[headers]]
     for = "/index.html"
     [headers.values]
       Cache-Control = "no-cache"
   ```
   — **Done.** Both header blocks added to [netlify.toml](../netlify.toml).
4. **Document the auto-pause behavior** in [README.md](README.md) so any operator knows to expect a one-time unpause click after long absences. — **Done.** See the new "Operations" section in [README.md](../README.md), which also documents the free-tier health checklist.
5. **Decide whether to keep church name cached in `localStorage`** so the dashboard can render the title pre-fetch (eliminates one perceptible round-trip on cold open). Low priority. — **Done.** Cached as `udfc.myChurchName`; `handleLogout()` clears the key so a different user signing in on the same browser doesn't see the previous church's title.

None of these were required for the app to function — they were the path to keeping the cost line at $0 as usage grows.

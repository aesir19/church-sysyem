# UDFC Church Dashboard — Architecture & System Design (AI Context)

> **Purpose of this document:** Provide an AI assistant with a concise, structured, and accurate snapshot of the current system so it can reason about, modify, and extend the codebase without re-discovering context.
>
> **Last reviewed against source:** Reflects the state of `main` / `project-hardening` branch as of the current workspace.
>
> **Audit 2026-08-03:** A full-codebase architecture review added §13 (confirmed defects — real bugs with reproductions and fixes) and §14 (operational readiness — what the system needs to *run*, as distinct from what users ask for). Neither section is speculative; every item was verified against source, schema, or build output.

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
│   └── migrations/             # SQL migrations managed by Prisma (each may carry a rollback.sql)
├── prisma.config.js            # Prisma CLI configuration
├── scripts/
│   ├── prisma/
│   │   ├── check-env.js        # Prisma env preflight checks
│   │   └── env-utils.js        # Shared env validation helpers
│   └── sql/
│       └── capture-security-state.sql  # Read-only audit of policies, grants, functions, views
├── public/
│   └── vite.svg                # Favicon (default Vite asset)
├── tests/                      # Unit tests (router guards + security/util logic)
│   ├── prisma/                 # Prisma env validation tests
│   └── views/                  # SSR smoke tests — that a view's setup runs and queries what it should
└── src/
    ├── main.js                 # createApp(App).use(router).mount('#app')
    ├── App.vue                 # Root component — renders <router-view /> only
    ├── style.css               # Global reset + body font (Segoe UI stack)
    ├── lib/
    │   └── supabase.js         # Singleton Supabase client (uses VITE_SUPABASE_*)
    ├── router/
    │   └── index.js            # Routes + global beforeEach auth guard
    ├── utils/
    │   ├── collectivesReport.js # Pure calculator for the monthly collectives report
    │   ├── collectivesSource.js # Live Supabase rows → calculator shapes; opening-balance replay
    │   ├── reportExpenseMerge.js # Folds live expenses into the report's per-service weeks
    │   ├── collectionsDate.js   # Service-date auto-selection + 3-hour edit window check
    │   ├── collectionPayload.js # Collections insert payload + contributor label (Anonymous/Unknown)
    │   └── expensesMonth.js     # Month parsing and date-range helpers for month-scoped queries
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
- Month navigator (prev/next), opening on the current month via `defaultMonthKey()`.
- KPI cards: Total Funds, Tithes, Offering, Expenses, Closing Balance.
- Weekly Breakdown table: one column per service date + a Month total column.
- Allocations panel with a proportional distribution bar.
- Expenses table (aggregated by description).
- Contributors table, finance-only. Named givers aggregate into one line each; **anonymous gifts do not — each is its own row**, so the count of anonymous givers and the spread of their amounts both survive into the report. That is the behaviour `0011`'s nullable `from` exists to protect.
- Rolling balance card: Church Allocation − Expenses + Opening Balance = Current Church Funds.
- Print stylesheet so the page saves cleanly to PDF via the browser.

**Data flow — three live reads, no fixture:**
- **Once on mount:** `public.collectives_service_totals` (§6.6), the whole ledger at one row per service date. [openingBalanceForMonth()](src/utils/collectivesSource.js) replays it through the calculator to derive the selected month's opening balance. Not re-fetched on navigation — it is month-independent and small.
- **Per month:** `collections` (with the `members` embed) and `expenses`, both range-scoped by [getMonthRange()](src/utils/expensesMonth.js). A request-id guard discards out-of-order responses from fast prev/next clicking. Neither query filters `from_church`; RLS scopes them.
- `buildMonthSourceFromCollections()` in [src/utils/collectivesSource.js](src/utils/collectivesSource.js) groups collection rows into per-service weeks, labelling each contributor with `contributorLabel()` so "Anonymous" and "Unknown" stay distinct. Expenses are merged in by [src/utils/reportExpenseMerge.js](src/utils/reportExpenseMerge.js); a date with expenses but no service becomes its own week, which is why the header counts **service dates** rather than services.
- The month cursor drives a `computed` that calls `computeMonthlyReport(...)` from [src/utils/collectivesReport.js](src/utils/collectivesReport.js).
- All allocation math (10 % tithes-of-tithes, 5 % project, 5 % student program with an optional personal draw, 50/50 pastor/church split of the remainder, expenses off church allocation, opening balance carry) lives in the calculator so the view stays presentational **and so there is exactly one source of truth** — this is why the SQL view aggregates but deliberately does not allocate.

**Two denominators, and the panel must show only one.** `ALLOCATION_RATES.pastorShare` / `churchShare` are shares of the **remainder**; the other three rates are shares of **total funds**. 50 % of the 80 % remainder is 40 % of the collection, so the two families describe the same pesos on different bases. The allocation panel used to print the raw `50%` beside `10%` and `5%` of total, which read as half the collection going to each of the last two lines. `SHARE_OF_TOTAL_FUNDS` restates all five against total funds — 10 + 5 + 5 + 40 + 40 = 100 — and the view renders its labels from that rather than from literals, so a rate change cannot silently desynchronise them again. The percentages are **nominal**: a personal draw enlarges the remainder, so realised shares drift above 40 %, and the label describes the rule rather than one month's rounding.

**Two rows are hidden because nothing can populate them.** `collections` stores a single `is_tithes` boolean, so **Others** has no live source; and no column holds a per-service **personal draw**. Both are hidden while zero rather than shown as a permanent ₱0.00. The calculator still computes them, so adding a category column later needs no change in the view. See §9.25.

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
- Reads/writes the `collections` table via `supabase.from('collections')`, storing the contributor as `collections.from` (member UUID, **or `NULL` for an anonymous gift** — see §9.16), the kind as `is_tithes`, and the service date as `collectedOn`. The 3-hour edit lock depends on `collections.created_at`. RLS enforces per-church isolation.
- The insert payload is built by `buildCollectionPayload()` in [src/utils/collectionPayload.js](src/utils/collectionPayload.js), which always sends `from` explicitly rather than omitting it. Contributor rendering goes through `contributorLabel()` in the same module, which separates three states that must not collapse: `from IS NULL` → "Anonymous", a readable member → their name, and a set `from` whose member embed came back empty → "Unknown".

**Future plan:**
- A "Report Discrepancy" button will allow a user to request editing or deletion of a locked entry under the `collections` table. This will involve a `collection_discrepancies` table (or similar) where requests are queued for an admin to approve.
- ~~**Multiple anonymous contributors per service (requested).**~~ **Delivered** by `0011_collections_anonymous_from`. Each anonymous gift is its own row with its own amount, so the count of anonymous givers and the spread of their amounts are both preserved in the table. What remains is report-side aggregation, which is blocked on §9.14 (the report does not read `collections` yet).

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

  > The `INSERT` policy scopes on `from_church` and says nothing about `from` — the contributor is **not** required to be a member of the caller's church. That is deliberate, not an oversight: visiting members give at other churches' services. `from` may also be `NULL`, meaning anonymous (`0011_collections_anonymous_from`). See §9.17 before adding `is_member_in_my_church()` here.
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

### 6.6 Views — `public.collectives_service_totals`

The only database view. Added by `0012_collectives_service_totals` to give the monthly report a running balance without downloading the whole ledger.

**What it is.** `collections` and `expenses`, each aggregated to one row per `(from_church, service_date)` and `FULL OUTER JOIN`ed — so a date carrying only collections or only expenses still appears. Roughly 52 rows per church per year. Columns: `from_church, service_date, tithes, offering, expenses`.

**Why a view and not a stored balance.** The report's opening balance is the accumulated net of every prior service. A stored `opening_balance` column would need a "close the month" step and would drift the instant a correction landed behind the close. A view is re-derived on every read, so correcting a three-month-old entry immediately re-derives every balance after it. There is no close step and nothing is ever frozen.

**`security_invoker = on` is load-bearing.** Postgres views run as their *owner* by default, which would bypass `collections_select_own_church` and `expenses_select_own_church` and expose every church's per-date ledger summary to every authenticated user. With invoker semantics the base-table RLS is evaluated as the caller, so the view inherits church scoping and needs no predicate of its own. **Any future view over an RLS-protected table must declare this.** Verify with:

```sql
SELECT relname, reloptions FROM pg_class WHERE relname = 'collectives_service_totals';
-- reloptions must contain security_invoker=on
```

**It aggregates; it does not allocate.** No allocation percentage appears in the SQL. The 10/5/5/50-50 rules live only in [src/utils/collectivesReport.js](src/utils/collectivesReport.js). Duplicating them here would create a second source of truth that disagrees only in the totals, and only sometimes. Keep it that way when extending the view.

**Grants:** `REVOKE ALL ... FROM anon, authenticated` **first**, then `GRANT SELECT TO authenticated`. The revoke is required, not tidy-up: Supabase's default privileges fire on every new object in `public`, so the view is created with full privileges already held by `anon`, and `GRANT` is additive. This is `0009_narrow_grants`' pattern applied to a view — see [SECURITY.md](SECURITY.md) §3.21. The view exposes only per-date sums, never `from`, so it carries no contributor identity.

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

> **Where the bugs live:** confirmed defects — things that are wrong, not merely absent — are tracked separately in **§13**. Operational/platform gaps (logging, monitoring, recoverability) are in **§14**. Do not add defects to this list; §9 is deliberately scoped to deferred features so it can be read as a product backlog.

1. **No restore UI for archived members** — archiving is exposed in the dashboard, but un-archiving (`update members set archived_at = null`) is a manual SQL operation. There is also no admin view for browsing archived rows.
2. **No pagination / virtualization** — entire member list is fetched at once. Fine for small congregations; revisit if a church exceeds a few thousand rows. See §12.4 for the free-tier threshold.
3. **No client-side search/filter.**
4. **No realtime subscriptions** — the table is a static snapshot until page reload. **Intentional** under the free-tier plan (§12.3).
5. **No global state store** — state lives in component `ref`s; if multiple views need shared data, introduce Pinia rather than prop-drilling.
6. **No integration/E2E tests yet** — Vitest unit coverage exists for router auth guards plus payload/search/password validation and Supabase bootstrap checks, and GitHub Actions now enforces `npm test` + `npm run build` on pull requests and pushes to `main`. `ChurchFundsView` additionally has an SSR smoke test with a mocked Supabase client (§14.6 O24). There is still no Playwright/Cypress suite and nothing exercises user interaction.
7. **No TypeScript** — adding types would require migrating `.vue`/`.js` files and updating `vite.config.js`.
8. **No multi-church admin role** — RLS assumes exactly one church per user. Cross-church access requires schema and policy changes.
9. **No error reporting** — errors are surfaced inline; no Sentry/logging integration.
10. **`App.vue` is empty of layout** — any global header/nav/toast container should be added here, not in individual views.
11. **Egress-wasteful list query** — ~~`select('*, churches(name)')` in [DashboardView.vue](src/views/DashboardView.vue) pulls all member columns plus a redundant per-row church name.~~ **Resolved**: `fetchMembers`, `handleCreate`, `handleUpdate` now share an explicit `MEMBER_COLUMNS` list and no longer join `churches(name)`. See §12.5.
12. **Two serial round-trips on mount** — ~~`fetchMyChurch()` does `rpc('get_my_church_id')` then a follow-up `churches` lookup.~~ **Resolved**: a new `public.get_my_church()` RPC returns `(id, name)` in a single call. The original `get_my_church_id()` is retained because the `members` RLS policies depend on it. See §12.5.
13. **No long-cache headers in [netlify.toml](netlify.toml)** — ~~Vite emits content-hashed assets that are safe to cache `immutable`.~~ **Resolved**: `netlify.toml` now serves `/assets/*` as `public, max-age=31536000, immutable` and `/index.html` as `no-cache`. See §12.5.
14. ~~**Church Funds report is partially sample-backed.**~~ **Resolved** by `0012_collectives_service_totals`.

    Contribution lines came from `SAMPLE_COLLECTIVES`, a hardcoded Feb 2026 fixture. The report opened on February 2026 showing invented names and amounts, and every other month — including the current one — rendered empty. Only expenses were live.

    The report now reads `collections` directly (§5.4). The one part that needed the database was the opening balance, which is the accumulated net of every prior service: `public.collectives_service_totals` (§6.6) supplies it as one row per service date, computed on read with no month-close step. The fixture is deleted.

    **Two rows are hidden rather than shown as a permanent ₱0.00**, because `collections` cannot populate them — see §9.25.
15. **Report Discrepancy workflow (future)** — When a `collections` entry passes the 3-hour edit window and is locked, there is currently no way for a user to request corrections. A planned feature will add a "Report Discrepancy" button in the detail modal that creates a request row (candidate table: `collection_discrepancies`) for an admin/treasurer to approve or reject the edit/delete. This enables an audit trail for post-lock corrections without weakening the time-lock policy.
16. ~~**Anonymous contributions cannot be recorded at all, and multiple anonymous givers per service are a requested feature.**~~ **Resolved** by `0011_collections_anonymous_from`.

    **What was broken.** `CollectionsInputView.handleSubmit()` omitted `from` from the insert payload on the "Anonymous" path. That never produced a null contributor: `collections.from` was `NOT NULL DEFAULT gen_random_uuid()`, so Postgres minted a random UUID and the `collections_from_fkey` foreign key rejected it. Verified against production inside a rolled-back transaction:

    ```
    23503: insert or update on table "collections" violates foreign key constraint "collections_from_fkey"
    ```

    The UI had offered anonymous entry since it was written, and every attempt had failed.

    **Chosen design — nullable `from`.** The default was dropped and the column made nullable; **`from IS NULL` means anonymous**. This was picked over the two alternatives (a sentinel "Anonymous" member row per church, which pollutes member counts and pickers and collides with the `0010` archived-member filters; and a separate `anonymous_collections` table, which duplicates the amount/date/church/edit-window logic) because each anonymous gift stays its own row — so **multiple anonymous givers per service works by construction**, which was the actual request.

    **Consequences to respect in new code:**
    - Any read joining `members` through `collections.from` must handle null. Use `contributorLabel()` from [src/utils/collectionPayload.js](src/utils/collectionPayload.js) rather than re-deriving the label; it keeps "Anonymous" (`from IS NULL`) distinct from "Unknown" (a set `from` whose member could not be read).
    - `onDelete` on the `from` relation stays `Cascade`. `SetNull` would silently reclassify a deleted member's gifts as anonymous.
    - ~~Report-side aggregation is **not** done.~~ **Done** in `0012` (§9.14). The Contributors table aggregates named givers into one line each but deliberately keeps **each anonymous gift as its own row**, keyed on the collection row id — collapsing them by their shared "Anonymous" label would discard exactly the giver count and amount spread this design exists to preserve. See `aggregateContributors()` in [src/utils/collectivesReport.js](src/utils/collectivesReport.js).

17. **Visiting contributors cannot be recorded by name.** Members of one church do give at another church's service. There is no way to record that: `collections.from` accepts only a `members.id`, and a visitor is not in the host church's member list. The only workaround today is to record the gift as anonymous, which loses the name and misattributes what is really a known, named gift.

    This is also **why the collections INSERT policy deliberately does not validate the contributor's church.** Adding `("from" IS NULL OR public.is_member_in_my_church("from"))` to `collections_insert_own_church` would look like an obvious hardening — it is the pattern `0004` uses for `group_members` — but it would reject exactly this legitimate case. Do not add it without resolving this item first.

    Design is open. Candidates: a free-text `contributor_name` column used only when `from IS NULL`; a "guest" member record flagged as non-member; or a cross-church contributor reference, which would need its own RLS reasoning since it deliberately reaches outside the caller's church.

18. **No export path.** Reports are `window.print()` only ([ChurchFundsView.vue](src/views/ChurchFundsView.vue)). There is no CSV/XLSX export for the treasurer and no **per-member annual giving statement** — a routine church requirement that members ask for at year end. ~~Blocked on §9.14.~~ **Unblocked** — the report reads real `collections` as of `0012`, so both are now buildable on the data the report already loads.
19. **No bulk import.** The README's stated premise is replacing paper files and spreadsheets, but the only way in is the one-at-a-time Add Member modal. Onboarding an existing congregation currently means manual retyping. A CSV importer with a dry-run preview is the natural companion to §9.1.
20. **No attendance or service records.** There is no `services` or `attendance` table. The monthly report's "weeks" are inferred from distinct `collectedOn` / `spent_on` values, not from a service that exists in its own right — which is why the header counts *service dates*, and why a midweek bill with no service behind it still produces a column. Attendance cannot be correlated with giving or used for follow-up.
21. **No household / family grouping.** Families are a first-class concept in church records (one address, joint giving, children linked to guardians) and are currently unrepresentable — a household gift can only be recorded against one member or anonymously.
22. **Discipleship progress is three booleans.** `is_one_to_one_completed`, `is_turning_point_completed`, `is_baptized` carry no completion date, no assignee, and no history. Progress is a workflow, not a flag; the current shape cannot answer "who is due for follow-up?" — arguably the primary pastoral question the system exists to serve.
23. **`has_submitted_membership_form` is written by nothing and read by nothing.** The column exists in `members` and appears in no view, payload builder, or query. Either it anticipates a member-facing self-service form that was never built, or it is dead schema — decide and then either wire it or drop it.
24. **No central ministry administrator or request workflow** — Ministry definitions are manually maintained in Supabase. A future design may add central-admin authorization and a request table for **new ministry definitions only**. Requests will carry requester/church identity, proposed name, status, reviewer, timestamps, and rejection reason; central approval/rejection will handle case-insensitive duplicate names before creating a global ministry. Rename and delete requests are explicitly excluded, and no broad admin UI, leader model, soft delete, or audit system is part of the current release.
25. **The paper report has two lines the schema cannot fill.** Both are hidden while zero rather than shown as a permanent ₱0.00 (owner decision, 2026-08-03), so the on-screen report no longer matches the DFC workbook line-for-line:

    - **Others / designated giving.** `collections` records a single `is_tithes` boolean, so a gift is either tithes or offering. The workbook has an *Others* column with a free-text *particular* ("Building Fund"), and the calculator still sums an `others` field — nothing can write to it. Needs a category column plus a designation label, and a corresponding control in the Collections form.
    - **Per-service personal draw.** The workbook deducts a personal draw from the 5 % Student Program allocation. No column holds it, so the deduction is always zero and the nested allocation line never renders.

    Both are recorded in `computeWeeklyReport` already, so filling them is a schema-and-form change, not a report change.

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

---

## 13. Confirmed Defects — Audit 2026-08-03

Unlike §9, everything here is **wrong today**, not merely missing. Each row was verified against source, `prisma/schema.prisma`, or `dist/` build output. IDs are stable — reference them in commits and PRs.

| ID | Severity | Where | Defect |
|---|---|---|---|
| D1 | **Critical** | [schema.prisma:517](../prisma/schema.prisma#L517) | `collections.amount` is `real` (4-byte float) |
| D2 | **High** | migrations | `collections` has no index; `members` has none on `member_of` / `archived_at` |
| D3 | **High** | [schema.prisma:590](../prisma/schema.prisma#L590) | `members.contact_number` is `numeric` — destroys PH phone numbers |
| D4 | **High** | [router/index.js:87](../src/router/index.js#L87), [useFinanceMember.js:18](../src/composables/useFinanceMember.js#L18) | Two competing role models; finance authz keyed on a mutable display name |
| D5 | Medium | [useFinanceMember.js:4](../src/composables/useFinanceMember.js#L4) | Module-level singleton never resets across user switch |
| D6 | Medium | [router/index.js:69](../src/router/index.js#L69) | No session-expiry handling |
| D7 | Medium | [router/index.js:103](../src/router/index.js#L103) | 2–4 round trips per navigation — breaches §12.3 |
| D8 | Medium | [DashboardView.vue:417](../src/views/DashboardView.vue#L417) | `todayIso` computed in UTC, not local time |
| D9 | Medium | [router/index.js:13](../src/router/index.js#L13) | Six eager view imports; single 413 KB chunk — breaches §12.4 |
| D10 | Medium | [schema.prisma:592](../prisma/schema.prisma#L592) | `members.member_of` defaults to `auth.uid()`; `onDelete: SetNull` on a `NOT NULL` column |
| D11 | Medium | all views | No keyboard access to rows, no `aria-sort`, no modal focus trap |
| D12 | Low | [DashboardView.vue:11](../src/views/DashboardView.vue#L11) | Two Sign Out buttons with divergent `localStorage` cleanup |
| D13 | Low | [router/index.js:13](../src/router/index.js#L13) | No catch-all route — unknown paths render blank |
| D14 | Low | 3 views | `formatMoney` implemented twice in two different currency formats |
| D15 | Low | [schema.prisma:595](../prisma/schema.prisma#L595) | Schema typo `wedding_anniversarry` (double `r`) is now load-bearing in 4 files |
| D16 | Medium | all views | No data-access layer — Supabase calls inline in 1,100–1,800-line SFCs |

### 13.1 D1 — Float money in the collections ledger

`expenses.amount` is `numeric(12,2)`; `collections.amount` is `real`. The monthly report sums hundreds of collection rows and is intended to reconcile against a printed sheet, so drift is guaranteed to surface as an unexplainable centavo mismatch that staff cannot diagnose. Fix while the table is small:

```sql
ALTER TABLE public.collections ALTER COLUMN amount TYPE numeric(12,2);
```

**This is now live, not hypothetical.** §9.14 shipped and the report reconciles against real rows. `0012_collectives_service_totals` casts `amount::numeric` before summing, which removes the *accumulation* error from adding hundreds of float4 values — but it cannot recover precision already lost at write time, because each row was stored as `real`. The `ALTER` above is still the actual fix and is still cheap while the table is small. Do it before the ledger grows enough that a rewrite needs a maintenance window.

### 13.2 D2 — Unindexed range scans on the two hottest queries

`0003_expenses` correctly added `(from_church, spent_on DESC)`. The structurally identical query in [CollectionsInputView.vue](../src/views/CollectionsInputView.vue) — `gte`/`lt` on `collectedOn` plus a double `ORDER BY` — has no index at all. **As of `0012` there are now two such queries**: the report issues the same range scan on every month navigation, and `collectives_service_totals` groups the whole `collections` table on `(from_church, "collectedOn")` on every page load. `members` is filtered on `member_of` by every RLS policy and on `archived_at` by every list query, with neither indexed.

```sql
CREATE INDEX collections_church_collected_on_idx
  ON public.collections (from_church, "collectedOn" DESC);
CREATE INDEX members_church_active_idx
  ON public.members (member_of) WHERE archived_at IS NULL;
```

This is a §12 cost item, not just latency: sequential scans burn the free tier's shared CPU budget on every page load.

### 13.3 D3 — Numeric phone numbers

PH mobile numbers are `09171234567`. A `numeric` column silently discards the leading zero and cannot represent `+63`, separators, or a second contact. [DashboardView.vue:566](../src/views/DashboardView.vue#L566) already compensates with `String(m.contact_number)`, which restores the digits but not the zero. Convert to `varchar` and backfill with left-padding where the value is 10 digits.

### 13.4 D4 — Two role models, neither authoritative

`user_accounts.role` exists with `DEFAULT 'unassigned'` and is **read nowhere in `src/`**. Actual authorization asks whether the member belongs to a group whose `name` is the literal string `'Finance Team'`. Two consequences:

1. Renaming that group through the Ministries UI silently revokes finance access for every user — no error, no audit entry.
2. Group names are unique per church for small groups and globally for ministries (`0004`), so the blast radius depends on `type` — worth an explicit decision either way.

Resolve by picking one authority. Either promote `user_accounts.role` to the source of truth (and have `is_finance_member()` read it), or add `groups.slug` / `groups.is_system` so the policy keys on an immutable identifier. Whichever is chosen, the loser should be dropped rather than left as a decoy.

### 13.5 D5 / D6 — Identity state outlives the session

`isFinance` and `loaded` in [useFinanceMember.js](../src/composables/useFinanceMember.js) are declared at module scope, outside the exported factory. Sign-out followed by sign-in is SPA navigation with no reload, so the second user inherits the first user's finance flag: `FundsTabs` renders the Collections/Expenses links, and the contributors section appears in the report. **RLS still blocks the data**, so this is a UI-truth defect rather than a data leak — but it produces support tickets and erodes trust in the authorization model.

Relatedly, the single `onAuthStateChange` listener handles only `PASSWORD_RECOVERY`. When the refresh token expires mid-session, staff see a raw `JWT expired` string in an inline error box. Both are fixed by the same change: one session-scoped identity store that subscribes to `onAuthStateChange` and clears on `SIGNED_OUT` / `TOKEN_REFRESHED` failure. That store also resolves D7 by caching `{ churchId, churchName, linked, isFinance }` instead of re-querying on every navigation.

### 13.6 D16 / D14 — No data-access layer

Every Supabase call lives inline in a view. The SFCs are 1,353 / 1,773 / 1,135 / 1,092 / 555 lines, and each one re-implements the same helpers:

| Helper | Copies | Divergence |
|---|---|---|
| `formatMoney` | 3 | [ChurchFundsView.vue:522](../src/views/ChurchFundsView.vue#L522) renders `₱1,234.00` via `Intl.NumberFormat`; [CollectionsInputView.vue:573](../src/views/CollectionsInputView.vue#L573) and [ExpensesInputView.vue:302](../src/views/ExpensesInputView.vue#L302) render `PHP 1,234.00` by string concatenation |
| `fullName` | 2 | [DashboardView.vue:435](../src/views/DashboardView.vue#L435) includes the middle name; [CollectionsInputView.vue:332](../src/views/CollectionsInputView.vue#L332) does not |
| `formatDate` / `formatDisplayDate` / `formatShortDate` | 4 | three different locale arguments |
| `showToast` | 2 | identical, duplicated |

The same amount therefore renders in two different currency formats depending on which screen the user is on, and the same person renders under two different names. This is the visible symptom; the structural cost is that no data path can be unit-tested without mounting a view (see §14.6), and every §12.3 egress rule has to be re-enforced by hand at each call site.

**Direction.** Extract `src/api/{members,collections,expenses,groups}.js` for data access and `src/utils/format.js` for presentation. This is a precondition for O-series testing work, not a cosmetic refactor.

The §9.14 report rewrite (`0012`) landed **before** this refactor. It added no new copy of `formatMoney` — the counts above still hold — and it kept its data reshaping in a pure module ([collectivesSource.js](../src/utils/collectivesSource.js)) so the pipeline is unit-testable without a view. But its three Supabase calls are still inline in the SFC, so it is now the fourth view this refactor has to unpick. The cost of deferring it keeps going up.

---

## 14. Operational Readiness

§9 is a product backlog and §13 is a defect list. This section is the third category: **what the system needs in order to be operable at all** — to tell you it is broken, to survive its own database being lost, and to be rebuilt by someone who was not present when it was written. None of it is user-visible, and all of it is currently absent.

Every recommendation below has a **$0 path**, per §0 priority 1. Where an item is already tracked in [SECURITY.md](SECURITY.md), it is cross-referenced rather than restated — the point here is that these were filed as *security* concerns when they are equally *operability* concerns, and so have been deferred on a security cost-benefit basis that does not apply to them.

### 14.1 Observability — the system cannot report on itself

| ID | Gap | Detail |
|---|---|---|
| O1 | No logging abstraction | Every failure path is `error.value = err.message` and then discarded. There is no `src/lib/logger.js`, no levels, no correlation id. |
| O2 | No global Vue error handler | `app.config.errorHandler` is unset in [main.js](../src/main.js). Any render-time throw produces a white screen with nothing recorded. |
| O3 | No `window.onerror` / `unhandledrejection` capture | Async failures outside a `try` vanish silently. |
| O4 | No error sink | Nobody ever learns that `handleCreate` failed for three users on Sunday. The only channel is a staff member choosing to mention it. |
| O5 | No domain audit log | Cross-ref [SECURITY.md](SECURITY.md) §3.7 — but note the ledger needs this *more* than `members` does. See below. |
| O6 | No DB performance visibility | `pg_stat_statements` is available on the Supabase free tier and is reviewed by no one, so D2-class problems are invisible until they become outages. |

**On O4 and the cost framing.** [SECURITY.md](SECURITY.md) §5.1 classifies error monitoring as **Tier 3 — "has a cost, evaluate per need"**. That classification should be revisited, because there are two free paths:

- **Sentry free tier** — 5k errors/month, well under this app's volume, but adds a third-party processor holding fragments of member PII in error payloads. That is a real privacy trade-off, not merely a cost one, and is the reason to prefer the second option.
- **In-stack, $0, no new processor** — a bounded `public.client_errors` table with `INSERT`-only RLS for `authenticated` and no `SELECT` grant, a row cap enforced by a trigger (e.g. keep the most recent 5,000), and a scrubber that strips message bodies to a whitelist of known error codes before insert. This stays inside the existing Supabase footprint, adds no dependency, respects §12.3, and keeps PII in the one database that already holds it.

The second option also gives O21 (CSP violation reporting) a destination for free.

**On O5 — the ledger, not the member table, is the urgent case.** [SECURITY.md](SECURITY.md) §3.7 scopes the audit-trail gap to `members`. But `collections` enforces a 3-hour edit window, permits in-window `UPDATE` and `DELETE`, and records **no `created_by` at all** (`expenses` does). The system therefore cannot answer "who changed this amount, from what, to what, and when" for the one table where that question is guaranteed to be asked. The planned discrepancy workflow (§9.15) has no substrate to build on until this exists. A trigger-written, append-only `collections_history` table is the conventional answer and costs one migration.

### 14.2 Availability — nothing detects failure

| ID | Gap | Detail |
|---|---|---|
| O7 | No uptime monitoring, no health check | Supabase free tier **auto-pauses after 7 days of inactivity** ([README](../README.md) documents the unpause click). A church dashboard is plausibly idle for a week. The first signal that the system is down is currently a phone call on a Sunday morning. |
| O8 | No degraded-mode UX | When Supabase is unreachable, each view renders its own inline error string. There is no app-level banner, no distinction between "you are offline", "the database is paused", and "your session expired". |
| O9 | No retry or backoff | `supabase-js` does not retry by default. One dropped request during a Sunday count surfaces as a hard failure to a volunteer mid-entry. |
| O10 | No offline tolerance | Collections are entered on-site, on church wifi, on a phone. There is not even a `navigator.onLine` check before a submit that is certain to fail. |

O7's $0 fix is an external pinger (UptimeRobot / Better Stack free tiers) against the Netlify URL plus a tiny static route that performs one cheap authenticated-free query, so that a paused database registers as *down* rather than as *a white page that loads fine*.

### 14.3 Durability — the system cannot currently be rebuilt

This is the most serious finding in §14.

| ID | Gap | Detail |
|---|---|---|
| O11 | No backup beyond platform defaults | Free-tier Supabase provides daily backups with short retention and **no PITR** (confirm current terms). No `pg_dump` runs anywhere, and no restore has ever been tested. |
| O12 | **Clean-room rebuild is impossible** | See below. |
| O13 | No seed / fixture path | A fresh environment cannot be brought to a working state without hand-editing production-shaped data. This is also why §14.4's staging gap is hard to close. |
| O14 | No retention or erasure policy | Cross-ref [SECURITY.md](SECURITY.md) §3.10. Soft delete is forever; there is no hard-delete path and no documented subject-access or erasure procedure. Under the PH **Data Privacy Act (RA 10173)** the church is a personal information controller for this data, which makes retention an obligation rather than a preference. |

**O12 in detail.** Two facts already documented separately combine into something worse than either:

1. `0006_baseline_rls` is a **record of live state that must not be executed** ([README](../README.md)).
2. The trigger on `auth.users` calling `handle_new_user()`, and the event trigger calling `rls_auto_enable()`, exist in **no migration** ([SECURITY.md](SECURITY.md) §3.13).

Therefore `prisma/migrations/` cannot reconstruct a working database, and the one migration that describes the missing security state is explicitly non-runnable. If the Supabase project were lost tomorrow, recovery would depend on a backup that has never been restore-tested (O11) plus institutional memory of manual dashboard steps. **The repository is not currently a sufficient disaster-recovery artifact.** Closing this requires (a) an idempotent `scripts/sql/bootstrap-triggers.sql` covering the two out-of-schema triggers, (b) a scheduled `pg_dump` to a GitHub Actions artifact, and (c) one documented, dated restore drill.

### 14.4 Environments & release safety

| ID | Gap | Detail |
|---|---|---|
| O15 | No staging | [README](../README.md) states this outright. RLS changes — the highest-blast-radius change type in this architecture — go straight to production with `rollback.sql` open in another tab. A second free Supabase project costs $0. |
| O16 | Deploy ordering is human memory | The README requires DB migrations to land before the matching SPA release. Nothing enforces it; the failure mode is a live column-not-found error. |
| O17 | Netlify builds are not gated on CI | [ci.yml](../.github/workflows/ci.yml) runs `test` + `build`, but Netlify builds on push independently unless configured otherwise — verify the dashboard setting. A red build can currently ship. |
| O18 | No version tag, changelog, or rollback runbook | Netlify supports instant rollback to a prior deploy; nobody has written down that this is the procedure, so it will not be found under pressure. |
| O19 | No secret rotation runbook | No documented procedure or trigger condition for rotating `VITE_SUPABASE_ANON_KEY`, `DATABASE_URL`, or `DIRECT_URL`, and no statement of who holds a service-role key (if anyone). |

### 14.5 Supply chain & runtime abuse

| ID | Gap | Detail |
|---|---|---|
| O20 | No dependency scanning | Cross-ref [SECURITY.md](SECURITY.md) §3.8. Dependabot and `npm audit --audit-level=high` in CI are both free and are a one-file change each. |
| O21 | CSP violations are silent | [netlify.toml](../netlify.toml) sets a genuinely strict CSP but no `report-uri` / `report-to`, so a blocked injection attempt produces no signal anywhere. Point it at the O4 sink. |
| O22 | No mutation throttling | RLS authorizes but does not rate-limit. A single compromised staff credential can enumerate the congregation or write unbounded ledger rows at API speed. Supabase Auth rate limits are dashboard configuration and are unreviewed (cross-ref [SECURITY.md](SECURITY.md) §3.6). |

### 14.6 Engineering hygiene — the guardrails that catch regressions

| ID | Gap | Detail |
|---|---|---|
| O23 | No linter or formatter | No ESLint, no Prettier, no `lint` script. §3 notes the absence as a stack fact; the consequence is that `eslint-plugin-vue` catches an entire class of template bugs — unused refs, missing `:key`, unresolved component names, typo'd bindings — that Vitest structurally cannot, because those files are never mounted. |
| O24 | **Interaction** tests are impossible today | [vitest.config.js](../vitest.config.js) sets `environment: 'node'` and `@vue/test-utils` is not installed, so nothing can click, type, or open a modal. Coverage is therefore inverted against risk: pure date helpers are well tested, while the archive flow, the modal state machine, the 3-hour lock path, and finance gating — every RLS-dependent path — have none. **Partially narrowed:** `vue/server-renderer` needs no new dependency, and [tests/views/churchFundsView.test.js](../tests/views/churchFundsView.test.js) uses it to assert a view's `setup()` runs, queries the tables it should, and renders the right initial state. That is worth copying to the other views — it caught a real crash that `npm run build` passed. Two traps: SSR skips `onMounted`, and Vue routes watcher failures to `app.config.errorHandler` instead of rejecting the render, so a test that does not collect from that handler will pass over a thrown exception. |
| O25 | No type checking | Cross-ref §9.7. Not proposed as a migration; noted because O23/O24 partially compensate and should be weighed first. |

O24's fix is `npm i -D jsdom @vue/test-utils` plus `environment: 'jsdom'`. The first three tests worth writing, in order: archive removes the row and closes the modal; an out-of-window edit surfaces `EDIT_WINDOW_CLOSED_MESSAGE` rather than a silent success (this is the [mutationResult.js](../src/utils/mutationResult.js) contract, currently only unit-tested in isolation); a non-finance user does not see `FundsTabs` links.

### 14.7 Minimum viable operational baseline

If only a subset is done, do these — ordered by consequence-if-skipped, all $0:

1. **O12 + O11** — bootstrap script for the out-of-schema triggers, scheduled `pg_dump`, one dated restore drill. Without this, every other item is moot, because a bad day ends the project.
2. **O5 (ledger audit)** — `collections_history`, trigger-written. Cheapest now, impossible to backfill later.
3. **O7** — external uptime check. Turns "a volunteer noticed on Sunday" into "we knew on Thursday".
4. **O4 + O2/O3** — the in-stack error sink plus global handlers. Ends the current state of learning about failures socially.
5. **O15** — a second free Supabase project as staging, which also gives O13 somewhere to matter.
6. **O20 + O17** — Dependabot, `npm audit` in CI, and gate the Netlify deploy on a green build.
7. **O23 + O24** — ESLint and a jsdom test environment, so the fixes above stay fixed.

**Security cross-reference.** The items with a security dimension are filed in [SECURITY.md](SECURITY.md) §3.14–§3.20 with threat-model context and verification steps: D4 → §3.14, D5/D6 → §3.15, O5 → §3.16, O21 → §3.17, O22 → §3.18, O12 → §3.19, O17/O19 → §3.20. §5.1 there records the reclassification of error monitoring from Tier 3 to Tier 1 on the strength of the free in-stack option described in §14.1 above.

### 14.8 Relationship to §0 priorities

None of §14 conflicts with priority 1 — every item above has a free path, and O2/O6/O22 actively *protect* the cost line by making budget-breaching regressions visible before they arrive as a bill. Where a paid option exists (Sentry, PITR, Cloudflare per [SECURITY.md](SECURITY.md) §5.3), the free in-stack alternative is named so that the decision stays an owner's choice rather than a default.

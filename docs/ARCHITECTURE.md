# UDFC Church Dashboard — Architecture & System Design (AI Context)

> **Purpose of this document:** Provide an AI assistant with a concise, structured, and accurate snapshot of the current system so it can reason about, modify, and extend the codebase without re-discovering context.
>
> **Last reviewed against source:** Reflects the state of `main` / `user-mgmt` branch as of the current workspace.

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
| Backend SDK | `@supabase/supabase-js` | `^2.49.1` |
| Backend (BaaS) | Supabase (Postgres + Auth) | n/a |
| Hosting | Netlify | n/a |
| Module type | ESM (`"type": "module"`) | — |
| State management | None (local component state via `ref` / `computed`) | — |
| CSS | Plain CSS (scoped per SFC) + global [src/style.css](src/style.css) | — |

There is **no TypeScript, no test framework, no linter, no Pinia/Vuex, and no UI component library.**

---

## 4. Repository Layout

```
dashboard-project/
├── index.html                  # Single HTML entry; mounts #app
├── netlify.toml                # build = `npm run build`, publish = `dist`, SPA fallback redirect
├── package.json                # Scripts: dev, build, preview
├── vite.config.js              # Minimal — only registers @vitejs/plugin-vue
├── README.md                   # Human-facing setup & deployment guide
├── public/
│   └── vite.svg                # Favicon (default Vite asset)
└── src/
    ├── main.js                 # createApp(App).use(router).mount('#app')
    ├── App.vue                 # Root component — renders <router-view /> only
    ├── style.css               # Global reset + body font (Segoe UI stack)
    ├── lib/
    │   └── supabase.js         # Singleton Supabase client (uses VITE_SUPABASE_*)
    ├── router/
    │   └── index.js            # Routes + global beforeEach auth guard
    └── views/
        ├── LoginView.vue       # Email/password sign-in form
        └── DashboardView.vue   # Members table + sortable columns + details modal
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
| `/dashboard` | `Dashboard` | `DashboardView` | `requiresAuth: true` |

`router.beforeEach` calls `supabase.auth.getSession()` on every navigation:
- Redirects unauthenticated users away from `requiresAuth` routes → `/login`.
- Redirects authenticated users away from `/login` → `/dashboard`.
- **Note:** `getSession()` is awaited per navigation; this is acceptable because the session is cached client-side by the Supabase SDK.

### 5.3 Supabase Client

[src/lib/supabase.js](src/lib/supabase.js):
- Reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from `import.meta.env`.
- Falls back to `https://placeholder.supabase.co` + `'placeholder-key'` if env vars are missing, and logs a `console.warn`. This prevents a hard crash in dev when `.env` is absent but the app will not function.
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
- `members` — array fetched once on mount via `supabase.from('members').select('*, churches(name)')`.
- `loading`, `error` — request lifecycle flags.
- `modalMode` — drives the tri-mode modal: `'view' | 'create' | 'edit' | 'archive-confirm' | null` (null = closed).
- `selectedMember` — the row being viewed / edited / archived (null in `create` mode).
- `formData`, `formError`, `formSaving` — shared by `create` and `edit` modes.
- `archiveReason` — captured by the in-modal archive confirmation panel.
- `myChurchId`, `myChurchName` — resolved on mount via `supabase.rpc('get_my_church_id')` + a follow-up `churches` lookup. Used to pre-fill `member_of` on create and to label the read-only "Member Of" form field.
- `sortKey`, `sortDir` — current column sort.

**Behavior:**
- Fetches once `onMounted`. RLS at the DB level filters rows to the user's church AND `archived_at IS NULL` automatically.
- `pageTitle` computes `"UDFC <church> Members"` from `myChurchName` (falling back to the first row's joined `churches.name`).
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
- `handleCreate()` → `supabase.from('members').insert({ ...buildPayload(), member_of: myChurchId }).select('*, churches(name)').single()` → prepend to `members`, close modal. RLS rejects any other `member_of`.
- `handleUpdate()` → `supabase.update(buildPayload()).eq('id', id).select('*, churches(name)').single()` → splice the row in `members` by id, return modal to `view` mode. The UPDATE policy's `with check` blocks reassigning `member_of` to another church.
- `handleArchive()` → `supabase.update({ archived_at: new Date().toISOString(), archived_reason })` → filter the row out of `members` (RLS will hide it on subsequent reloads too).
- `buildPayload()` trims strings and coerces empty optional fields to `null` so the DB stores `NULL` rather than `""`.

### 5.5 Styling Conventions
- Global reset in [src/style.css](src/style.css) (`*` reset + body font stack).
- Component styles use `<style scoped>` per SFC.
- Color palette: primary `#1a56db` (blue), neutrals from the `slate` family (`#f8fafc`, `#e2e8f0`, `#1e293b`, `#64748b`), error `#dc2626`.
- Card aesthetic: `12px` radius, soft blue-tinted shadows.

---

## 6. Backend (Supabase)

### 6.1 Required Tables

## Table `churches`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `name` | `varchar` |  |
| `address` | `varchar` |  Nullable |

## Table `user_accounts`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `member_id` | `uuid` |  Nullable |

## Table `members`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `first_name` | `varchar` |  |
| `last_name` | `varchar` |  |
| `middle_name` | `varchar` |  Nullable |
| `birthdate` | `date` |  |
| `gender` | `varchar` |  |
| `address` | `varchar` |  Nullable |
| `date_joined` | `date` |  Nullable |
| `contact_number` | `numeric` |  Nullable |
| `email` | `varchar` |  Nullable |
| `member_of` | `uuid` |  |
| `archived_at` | `timestamptz` |  Nullable |
| `archived_reason` | `text` |  Nullable |



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

Policies (summarized from [README.md](README.md)):
- `members SELECT` → `using (member_of = public.get_my_church_id() AND archived_at IS NULL)` — same church, active only.
- `members INSERT` → `with check (member_of = public.get_my_church_id() AND archived_at IS NULL)` — must belong to caller's church and start un-archived.
- `members UPDATE` → `using/with check (member_of = public.get_my_church_id())` — allows edits and archiving (`archived_at` flip), but `with check` blocks reassigning `member_of` to another church.
- **No DELETE policy.** Archiving is the only deletion path; hard deletes are not permitted from the dashboard.
- `churches SELECT` → `using (true)` for `authenticated` (so joined `churches(name)` resolves).

**Why `SECURITY DEFINER`?** The helper function reads `members` itself; without `SECURITY DEFINER` the policy on `members` would recurse, producing `stack depth limit exceeded`.

### 6.2.1 Archiving Model (soft delete)

Members are never hard-deleted. The schema uses two nullable columns plus a partial index:

- `members.archived_at TIMESTAMPTZ NULL` — `NULL` = active; non-null timestamp = archived.
- `members.archived_reason TEXT NULL` — optional free-text reason captured at archive time.
- Partial index `members_active_church_idx ON members(member_of) WHERE archived_at IS NULL` — every dashboard query has the predicate `archived_at IS NULL` injected by the `SELECT` policy, so the planner uses this index. Its size scales with the **active** member count, not the total.

**Storage rationale.** NULL columns cost ~1 bit each in Postgres' null bitmap (with no per-row payload when null), so the two nullable columns add negligible weight to active rows. A partial index over the active set keeps lookups fast even if archived rows accumulate over years. Restoring an archived member is a single `update members set archived_at = null, archived_reason = null where id = ...` — currently a manual SQL operation (no UI).

### 6.3 Authentication
- Supabase Auth, email + password, bcrypt-hashed server-side.
- JWT session is persisted by the SDK in `localStorage` (default behavior of `@supabase/supabase-js` v2).
- The frontend never sees or stores password hashes.

### 6.4 Linking a New Auth User to a Member
Manual SQL (no UI yet):
```sql
insert into public.members (id, first_name, last_name, birthdate, gender, member_of, date_joined)
values ('<auth-user-uuid>', 'First', 'Last', '1990-01-01', 'Male', '<church-uuid>', current_date);

insert into public.user_accounts (id, member_id)
values ('<auth-user-uuid>', '<auth-user-uuid>');
```

---

## 7. Build, Run, Deploy

### 7.1 Scripts ([package.json](package.json))
| Script | Command | Use |
|---|---|---|
| `dev` | `vite` | Dev server, HMR, default port 5173 |
| `build` | `vite build` | Outputs to `dist/` |
| `preview` | `vite preview` | Serves the production build locally |

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

| Concern | Status |
|---|---|
| Secrets in repo | None. Anon key is intentionally public; service role key is **never** used in the frontend. |
| Authorization | Enforced server-side by Postgres RLS. Frontend cannot bypass it. |
| Transport | HTTPS only (Supabase + Netlify). |
| XSS | Vue auto-escapes interpolation; no `v-html` is used in current views. |
| CSRF | N/A — Supabase uses Bearer JWTs in headers, not cookies. |
| Password storage | Handled by Supabase (bcrypt). App never touches password material after submission. |
| Open redirects | Router only navigates to known named routes. |

---

## 9. Known Gaps / Things AI Should Be Aware Of

These are **not bugs** but explicit non-features in the current build. If asked to add them, treat as new feature work:

1. **No restore UI for archived members** — archiving is exposed in the dashboard, but un-archiving (`update members set archived_at = null`) is a manual SQL operation. There is also no admin view for browsing archived rows.
2. **No pagination / virtualization** — entire member list is fetched at once. Fine for small congregations; revisit if a church exceeds a few thousand rows.
3. **No client-side search/filter.**
4. **No realtime subscriptions** — the table is a static snapshot until page reload.
5. **No global state store** — state lives in component `ref`s; if multiple views need shared data, introduce Pinia rather than prop-drilling.
6. **No tests** — no Vitest, no Playwright, no CI checks beyond the Netlify build.
7. **No TypeScript** — adding types would require migrating `.vue`/`.js` files and updating `vite.config.js`.
8. **No multi-church admin role** — RLS assumes exactly one church per user. Cross-church access requires schema and policy changes.
9. **No error reporting** — errors are surfaced inline; no Sentry/logging integration.
10. **`App.vue` is empty of layout** — any global header/nav/toast container should be added here, not in individual views.

---

## 10. Conventions for AI-Assisted Edits

When modifying this codebase, prefer the following:

- **Composition API + `<script setup>`** — match the existing style; do not introduce Options API.
- **Scoped styles per SFC** — only put truly global rules in [src/style.css](src/style.css).
- **Route-level code splitting** — when adding new views, register them in [src/router/index.js](src/router/index.js) and consider `() => import('...')` for lazy loading once the bundle grows.
- **Auth guard** — any new authenticated route must include `meta: { requiresAuth: true }`.
- **Database access** — go through the shared `supabase` import from [src/lib/supabase.js](src/lib/supabase.js); do not instantiate a new client.
- **RLS first** — never replicate authorization logic in the frontend. If the user shouldn't see a row, the policy must reject it.
- **Errors** — surface Supabase error `.message` to the user (this is the existing pattern); avoid throwing.
- **No new dependencies** without a clear reason — the dep list is intentionally minimal.
- **Color & spacing tokens** — match the existing slate/blue palette and `12px` card radius for visual consistency.

---

## 11. Quick Reference — Data Flows for the Dashboard

### 11.1 Sign in & initial load
1. User submits credentials in [LoginView.vue](src/views/LoginView.vue).
2. `supabase.auth.signInWithPassword` → JWT stored in `localStorage`.
3. `router.push('/dashboard')`.
4. Router guard sees a session → allows navigation.
5. [DashboardView.vue](src/views/DashboardView.vue) `onMounted` runs in parallel:
   - `supabase.rpc('get_my_church_id')` → caches `myChurchId`; a follow-up `churches` lookup caches `myChurchName`.
   - `supabase.from('members').select('*, churches(name)')`.
6. PostgREST attaches the JWT, Postgres evaluates RLS:
   - `get_my_church_id()` resolves the user's church via `user_accounts → members.member_of`.
   - `members SELECT` policy filters to `member_of = get_my_church_id() AND archived_at IS NULL` (the partial index `members_active_church_idx` is used).
7. Rows return; Vue renders the sortable table.
8. Sign out → `supabase.auth.signOut()` clears session → guard sends user back to `/login`.

### 11.2 Create
1. User clicks **+ Add Member** → modal opens in `create` mode with a blank form; `member_of` is pinned to `myChurchId`.
2. Submit → `handleCreate()` → `insert(payload).select('*, churches(name)').single()`.
3. The INSERT policy enforces `member_of = get_my_church_id() AND archived_at IS NULL`; any tampered payload is rejected.
4. On success, the new row is prepended to `members` and the modal closes. Badge increments.

### 11.3 Edit
1. From `view` mode, user clicks the Edit icon → modal switches to `edit`, `formData` is hydrated from `selectedMember`.
2. Submit → `handleUpdate()` → `update(payload).eq('id', id).select('*, churches(name)').single()`.
3. The UPDATE policy's `with check` enforces `member_of = get_my_church_id()` — reassigning to another church is blocked.
4. On success, the row in `members` is replaced (splice by id), `selectedMember` is updated, modal returns to `view`.

### 11.4 Archive (soft delete)
1. From `view` mode, user clicks **Archive member** → modal body swaps to an in-modal confirmation panel with an optional reason textarea.
2. Confirm → `handleArchive()` → `update({ archived_at: now, archived_reason }).eq('id', id)`.
3. The UPDATE policy permits the change (same church); the row remains in the database.
4. On success, the row is filtered out of `members` and the modal closes. Badge decrements. Subsequent reloads will not return the row because the SELECT policy excludes `archived_at IS NOT NULL`.

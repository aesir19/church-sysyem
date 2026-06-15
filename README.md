# UDFC Church Dashboard

A clean, professional dashboard for managing church member records. Built for the **United Door of Faith Church (UDFC)** church system, the platform allows authorized church staff to securely sign in and view members of their own congregation.

---

## Features

- **Secure authentication** powered by Supabase Auth (email + password, bcrypt-hashed)
- **Members directory** with sortable columns (Last Name, First Name, Age, Gender)
- **Member details modal** — click any row to view full contact info
- **Create / Edit members** directly from the dashboard via a tri-mode modal (view / edit / create)
- **Soft-delete (archive)** members with an optional reason; archived rows are hidden from the dashboard but retained in the database for audit
- **Per-church data isolation** — Row Level Security ensures each user only sees, creates, and edits members of their assigned church
- **Responsive UI** with a clean white & blue theme
- **Ready for Netlify deployment**

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | [Vue 3](https://vuejs.org/) + [Vite](https://vitejs.dev/) |
| Routing | [Vue Router](https://router.vuejs.org/) |
| Backend & Database | [Supabase](https://supabase.com/) (PostgreSQL + Auth) |
| Hosting | [Netlify](https://www.netlify.com/) |

---

## Prerequisites

- **Node.js** v18 or higher (v22 LTS recommended)
- **npm** (comes with Node.js)
- A **Supabase project** ([create one for free](https://supabase.com/))

---

## Getting Started

### 1. Clone the repository

```bash
git clone <your-repo-url>
cd dashboard-project
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Create a `.env` file in the project root (or copy from `.env.example`):

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-publishable-key
```

> Get these from your Supabase dashboard → **Settings → API**.
> The "anon key" is the same as the "publishable key".

### 4. Run the development server

```bash
npm run dev
```

The app will be available at `http://localhost:5173/` (or the next available port).

---

## Database Setup

The app expects the following tables in your Supabase project:

### `churches`
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | Primary key |
| `name` | `text` | Church name (e.g. "Graceville") |

### `members`
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | Primary key |
| `first_name` | `text` | |
| `last_name` | `text` | |
| `middle_name` | `text` | Nullable |
| `birthdate` | `date` | Used to compute age |
| `gender` | `text` | "Male" or "Female" |
| `address` | `text` | Nullable |
| `member_of` | `uuid` | Foreign key → `churches.id` |
| `contact_number` | `text` | |
| `email` | `text` | |
| `date_joined` | `date` | |
| `archived_at` | `timestamptz` | Nullable. `NULL` = active member; non-null = archived (soft-deleted) |
| `archived_reason` | `text` | Nullable. Optional reason captured at archive time |

### `user_accounts`
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | Primary key — matches `auth.users.id` |
| `member_id` | `uuid` | Foreign key → `members.id` |

---

## Row Level Security (RLS)

A helper function determines the logged-in user's church and is used in the `members` policies. Members are never hard-deleted; instead they are *archived* by setting `archived_at`. The `SELECT` policy hides archived rows from the dashboard, and a partial index keeps lookups fast on the active set only.

```sql
-- ─────────────────────────────────────────────────────────────
-- Schema: archiving columns (idempotent)
-- ─────────────────────────────────────────────────────────────
alter table public.members
  add column if not exists middle_name     text,
  add column if not exists address         text,
  add column if not exists archived_at     timestamptz,
  add column if not exists archived_reason text;

-- Partial index — only active members are indexed (scales with active set)
create index if not exists members_active_church_idx
  on public.members (member_of)
  where archived_at is null;

-- ─────────────────────────────────────────────────────────────
-- Helper function (SECURITY DEFINER bypasses RLS to avoid recursion)
-- ─────────────────────────────────────────────────────────────
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

revoke execute on function public.get_my_church_id() from public;
grant execute on function public.get_my_church_id() to authenticated;

-- ─────────────────────────────────────────────────────────────
-- Single round-trip helper: returns the caller's church id + name
-- in one call. The frontend uses this on dashboard mount instead
-- of two serial calls (rpc('get_my_church_id') + churches.select).
-- Additive — does NOT replace get_my_church_id(), which is still
-- referenced by the RLS policies below.
-- ─────────────────────────────────────────────────────────────
create or replace function public.get_my_church()
returns table (id uuid, name text)
language sql
security definer
set search_path = public
stable
as $$
  select c.id, c.name
  from public.user_accounts ua
  join public.members m on m.id = ua.member_id
  join public.churches c on c.id = m.member_of
  where ua.id = auth.uid()
  limit 1;
$$;


-- ─────────────────────────────────────────────────────────────
-- RLS policies on public.members
-- ─────────────────────────────────────────────────────────────
alter table public.members enable row level security;

-- Drop any prior SELECT policy that did not exclude archived rows
drop policy if exists "Only same church members can view data" on public.members;
drop policy if exists "members_select_active_same_church"     on public.members;
drop policy if exists "members_insert_own_church"             on public.members;
drop policy if exists "members_update_own_church"             on public.members;

-- SELECT: same church AND not archived (hides archived rows from the dashboard)
create policy "members_select_active_same_church"
  on public.members
  for select
  to authenticated
  using (
    member_of = public.get_my_church_id()
    and archived_at is null
  );

-- INSERT: must belong to caller's church and start un-archived
create policy "members_insert_own_church"
  on public.members
  for insert
  to authenticated
  with check (
    member_of = public.get_my_church_id()
    and archived_at is null
  );

-- UPDATE: edits + archiving allowed; church reassignment blocked by `with check`
create policy "members_update_own_church"
  on public.members
  for update
  to authenticated
  using       (member_of = public.get_my_church_id())
  with check  (member_of = public.get_my_church_id());

-- No DELETE policy — archive is the only deletion path.

-- Allow authenticated users to read church names (for the joined dropdown / header)
create policy "Authenticated users can view churches"
  on public.churches for select
  to authenticated
  using (true);
```

### Linking an auth user to a member

When a new user is created in Supabase Auth, you must link them to a member:

```sql
-- 1. Insert a member record (or use an existing one)
insert into public.members (id, first_name, last_name, birthdate, gender, member_of, date_joined)
values ('<auth-user-uuid>', 'First', 'Last', '1990-01-01', 'Male', '<church-uuid>', current_date);

-- 2. Create the user_accounts link
insert into public.user_accounts (id, member_id)
values ('<auth-user-uuid>', '<auth-user-uuid>');
```

---

## Project Structure

```
dashboard-project/
├── public/                 # Static assets
├── src/
│   ├── lib/
│   │   └── supabase.js     # Supabase client setup
│   ├── router/
│   │   └── index.js        # Vue Router with auth guard
│   ├── views/
│   │   ├── LoginView.vue   # Sign-in page
│   │   └── DashboardView.vue # Members table + tri-mode modal (view/edit/create) + archive flow
│   ├── App.vue
│   ├── main.js             # App entry point
│   └── style.css           # Global styles
├── .env                    # Local environment variables (not committed)
├── .env.example            # Template for env variables
├── netlify.toml            # Netlify deployment config
├── index.html
├── package.json
└── vite.config.js
```

---

## Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the dev server with hot reload |
| `npm run build` | Build the production bundle into `dist/` |
| `npm run preview` | Preview the production build locally |

---

## Deployment to Netlify

1. Push your code to a GitHub/GitLab/Bitbucket repository.
2. In Netlify, click **Add new site → Import an existing project** and connect your repo.
3. Netlify will auto-detect the build settings from `netlify.toml`:
   - **Build command:** `npm run build`
   - **Publish directory:** `dist`
4. Add your environment variables in **Site settings → Environment variables**:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. Click **Deploy**.

The included `netlify.toml` already handles SPA routing redirects so deep links (e.g. `/dashboard`) work correctly. It also caches Vite's content-hashed assets (`/assets/*`) for one year (`immutable`) while keeping `index.html` revalidated on every visit so deploys propagate immediately.

---

## Operations

### Supabase free-tier auto-pause

Supabase pauses free-tier projects after **7 consecutive days of no activity**. "Activity" means any authenticated request — a single sign-in + dashboard load is enough to keep the project warm.

**What you'll see when it's paused**

- Sign-in fails with a network error or a long timeout.
- The project shows a `Paused` banner in the [Supabase dashboard](https://app.supabase.com/).

**How to recover**

1. Open the project in the Supabase dashboard.
2. Click **Restore project** (one-click; takes ~1–2 minutes).
3. The next sign-in works normally. No data is lost — auto-pause only suspends compute, not storage.

**What we deliberately do NOT do**

- We do **not** run a synthetic keep-alive cron (e.g. a scheduled function that pings the database). It would consume free-tier budget for no real-user benefit and risks tripping abuse policies. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §12.3 rule 10.
- For seasonal closures (multi-month gaps), accept the one-time unpause as the operating cost of the free tier.

### Free-tier health checklist

A quick once-a-month look at the Supabase dashboard:

- **Database size** — should stay well under 500 MB (free-tier limit). Each archived member is ~1 KB.
- **Egress (outgoing bandwidth)** — should stay well under 5 GB/month. Watch the Reports tab.
- **Auth users** — limit is 50,000 monthly active users; not a realistic concern for a single church.
- **Netlify bandwidth** — limit is 100 GB/month. Cache headers (above) keep the asset bandwidth near zero on repeat visits.

If any of these get close to a limit, see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §12 for the upgrade path.

---

## Troubleshooting

**Blank white screen on startup**
- Make sure `.env` contains valid Supabase credentials and you've restarted the dev server after editing it.

**"Failed to load members: stack depth limit exceeded"**
- A Row Level Security policy is recursively querying its own table. Make sure helper functions like `get_my_church_id()` use `SECURITY DEFINER`.

**Dashboard shows "No members found" but data exists in Supabase**
- The logged-in user has no row in `user_accounts`, or the linked member has `member_of = NULL`. See the [Linking an auth user to a member](#linking-an-auth-user-to-a-member) section.

**"Member Of" shows a UUID instead of the church name**
- The `churches` table needs an RLS policy allowing authenticated reads (see SQL above).

---

## Security Notes

- The `VITE_SUPABASE_ANON_KEY` is safe to expose in the frontend — actual access is gated by Row Level Security policies.
- Passwords are never stored or hashed in this app; Supabase handles authentication entirely server-side using **bcrypt**.
- All database access is over HTTPS.

---

## License

This project is for internal use by UDFC. All rights reserved.

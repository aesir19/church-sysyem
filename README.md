# UDFC Church Dashboard

A clean, professional dashboard for managing church member records. Built for the **United Door of Faith Church (UDFC)** church system, the platform allows authorized church staff to securely sign in and view members of their own congregation.

---

## Features

- **Secure authentication** powered by Supabase Auth (email + password, bcrypt-hashed)
- **Members directory** with sortable columns (Last Name, First Name, Age, Gender)
- **Member details modal** — click any row to view full contact info
- **Per-church data isolation** — Row Level Security ensures each user only sees members of their assigned church
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
| `birthdate` | `date` | Used to compute age |
| `gender` | `text` | "Male" or "Female" |
| `member_of` | `uuid` | Foreign key → `churches.id` |
| `contact_number` | `text` | |
| `email` | `text` | |
| `date_joined` | `date` | |

### `user_accounts`
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | Primary key — matches `auth.users.id` |
| `member_id` | `uuid` | Foreign key → `members.id` |

---

## Row Level Security (RLS)

A helper function determines the logged-in user's church and is used in the `members` SELECT policy.

```sql
-- Helper function (SECURITY DEFINER bypasses RLS to avoid recursion)
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

-- Policy: users can only see members of their own church
create policy "Only same church members can view data"
  on public.members
  for select
  to authenticated
  using (member_of = public.get_my_church_id());

-- Allow authenticated users to read church names
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
│   │   └── DashboardView.vue # Members table + details modal
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

The included `netlify.toml` already handles SPA routing redirects so deep links (e.g. `/dashboard`) work correctly.

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

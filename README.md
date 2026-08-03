# UDFC Church Dashboard

The UDFC Church Dashboard is a private online record-keeping tool for authorized church staff. It helps teams view and manage member information in one place without needing paper files or manual spreadsheets.

## What it is for

- Finding church members quickly
- Viewing member contact details
- Adding new member records
- Updating existing member records
- Keeping inactive records out of the main view while preserving history

## Who can use it

Only authorized church staff with a valid sign-in can access the dashboard.

## What you will see

- A secure sign-in screen
- A member list for the assigned church
- Member profiles with contact and personal details
- Simple actions for viewing, editing, or adding records

## Getting started

1. Open the dashboard in your browser.
2. Sign in with your church account.
3. Use the member list to find the person you need.
4. Open a record to view details or make updates if you have permission.

## Using the dashboard

You can search for people, open a member’s record, and update information when needed. If a record is no longer active, it may be hidden from the main list but still kept for church records.

## If you need help

If you cannot sign in, cannot find a member, or see information that looks incorrect, contact your church administrator or support contact.

## Privacy

Member information is limited to authorized users only. Please keep your sign-in details private and log out when you are finished.

## Developer workflow: Prisma schema migrations

Prisma is now used to manage database schema changes in code while Supabase remains the hosted Postgres/Auth/RLS platform.

1. Configure `.env` with:
   - `DATABASE_URL` (Supabase pooled URL)
   - `DIRECT_URL` (Supabase direct URL)
2. Pull existing schema:
   - `npm run prisma:pull`
3. Create migration from schema changes:
   - `npm run prisma:migrate:create -- --name your_change_name`
4. Deploy migrations:
   - `npm run prisma:migrate:deploy`

### Ministries and small-groups migrations

Migration `0004_church_scoped_groups` must be deployed before using the updated Ministries & Small Groups screen. It adds church ownership, curated colors, uniqueness constraints, grants, and RLS for `groups` / `group_members`.

The migration preserves existing ministry definitions and memberships, removes duplicate copies of the same membership association, and deterministically assigns colors. It intentionally aborts if it finds any existing non-Ministry group because no legacy small groups are expected and assigning those rows to a church automatically would risk cross-tenant exposure. If it aborts, inspect the unexpected rows and either export/remove them or add a reviewed church-specific backfill to the migration before retrying. Apply and verify this migration in a non-production Supabase project first, including the two-church RLS checks in `docs/SECURITY.md` §3.2.

Migration `0005_group_color_slots` must be deployed **after `0004_church_scoped_groups`** and before deploying frontend code that selects `groups.color_slot`. Do not edit or replace `0004` if it is already deployed. `0005` replaces the old eight-token `color` column with 3,240 globally unique integer slots, deterministically backfills all existing groups, and installs concurrency-safe automatic assignment for new groups. It aborts without applying changes if the existing group count exceeds 3,240.

Deploy database migrations before the matching SPA release to avoid a window where the frontend requests a column that does not exist. Validate `0005` in a non-production Supabase project first; confirm existing groups have distinct slots, concurrent inserts receive distinct slots, normal small-group creation succeeds without a color field, and authenticated attempts to insert or update `color_slot` are denied. The application does not deploy migrations automatically.

### Security baseline migration (`0006_baseline_rls`)

**Do not run `0006_baseline_rls` against the existing database.** It is a record of state that was already live, not a change to apply.

Policies for `members`, `churches`, `user_accounts` and `collections`, plus the `get_my_church()`, `handle_new_user()` and `rls_auto_enable()` functions, were originally created by hand in the Supabase dashboard and appeared in no migration. `0006` transcribes them verbatim so that every future policy change is a reviewable diff. It was registered without executing:

```bash
npx prisma migrate resolve --applied 0006_baseline_rls
```

Re-capture the live state at any time with `scripts/sql/capture-security-state.sql` (read-only; run it in the Supabase SQL editor) and diff it against the migrations to detect drift.

Two caveats a future operator must know:

1. `0006` records **known-flawed** policies unchanged, because a baseline that silently improves reality is not a baseline. Those flaws are fixed by `0007`–`0009` below, not by editing `0006`.
2. Rebuilding from `prisma/migrations/` alone is **not yet sufficient**. The trigger on `auth.users` that calls `handle_new_user()` and the event trigger that calls `rls_auto_enable()` live outside the `public` schema and are not captured by any migration. Both must be recreated by hand — without the first, every user signs in to an empty dashboard. See `docs/SECURITY.md` §3.13.

### Security fix migrations (`0007`–`0009`)

These three fix the defects `0006` exposed. Unlike `0006` they **do** change behaviour, so deploy them one at a time and verify before starting the next — there is no staging project.

| Migration | Fixes | Verify after deploying |
|---|---|---|
| `0007_members_policy_split` | Hard DELETE of active members was possible; the archive UPDATE was blocked by its own policy | List loads → create → edit → **archive a member** → a `DELETE` from devtools affects 0 rows |
| `0008_funds_write_policies` | Finance-role authorization was browser-only; `collections` had no UPDATE/DELETE policy; the 3-hour edit window was advisory | Finance user records a collection, edits it within 3 hours, is refused outside; a non-finance user's direct PostgREST write to `expenses` is rejected; **the reports page still loads for a non-finance user** |
| `0009_narrow_grants` | Default `GRANT ALL` to `anon`/`authenticated` on five tables; the `churches` cross-tenant leak | **Every view** — members, ministries & small groups, funds reports, collections, expenses |

```bash
npm run prisma:migrate:deploy
```

Each migration directory also contains a `rollback.sql`. Prisma never executes these — they are operational, for pasting into the Supabase SQL editor. Keep the relevant one open in a second tab while deploying, especially for `0009`: a grant that is too tight produces no build or test failure, only a runtime error on whichever page needed it. After running one, record it:

```bash
npx prisma migrate resolve --rolled-back 0009_narrow_grants
```

Re-run `scripts/sql/capture-security-state.sql` afterwards and confirm live state matches `0006` as amended by `0007`–`0009`.

Detailed plan: see `docs/prisma-migration.md`.

## License

This project is for internal use by UDFC. All rights reserved.

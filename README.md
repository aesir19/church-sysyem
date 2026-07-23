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

Detailed plan: see `docs/prisma-migration.md`.

## License

This project is for internal use by UDFC. All rights reserved.

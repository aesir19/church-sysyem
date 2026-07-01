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

Detailed plan: see `docs/prisma-migration.md`.

## License

This project is for internal use by UDFC. All rights reserved.

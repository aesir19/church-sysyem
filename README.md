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

## A note on availability

The dashboard runs on free hosting that goes to sleep after about a week without use. If nobody
has opened it in a while, the first visit may need an administrator to wake the database up once.
Using it at least weekly avoids this entirely.

---

## For developers

This README is for the people who use the dashboard. Technical documentation lives elsewhere:

| Document | Covers |
|---|---|
| [CLAUDE.md](CLAUDE.md) | The rules any change must follow — start here |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the system is wired |
| [docs/decisions/](docs/decisions/) | Why the load-bearing choices were made |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Deploying, migrations and their caveats, backups, free-tier budgets |
| [docs/SECURITY.md](docs/SECURITY.md) | Threat model, findings, verification steps |
| [docs/DEFECTS.md](docs/DEFECTS.md) | Known bugs |
| [docs/BACKLOG.md](docs/BACKLOG.md) | Deferred features |

Quick start:

```bash
npm install
npm run dev      # always the STAGING database — see docs/STAGING.md for the .env.staging it needs
npm test
```

`npm run dev` cannot reach production: production credentials live in `.env.production`, which Vite
loads only for `npm run build`. That is deliberate — see [docs/STAGING.md](docs/STAGING.md) §1.

**Before deploying anything that touches the database, read
[docs/OPERATIONS.md](docs/OPERATIONS.md).** Several migrations have caveats that will cost you a
production incident if skipped — including one that must never be run.

## License

This project is for internal use by UDFC. All rights reserved.

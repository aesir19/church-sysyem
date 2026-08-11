# Defects

**Open defects live in the [issue tracker](https://github.com/aesir19/church-sysyem/issues?q=is%3Aissue+is%3Aopen+label%3Adefect), not here.**

They were kept in this file until 2026-08-11 and migrated to GitHub issues, because a defect list
in markdown carries line-number links that rot on every commit — four of the sixteen entries
described code that no longer existed by the time anyone re-read them.

| Was | Now |
|---|---|
| `D1`–`D3`, `D10`, `D15` | issues labelled `defect` + `schema` — need a Prisma migration |
| `D6`–`D8`, `D11`, `D12`, `D14` | issues labelled `defect` + `ready-for-agent` |
| `D16` | issue labelled `defect` — the data-access layer, partly landed |

The old ids are preserved in each issue title (`D1 — …`) so commits and docs that reference them
still resolve.

---

## Why four entries were wrong

Worth keeping, because it is the argument for not doing this again:

- **D4, D5** described `useFinanceMember.js`, a file that had been deleted. `useCurrentRole` plus
  the `get_my_permissions` RPC (`0017`) replaced it, keyed to the auth user id and cleared on
  sign-out.
- **D9** said every view was eagerly imported into one 404 KB chunk. Every route had already been
  converted to `() => import(...)`.
- **D13** said an unmatched path rendered blank. The catch-all route already existed.

Each was accurate when written. Each became false silently, because nothing fails when a document
disagrees with the code — the disagreement is only discovered by someone reading both, which is
exactly the work the document was supposed to save.

**Rule that follows: never link to a line number from a document.** Link to a file, a symbol, or a
migration. `#L748` is a claim about code that will be false within a week, asserted in a place no
test can check.

## Where the rest went

- Things that are *missing* → [BACKLOG.md](BACKLOG.md)
- Things needed to *operate* the system → [OPERATIONS.md](OPERATIONS.md)
- Security findings → [SECURITY.md](SECURITY.md) (open) and [security/RESOLVED.md](security/RESOLVED.md) (closed)

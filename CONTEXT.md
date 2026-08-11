# Domain language

The words this project uses, and the ones it deliberately avoids. When code, an issue title or a
commit message names one of these concepts, use the term as defined here — a synonym that drifts
is how two people end up building different things.

Decisions that are hard to reverse live in [docs/decisions/](docs/decisions/), not here.

---

## Church

A congregation. The unit of tenancy: every member, collection, expense, group and service belongs
to exactly one. Postgres RLS scopes almost everything by church, so "which church" is a question
every query has an answer to, whether or not it says so.

## Active church

The **one** church a dashboard view is currently showing. For an ordinary user this is simply
their own. For a SuperAdmin or Head Pastor — who can read every church under RLS — it is the one
chosen in the church selector.

Load-bearing: RLS returns *all* churches to those roles, so a query that forgets to filter by the
active church merges congregations rather than failing. The scoping is the application's job.
See `src/composables/useActiveChurch.js`.

## Member

A person belonging to a church. Distinct from a **user** — most members have no login, and some
users (a visiting pastor) are not members of the church they administer.

## Member record

The **full** member row: seventeen columns including birthdate, address, contact number and
baptismal status. This is PII under this project's threat model.

Reached only through `listRecords()`, and only by a caller holding `canSeeMemberDetail`. It
refuses rather than degrading — see [Directory](#directory).

_Avoid_: "member details", "member profile".

## Directory

The **safe** view of members: names and group membership, nothing more. Served by the
`directory_search` RPC, available to every role including baseline users, for whom the base
`members` table returns nothing at all under RLS.

The Directory and the Member record are two different things, not one thing with a flag. They are
separate operations in `src/lib/data/members.js` precisely so that reaching the PII path is
something a caller has to ask for by name.

## Archive

The soft delete for a member: sets `archived_at` and an optional `archived_reason`. Members are
never hard-deleted — attendance and giving history reference them.

Load-bearing consequence: migration `0010_members_select_allow_archived` deliberately stopped RLS
from hiding archived rows, because a policy that hides them makes archiving itself impossible.
**Filtering archived members is therefore the application's job on every read.** That obligation
now lives inside `src/lib/data/members.js` rather than at each call site.

_Avoid_: "delete", "deactivate", "soft-delete" as a noun.

## Blocked write

A write the database refused **by filtering rather than by raising**. PostgREST applies an RLS
`USING` clause by excluding rows from the statement, so an `UPDATE` or `DELETE` that touches
nothing comes back `{ error: null, data: [] }` — success, with zero rows.

This is the failure mode most likely to be mistaken for success, and it caused a live defect: an
archive the policy refused was reported to the user as "Member archived successfully."

Distinguish from:

- **Denied** — the `WITH CHECK` half, which *raises* `42501`. Different failure, different message.
- **Conflict** — a unique-constraint violation, `23505`.

All three are classified in `src/lib/data/write.js`, which every mutation passes through.

## Capability

A derived boolean — `canWriteFinance`, `canSeeMemberDetail`, `canManageSmallGroups` — computed
from a role by `src/utils/capabilities.js`. Views and the router gate on capabilities, never on
role names.

Capabilities are **presentation**. RLS is the enforcement boundary (ADR-0001). A capability check
stops the app *asking* for something; it is not what stops the database answering.

## Service

A gathering attendance is recorded against. Either scheduled (from a recurring
`service_schedules` slot) or ad-hoc (a one-off).

## Check-in

A member or guest recording their own attendance from the public QR page, without an account.
Distinct from **recording**, which is staff entering attendance on someone's behalf — the
`source` column keeps the two apart, and a corrected check-in must not start claiming staff
verified the person. See ADR-0007.

## Guest

An attendance row not linked to a member. Either a genuine visitor, or a member whose self
check-in name did not match. Linking a guest row to a member is an in-place `UPDATE`, never
delete-and-re-add — see `src/utils/attendanceLink.js`.

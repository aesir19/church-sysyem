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

## Journey

A member's discipleship progression through **four ordered stages**:

1. **One-to-One**
2. **Baptized**
3. **Turning Point**
4. **Membership Form**

The order is the domain's, not an arbitrary display choice — it is the sequence a member actually
moves through, and it is *not* the order the columns appear in on the member record.

Load-bearing consequence: the stages are ordered, but the **record does not enforce that order**.
Each stage is an independent flag, so a member can carry a later stage complete while an earlier
one is not. Such a record is wrong, but it is representable and may already exist.

The application therefore **shows the flags as they are** — a later stage reads complete, the
skipped one reads incomplete — and never infers an earlier stage from a later one. Inferring would
be the app fabricating a pastoral record. A member's **stage label** is the furthest *contiguous*
stage completed, so a gap stays visible rather than being smoothed over. "Not started" and
"Complete" are the labels for neither end.

_Avoid_: "steps", "pipeline", "funnel". _Avoid_ describing it as a state machine in code or
comments — the record permits states a state machine would not.

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

## Contribution

Money received from a member or anonymously, of one of two kinds: **tithes** or **offering**. A
contribution belongs to a church and a date; it may belong to no member, which is what
*anonymous* means — see `docs/decisions/0003-nullable-collections-from.md`.

**Contributor** is the person, when there is one. The **Contributors** list is a finance surface,
restricted to those who may write finance, and it is where contributor identity legitimately
appears.

Load-bearing consequence: **a contribution never appears in a member context.** Not on a member
profile, not in a member export, not as a locked or empty placeholder — the placeholder is the
same disclosure promise as the figure. This is a privacy rule about *where* the information is
shown, and it does not narrow who may see the Contributors list. The two rules are independent
and both hold.

_Avoid_: "giving" and "donation" as nouns for the record. "Giving" is the word to avoid most
carefully — it is what the design mockups call a per-member view of exactly this data, which is
the thing the rule above forbids.

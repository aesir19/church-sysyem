# Archived members

Owner-approved functional scope, 5 October 2026. Implementation base: staging
`891b9ec`; branch: `codex/archived-members`.

## Purpose and surfaces

Add Settings → Archived members using the four owner-supplied mockups (12a–12d).
The existing Members page and Settings menu were inspected in the running app.
Only archive-related entries and behavior change; other settings remain as they are.
Use existing tokens and components, including dark mode and responsive layouts.

The Archived tab lists the selected church's archived members, with search by name,
record identifier, or archive reason. Show archive date, reason, linked-account
status, and a read-only record panel with retained group assignments. Distinguish
loading, failure, no archived records, and no search matches. Paginate on the server.
Do not invent archival actors or reasons for legacy rows.

## Permissions

| Actor | Browse archive | Archive / restore | Awaiting access / re-enable |
| --- | --- | --- | --- |
| SuperAdmin | Selected church | Yes | Yes |
| Pastor | Own church | Yes | No |
| Secretariat | Own church | Yes | No |
| Church Leader | Own church | No | No |

Enforce church scope and permissions in the database, including direct API calls.
Only SuperAdmin may archive a member linked to a SuperAdmin or Head Pastor account.
Block self-archive and archiving the last active SuperAdmin. Pastor gains archive
and restore operations, not general editing rights over member details.

## Archive and account access

Archiving retains member data, recorded attendance, giving, ministry membership,
small-group membership, and leadership assignments. Existing active-list filters
hide the archived member. Archiving a linked member must disable their account:
block new sign-ins and subsequent protected requests from existing sessions.
If account disabling fails, nothing is archived. Apply the rule to accounts already
linked to archived members when rolling out. Identify affected accounts before rollout.
No paid service or additional runtime vendor.

## Restore

Restore one member at a time. The confirmation requires a nonblank reason, explains
that retained group assignments return, and explicitly says sign-in stays disabled.
The archive window cannot edit member details. Ordinary member editing becomes
available through the existing authorized workflow once the record is restored.

## Awaiting access

SuperAdmin-only tab on this page, scoped to the selected church. List restored
members whose linked account remains disabled by archiving. Show the restoration
reason/date and current retained roles and assignments. Every listed item must be
explicitly confirmed before re-enabling; unticked items block the action, not remove
permissions. Existing role/group management handles changes to assignments.
Recheck permissions and current assignments on the server when re-enabling. A member
must be active first. Restoration never automatically re-enables account access.

## History

Record actor, timestamp, action, and reason for archive and restore from launch.
Keep the original archive event after restoration. Record rollout disabling distinctly
without fabricating an original archive actor. Record account recovery as well.
The history timeline is deferred.

## Exclusions

No editing inside the archive, bulk restoration, permanent deletion, unrelated
settings changes, new general-purpose audit viewer, or automatic account recovery.

## Confirmed test boundaries

The owner confirmed all three boundaries on 5 October 2026:

1. Database/API: church and role access, atomic archive and disable, restoration,
   protected-account/self/last-admin safeguards, disabled-session rejection, and
   SuperAdmin-only re-enable after confirming current assignments.
2. Frontend data module: successful operations, denied or failed operations, safe
   error messages, and retry behavior.
3. Browser flows: search/read-only details, restore reason and confirmation, retained
   groups, permission-dependent controls, and Awaiting access.

Use synthetic fixtures. Do not publish live member data. Show the implemented UI
to the owner before review or commit as required by AGENTS.md. Deployment/backfill
is a separate rollout action after the implementation is concrete and reviewable.

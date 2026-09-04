# 0019 — Member-first invitations, and cancelling a pending invite

Status: accepted · Supersedes the invite half of [ADR-0018](0018-account-invites-edge-function.md) · Migration `0040_member_first_invites`

## Context

Two problems surfaced in the invite flow from ADR-0018/0037:

1. **The address was typed by hand.** `invite_member(p_email, p_member, …)` trusted
   whatever e-mail the caller passed and only checked that *some* member carried it.
   A mistyped address failed to match — or, worse, matched the wrong member's record
   and sent there. The member already carries an e-mail; that is the only address an
   invite should ever use.

2. **A wrong invite stranded the member.** Sending an invite creates an `auth.users`
   account *and* an `account_invites` row. Deleting the account by hand in the
   Supabase dashboard removed the login but left the `account_invites` row — it has no
   FK to `auth.users`, it keys on e-mail + member. That orphaned row then blocked
   re-inviting the member forever ("that member already has a pending invite").

## Decision

**Invitations are anchored to a member, not to a typed address.** The invite dialog
searches members by name and shows, on every row, the e-mail the invite would go to.
`invite_member(p_member, p_role)` reads the address off the member record itself and
returns it (with the name) so the Edge Function knows where to mail. **E-mail is no
longer a caller-supplied parameter** — one fewer forgeable field (rule 2). A member
with no e-mail on file cannot be invited: the row is disabled with a prompt to add one,
and the function raises to match.

**A pending invite can be cancelled from inside the app** — the owner chose an in-app
Cancel over an auto-cleanup trigger on `auth.users` delete. `invite_to_cancel(email)`
tells the Edge Function whether the caller may cancel and hands back the un-accepted
account to delete (NULL when the login is already gone). The Edge Function deletes that
account (cascading `user_accounts`, unlinking the member) **then** `cancel_invite(email)`
marks the `account_invites` row consumed. Order matters: clearing the record before
deleting the account would leave the member linked and re-invite would refuse.

**`list_pending_invites()` now surfaces orphaned invites too**, flagged `orphaned`. An
orphan (login removed by hand, invite record left behind) stopped showing in the live
set yet still blocks re-inviting the member. Surfacing it is what lets Cancel reach the
ones already stuck — no manual SQL, now or later. Orphan rows offer Cancel only; a live
row offers Resend and Cancel.

## Consequences

- The correction workflow for a wrong address is: **cancel the invite → fix the
  member's e-mail on their record → invite again.** One source of truth, no override.
- The Edge Function and migration `0040` are a **matched pair**: `0040` changes the
  signature the deployed function calls, so the function must be deployed together with
  the migration or invites break in between.
- `cancel_invite` reuses `consumed_at` to mean "finalised" (accepted *or* cancelled),
  keeping the partial-unique indexes and guards unchanged. Distinguishing the two is
  not a feature any screen needs today; add a column if that changes.
- A pre-existing race was fixed alongside this: `RolesLinkingView` captured its
  `permitted` flag once at mount, before `get_my_permissions` resolved, locking a
  Super Admin out of the page. It now awaits the role and derives `permitted`.

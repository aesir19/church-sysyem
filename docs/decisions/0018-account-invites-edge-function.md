# ADR-0018 — Account invitations go through one Supabase Edge Function

**Status:** Accepted (constraint superseded) — authorises exactly one Edge Function holding the
service-role key, for sending account invitations. Supersedes the "transactional email" line of
[ADR-0002](0002-no-second-compute-vendor.md) for this one use.

## Context

Provisioning a new user has, until now, meant leaving the app: an owner opens the Supabase
dashboard, invites an e-mail by hand, then comes back to the app afterwards to tie that new sign-in
to a member record on the Roles & account-linking screen ([0024](../../prisma/migrations/0024_church_accounts/migration.sql)).
Two systems, two steps, and a window in between where an account exists with no member behind it.

The receiving half is already built. [SetPasswordView.vue](../../src/views/SetPasswordView.vue) is
"the screen an invited user lands on from their e-mail" — it takes their password and moves them on.
Only the **sending** half is missing, and it is missing for a specific reason.

Sending an invite is `supabase.auth.admin.inviteUserByEmail(...)`. The `admin` namespace requires the
**service-role key**, which bypasses RLS entirely. [ADR-0002](0002-no-second-compute-vendor.md) lists
anything "requiring a secret the browser must not see" as blocked until a superseding record exists,
and names transactional e-mail specifically. [ADR-0010](0010-ai-features-need-an-edge-function.md)
reserved the escape hatch — a Supabase Edge Function holding the secret — but built nothing. This is
the first Edge Function to actually deploy.

## Decision

**One Edge Function, `invite-user`, holds the service-role key as a function secret** (`supabase
secrets set`, never `.env`, never committed) and is the only place invitations are sent.

The service-role key grants unlimited authority. The function must add none of its own on top of the
caller's. So authorisation is **not** decided inside the function — it is decided by the database,
under the caller's identity:

1. The browser calls `supabase.functions.invoke('invite-user', { body: { email, member_id, role } })`.
   The caller's JWT rides along in the `Authorization` header.
2. The function builds a PostgREST client **from that forwarded JWT** and calls the SECURITY DEFINER
   RPC `invite_member(email, member, role)`. That RPC runs as the caller — `is_super_admin()`,
   `is_church_leader()`, `get_my_church_id()` all evaluate against the real user, exactly as they do
   for `link_account_to_member`. It enforces every rule (below) and, on success, records the
   invitation in `account_invites`. If it raises, the function returns non-2xx and **sends nothing**.
3. Only after the RPC succeeds does the function switch to a service-role client and call
   `inviteUserByEmail`. The service key is used for the e-mail send and nothing else — never to read
   or write church data, which always goes through the caller's RLS.

**The linking is atomic, and never trusts anything the user controls.** `inviteUserByEmail` creates
the `auth.users` row, which fires `handle_new_user()` ([0006](../../prisma/migrations/0006_baseline_rls/migration.sql)).
That trigger now also reads `account_invites` — a table only `invite_member` can write — and applies
the pre-authorised member and role in the **same transaction** the account is created. There is no
window where a confirmed account exists without its member, and no metadata a self-signup could forge
to hand itself a role. (User-supplied `user_metadata` is forgeable at sign-up; the authority lives in
a server-side table instead. This is the crux of the design.)

**Why the e-mail match is safe.** The trigger finds the invite by e-mail, which alone would be
exploitable: with public self-signup enabled (it is — the "accounts awaiting a link" queue is fed by
self-signups), someone could sign up as an address that has a pending invite and inherit its member
and role by matching on e-mail. So the consume is gated on `new.invited_at IS NOT NULL`. `invited_at`
is stamped by the auth admin invite API and by nothing a client can reach — a self-signup leaves it
null and cannot forge it. Only an account created by `inviteUserByEmail` ever consumes an invite.
That guard, not any Auth dashboard setting, is what backs the "no forgeable path" guarantee.

**The authorisation rules `invite_member` enforces:**

| Caller | May invite | May link to a member | May set a role |
|---|---|---|---|
| Super Admin | anyone | any active member | any role |
| Church Leader | anyone | active member **in their own church only** | **no** — role stays `unassigned` |
| everyone else | — | — | — |

A Super Admin's invitee lands fully provisioned. A Church Leader's invitee is linked but role-less,
and waits for a Super Admin to grant a role — the same split `set_user_role` already enforces (a
Church Leader cannot set roles). Duplicate e-mail, archived member, or a member already linked to
another login are each refused with a clear message and nothing is sent.

**Pending list and resend.** "Pending" means invited but not yet accepted — a fact about
`auth.users` (`invited_at` set, `email_confirmed_at` still null), not about `account_invites`, whose
row is consumed the instant the account is created. `list_pending_invites` reads the auth signal.
Resend is a problem because the built-in mailer has no admin "re-send to an existing account", so
**resend clears the un-accepted account and invites fresh** in one action: `invite_to_resend` returns
the still-pending account (scoped to the caller), the function deletes it — the `auth.users` FK
cascades `user_accounts`, unlinking the member — and then re-invites. It only ever touches an account
nobody has accepted, so nothing is lost. A dedicated e-mail provider later could replace this with a
true resend; until then this is the honest mechanism, and it also serves as the deferred cancel.

## Cost — rule 1

Edge Functions are on the same free plan already in use: ~500K invocations/month, ~2M/month at the
next tier. Invitations are a human, occasional action — a handful a month, not a request path.
Invocation cost is not a plausible route off the free tier. **No new vendor, no card on file.** This
does not by itself move the project's cost posture; it spends headroom that already exists.

## Security — rule 2

- Service-role key lives **only** as a function secret, set out-of-band. It is never in the repo, the
  browser bundle, or `.env` committed anywhere.
- The function is not an authority. Strip the RPC call out and it can do nothing a caller could not
  already do, because every allow/deny decision is the database's, under the caller's JWT.
- `account_invites` carries an e-mail and a pending member/role link. It is readable only through a
  SECURITY DEFINER RPC scoped the same way `list_accounts` / `list_church_accounts` are (Super Admin
  sees all; a Church Leader sees only their own church's pending invites). No new PII surface: the
  e-mail was already the invitee's, and the member link is the same one the linking screen shows.
- Fail closed: if `invite_member` raises for any reason, no invite is sent.

## Consequences

- **Deployment gains a second command.** The site still ships only via GitHub Actions; the function
  ships separately via `supabase functions deploy invite-user`, with `supabase secrets set` run once.
  A first-time setup wizard covers `supabase login`, `link`, `secrets set`, `functions deploy`, and
  the one Auth setting the invite link needs (a redirect URL allowing `/set-password`).
  [OPERATIONS.md](../OPERATIONS.md) gains a line once this is real.
- **`supabase/` is greenfield** — this migration creates `supabase/functions/invite-user/` and a
  minimal `supabase/config.toml`.
- **No new frontend dependency:** `@supabase/supabase-js` already exposes `functions.invoke()`, and
  `netlify.toml`'s CSP already allows `*.supabase.co`.
- **No routing change.** The existing set-password flow already lands every invitee on the dashboard
  (it routes via `/account-pending`, whose guard forwards a linked account on). A Super Admin's
  invitee arrives fully provisioned; a Church Leader's arrives linked but role-less and sees the
  existing scopeless empty-states until a Super Admin grants a role. (Aside: the guard's
  `isAccountLinked` only checks that a `user_accounts` row exists — always true — so it never gates
  anyone to `/account-pending` today. That is a pre-existing quirk, out of scope here, flagged not
  fixed.)

## What would supersede this

An ADR that broadens the service-role Edge Function beyond invitations, or moves invite e-mail off
Supabase's built-in sender onto a dedicated provider (the "proper e-mail for notifications" the owner
has already flagged as later, separate work). Until then, `invite-user` is the *only* function
authorised to hold the service-role key, and only for sending invitations.

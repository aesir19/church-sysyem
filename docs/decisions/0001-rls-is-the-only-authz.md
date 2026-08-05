# ADR-0001 — Postgres RLS is the only authorization boundary

**Status:** Accepted · **Date:** 2026-08-03 (recorded retroactively; in force since `0001_baseline`)

## Context

The app is a static SPA with no server of its own. The Supabase **anon key ships to every
browser** and is trivially readable in devtools. Anyone holding it can issue arbitrary PostgREST
requests against the project — the UI is not a gate and cannot be made into one.

So the question is not *where is it convenient to check permissions*, it is *where is the check
unavoidable*. There is exactly one such place: inside Postgres, on the row.

## Decision

**Every authorization rule is a Postgres RLS policy or a grant. The frontend never enforces
authorization — only presents it.**

Concretely:

- Per-church isolation runs through `get_my_church_id()`, a `SECURITY DEFINER` function
  resolving `auth.uid() → user_accounts → members.member_of`. It must be `SECURITY DEFINER`
  because it reads `members` itself; without that, the policy on `members` recurses into
  `stack depth limit exceeded`.
- Grants are the first gate, policies the second. `0009_narrow_grants` replaced Supabase's
  default `GRANT ALL` with the minimum set derived by enumerating every `supabase.from(...)`
  call. `anon` holds no table privileges at all.
- Finance-role checks exist in the router guard **and** in `is_finance_member()` inside the
  write policies. The former is UX; only the latter is enforcement.

## Consequences

**The good.** The anon key being public is safe. A compromised or patched frontend cannot read
another church's rows. Security review has one surface — `prisma/migrations/` — and
`scripts/sql/capture-security-state.sql` can verify live state against it.

**The cost — three consequences that bite in application code:**

1. **`members SELECT` returns archived rows, and filtering them is the application's job.**
   `archived_at IS NULL` cannot live in that policy: Postgres evaluates the SELECT policy against
   the *new* row during an `UPDATE`, so the condition made archiving impossible — it had never
   once succeeded in production. `0010_members_select_allow_archived` removed it. **Every read of
   `members` must add `.is('archived_at', null)`.** A new read that forgets will show archived
   people in lists and pickers, with no error.

2. **`members` has no DELETE policy at all.** That omission *is* the control making archiving the
   only deletion path. `0007_members_policy_split` created it after `0006` captured a single
   `FOR ALL ... TO public` policy that both permitted hard deletes and — having no `with check` —
   blocked the archive UPDATE it was meant to allow.

3. **Column-scoped grants are load-bearing, not tidiness.** `collections.UPDATE (amount)` is
   column-scoped because a table-wide UPDATE would let a caller set `created_at = now()` and
   extend their own 3-hour edit window indefinitely. `groups` INSERT/UPDATE are column-scoped so
   the app cannot submit `color_slot`. **Adding a field to a form is not enough to make it
   writable — the grant must be extended deliberately.**

**Two more rules follow from this decision:**

- Any new database **view** over an RLS-protected table must declare `security_invoker = on`.
  Views run as their owner by default, which bypasses the base tables' policies entirely.
- Any new object in `public` must `REVOKE ALL FROM anon, authenticated` **before** granting.
  Supabase's default privileges fire on creation, and `GRANT` is additive — granting without
  revoking leaves the defaults in place.

**What would reverse this.** Only a genuine need for privileged server-side action — an admin
operation that must cross church boundaries, or a scheduled job with no user session. Those are
better served by additional `SECURITY DEFINER` RPCs (the pattern already in use for
`get_my_church()`) than by moving authorization into application code. Introducing a service that
holds the `service_role` key would make every policy in `0004`–`0012` decorative; see
[ADR-0002](0002-no-second-compute-vendor.md).

## References

- [SECURITY.md](../SECURITY.md) §3.2, §3.3, §3.11 — the findings that produced `0007`–`0009`
- [DEFECTS.md](../DEFECTS.md) D4 — finance authorization keyed on a mutable display name
- `prisma/migrations/0006_baseline_rls` — the transcription of pre-migration live state

# Security findings — resolved

Findings from [SECURITY.md](../SECURITY.md) that are **closed**. They live here so the main
document stays a list of work still to do, and so a security task doesn't re-read the history of
problems already fixed.

Kept rather than deleted because several record *why* the fix took the shape it did, and one
(§3.11) records a wrong diagnosis that was corrected — the kind of thing that gets re-introduced
when nobody remembers the first attempt failed.

Section numbers match their original SECURITY.md positions and are stable.

| § | Finding | Closed by |
|---|---|---|
| 3.2 | Tenant RLS unverified on `user_accounts`, `groups`, `group_members` | `0004`, confirmed in `0006` |
| 3.3 | `churches` RLS was `using (true)` — leaked every church's name and address | `0009` |
| 3.9 | Placeholder Supabase URL fallback | code — `src/lib/supabase.js` now throws |
| 3.11 | `members` / `collections` policies did not match documented intent | `0007`, `0008`, `0010` |
| 3.12 | Supabase default `GRANT ALL` never revoked on five tables | `0009` |
| 3.21 | Database views bypass RLS by default | `0012`, mitigated at introduction |
| 4.3 | Verbose console output in production | code — removed with §3.9 |

---

## 3.2 Tenant RLS on `user_accounts`, `groups`, `group_members`

**Resolution.** `0004_church_scoped_groups` enables RLS, removes every legacy policy, resets
grants, and installs the complete policy set for `groups` and `group_members`. The `user_accounts`
verification item is closed: the live capture confirms exactly one policy —
`FOR SELECT TO authenticated USING (id = auth.uid())` — with no write policies, so writes are
denied and rows are created only by the `SECURITY DEFINER` `handle_new_user()` trigger. That
policy is source-controlled in `0006_baseline_rls`.

**Threat boundaries established.**

- Ordinary users can never create, rename, tenant-assign, or delete global Ministry definitions
  through PostgREST. Trusted operators manage them manually in Supabase. Users also cannot choose
  or update any group's generated `color_slot`.
- A church A user cannot discover church B small groups, membership rows, member counts, or nested
  member data; direct ID probing returns no row or an RLS error.
- A user cannot attach a church B member to any group, attach an own member to a church B small
  group, or mutate an archived member's memberships.
- A database check constraint independently enforces Ministry/global and Small Group/church
  ownership even for privileged maintenance.

**Why narrow `SECURITY DEFINER` predicates.** `is_member_in_my_church` and
`is_group_available_to_my_church` are `STABLE`, fixed-`search_path` functions. Using them instead
of traversing policy-protected tables directly avoids policy recursion when PostgREST performs
nested `groups` / `members` reads. It also lets the Finance Team guard read only the signed-in
user's own-church membership.

The current policy and grant contract is in `prisma/migrations/0004_church_scoped_groups`, which is
its source of truth. The two-church test matrix moved to [VERIFICATION.md](VERIFICATION.md).

---

## 3.3 `churches` RLS leaked every church's data to every user

**Resolution — `0009_narrow_grants`.** Fixed more decisively than originally proposed.
Enumerating every `supabase.from(...)` call showed the SPA **never queries `churches` directly** —
it reads the table only through the `SECURITY DEFINER` `get_my_church()` RPC. So `0009` revokes
the table grant from `anon` and `authenticated` entirely, making the permissive policy unreachable
rather than merely narrower. The policy is *also* scoped to `id = get_my_church_id()` as defence in
depth should the grant ever be restored.

**Original finding.** The deployed policy was:

```sql
create policy "Authenticated users can view churches"
  on public.churches for select
  to authenticated
  using (true);
```

It existed so a `select('*, churches(name)')` join could resolve. That join was later eliminated
on egress grounds and replaced by the `get_my_church()` RPC, leaving the blanket policy both
unnecessary and a quiet cross-tenant disclosure: any authenticated staff member of any church
could read every church's `id`, `name`, **and `address`**.

---

## 3.9 Placeholder Supabase URL fallback

**Resolution — fixed in code.** `src/lib/supabase.js` now throws when either environment variable
is missing, so a misconfigured build fails closed instead of mounting:

```js
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Supabase Connection Error: Missing environment variables. Contact Administrator.'
  )
}
```

**Original finding.** The client fell back to `https://placeholder.supabase.co` and
`'placeholder-key'` with only a `console.warn`. A build shipped without env vars — a Netlify
variable deleted by mistake, a preview deploy of a fork — would load and quietly issue requests
against a domain the project does not own. Had `placeholder.supabase.co` ever been registered or
DNS-squatted, that would have been a stored phishing surface: a login form posting credentials to
an attacker-controlled host.

**§4.3, verbose console output, closed with the same change** — the `console.warn` it described no
longer exists. The general principle stands and is worth keeping: wrap any future diagnostic
logging in `if (import.meta.env.DEV)`, and do not add a logging helper that swallows errors
silently, because that creates blind spots worse than `console.error`.

---

## 3.11 `members` and `collections` policies did not match their documented intent

**Resolution.** `0007_members_policy_split` replaced the `members` `FOR ALL` policy with
per-command policies and no `DELETE` policy. `0008_funds_write_policies` added the missing
`collections` UPDATE/DELETE policies and the `is_finance_member()` predicate, closing the separate
gap that finance authorization was enforced only in the browser.
`0010_members_select_allow_archived` fixed the archive failure — but **not for the reason this
finding originally gave.**

**How it surfaced.** Baselining the untracked policies into `0006_baseline_rls` required capturing
what was actually deployed. Three captured policies differed from what the architecture notes
described. They are transcribed unchanged in `0006` — that migration is a record, not a fix.

### Finding A — `members` permitted hard DELETE (High)

The deployed policy was a single `FOR ALL` policy, not the four separate policies documented:

```sql
CREATE POLICY "Only same church members can CRUD data"
ON public.members FOR ALL TO public
USING (member_of = public.get_my_church_id() AND archived_at IS NULL);
```

`FOR ALL` covers `DELETE`, and `authenticated` held the `DELETE` grant (§3.12). Any signed-in
staff member could therefore permanently delete an active member record of their own church
through PostgREST. The soft-delete-only guarantee that the retention model and the audit rationale
both rest on **did not exist in the database.**

### Finding B — the archive flow was blocked (High, correctness)

`DashboardView.handleArchive()` failed with `42501`. Production data confirmed it had never
worked: 27 members across three churches, **zero archived rows.**

> **Correction — the first diagnosis was wrong.** This was originally attributed to the missing
> `WITH CHECK` on the `FOR ALL` policy, reasoning that Postgres reuses `USING` as the write check.
> `0007_members_policy_split` was written on that theory and consequently **did not fix it.**
>
> The real cause is the **SELECT** policy. Postgres evaluates it against the **new** row during an
> `UPDATE`; setting `archived_at` makes the updated row invisible under `archived_at IS NULL`, so
> the statement is rejected. Verified empirically inside rolled-back transactions against
> production: holding the UPDATE policy at `WITH CHECK (true)` still failed, while removing
> `archived_at IS NULL` from the SELECT policy alone succeeded. The pre-`0007` `FOR ALL` policy
> carried the same condition in its `USING` clause and failed identically — so this was
> long-standing, not a regression.
>
> Fixed by `0010_members_select_allow_archived`. The condition moved out of the policy and into
> the application, so **archived rows are now readable over PostgREST by staff of the owning
> church** and hiding them is a UI responsibility. Tenant isolation is unaffected. A
> `SECURITY DEFINER` `archive_member()` RPC preserving the invisible-once-archived model was
> considered and not taken.

Findings A and B compounded: before `0007`, the only deletion path that worked was the destructive
one.

### Finding C — `collections` could not be edited or deleted (Medium)

Only `SELECT` and `INSERT` policies existed. With RLS enabled and no `UPDATE` or `DELETE` policy,
both operations were denied for every caller, so the 3-hour edit window in
`CollectionsInputView.vue` was calling operations that could never succeed.

### Two design decisions worth keeping

- **Reads are church-scoped; writes are finance-gated.** `SELECT` policies on `collections` and
  `expenses` are deliberately *not* finance-gated. The funds report is not a finance-only route,
  so gating `SELECT` would break reports for every non-finance user.
- **The 3-hour edit window moved into RLS** and is no longer advisory. This required a
  column-scoped `UPDATE (amount)` grant: with table-wide `UPDATE` a caller could set
  `created_at = now()` and extend their own window indefinitely, making the policy predicate
  useless. See [ADR-0001](../decisions/0001-rls-is-the-only-authz.md).

---

## 3.12 Supabase default `GRANT ALL` never revoked on five tables

**Resolution — `0009_narrow_grants`.** Revokes all privileges on `churches`, `collections`,
`expenses`, `members`, and `user_accounts` from both `anon` and `authenticated`, then re-grants
only what the SPA demonstrably uses — a set derived by enumerating every `supabase.from(...)` call
rather than estimated. `anon` ends with **no table privileges at all**, which is correct: the
pre-auth views use only `supabase.auth.*`, which talks to GoTrue rather than PostgREST.
`service_role` is untouched; it bypasses RLS by design and the frontend never uses it.

`0009` also revokes `anon`'s `EXECUTE` on the helper functions. `0004` had attempted this with
`REVOKE ALL ... FROM PUBLIC`, which does not work — `anon`'s grant comes from Supabase's default
privileges, granted to the role directly rather than via `PUBLIC`.

The resulting grant table lives in `prisma/migrations/0009_narrow_grants`, its source of truth.

**Original finding.** Table privileges are the gate *in front of* RLS. `0004` revoked Supabase's
defaults before re-granting narrowly for `groups` and `group_members`. No such revoke existed for
the other five tables — all still carried the default `GRANT ALL` (`SELECT, INSERT, UPDATE,
DELETE, TRUNCATE, REFERENCES, TRIGGER`) to **both** `anon` and `authenticated`.

`0003_expenses`' `GRANT SELECT, INSERT, UPDATE ... TO authenticated` reads as though it scoped
access, but `GRANT` is additive and `0003` never revoked — so it changed nothing about the
effective privilege set. **That is the trap worth remembering.**

Why it mattered: `TRUNCATE` is **not subject to RLS**. Not reachable through PostgREST, so not
exploitable with the anon key — but it meant a single future misconfiguration, one table with RLS
accidentally disabled, would escalate from "readable" to "erasable".

---

## 3.21 Database views bypass RLS by default

**Mitigated at introduction — `0012_collectives_service_totals`.** The project's first database
view, over its two most sensitive tables. Views are a documented RLS blind spot and the default is
the unsafe one:

> A Postgres view executes with the privileges of its **owner**, not its caller. Row-level
> security on the underlying tables is therefore evaluated as the owner — who typically bypasses
> it — so an ordinary `CREATE VIEW` over an RLS-protected table hands every caller the
> *unfiltered* contents.

Had it shipped with the default, any authenticated user could have read a per-service-date
financial summary of **every church in the database** — the exact leak `0009` closed for
`churches` (§3.3), reintroduced through a different mechanism. Table grants would not have caught
it: `SELECT` on the view is precisely what the report legitimately needs.

**Mitigation.** Declared `WITH (security_invoker = on)`, so base-table RLS is evaluated as the
caller and the existing church-scoping policies apply automatically. No predicate is duplicated
into the view — a hand-written `from_church = get_my_church_id()` would be a second copy of the
isolation rule, free to drift from the policy it mirrors.

**Second trap, hit during implementation: §3.12 applies to views too.** The first version granted
`SELECT` to `authenticated` and stopped. Not enough — Supabase's `DEFAULT PRIVILEGES` fire on
every new object in `public`, so the view was created with `SELECT, INSERT, UPDATE, DELETE,
TRUNCATE, REFERENCES, TRIGGER` already held by `anon` *and* `authenticated`, and `GRANT` is
additive. Confirmed against the live database before correcting:

```
grantee=anon  privilege_type=SELECT      ← should not exist
grantee=anon  privilege_type=INSERT, UPDATE, DELETE, TRUNCATE, ...
```

`security_invoker` contained the blast radius — under invoker semantics the *caller* also needs
privileges on the underlying tables, and `0009` had left `anon` with none, so the read failed
there instead. **The two mitigations covered for each other; neither should be relied on alone.**

**The generalisable rule: `0009`'s revoke-then-grant order is not a table-only pattern.** It
applies to any new object in `public` — views and materialised views equally.

**Verified 2026-08-03 against production**, each read run as `authenticated` under a
`SET LOCAL request.jwt.claims` inside a rolled-back transaction:

| Caller | Result |
|---|---|
| User in **Graceville** (the church holding the data) | 1 row — its own service date |
| User in **Tala** (a different church) | **0 rows** |
| Unknown `sub` uid | 0 rows |
| `anon` | `42501: permission denied for view collectives_service_totals` |

Two real churches, one with data and one without, is the assertion that matters — `reloptions`
alone proves the flag is set, not that filtering works.

> **The standing rule from this finding is live, not history.** Every future view over an
> RLS-protected table must declare `security_invoker = on`. It is in [CLAUDE.md](../../CLAUDE.md)
> and [ADR-0004](../decisions/0004-view-aggregates-but-does-not-allocate.md). Postgres will not
> warn, and the failure is silent.

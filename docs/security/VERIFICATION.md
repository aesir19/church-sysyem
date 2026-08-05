# Security verification

How to prove each control actually works, and the recurring review that keeps the posture from
drifting. Findings themselves are in [SECURITY.md](../SECURITY.md); closed ones are in
[RESOLVED.md](RESOLVED.md).

Two of these checks exist because the failure they catch is **invisible from the UI** — a leaking
view and a missing trigger both look exactly like a working system. Those are marked ⚠.

---

## 1. Monthly review — about 10 minutes

- [ ] **Supabase → Authentication → Settings.** MFA still required, sign-up disabled,
      leaked-password check on, minimum length unchanged.
- [ ] **Supabase → Database → policies.** Every table in `public` shows `RLS Enabled`. Spot-check
      that `members`, `churches`, and `user_accounts` policies still match the migrations.
- [ ] **Supabase → Logs.** Scan for repeated 401/403 spikes — the credential-stuffing signal.
- [ ] **Netlify → Deploy logs.** Latest deploy succeeded; no warnings about missing env vars.
- [ ] **[securityheaders.com](https://securityheaders.com)** grade against production is still ≥ A.
- [ ] **Dependabot PRs** reviewed and merged.
- [ ] **Free-tier budgets** reviewed — egress, bandwidth, DB size. Budgets in
      [OPERATIONS.md](../OPERATIONS.md); response thresholds in [CLAUDE.md](../../CLAUDE.md).
- [ ] **Finance group name unchanged.** `select name from public.groups where name = 'Finance Team'`
      still returns a row per church that needs finance access. Until §3.14 removes the name
      dependency, a rename is a **silent outage**.
- [ ] **`client_errors` reviewed** (once [ADR-0006](../decisions/0006-error-sink-in-stack.md)
      lands). Scan for repeated `csp` rows — injection attempts — and `network` spikes. Confirm the
      row cap is holding.
- [ ] **Backup exists and is recent.** The scheduled `pg_dump` artifact ran; check its age against
      the retention window.
- [ ] **Uptime monitor is green** *and actually alerting* — confirm it detects a paused project,
      not just a served `index.html`.
- [ ] **CI is gating, not advisory.** Netlify still requires the GitHub check to pass.
- [ ] ⚠ **Triggers still present.** `scripts/sql/capture-security-state.sql` reports both
      out-of-schema triggers. Investigate immediately if either is missing after a Supabase
      platform upgrade — without `handle_new_user()` every user signs in to an empty dashboard.
- [ ] ⚠ **Every view is invoker-rights.** Same script, query 9. Any `public` view without
      `security_invoker=on` is a cross-church leak. **Check after any migration that adds a view.**
- [ ] ⚠ **`anon` holds exactly two function grants and no table grant.** Since
      [ADR-0007](../decisions/0007-public-checkin-endpoint.md) the only privileges `anon` has
      anywhere are `EXECUTE` on `checkin_session_status(text)` and `submit_checkin(text,text,text)`.
      **A third entry is a regression** — it means a migration re-granted something Supabase's
      default privileges handed out and nobody revoked.

      ```sql
      SELECT p.proname, array_agg(DISTINCT a.privilege_type) AS privs
      FROM information_schema.role_routine_grants a
      JOIN pg_proc p ON p.oid = (a.specific_name::text)::regprocedure
      WHERE a.grantee = 'anon' GROUP BY 1
      UNION ALL
      SELECT 'TABLE: ' || table_name, array_agg(DISTINCT privilege_type)
      FROM information_schema.role_table_grants WHERE grantee = 'anon' GROUP BY 1;
      ```

      Expect exactly two rows, both functions. Any `TABLE:` row at all is a finding.
- [ ] ⚠ **No service window is stuck open.** A window longer than 24 hours is an unbounded
      unauthenticated write endpoint. The CHECK constraint should make this impossible, so a row
      here means the constraint was dropped:
      `select id, label, opens_at, closes_at from public.services where closes_at - opens_at > interval '24 hours';`
      Expect zero rows. Also scan for windows open right now that shouldn't be:
      `select id, label, closes_at from public.services where now() between opens_at and closes_at;`

## 2. Annually

- [ ] **Secret rotation** per the §3.20 runbook, plus a re-read of who holds a service-role key.
- [ ] **Restore drill.** Restore the `pg_dump` into a throwaway project and confirm the app boots
      against it. Record the date — an untested backup is not a backup.

---

## 3. Per-finding verification

| Finding | How to verify |
|---|---|
| §3.1 Headers | `curl -I https://<site>` → all seven headers present; securityheaders.com grade ≥ A. Separately confirm `connect-src` names the **specific project ref**, not `*.supabase.co`. |
| §3.5 Errors | Force a duplicate insert (constraint violation) → UI shows a generic message; the raw `error.message` appears only under `npm run dev`. |
| §3.6 Auth | Password `password1234` is rejected; sign-in without TOTP fails after MFA enrollment; `signUp()` from the SDK is rejected. |
| §3.7 Member audit | Insert / update / archive a member as user A → `select created_by, updated_by, archived_by from members where id=…` matches `auth.uid()`. |
| §3.8 Dependencies | Dependabot opens a PR on a deliberately out-of-date dep; the CI `npm audit` job runs on PR. |
| §3.10 Retention | The erasure SQL playbook is documented; a hard-delete on a throwaway record removes it from all four tables. |
| §3.13 Triggers | ⚠ Both queries in §3.13 return a row. This is the one where "looks fine" and "is broken" are indistinguishable from the app. |
| §3.14 Finance authz | Rename the finance group in the UI → finance access must be **unaffected**. Under the current build it is revoked, which *is* the defect. Then confirm `user_accounts.role` is either authoritative or dropped. |
| §3.15 Identity state | Sign in as a finance user, sign out, sign in as a **non**-finance user in the same tab **without reloading** → `FundsTabs` must not render Collections/Expenses links. Separately, expire the JWT and confirm a redirect to `/login` rather than a raw `JWT expired` string. |
| §3.16 Ledger audit | Record a collection, edit one in-window, delete another in-window → `collections_history` holds one `UPDATE` row with both old and new amounts and one `DELETE` row, each with the correct `changed_by`. Then confirm `authenticated` cannot `INSERT`, `UPDATE`, or `DELETE` that table directly. |
| §3.17 CSP reports | Temporarily add an inline `<script>` to a built page → a `csp` row appears in the sink. Remove it. |
| §3.18 Throttling | Script >100 `collections` inserts in a minute as one user → the trigger rejects the excess. Confirm a realistic Sunday entry rate stays well under the ceiling. |
| §3.19 Recovery | Restore the latest dump into a throwaway Supabase project, run `bootstrap-triggers.sql`, sign in → the dashboard shows data (proves `handle_new_user()`), and `create table t(...)` lands with `relrowsecurity = true` (proves `rls_auto_enable()`). Record the drill date. |
| §3.20 Release | Push a commit with a deliberately failing test → Netlify must **not** publish. Deploy a schema-dependent build without its migration → CI `prisma:migrate:status` must fail the job. |
| §4.1 URL scheme | Save a `javascript:` value in `facebook_link` → stored as `null`. Re-check whenever that field becomes a clickable link. |
| Error sink ([ADR-0006](../decisions/0006-error-sink-in-stack.md)) | Throw inside a view's `setup()` → a `render` row appears in `client_errors` with a whitelisted code and **no raw message or PII**. Insert >5,000 rows → the cap trigger holds. Confirm `authenticated` has no `SELECT` grant. |

---

## 4. Tenant isolation — the two-church matrix

The core assertion of the whole authorization model. Run it after **any** change to policies,
grants, helper functions, or views. It needs two real churches, one holding data and one not.

| Scenario | Expected |
|---|---|
| Church A and B list groups | Both see all global ministries; each sees only its own small groups. |
| Church A reads a global ministry's memberships / count | Only active church A members are returned and counted. |
| Church A probes a church B group or membership UUID | Zero rows, or an RLS rejection. |
| Ordinary user inserts / updates / deletes a Ministry | RLS rejection. |
| Ordinary user CRUDs their own Small Group | Allowed. Insert returns the generated `color_slot`; changing `color_slot`, `church_id`, or `type` is rejected by column grants. |
| Two transactions insert groups concurrently | Advisory locking serializes slot search — both get different slots, or a full-capacity insert fails clearly. |
| User inserts a duplicate membership | Unique-constraint rejection. |
| Linked Finance Team member runs the nested auth query | Own membership and the global Ministry join resolve; an unassigned user gets no row. |
| Anonymous caller touches either table | Denied — grants revoked, no anonymous policy. |
| Authenticated but **unlinked** caller lists groups | Zero rows, including global ministries. |
| Authenticated user reads `user_accounts` | Exactly their own row. |
| Authenticated user reads `churches` directly | Permission error — the table carries no grant. The dashboard title still renders, because it comes from the `get_my_church()` RPC. |
| ⚠ Church A reads `collectives_service_totals` | **Only** church A dates. Cross-check the count against `select count(distinct "collectedOn") from collections where from_church = <A>` run as superuser. |
| Authenticated user runs `delete from members` via PostgREST | Zero rows affected — there is no DELETE policy. |
| Archive a member | Succeeds, and the row leaves the list. |
| Edit a collection inside / outside the 3-hour window | Succeeds inside; refused outside. |

### 4.1 Attendance and the public check-in endpoint

Added by `0013_attendance_and_checkin`. Run alongside the matrix above — same two churches, one
holding data and one not. ⚠ marks a failure that is **invisible from the UI**: the endpoint keeps
returning a friendly message either way.

The anonymous rows need no JWT at all — call the RPC with the `anon` key, or run
`SET LOCAL ROLE anon;` inside the rolled-back transaction below.

| Scenario | Expected |
|---|---|
| ⚠ Anon calls `submit_checkin` with A's token **during** A's window | `'recorded'`, and the row lands with `church_id = A`, `source = 'self'`, `recorded_by IS NULL`. |
| ⚠ Anon calls `submit_checkin` with A's token **outside** the window | `'closed'`. **Zero rows written *and* no `services` row materialized** — check `select count(*) from services` before and after. |
| Anon submits the same guest name twice in one service | Both return `'recorded'`; exactly one row exists. Idempotence is what stops a flood growing storage. |
| Anon submits a name matching an A member, then one matching nobody, then one matching a **church B** member | All three return `'recorded'`. The B name lands as a **guest** — never with B's `member_id`. |
| Anon submits a name matching **two** A members | `'recorded'`, stored as a guest. Ambiguity must never be guessed between. |
| Response latency across matched / unmatched / duplicate, ≥100 samples | No systematic difference beyond network noise. A measurable gap means an `EXCEPTION` block crept into `submit_checkin`. |
| Anon selects from `attendance`, `services`, or `service_schedules` | `42501` permission denied — no grant, no anon policy. |
| Anon calls `get_my_checkin_link`, `rotate_my_checkin_token`, `close_service_now`, `ensure_my_open_service`, `checkin_open_service`, or `checkin_ensure_service` | Permission denied on every one. Only two functions are reachable. |
| ⚠ Anon calls `checkin_session_status` with a valid-shaped but unknown token | Zero rows — indistinguishable from "nothing open". It must not reveal which tokens exist. |
| Church A staff read `attendance` | Only A rows. A probe of a B `service_id` returns zero rows. |
| ⚠ Church A staff INSERT attendance with `church_id = A` and a **church B** `service_id` | **Foreign-key violation**, not an RLS rejection. The composite FK is what stops this; RLS alone would let it through. |
| Church A staff INSERT attendance for a **church B** `member_id` | RLS rejection via `is_member_in_my_church()`. |
| Church A staff INSERT attendance with `source = 'self'` or `recorded_by = <anything>` | `42501` — both columns are withheld from the INSERT grant. This is what makes provenance unforgeable. |
| Church A staff INSERT a service referencing a **church B** `schedule_id` | Foreign-key violation. |
| Church A staff UPDATE `services.closes_at` directly | `42501` — there is no UPDATE grant. `closes_at` moves only through `close_service_now()`. |
| Two anon callers submit simultaneously as the window opens | Exactly **one** `services` row exists; both return `'recorded'`. Verifies the double-checked advisory lock. |
| ⚠ Materialize today's service, close it early, then call `checkin_session_status` | Zero rows. The materialized row wins — the schedule fallback must **not** re-open it. |
| ⚠ Run `submit_checkin` at 00:30 and at 23:30 Manila time (16:30 / 15:30 UTC the previous day) | The resulting `services.service_date` is the correct **Manila** date both times. An off-by-one day is a D8 regression. |
| Self check-in ceiling reached (500 rows, `source = 'self'`) | Further self check-ins return `'closed'`; **staff recording still succeeds**. Degrades, not denies. |
| Church A calls `get_my_checkin_link()` | A's token only. An unlinked user gets zero rows. |
| Rotate A's token, then submit with the **old** token | `'closed'`. |
| Delete a member who has attendance | Blocked — `members` has no DELETE policy. (The `ON DELETE CASCADE` on `attendance.member_id` only applies to a superuser deletion.) |

**How to run a check as another role.** Wrap it in a rolled-back transaction with the JWT claims
set locally, so production data is never altered:

```sql
BEGIN;
SET LOCAL request.jwt.claims = '{"sub":"<user-uuid>","role":"authenticated"}';
SET LOCAL ROLE authenticated;
-- the query under test
ROLLBACK;
```

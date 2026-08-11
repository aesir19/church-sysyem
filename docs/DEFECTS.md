# Confirmed defects

Everything here is **wrong today**, not merely absent. Each was verified against source,
`prisma/schema.prisma`, or `dist/` build output. IDs are stable — reference them in commits and
PRs. Line references were re-verified 2026-08-05.

- Things that are *missing* → [BACKLOG.md](BACKLOG.md) (`B1`–`B25`)
- Things needed to *operate* the system → [OPERATIONS.md](OPERATIONS.md) (`O1`–`O25`)
- Security framing and verification steps for D4, D5, D6 → [SECURITY.md](SECURITY.md) §3.14–§3.15

| ID | Severity | Where | Defect |
|---|---|---|---|
| D1 | **Critical** | [schema.prisma:517](../prisma/schema.prisma#L517) | `collections.amount` is `Real` (4-byte float) |
| D2 | **High** | migrations | `collections` has no index; `members` has none on `member_of` / `archived_at` |
| D3 | **High** | [schema.prisma:590](../prisma/schema.prisma#L590) | `members.contact_number` is `Decimal` — destroys PH phone numbers |
| ~~D4~~ | ~~**High**~~ | — | **RESOLVED.** `useFinanceMember.js` no longer exists; `useCurrentRole` + `get_my_permissions` (0017) is the single role model |
| ~~D5~~ | ~~Medium~~ | — | **RESOLVED.** The cache in `useCurrentRole` is keyed to the auth user id and cleared on sign-out |
| D6 | Medium | [router/index.js:69](../src/router/index.js#L69) | No session-expiry handling |
| D7 | Medium | [router/index.js:103](../src/router/index.js#L103) | Up to 3 serial round-trips per navigation |
| D8 | Medium | [DashboardView.vue:417](../src/views/DashboardView.vue#L417) | `todayIso` computed in UTC, not local time |
| ~~D9~~ | ~~Medium~~ | — | **RESOLVED.** Every route is `() => import(...)`; 13 lazy imports in `router/index.js` |
| D10 | Medium | [schema.prisma:592](../prisma/schema.prisma#L592) | `members.member_of` defaults to `auth.uid()`; `onDelete: SetNull` on a `NOT NULL` column |
| D11 | Medium | all views | No keyboard access to rows, no `aria-sort`, no modal focus trap |
| D12 | Low | 3 files | **Three** sign-out paths with divergent `localStorage` cleanup (DashboardLayout, DashboardView, AccountPendingView) |
| ~~D13~~ | ~~Low~~ | — | **RESOLVED.** `/:pathMatch(.*)*` renders `NotFoundView` |
| D14 | Low | 3 views | `formatMoney` implemented three times in two currency formats |
| D15 | Low | [schema.prisma:595](../prisma/schema.prisma#L595) | Schema typo `wedding_anniversarry` is load-bearing in 4 files |
| D16 | Medium | 4 of 5 views | No data-access layer — Supabase calls inline in large SFCs. **Partly addressed:** all writes now go through `src/lib/data/write.js`, and members reads/writes through `src/lib/data/members.js`. Attendance, funds and groups still read inline |

---

## D1 — Float money in the collections ledger

`expenses.amount` is `Decimal(12,2)`; `collections.amount` is `Real`. The monthly report sums
hundreds of collection rows and is meant to reconcile against a printed sheet, so drift is
guaranteed to surface as an unexplainable centavo mismatch staff cannot diagnose.

```sql
ALTER TABLE public.collections ALTER COLUMN amount TYPE numeric(12,2);
```

`0012_collectives_service_totals` casts `amount::numeric` before summing, which removes the
*accumulation* error from adding hundreds of float4 values — but it cannot recover precision
already lost at write time, because each row was stored as `real`. The `ALTER` above is the
actual fix and is cheap while the table is small. **Do this before adding ledger history
([OPERATIONS.md](OPERATIONS.md) O5), or the history table faithfully records drifting values.**

## D2 — Unindexed range scans on the hottest queries

`0003_expenses` correctly added `(from_church, spent_on DESC)`. The structurally identical
`collections` query has no index at all, and there are now three such scans: the collections
list, the report's per-month range read, and `collectives_service_totals` grouping the whole
table on every page load. `members` is filtered on `member_of` by every RLS policy and on
`archived_at` by every list query, with neither indexed.

```sql
CREATE INDEX collections_church_collected_on_idx
  ON public.collections (from_church, "collectedOn" DESC);
CREATE INDEX members_church_active_idx
  ON public.members (member_of) WHERE archived_at IS NULL;
```

This is a cost item, not just latency — sequential scans burn the free tier's shared CPU on
every page load.

## D3 — Numeric phone numbers

PH mobile numbers are `09171234567`. A `Decimal` column silently discards the leading zero and
cannot represent `+63`, separators, or a second contact.
[DashboardView.vue:566](../src/views/DashboardView.vue#L566) already compensates with
`String(m.contact_number)`, which restores the digits but not the zero. Convert to `varchar` and
backfill with left-padding where the value is 10 digits.

## D4 — Two role models, neither authoritative

`user_accounts.role` exists with `DEFAULT 'unassigned'` and is **read nowhere in `src/`**. Actual
authorization asks whether the member belongs to a group whose `name` is the literal string
`'Finance Team'` — in the router guard, in `useFinanceMember`, and in the `is_finance_member()`
SQL function. Two consequences:

1. Renaming that group through the Ministries UI silently revokes finance access for every user
   — no error, no audit entry.
2. Group names are unique per church for small groups and globally for ministries (`0004`), so
   the blast radius depends on `type` — worth an explicit decision either way.

Resolve by picking one authority: promote `user_accounts.role` to the source of truth and have
`is_finance_member()` read it, or add `groups.slug` / `groups.is_system` so the policy keys on an
immutable identifier. Whichever loses should be dropped rather than left as a decoy.

## D5 / D6 / D7 — Identity state outlives the session

`isFinance` and `loaded` in [useFinanceMember.js](../src/composables/useFinanceMember.js) are
declared at **module scope**, outside the exported factory. Sign-out followed by sign-in is SPA
navigation with no reload, so the second user inherits the first user's finance flag:
`FundsTabs` renders the Collections/Expenses links and the contributors section appears in the
report. **RLS still blocks the data**, so this is a UI-truth defect rather than a data leak —
but it produces support tickets and erodes trust in the authorization model.

Relatedly, the single `onAuthStateChange` listener handles only `PASSWORD_RECOVERY`. When the
refresh token expires mid-session, staff see a raw `JWT expired` string in an inline error box.

All three are one fix: a **session-scoped identity store** subscribing to `onAuthStateChange`,
cleared on `SIGNED_OUT` and on refresh failure, holding `{ churchId, churchName, linked, isFinance }`.
That store also removes D7's per-navigation round-trips, so the security fix and the cost fix are
the same change. Security framing: [SECURITY.md](SECURITY.md) §3.15.

## D8 — `todayIso` is computed in UTC

[DashboardView.vue:417](../src/views/DashboardView.vue#L417) uses
`new Date().toISOString().slice(0, 10)` to set the `max` on three date inputs. Manila is UTC+8,
so for the first eight hours of every local day the max is *yesterday* — a member whose birthday
or join date is today cannot be entered until mid-afternoon. Use local date parts, not
`toISOString()`.

## D9 — Every view in one chunk — RESOLVED

Every route is now `() => import('../views/Foo.vue')`, and the build emits a per-view chunk. This
matters beyond bundle hygiene: `/checkin` is opened by attendees on their phones, on church wifi,
with a cold cache, every service — shipping them the staff dashboard would have been the single
largest use of the Netlify bandwidth budget.

Kept as a record because the threshold that forced it still applies: lazy-load once routes reach
three.

## D12 — Two sign-out paths, divergent cleanup

[DashboardLayout.vue:44-49](../src/layouts/DashboardLayout.vue#L44) clears both
`udfc.myChurchName` and `udfc.myUserName` before `signOut()`.
[DashboardView.vue:725](../src/views/DashboardView.vue#L725) clears only the church name. Signing
out from the member-list button therefore leaves the previous user's first name cached, and
`DashboardLayout` renders it instantly on the next user's mount
([line 26](../src/layouts/DashboardLayout.vue#L26)) before the real name resolves. Same class of
bug as D5, same fix: one place that owns session teardown.

## D16 / D14 — No data-access layer

Every Supabase call lives inline in a view. The SFCs are 1,773 / 1,353 / 1,153 / 1,133 / 555
lines, and each re-implements the same helpers:

| Helper | Copies | Divergence |
|---|---|---|
| `formatMoney` | 3 | [ChurchFundsView.vue:602](../src/views/ChurchFundsView.vue#L602) renders `₱1,234.00` via `Intl.NumberFormat`; [CollectionsInputView.vue:571](../src/views/CollectionsInputView.vue#L571) and [ExpensesInputView.vue:302](../src/views/ExpensesInputView.vue#L302) render `PHP 1,234.00` by string concatenation |
| `fullName` | 2 | [DashboardView.vue:435](../src/views/DashboardView.vue#L435) includes the middle name; [CollectionsInputView.vue:333](../src/views/CollectionsInputView.vue#L333) does not |
| `formatDate` / `formatDisplayDate` / `formatShortDate` | 4 | three different locale arguments |
| `showToast` | 2 | [DashboardView.vue:367](../src/views/DashboardView.vue#L367) and [MinistrySmallGroupView.vue:362](../src/views/MinistrySmallGroupView.vue#L362), identical |

So the same amount renders in two currency formats depending on which screen you are on, and the
same person renders under two different names. That is the visible symptom; the structural cost
is that no data path can be unit-tested without mounting a view
([OPERATIONS.md](OPERATIONS.md) O24), and every egress rule has to be re-enforced by hand at each
call site.

**Direction.** Extract `src/api/{members,collections,expenses,groups}.js` for data access and
`src/utils/format.js` for presentation. This is a precondition for the O-series testing work, not
a cosmetic refactor — and it is the refactor this project actually needs, as distinct from adding
a server tier ([ADR-0002](decisions/0002-no-second-compute-vendor.md)).

The `0012` report rewrite landed *before* this refactor. It added no new copy of `formatMoney` —
the counts above still hold — and kept its reshaping in pure modules so the pipeline is testable
without a view. But its three Supabase calls are still inline, so it is now the fourth view this
refactor has to unpick. The cost of deferring keeps rising.

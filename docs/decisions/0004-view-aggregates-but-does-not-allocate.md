# ADR-0004 — The SQL view aggregates; only the JS calculator allocates

**Status:** Accepted · **Date:** 2026-08-03 · **Implemented by:** `0012_collectives_service_totals`

## Context

The monthly report needs an **opening balance**: the accumulated net of every service prior to the
month being viewed. Computing that in the browser meant downloading the entire ledger on every
page load, which breaches the egress budget as history grows.

Two things had to be decided at once: where the running balance comes from, and where the
allocation rules live.

## Decision

**A database view supplies aggregates. The allocation model exists only in JavaScript.**

`public.collectives_service_totals` is `collections` and `expenses`, each aggregated to one row
per `(from_church, service_date)` and `FULL OUTER JOIN`ed — so a date carrying only one of the two
still appears. Columns: `from_church, service_date, tithes, offering, expenses`. Roughly 52 rows
per church per year.

**No allocation percentage appears anywhere in SQL.** The 10 / 5 / 5 / 50-50 rules live only in
[collectivesReport.js](../../src/utils/collectivesReport.js).

### Why a view and not a stored balance

A stored `opening_balance` column would need a "close the month" step, and would drift the instant
a correction landed behind the close. A view is re-derived on every read, so correcting a
three-month-old entry immediately re-derives every balance after it. **There is no close step and
nothing is ever frozen.**

### Why the allocation stays out of SQL

Duplicating the rates into the view would create a second source of truth that disagrees only in
the totals, and only sometimes — the worst failure mode available, because it reconciles most
months. Keep it that way when extending the view.

## Consequences

**`security_invoker = on` is load-bearing.** Postgres views run as their *owner* by default, which
would bypass `collections_select_own_church` and `expenses_select_own_church` and expose every
church's per-date ledger summary to every authenticated user. With invoker semantics the base-table
RLS is evaluated as the caller, so the view inherits church scoping and needs no predicate of its
own. Verify:

```sql
SELECT relname, reloptions FROM pg_class WHERE relname = 'collectives_service_totals';
-- reloptions must contain security_invoker=on
```

Grants follow `0009`'s pattern — `REVOKE ALL FROM anon, authenticated` **first**, then
`GRANT SELECT TO authenticated`. The revoke is required, not tidy-up: Supabase's default privileges
fire on every new object in `public`, and `GRANT` is additive.

**The view exposes only per-date sums, never `from`** — it carries no contributor identity.

**It casts `amount::numeric` before summing**, which removes the accumulation error from adding
hundreds of `real` values. It does **not** recover precision already lost at write time — see
[DEFECTS.md](../DEFECTS.md) D1, which is still the actual fix.

**It groups the whole `collections` table on every page load, unindexed** — [DEFECTS.md](../DEFECTS.md) D2.

---

## Corollary: two denominators, and the UI must show only one

This follows directly from "the calculator is the single source of truth", and is the specific
mistake it exists to prevent.

`ALLOCATION_RATES.pastorShare` and `churchShare` are shares of the **remainder**. The other three
are shares of **total funds**:

```
tithesOfTithes  0.10  ── of total funds
project         0.05  ── of total funds
studentProgram  0.05  ── of total funds
pastorShare     0.50  ── of the 0.80 remainder
churchShare     0.50  ── of the 0.80 remainder
```

50 % of the 80 % remainder is **40 % of the collection**. The two families describe the same pesos
on different bases. The allocation panel used to print the raw `50%` beside `10%` and `5%` of
total, which read as half the collection going to each of the last two lines.

`SHARE_OF_TOTAL_FUNDS` restates all five against total funds — 10 + 5 + 5 + 40 + 40 = 100 — and
**the view renders its labels from that constant rather than from literals**, so a rate change
cannot silently desynchronise them again. Anything user-facing uses `SHARE_OF_TOTAL_FUNDS`;
`ALLOCATION_RATES` is for the arithmetic only.

The percentages are **nominal**: a personal draw enlarges the remainder, so realised shares drift
above 40 %. The label describes the rule, not one month's rounding.

## Related

Two report lines are computed but can never be non-zero, because nothing can write to them —
`others` (designated giving) and the per-service personal draw. Both are hidden while zero rather
than shown as a permanent ₱0.00. See [BACKLOG.md](../BACKLOG.md) B25.

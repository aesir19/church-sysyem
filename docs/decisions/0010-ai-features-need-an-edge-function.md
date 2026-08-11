# ADR-0010 — AI features go through a Supabase Edge Function, or not at all

**Status:** Accepted (constraint) — no AI feature is built until a superseding record names a vendor

## Context

The first AI candidate is a narrative layer over the planned Secretariat Statistics Report — *"membership
grew 8% this quarter, driven mainly by two new small groups"* — generated from numbers the report
already computes. A second, undesigned candidate: natural-language search over the member directory.

Both are additive summaries over already-correct data. The AI is never the source of truth for a
number, only a sentence about numbers computed elsewhere.

The stated cost intent is "a free API key, so it incurs no cost." That is necessary and **not
sufficient**, for two reasons that have nothing to do with price.

## Decision

**An AI vendor key must never reach the browser.** [ADR-0002](0002-no-second-compute-vendor.md)
lists third-party API keys under "blocked until this record is superseded," and being free does not
change the reasoning: shipping a key to a static SPA hands every visitor an unmetered way to spend
the owner's quota, defeats any per-key rate limit, and gets the key scraped and revoked.

The sanctioned path is the escape hatch ADR-0002 already names: a **Supabase Edge Function** holding
the key as a function secret, invoked via `supabase.functions.invoke()`, forwarding the caller's JWT
so any church data it touches goes through PostgREST under the caller's own RLS. The function ends
up with no more authority than the person calling it.

**Three constraints bind any such feature:**

1. **Aggregates only, never raw member rows.** A stats summary needs counts and totals, not names,
   birthdates or addresses. `computeMonthlyReport()` in `src/utils/collectivesReport.js` already
   returns exactly the right shape — its `totals` object, **not** its `weeklyReports`, which carry
   `contributions[]`/`expenses[]` and therefore contributor names. Stripping to `totals` is what
   keeps the call PII-free; passing a whole weekly report would not. Priority 2 does not get skipped
   because priority 1 is satisfied for free.

2. **Fail closed to the non-AI baseline.** A free tier is a quota, not a guarantee. On quota
   exhaustion, timeout or vendor error the function returns non-2xx and the report renders its
   computed numbers without the AI section. The summary is decoration, never a dependency.

3. **Verify the free tier at implementation time, not from today's pricing page.** Most "free" LLM
   tiers are trial credits that convert to billed usage. The specific vendor and plan must be
   confirmed to have no expiry and no silent card-on-file conversion. That is what "$0/month
   indefinitely" actually requires.

**Do not build the Edge Function before a superseding ADR exists.** ADR-0002 is binding until then.

## Consequences

- Deployment gains a second command. Edge Functions ship via `supabase functions deploy`, not
  `prisma migrate deploy`; [OPERATIONS.md](../OPERATIONS.md) needs a line for it once this is real.
- No `supabase/` directory exists yet — Edge Functions are greenfield here.
- No new frontend runtime dependency: `@supabase/supabase-js` already exposes `functions.invoke()`.
- The Statistics Report needs its own `src/utils/` aggregator first — same "pure function, no I/O,
  has a test" pattern as `collectivesReport.js` — because membership and attendance aggregation do
  not exist yet. There is currently nothing to send on that side.

## What would supersede this

An ADR that names the vendor and plan (with the free-tier verification actually done, not deferred),
the exact payload per call, the invocation budget, and the fail-closed behaviour. That record also
formally supersedes the "third-party API keys: blocked" line in ADR-0002 — precisely the case
ADR-0002's own "What would supersede this" section anticipates.

## Sketch — request/response shape, for that ADR to adapt rather than final text

Candidate function name: `summarize-statistics`.

```js
const { data, error } = await supabase.functions.invoke('summarize-statistics', {
  body: {
    church_id: activeChurchId.value,
    period: { month: 7, year: 2026 },
    funds: {                                 // computeMonthlyReport(...).totals — figures only
      tithes: 42000, offering: 18500, others: 0, totalFunds: 60500,
      churchAllocation: 19360, totalExpenses: 12100, netChurchFunds: 7260,
      openingBalance: 55000, closingBalance: 62260,
    },
    membership: { activeCount: 214, newThisMonth: 6, archivedThisMonth: 1 },
    attendance: { servicesCount: 9, avgAttendance: 121, trendVsPriorMonth: 0.04 },
  },
})
```

No `contributions[]`, no `expenses[]`, no names, no member or contributor ids — exactly what already
appears as totals on screen, nothing that could re-identify anyone.

Response is a plain string plus provenance — nothing structured for the SPA to parse and trust:

```json
{ "summary": "Giving held steady this month at PHP 60,500, with attendance up 4% across 9 services.",
  "generated_at": "2026-08-14T03:12:00Z",
  "model": "<vendor/model pinned by the superseding ADR>" }
```

Inside the function (Deno): read the caller's JWT from the forwarded `Authorization` header and use
it to build any PostgREST client, so RLS evaluates under the caller's identity and never a service
key; read the vendor key from a Supabase function secret (`supabase secrets set`) — never `.env`,
never committed; call the vendor once with a fixed prompt template and a token cap; on any failure
return non-2xx.

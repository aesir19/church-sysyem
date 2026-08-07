# Backlog — deferred features

Everything here is **absent, not broken**. If asked to add one, treat it as new feature work and
check whether it is already specced below before designing from scratch.

- Things that are *wrong* → [DEFECTS.md](DEFECTS.md) (`D1`–`D16`)
- Things the system needs to be *operable* → [OPERATIONS.md](OPERATIONS.md) (`O1`–`O25`)

IDs are stable and carry over from the old `ARCHITECTURE.md` §9 numbering, so gaps are
intentional — a missing number means that item shipped. Delivered items are not restated here;
`git log` and [decisions/](decisions/) hold that history.

---

## Members

**B1 — No restore UI for archived members.** Archiving is exposed in the dashboard;
un-archiving (`update members set archived_at = null`) is a manual SQL operation. There is also
no admin view for browsing archived rows.

**B2 — No pagination or virtualization.** The whole member list is fetched at once. Fine for a
small congregation; the required response at **300 active members in one church** is `.range()`
pagination before any further list-view feature ([CLAUDE.md](../CLAUDE.md) thresholds).

**B3 — No search on the member list.** `MinistrySmallGroupView` has both a client-side group
filter and a server-side member-name search for its picker
(`buildMemberNameOrFilter()` in [searchFilters.js](../src/utils/searchFilters.js)). The main
member list in `DashboardView` has neither — it sorts but does not search. The helper to reuse
already exists.

**B19 — No bulk import.** The stated premise is replacing paper files and spreadsheets, but the
only way in is the one-at-a-time Add Member modal; onboarding an existing congregation means
manual retyping. A CSV importer with a dry-run preview is the natural companion to B1. This
needs no server — parse in the browser, insert in batches under existing RLS.

**B21 — No household or family grouping.** Families are first-class in church records (one
address, joint giving, children linked to guardians) and are currently unrepresentable. A
household gift can only be recorded against one member or anonymously.

**B22 — Discipleship progress is three booleans.** `is_one_to_one_completed`,
`is_turning_point_completed`, and `is_baptized` carry no completion date, no assignee, and no
history. Progress is a workflow, not a flag; the current shape cannot answer *"who is due for
follow-up?"* — arguably the primary pastoral question the system exists to serve.

**B23 — `has_submitted_membership_form` is written by nothing and read by nothing.** The column
exists in `members` and appears in no view, payload builder, or query. Either it anticipates a
member-facing self-service form that was never built, or it is dead schema. Decide, then either
wire it or drop it.

## Funds and the ledger

**B15 — Report Discrepancy workflow.** Once a `collections` entry passes the 3-hour edit window
it is locked, and there is no way to request a correction. The planned design adds a "Report
Discrepancy" button in the detail modal that creates a request row (candidate table:
`collection_discrepancies`) for an admin or treasurer to approve or reject — an audit trail for
post-lock corrections that does not weaken the time lock.

> Blocked in practice by [OPERATIONS.md](OPERATIONS.md) O5: `collections` records no
> `created_by` at all, so there is nothing for a discrepancy request to reference.

**B17 — Visiting contributors cannot be recorded by name.** Members of one church do give at
another church's service. `collections.from` accepts only a `members.id`, and a visitor is not
in the host church's member list, so the only workaround is to record the gift as anonymous —
which loses the name and misattributes a known, named gift.

> **This is why the `collections` INSERT policy deliberately does not validate the
> contributor's church.** Adding `("from" IS NULL OR public.is_member_in_my_church("from"))`
> looks like obvious hardening — it is the pattern `0004` uses for `group_members` — but it
> would reject exactly this legitimate case. Do not add it without resolving this item first.
> See [ADR-0003](decisions/0003-nullable-collections-from.md).

Design is open. Candidates: a free-text `contributor_name` used only when `from IS NULL`; a
"guest" member record flagged as non-member; or a cross-church contributor reference, which
would need its own RLS reasoning since it deliberately reaches outside the caller's church.

**B18 — No export path.** Reports are `window.print()` only. There is no CSV/XLSX export for the
treasurer and no **per-member annual giving statement** — a routine church requirement members
ask for at year end. Both are buildable client-side on data the report already loads.

**B20 — No attendance or service records.** ~~There is no `services` or `attendance` table.~~
**Largely shipped in `0013_attendance_and_checkin`.** `service_schedules`, `services` and
`attendance` now exist, with a staff roster and a public QR self check-in page — see
[ADR-0007](decisions/0007-public-checkin-endpoint.md).

**What remains open is the second half: attendance is not correlated with giving.** The monthly
report's "weeks" are still inferred from distinct `collectedOn` / `spent_on` values rather than
from the `services` rows that now exist, so the header still counts *service dates* and a midweek
bill with no service behind it still produces its own column. Joining the report to `services`
is a follow-up, and a behaviour-changing one: it would alter which columns appear in a report
people reconcile against paper, so it needs its own decision rather than being folded in.

Follow-up work is also unblocked rather than done: **B22**'s "who is due for follow-up?" now has
a data source, but nothing consumes it yet.

**B25 — The paper report has two lines the schema cannot fill.** Both are hidden while zero
rather than shown as a permanent ₱0.00 (owner decision, 2026-08-03), so the on-screen report no
longer matches the DFC workbook line-for-line:

- **Others / designated giving.** `collections` records a single `is_tithes` boolean, so a gift
  is either tithes or offering. The workbook has an *Others* column with a free-text
  *particular* ("Building Fund"). The calculator still sums an `others` field — nothing can
  write to it.
- **Per-service personal draw.** The workbook deducts a personal draw from the 5 % Student
  Program allocation. No column holds it, so the deduction is always zero and the nested
  allocation line never renders.

`computeWeeklyReport` already records both, so filling them is a schema-and-form change, not a
report change.

## Groups and roles

**B8 — No multi-church admin role.** RLS assumes exactly one church per user. Cross-church
access requires schema and policy changes, not just a UI.

**B24 — No central ministry administrator or request workflow.** Ministry definitions are
maintained by hand in Supabase. A future design may add central-admin authorization plus a
request table for **new ministry definitions only**, carrying requester/church identity,
proposed name, status, reviewer, timestamps, and rejection reason, with case-insensitive
duplicate handling at approval. Rename and delete requests are explicitly excluded, and no broad
admin UI, leader model, soft delete, or audit system is in scope.

## Frontend structure

**B5 — No global state store.** State lives in component `ref`s. If several views need shared
data, introduce Pinia rather than prop-drilling — but note that the session-scoped identity
store proposed for [DEFECTS.md](DEFECTS.md) D5/D6/D7 is the first real candidate and may make a
full store unnecessary.

**B7 — No TypeScript.** Adding it means migrating `.vue`/`.js` files and updating
`vite.config.js`. Weigh [OPERATIONS.md](OPERATIONS.md) O23 (ESLint) and O24 (a jsdom test
environment) first — they are cheaper and catch overlapping classes of bug.

**B10 — `App.vue` holds no global layout.** It is a bare `<router-view />`. `DashboardLayout`
covers the authenticated shell, but anything genuinely app-wide — a toast container, an offline
banner ([OPERATIONS.md](OPERATIONS.md) O8), a global error boundary (O2) — belongs in `App.vue`,
not duplicated into individual views.

**B27 — No vetted runtime-dependency candidates for common utility gaps.** Three keep coming up
in discussion and are worth naming so they aren't re-litigated from scratch, though none is
justified yet per [CLAUDE.md](../CLAUDE.md)'s "never add a runtime dependency without a stated
reason and a free-tier impact note" rule:

- **VueUse** — tree-shakeable composables (debounce, storage sync, etc.); only imported functions
  ship, typically a few KB.
- **Zod or Valibot** — schema validation at input/RPC boundaries, matching this codebase's
  existing validate-at-the-boundary convention. Valibot is the lighter option (~1-3 KB gzip vs
  Zod's ~10-13 KB).
- **date-fns** — general date formatting/math. Could double as the fix vehicle for
  [DEFECTS.md](DEFECTS.md) D14's three-different-date-format duplication if adopted with that
  intent specifically, rather than ad hoc.

**Error monitoring (Sentry) is a related but already-resolved question — see
[ADR-0006](decisions/0006-error-sink-in-stack.md).** That record rejected a third-party processor
in favor of an in-stack `client_errors` table, for reasons (bundle size, CSP `connect-src`
weakening, member PII inside error payloads) that still hold. Its final line leaves "whether to
*additionally* adopt Sentry" explicitly open — if ever revisited, it needs a PII-scrubbing plan
before error payloads (which can carry names/birthdates/addresses lifted from constraint-violation
text) leave the stack.

## AI integration

**B26 — AI-assisted Statistics Report (Secretariat), and other bounded AI features.** No AI
integration exists today. The first candidate is a narrative layer over the planned Secretariat
Statistics Report — e.g. "membership grew 8% this quarter, driven mainly by two new small
groups" — generated from numbers the report already computes, not from a live query the AI runs
itself. A second candidate raised but not designed: natural-language search over the member
directory. Both are additive summaries on top of existing, already-correct data — the AI is
never the source of truth for a number, only a sentence about numbers computed elsewhere.

**The stated cost intent — a free API key, so it incurs no cost — is necessary but not
sufficient.** Two failure modes to design against, not assume away:

1. Most "free" LLM API tiers are trial credits that convert to billed usage, not free
   indefinitely. The specific vendor/plan must be verified to have no expiry and no
   silent card-on-file conversion **at implementation time** — that is what "$0/month
   indefinitely" ([CLAUDE.md](../CLAUDE.md) priority 1) actually requires, not what today's
   pricing page happens to say.
2. A free tier is still a quota, not a guarantee. The feature must fail closed to its non-AI
   baseline when the quota is exhausted or the call errors — the Statistics Report renders its
   computed numbers either way; the AI summary is decoration, never a dependency the report needs
   to function.

**This is currently blocked by [ADR-0002](decisions/0002-no-second-compute-vendor.md), on
purpose.** That record lists third-party API keys explicitly under "blocked until this record is
superseded," for the reason that applies here regardless of price: **a key is a secret the
browser must never hold, free or not.** Shipping it to the frontend hands every visitor of the
deployed site an unmetered way to spend the owner's quota, defeats whatever per-key rate limit
the vendor sets, and risks the key being scraped and revoked. Being free changes the cost of that
key leaking; it does not change whether the key must stay server-side.

The fix is the escape hatch ADR-0002 already names: a **Supabase Edge Function** holds the AI
vendor's key as a function secret, is invoked from the SPA the same way `supabase.functions.invoke()`
would be used anywhere else in this codebase, and forwards the caller's JWT so any church data it
touches goes through PostgREST under the caller's own RLS — the function ends up with no more
authority than the person calling it. Concretely:

- The Edge Function receives already-aggregated figures, or fetches them itself RLS-scoped to the
  caller — **never raw member rows.** A stats summary needs counts and totals, not names,
  birthdates, or addresses; sending PII to a third-party API is a data-exposure question priority
  2 doesn't get to skip just because priority 1 is satisfied for free.
- The function returns text; the SPA renders it inline in the report. No new frontend runtime
  dependency — `@supabase/supabase-js` already exposes `functions.invoke()`.
- Errors and quota-exhaustion are caught the existing way (surfaced as `error.message`, per
  [CLAUDE.md](../CLAUDE.md) conventions) and the report keeps rendering without its AI section.

**Before implementation, this needs its own ADR (next number: ADR-0008),** because it formally
supersedes the "third-party API keys: blocked" line in ADR-0002 — precisely the case that
record's own "What would supersede this" section anticipates. That ADR should pin: the chosen
vendor and plan (with the free-tier verification above actually done, not deferred), the exact
data sent per call, the invocation budget, and the fail-closed behavior. Do not build the Edge
Function before the ADR exists — ADR-0002 is binding until a superseding record is written.

### Sketch: request/response shape (for ADR-0008 to adapt, not final text)

No `supabase/` directory exists in this repo yet — Edge Functions are greenfield here. A
candidate name: `summarize-statistics`.

**SPA → function.** The SPA never assembles this from raw member rows; it passes only numbers a
report has already computed. On the funds side, `computeMonthlyReport()`
([collectivesReport.js](../src/utils/collectivesReport.js)) already returns exactly this shape —
its `totals` object, **not** its `weeklyReports`, which carry `contributions[]`/`expenses[]`, and
those carry contributor names via `contributorLabel()`. Stripping to `totals` is what keeps this
call PII-free; passing a whole weekly report would not.

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

No `contributions[]`, no `expenses[]`, no names, no member or contributor ids — the function
receives exactly what already appears as totals on screen, nothing that could re-identify anyone.
(Membership and attendance aggregation don't exist yet — the Statistics Report itself needs its
own `src/utils/` aggregator, same "pure function, no I/O, has a test" pattern as
`collectivesReport.js`, before there's anything to send on that side.)

**Function → SPA.**

```json
{ "summary": "Giving held steady this month at ₱60,500, with attendance up 4% across 9 services. Membership grew by 5 net.",
  "generated_at": "2026-08-14T03:12:00Z",
  "model": "<vendor/model pinned by the ADR>" }
```

A plain string plus provenance — nothing structured for the SPA to parse and trust. The numbers
on screen stay the ones `computeMonthlyReport()` produced; the AI sentence sits alongside them,
never recomputes or overrides them.

**Inside the function (Deno runtime):**

1. Reads the caller's JWT from the `Authorization` header — forwarded automatically by
   `functions.invoke()` — and, if the function ever fetches data itself rather than trusting the
   request body, uses it to build its PostgREST client so RLS still evaluates under the caller's
   own identity, never a service key.
2. Reads the AI vendor key from a Supabase **function secret** (`supabase secrets set`) — never in
   `.env`, never shipped to the browser, never committed to this repo.
3. Calls the AI vendor once, with a fixed prompt template and a token cap — the invocation budget
   ADR-0008 has to name a number for.
4. On any failure — quota exhausted, timeout, vendor error — returns a non-2xx. The SPA catches it
   the existing way (`error.message`, no throw) and renders the report **without** the AI section,
   same pattern as every other Supabase failure in this app.

**Deployment is a separate command, deliberately not folded into the Prisma flow:** Edge Functions
ship via `supabase functions deploy`, not `prisma migrate deploy`. [OPERATIONS.md](OPERATIONS.md)'s
deploy procedure needs a line added for this once it's real.

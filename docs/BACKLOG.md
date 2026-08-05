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

**B20 — No attendance or service records.** There is no `services` or `attendance` table. The
monthly report's "weeks" are inferred from distinct `collectedOn` / `spent_on` values rather
than from a service that exists in its own right — which is why the header counts *service
dates*, and why a midweek bill with no service behind it still produces its own column.
Attendance cannot be correlated with giving or used for follow-up.

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

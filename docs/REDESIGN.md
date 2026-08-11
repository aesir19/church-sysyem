# Frontend redesign — phased plan

Presentation-layer only. No router, Prisma, or RLS changes appear anywhere in this plan.

Grounded in direct inspection of every file it names — all 11 views, all 4 shared components,
the layout/shell, router, `style.css`, `netlify.toml`, [CLAUDE.md](../CLAUDE.md), and the
relevant `docs/` sections. Claims were verified against the code; where the evidence disagreed
with the original brief, the correction is flagged inline.

---

## Status

| | |
|---|---|
| Branch | `redesign` |
| Phase | **Phase 0 built (2026-08-11).** §0.1–§0.5 landed; §0.6 was already done. **Phase 1 is gated on the §0.5 step-3 sign-off**, which is a human call on the style-guide route — see below. |
| Mockups | Leaving the repo — see [Amendment 16](#amendment-16--the-mockups-leave-the-repo) |
| Scope | Existing features only. [Amendment 9](#amendment-9--scope-is-the-existing-feature-set-not-the-mockups-feature-set) is the boundary. |

### What Phase 0 landed, and what it deliberately did not

Built: `src/styles/tokens.css` (two layers, dark theme, the global reduced-motion block),
`src/components/ui/` (Button, Card, Input, Badge, Spinner, Modal, Toast, ToastHost,
TableSortHeader, the local icon set), `AppLogo.vue` and a real favicon, the
`theme`/`toast`/`sortState` utils and composables, and the dev-only style-guide route at
**`/dev/style-guide`** — which is where the sign-off happens.

**Not done, on purpose, because they belong to later phases:** no view was migrated; `<ToastHost />`
is *not* yet mounted in `App.vue` (Phase 1b owns that, and mounting it early would add entry-chunk
bytes for nothing); the sidebar still injects its icons with `v-html` (Stage 1b); the Lighthouse
accessibility threshold is still 0.85 (Amendment 6 raises it at the *end* of Phase 1 — measured
headroom exists already: login 0.91, checkin 1.0, 404 1.0).

Two decisions were made during the build that amend records above, both written up where they
belong rather than only here:

- **Reka UI is scoped to `Dialog` alone; its Toast was declined.** `ToastHost` mounts in `App.vue`,
  which is the shared entry chunk — the library would have shipped to every `/checkin` visitor
  rather than to a lazy dashboard chunk. Recorded in
  [ADR-0011](decisions/0011-headless-primitives-for-accessibility.md).
- **The bundle gate holds — `CheckinView-*.js` is byte-identical at 6,675 B — but the dependency is
  not yet paid for.** Nothing in a production route imports `Modal.vue` yet, so `reka-ui` is absent
  from the production build entirely. Its real weight lands in Phase 1b and must be diffed then.
  Full measurement table in ADR-0011.

### Open decisions blocking Phase 0 — both now settled

Both changed what goes into `src/styles/tokens.css`, so both had to be settled before that file
was written. Deciding either one *after* the views were migrated would have meant reopening all
eleven.

1. ~~**Dark mode — in or out?**~~ **In.** [Amendment 7](#amendment-7--dark-mode-resolved-in).
2. ~~**Typography — self-hosted Manrope or the system stack?**~~ **Self-hosted Manrope.**
   [Amendment 8](#amendment-8--typography-resolved-self-hosted-manrope).

---

## Mockups

`UI mockups for form/` holds one design turn with one option — **"1c — Modern"**: a 1320×860
dashboard frame with a working left nav (Overview, Members, Groups, Attendance, Collections,
Expenses, Funds, Statistics, roadmap), the sign-in and account states, the public check-in on a
phone, and the dashboard on mobile. Manrope 400–800, cyan `#0088b0` with magenta as a rarer
second accent, soft surfaces, entry animation on cards, and a full dark theme behind a sun/moon
toggle in the sidebar footer.

The folder also contains `_ds/broadsheet-…/` — a **second, unused design system** ("Broadsheet":
newsprint serif, no boxes or dividers, CMYK print treatments). It is linked from the mockup's
`<head>` but the mockup does not consume it; the file's own footer offers *"restyle this in
Broadsheet"* as an unexplored alternative. **The Modern direction is the one being built.**
Broadsheet is recorded here only so nobody mistakes it for the target later.

A later handoff turn added `design_handoff_church_dashboard/` — the same design direction split
across three files (screens, dialogs/alerts/states, detail views) plus a `README.md` stating the
tokens, motion vocabulary and per-screen intent explicitly. **That README is the specification
this redesign builds from**, and it is more precise than this section: it names every colour,
type step, radius, shadow recipe and easing curve.

Housekeeping: **the folder was never fully untracked** — the original `.dc.html`, `support.js`,
`_ds/`, a `.pptx` and the duplicate `UI mockups for form.zip` are all committed; only the newer
`design_handoff_church_dashboard/` was untracked. Resolved by
[Amendment 16](#amendment-16--the-mockups-leave-the-repo).

### The mockup and this plan disagree

They were produced independently. Three conflicts, resolved by the amendments below, plus a
scope difference resolved by [Amendment 4](#amendment-4--new-screens-move-to-their-own-track).

| | This plan said | The mockup shows | Resolution |
|---|---|---|---|
| Dark mode | Explicitly out of scope | Full dark theme, 28 tokens, a toggle | **[A7](#amendment-7--dark-mode-resolved-in) — in** |
| Typography | System stack *or* self-hosted, undecided | Manrope via Google Fonts (**CSP-blocked**) | **[A8](#amendment-8--typography-resolved-self-hosted-manrope) — self-hosted** |
| Brand colour | `#1a56db` (per CLAUDE.md) | Cyan `#0088b0` + magenta | [A3](#amendment-3--brand-colour) — **confirmed**, absorbed by §0.5 as-is |
| Scope | 11 existing views, restyle only | A whole target application | [A9](#amendment-9--scope-is-the-existing-feature-set-not-the-mockups-feature-set) — existing features only |
| Roles | Seven capability predicates, RLS-backed | Three roles, "Pastor does everything" | [A10](#amendment-10--the-capability-model-wins-over-the-mockups-role-copy) — the code wins |
| Public check-in | Six states, no match feedback (ADR-0007) | A "found — is this you?" state | [A11](#amendment-11--the-public-check-in-has-no-found-state) — not built, ever |

---

## Amendments

### Amendment 1 — dark mode

**Open decision. Must be settled before `tokens.css` is written.**

A design token is a name for a value, declared once (`--color-bg-page`) and referenced everywhere
(`var(--color-bg-page)`). Dark mode is simply a *second set of values for the same names*:

```css
:root                    { --color-bg-page: #ffffff; --color-text-primary: #1e293b; }
:root[data-theme="dark"] { --color-bg-page: #0b1117; --color-text-primary: #e8eef4; }
```

Every view keeps saying `var(--color-bg-page)` and repaints when the attribute flips — because no
view was ever told the literal colour.

That is exactly why the timing is load-bearing. A view that still says `background: #ffffff`
cannot go dark; white is welded in. Adding the second value set during Phase 0 costs one extra
block in one file, and each view is then migrated **once**. Retrofitting after eleven views have
already been migrated means reopening every one to hunt down surviving literals — the redesign,
twice.

The mockup already contains the dark values (the `.om-dark` block, 28 tokens). If the answer is
yes, that block is the source material; the work is mostly transcription into the semantic layer.

If dark mode is adopted, note two follow-ons: the `:root[data-theme="dark"]` values must also be
supplied for the shadow ramp (shadows tuned for a light ground read as smudges on a dark one),
and a `prefers-color-scheme` default plus a persisted user choice need a home — `localStorage`
key `udfc.theme`, which must be added to `sessionCleanup.js`'s **do-not-clear** list alongside
`udfc.checkin.recorded`, since a theme preference should outlive a sign-out.

### Amendment 2 — typography

**Open decision. Must be settled before `tokens.css` is written.**

The mockup loads Manrope 400–800 with `<link rel="stylesheet" href="https://fonts.googleapis.com/…">`.
Our CSP in [netlify.toml](../netlify.toml) is `font-src 'self' data:` with no external origin
allowlisted anywhere, so **that link is blocked outright — the mockup as drawn cannot ship.** Two
compliant paths:

1. **Self-hosted Manrope** — `@fontsource-variable/manrope`, an npm package shipping only `.woff2`
   files and a small CSS file, no runtime JS. Served from `/assets/` under the existing
   long-cache-immutable rule, so it is one download per new visitor and nothing thereafter.
   Same-origin, so **zero CSP changes**. One variable file replaces the mockup's five static
   weights.
2. **System font stack** — `$0`, no CSP interaction, no asset weight. Formalised as `--font-sans`.

Worth knowing before choosing: Manrope at weight 800 carries most of the mockup's visual
character. The system stack is a legitimate choice, but the result will not look like the design
that was approved.

Whichever wins, the check in §0.2's bundle gate applies — a font file is bytes on the critical
path for `CheckinView` too, which is the one chunk that must not grow.

### Amendment 3 — brand colour

No process change; recording the shift so it is not mistaken for drift. [CLAUDE.md](../CLAUDE.md)
documents primary `#1a56db`; the mockup uses cyan `#0088b0` with magenta as a rarer second accent.
This is a rebrand, not a reskin.

§0.5 already handles it correctly and needs no amendment: build the component system on the
current blue as a neutral placeholder, prove the mechanics, **then** repoint the palette in
`tokens.css` alone. A rejected palette costs a token edit, not a re-review of eleven views.

CLAUDE.md's "Code conventions" palette line must be updated at the point the rebrand lands —
not before, so the file never describes a state that isn't shipped.

**Reality check on the size of this job:** the codebase currently holds **667 hardcoded colour
literals across 15 files, 60 unique colours** — against the six that CLAUDE.md documents.
`src/style.css` is 11 lines; every other rule lives in an SFC `<style scoped>` block. "Migrate a
view" therefore means reconciling ~20–24 unique hexes down to semantic tokens and judging which
near-duplicates collapse. This is the redesign's real cost centre and the per-stage estimates
below should be read with it in mind.

### Amendment 4 — new screens move to their own track

**Agreed and settled.** The mockup contains four things that are not restyling work:

| In the mockup | Status today |
|---|---|
| **Overview / home** — "Good morning, Grace", attendance sparkline, "Needs attention" | No such route. `/dashboard` redirects to `/dashboard/members`. |
| **Statistics Report** | Unbuilt, and needs its own `src/utils/` aggregator. **Correction:** this cited `BACKLOG.md` **B26**, which is *AI integration* — now [ADR-0010](decisions/0010-ai-features-need-an-edge-function.md). The Statistics screen had **no backlog entry and no issue at all** until it was specced as [#56](https://github.com/aesir19/church-sysyem/issues/56). Its AI-narrative layer is blocked behind ADR-0010, which is written. |
| **"What's to come" roadmap** + *Submit a request* form | Entirely new, and a **write path** — needs a table, RLS policies, and a security review. Not presentation-layer work under any reading. |
| **Mobile** — sidebar → bottom bar, tables → cards | A per-view layout change, not a restyle. Never scoped in this plan. |

These are **out of scope for this plan** and belong on a separate track, sequenced after the
restyle lands. The reasoning: they carry data requirements, new routes, and — for the request form
— a schema change and RLS policies, which is a different kind of risk from repainting an existing
view. Folding them in would also make "done" undefinable, since the plan's exit criterion is
"eleven views migrated" and the mockup's is "nine nav items work."

Mobile is the judgement call in that list. It is genuinely closer to the restyle than the other
three, and doing it later means touching each view twice. It is still split out because the
mockup specifies real layout restructuring (a bottom nav component that does not exist; tables
becoming cards) rather than responsive polish. **Revisit this once Stage 2 is done** — if
DashboardView's migration turns out to make its card-mode cheap, pulling mobile forward is a
reasonable in-flight correction.

### Amendment 5 — ADR number correction

The plan below reserves **0008** for the headless-primitives record. That number was taken since
by [0008-sentry-alongside-in-stack-sink.md](decisions/0008-sentry-alongside-in-stack-sink.md).
It becomes **`docs/decisions/0009-headless-primitives-for-accessibility.md`**.

### Amendment 6 — wire the accessibility work to the gate

The plan lands real accessibility fixes (D11) but never connects them to
[lighthouserc.json](../lighthouserc.json), which was added after the plan was written and is a
hard-fail gate. Accessibility currently sits at **0.85**.

Raise it to **0.9** at the end of Phase 1, once the auth family and shell have been migrated and
the score is known to clear it. Without that, the D11 work is unenforced and regresses silently on
the next view.

Two related notes now that the gate exists:

- The mockup's layered shadows, gradients, and per-card entry animations are the kind of thing
  that moves a performance score against a gate that hard-fails. Get a baseline Lighthouse run in
  during Phase 1, not at Stage 3.
- The global `prefers-reduced-motion` block landing in Phase 0 (§0.1) helps here as well as being
  the right thing to do — the mockup animates a great deal more than the current app does.

---

> **Amendments 7–16 all date from the design review of 2026-08-11**, which worked through the
> `design_handoff_church_dashboard/` bundle against the shipped code. They settle every decision
> that was open, and reverse four earlier recommendations in this file. Where an amendment
> reverses something, the superseded text is left in place with a pointer — the reasoning that was
> right at the time is still worth reading.

### Amendment 7 — dark mode: RESOLVED, in

**Settled 2026-08-11.** Dark mode is **in**, from Phase 0, attached at the *semantic* token layer
exactly as [Amendment 1](#amendment-1--dark-mode) describes. The handoff README supplies the full
dark palette, so this is mostly transcription rather than design.

The follow-ons Amendment 1 names are all binding: a dark shadow ramp (shadows tuned for a light
ground read as smudges on a dark one), a `prefers-color-scheme` default, a persisted user choice
under `localStorage` key `udfc.theme`, and **that key joins the do-not-clear list on sign-out**
alongside `udfc.checkin.recorded` — a theme preference should outlive a session.

One rule carried over verbatim from the handoff, because it records a bug they already fixed:
**the selected member row is `#f4fcff` light / `#0e2b38` dark.** A light tint on a dark surface is
what broke it the first time. Do not reintroduce it.

### Amendment 8 — typography: RESOLVED, self-hosted Manrope

**Settled 2026-08-11.** Option 1 of [Amendment 2](#amendment-2--typography):
**`@fontsource-variable/manrope`**, served same-origin from `/assets/` under the existing
immutable long-cache rule. **Zero CSP change** — which is the point. Editing
`font-src` to allowlist a font CDN was considered and rejected: loosening a security header
permanently to avoid an npm install is the wrong trade.

The system stack was the other live option and would have cost nothing, but Manrope at weight 800
carries most of the design's character; shipping the system stack means shipping something that
is not the design that was approved.

**The measurement in §0.2 applies to the font too:** a font file is bytes on `CheckinView`'s
critical path, and `dist/assets/CheckinView-*.js` (6,675 B at the time of writing) is the one
artifact that must not grow. Check it after the font lands, not at the end.

### Amendment 9 — scope is the existing feature set, not the mockup's feature set

**This is the boundary for the whole project.** The handoff bundle describes a *target
application* — roughly 40 surfaces. This redesign applies its visual and interaction language to
**the features that exist today**, and nothing else. Every feature the mockups add is deferred to
a spec, untouched by this work.

| In — restyled | Out — deferred to spec |
|---|---|
| Screens 2–7: Members, Groups, Attendance, Collections, Expenses, Funds | Screens 1, 8, 9: Overview, Statistics, What's next |
| Auth family (sign in, set password, account pending, 404) | All nine detail views (file 3) |
| Public check-in — see [A11](#amendment-11--the-public-check-in-has-no-found-state) | All five admin pages (users & roles, churches, profile, settings, audit log) |
| Modals 01–09, 12, 13, 15 | Modals 10 (close the month), 11 (invite user), 14 (export) |
| Toasts, and the empty / error / skeleton / no-access state vocabulary | Bulk selection bar, notification panel, offline banner + sync queue |
| Dark mode; responsive layouts for every view | The mobile bottom tab bar — see [A12](#amendment-12--mobile-lands-now-the-tab-bar-does-not) |
| | The Expenses **category** chart — there is no `category` column on `expenses` |

This supersedes [Amendment 4](#amendment-4--new-screens-move-to-their-own-track), which drew the
same line around a smaller set. A4's reasoning stands and is worth reading; its list is simply
incomplete now that the full bundle is in hand.

**The governing rule for anything in between:** when the mockup renders a datum the schema does
not carry, **omit the element**. The layout closes up and nothing is promised. The mockup's own
em-dash placeholder (`#b9c0cc`) is for a *row* that legitimately has no value — an expense with no
note — never for a feature that was not built; using it there ships blanks that look permanent.
The single exception is a datum that is one cheap addition to a query already being made, and
even then **"one round-trip per intent" is binding**: the header's "39 archived" costs a second
count query against `members` and is therefore out, while the active count rides along free on
the paginated request (see [A13](#amendment-13--members-stops-being-a-restyle)).

Two consequences worth stating plainly:

- **No chart library is being added.** There are zero charts in the app today — no `<canvas>`, no
  chart code — and after dropping the Expenses category chart the only chart-shaped element left
  in scope is the Funds five-segment allocation bar, which is a CSS bar over numbers
  [collectivesReport.js](../src/utils/collectivesReport.js) already computes.
- **Icons stay local.** Consolidate the drifted hand-drawn glyphs into `src/components/ui/icons/`
  as §0.3 already proposes. `lucide-vue-next` was considered and rejected: unlike Reka UI, which
  buys a tested focus trap, an icon package buys convenience, and priority 1 is binding. While the
  shell is open, `AppSidebar`'s `v-html` icon injection becomes a real inline `<svg>` render from
  a **static module constant** — that removes a latent sink SECURITY.md already flags, for free.

### Amendment 10 — the capability model wins over the mockup's role copy

The handoff README describes three roles — Pastor / Finance / Secretariat — and says *"Pastor
(everything + approvals + closing the month)"*. **That is not this application's authorization
model**, and rendering it literally would ship a UI promising access RLS will refuse.

The real model is seven predicates in [capabilities.js](../src/utils/capabilities.js), mirroring
the SQL composites in `0014`–`0017`. Two of them are deliberately counter-intuitive and are the
ones the mockup gets wrong:

- **Pastor is see-only.** `canWriteMembers` is Secretariat + SuperAdmin. A Pastor sees member
  detail and cannot edit it.
- **Head Pastor deliberately cannot see member PII.** It reads the Directory, never the Member
  record — `can_see_member_detail()` excludes it on purpose.

**Every role-gated surface in the mockup is re-derived from `deriveCapabilities()`**, and the
mockup's role names are treated as placeholder copy. This follows ADR-0001: capabilities are
presentation, RLS is enforcement. A screen offering an action the policy will filter produces
exactly the `{ error: null, data: [] }` false success that
[write.js](../src/lib/data/write.js) exists to catch.

**Related, and settled the same way:** the mockup's member profile carries a role-gated **Giving**
card. It is not built — not gated, not locked, not empty. Per-member giving does not appear in a
member context at all, on privacy grounds. This does **not** touch the *Contributors* table on
the Funds screen, which is a finance surface, already `canWriteFinance`-gated, and stays as it is.
"Do not show giving on a person's profile" and "finance staff may see who gave" are different
rules and both hold. Recorded in [CONTEXT.md](../CONTEXT.md) under **Contribution**.

### Amendment 11 — the public check-in has no "found" state

The mockup draws the public check-in in four states: idle, **searching**, **found**, confirmed.
**The "found" state must never be built.** It is the directory oracle that
[ADR-0007](decisions/0007-public-checkin-endpoint.md) and
[CheckinView.vue](../src/views/CheckinView.vue)'s three opening rules exist to deny: a screen that
confirms "found — is this you, *«name»*?" lets anyone who photographs the poster test names
against the church roll.

The real states are `loading / bad-link / closed / open / already / done`, and `already` is read
from **this device's own localStorage**, never from the server. All six get restyled in the
mockup's visual language and none of them gain match feedback.

A **pending indicator** while the submit is in flight is fine and is the honest half of
"searching" — it reveals nothing. A *found* state is not, at any fidelity.

Re-run [VERIFICATION.md](security/VERIFICATION.md) §4.1's response-uniformity and
already-checked-in rows after this view is touched, exactly as
[Security-load-bearing behaviour](#security-load-bearing-behaviour--anchored-to-the-exact-touch-point)
already requires. This amendment exists so that a future contributor comparing the app to the
mockup reads "unfinished" as "deliberate".

### Amendment 12 — mobile lands now; the tab bar does not

Reverses the mobile half of [Amendment 4](#amendment-4--new-screens-move-to-their-own-track).
Since this redesign covers the existing feature set, the mobile treatment **of those same views**
lands with them rather than being visited twice: tables become cards, 44px minimum targets, 14px
minimum body text, and the sidebar collapses to a drawer.

**The bottom tab bar is not built.** The mockup's is five tabs — Home / People / Check in / Funds
/ More — and **two of them point at nothing that exists**: Home is the unbuilt Overview, More is
profile/settings pages that do not exist. A five-tab bar with two dead ends is worse than the
drawer. It belongs to the deferred track, with the screens that fill it.

`/checkin` is the exception that needs no debate: it is *already* a phone screen, opened on church
wifi at every service, and its mobile treatment was always part of restyling it.

### Amendment 13 — Members stops being a restyle

`DashboardView.vue` is no longer a repaint. Five changes land in it, and together they make it the
riskiest file in the project:

1. **Server-side pagination.** `.range()`, page size **50**, a numbered pager. Client-side paging
   was rejected as theatre: the unbounded query still runs, so egress is unchanged and the
   CLAUDE.md threshold it is meant to answer stays breached.
2. **A stable sort in the query.** `listRecords()` has **no `.order()` at all** today — ordering is
   whatever Postgres returns, then `sortedMembers` sorts client-side. That is harmless while the
   whole list is in the browser and becomes a bug the moment `.range()` arrives: **range over an
   unordered query can repeat rows on one page and skip them on the next.** Order by
   `last_name, id` — the `id` tiebreaker is what stops shared surnames shuffling across page
   boundaries.
3. **Server-side search**, finally using `buildMemberNameOrFilter` from
   [searchFilters.js](../src/utils/searchFilters.js) — written, unit-tested against a
   `"Jane),or(member_of.not.is.null)"` breakout, and imported by **nothing in `src/`**. There is no
   search field on Members today; adding one is what stops pagination from being a downgrade,
   since today you can Ctrl-F the whole list precisely because the whole list is on the page.
4. **The detail modal becomes a right panel** that fills only on selection and is empty until
   then — which is what the mockup actually shows. PII still appears only after a deliberate
   click, rather than sitting on screen by default. On mobile the row navigates instead.
5. **`facebook_link` becomes clickable** — see
   [A14](#amendment-14--facebook_link-becomes-a-link-under-conditions).

Sequencing, and the reason this amendment exists: **split the stage in two.** Restyle first, then
pagination + search as a separate commit with its own `code-reviewer` pass. Landing a data-flow
change and a repaint in one diff makes both unreviewable.

Decisions inside this that were made deliberately and should not be re-opened as bugs:

- **The two capability-split column sets stay split.** Today the table shows Age + Gender to
  `canSeeMemberDetail` holders and Ministries + Small Groups to everyone else. The mockup shows
  one table with Member / Age / Groups / Journey. Merging needs group membership on the detail
  path, which `listRecords()` does not fetch — groups come from the `directory_search` RPC — so
  every version of the merge costs a second round-trip. Deferred to spec. Note also that a Journey
  column **cannot render for baseline users at all**: `directory_search` returns names and groups
  only, no journey flags. The mockup's four-column table is a detail-user view no matter what.
- **Sorting is names-only.** Age and Gender are sortable today; they will not be after this. Age
  is `computeAge(member.birthdate)` in the browser and does not exist to order on — it would have
  to become `birthdate` descending, which is correct but inverted and easy to get backwards. This
  is an accepted regression, chosen with that trade in view. **Do not "restore" it without
  re-deciding it.**
- **Selection clears on any refetch** — page change, sort change, search change. It is the only
  behaviour where what is on screen always matches the table, and it means a member's address
  never lingers in a panel beside results it has nothing to do with.
- **The filter pills are not built.** The mockup shows four and defines none of them. One of the
  likely candidates, "Archived", is not a filter at all — it inverts the mandatory
  `.is('archived_at', null)` read rule and needs its own deliberate path.

**Sizing, recorded 2026-08-11:** the largest church holds ~150 active members. So pagination here
is correctness-and-cost work rather than an emergency, and the `directory_search` 200-row cap
([A15](#amendment-15--the-directory-caps-honestly-rather-than-silently)) is not yet biting. The
list actually nearest a threshold is **the attendance roster, which can reach ~300** — that is
where to look next, not Members.

### Amendment 14 — `facebook_link` becomes a link, under conditions

Reverses this file's own default recommendation under
[Security-load-bearing behaviour](#security-load-bearing-behaviour--anchored-to-the-exact-touch-point),
which was "don't add link behaviour at all". The owner wants it clickable. It ships **only** with
all four of these:

1. **Validated at render**, not just on write. Render-time validation is the half that actually
   protects, because it covers rows already in the database — and nobody knows what is in that
   column today. Write-time validation goes in too, but it only ever buys a better error message.
2. **Host-allowlisted** to `facebook.com` / `fb.com` / `m.facebook.com`, `https:` only. The field
   is *named* `facebook_link`; a member-editable field accepting arbitrary URLs and rendered as a
   clickable link inside a staff dashboard is a phishing pivot, and requiring it to be what it
   claims costs nothing.
3. **`target="_blank"` + `rel="noopener noreferrer"`.**
4. **Anything failing validation renders as plain text**, never as a broken or stripped link.
   Silently dropping it would hide bad data instead of showing it.

This converts a documented-safe pattern into an active sink, so it is the one change in the
redesign that takes **`/security-review`** in addition to the mandatory `code-reviewer` pass.

### Amendment 15 — the directory caps honestly rather than silently

`directory_search(p_query, p_church_id, p_limit DEFAULT 200)` — and
[listDirectory()](../src/lib/data/members.js) passes only `p_church_id`. A church over 200 members
therefore **already shows baseline users and Head Pastors a truncated list with no indication it
was truncated.** That is live today, independent of any redesign.

Fixed here the cheap way: pass `p_limit` explicitly and render an honest **"Showing 200 of N —
refine your search"** note. Paginating that path properly needs a `p_offset` parameter on the RPC
— a migration, schema-before-SPA deploy ordering, and a security review of a `SECURITY DEFINER`
function that is the only thing standing between baseline users and the `members` table. **That is
not work to fold into a restyle**, and it is deferred to spec. At ~150 members the cap is not
biting yet, which is what makes deferring it safe rather than merely convenient.

### Amendment 16 — the mockups leave the repo

The design bundle does not belong in a **public** repository. Removed from tracking and ignored:
`UI mockups for form.zip`, `UI mockups for form/` in full — including the ~250 KB
`_ds/broadsheet-…` design system that is not the target, the `.pptx`, and the untracked
`design_handoff_church_dashboard/`.

Nothing load-bearing is lost. The tokens become `src/styles/tokens.css`, the decisions become
these amendments, and the vocabulary becomes [CONTEXT.md](../CONTEXT.md) — all of which are
reviewable and diffable in a way a 158 KB prototype never was.

### Amendment 17 — smaller reversals and confirmations, in one place

- **Brand colour: confirmed.** Cyan `#0088b0` + magenta `#d6006c`, applied exactly as §0.5
  sequences it — build on the current blue as a placeholder, sign off the *mechanics* on the
  style-guide route, then repoint the palette in `tokens.css` alone. CLAUDE.md's palette line is
  updated **when the rebrand lands**, not before, per [A3](#amendment-3--brand-colour).
- **Nine nav slots ship now**, with Overview / Statistics / What's next carrying the mockup's own
  "Soon" badge and no route. The IA lands once and the sidebar stops churning. The nav label
  becomes **Groups**; the route path `/dashboard/ministry` is unchanged.
- **The church switcher becomes modal 12.** This reverses §0.2's "reskin `ChurchSelector`, do not
  replace the native `<select>`". That objection was to a styled *listbox* reimplementing a select
  — it does not reach a real dialog, which `ui/Modal.vue` makes keyboard- and screen-reader-correct
  by construction. Switching church is a consequential context change, not a form field, and the
  cards carry the "records never move" reassurance a `<select>` cannot. Only the two cross-church
  roles ever see it.
- **A capability-denied route shows the no-access state** instead of silently redirecting to
  `/dashboard/members`, which is what the router does today. The mockup's rule — *never hide a
  permission failure silently* — is right, and this is a UX fix to existing behaviour. The
  "Request access" button on that screen is **not** built; there is nothing behind it.
- **The headless-primitives ADR is `0011`, not `0009`.**
  [Amendment 5](#amendment-5--adr-number-correction) moved it from 0008 to 0009; **0009 and 0010
  were both taken since**. It is now
  [0011-headless-primitives-for-accessibility.md](decisions/0011-headless-primitives-for-accessibility.md),
  and it is **written** — §0.6 can treat that step as done. Note that
  [ADR-0009](decisions/0009-vetted-runtime-dependency-candidates.md) pre-vets three runtime
  dependencies and **Reka UI is not one of them**, so 0011 makes the full CLAUDE.md case from
  scratch rather than citing 0009's sizing.
- **Skeletons for pages and lists, inline spinners on buttons.** The handoff's "no spinner" rule
  is about page and list loading, where a skeleton communicates shape. A submit button mid-flight
  still needs an indicator — on the screens that write money and attendance, no pending state
  invites double submits. `CollectionsInputView` and `ExpensesInputView` have **no loading state
  at all** today and gain one either way.

---

## Phase 0 — Foundation (tokens, dependency, shared components, brand validation)

### 0.1 Token layer

New file: **`src/styles/tokens.css`**. Not appended into `src/style.css` — `style.css` stays
exactly what CLAUDE.md §"Code conventions" describes ("only truly global rules go in
`src/style.css`") and keeps holding just the box-sizing reset and base font stack. `tokens.css` is
a second, purpose-built global file, imported explicitly as a new line in `src/main.js` above the
existing `import './style.css'`. That makes both global stylesheets visible from the one file a
new contributor already opens first, rather than hiding an `@import` inside `style.css`.

**Why this coexists with `<style scoped>` for free:** Vue's `scoped` attribute rewrites *selectors*
only — it stamps a `data-v-xxxxxxxx` attribute onto rendered elements and appends
`[data-v-xxxxxxxx]` to every rule in that block. It does nothing to custom-property resolution,
which follows the real DOM's cascade and inheritance regardless of scoping. Because `tokens.css`
defines everything on `:root`, any `var(--color-accent)` written inside any `<style scoped>` block
in any SFC resolves correctly with zero extra wiring — no props, no provide/inject, no
preprocessor. This is exactly why CSS custom properties are the right mechanism here and not, say,
Sass variables (not installed) or a JS theme object (would need a provider component).

Two-layer token architecture (primitive → semantic), kept to two layers rather than three —
component-level tokens (`--button-bg`, etc.) are explicitly deferred as speculative until a real
component needs to diverge from the semantic layer:

| Layer | Examples | Purpose |
|---|---|---|
| Primitive | `--color-blue-50`…`--color-blue-900`, `--color-slate-50`…`--color-slate-900`, `--color-red-*`, `--color-green-*`, `--color-amber-*` | Raw ramps. Referenced only from inside `tokens.css` itself, never from a view/component. |
| Semantic | `--color-bg-page`, `--color-bg-surface`, `--color-border-default`, `--color-text-primary`, `--color-text-secondary`, `--color-text-muted`, `--color-accent`, `--color-accent-hover`, `--color-accent-subtle`, `--color-focus-ring`, `--color-danger[-bg/-border]`, `--color-success[-bg/-border]`, `--color-warning[-bg/-border]` | What views and `ui/` components actually consume. A rebrand only ever edits primitive values and re-points a handful of semantic aliases — it never touches an SFC. |

> **If [Amendment 1](#amendment-1--dark-mode) resolves to yes**, dark mode attaches at the
> *semantic* layer only: a `:root[data-theme="dark"]` block re-points the semantic names at
> different primitive steps. Primitives never change. Views never know.

Other scales in the same file, sized against what's actually in the code today (12px card radius,
12–32px paddings, three shadow recipes, two duplicated keyframe blocks):

- **Spacing** — `--space-1` (4px) through `--space-16` (64px) on a 4px grid.
- **Type** — `--font-sans` (see [Amendment 2](#amendment-2--typography)),
  `--text-xs/sm/base/lg/xl/2xl/3xl`, `--font-weight-normal/medium/semibold/bold`,
  `--leading-tight/normal/relaxed`. This directly retires the `rem`-vs-`px` drift (e.g.
  LoginView's `0.85rem` labels vs. other files' `14px`).
- **Radius** — `--radius-sm` (6px) … `--radius-xl` (16px), `--radius-full` (999px), with
  `--radius-lg` = the documented 12px card radius.
- **Shadow/elevation** — `--shadow-xs/sm/md/lg/xl`, consolidating the three recipes currently in
  the wild (`rgba(26,86,219,.08)` on auth cards, `rgba(15,23,42,.06)` on form cards,
  `rgba(15,23,42,.15–.18)` on modals) into one neutral ramp, plus one dedicated
  `--shadow-focus-ring` for the brand-tinted focus glow (legitimately brand-coloured, kept
  separate from elevation).
- **Motion** — `--duration-fast/base/slow` (120/180/240ms), `--ease-standard/-in/-out`. A global
  `@media (prefers-reduced-motion: reduce)` block moves from being AttendanceView-only
  (`AttendanceView.vue:1699-1703`, the sole instance in the whole app) into `tokens.css`, so all
  11 views get the accommodation on day one of Phase 0 — before any of them are visually migrated.
- **Z-index** — a small `--z-dropdown/-sticky/-modal-backdrop/-modal/-toast` scale, replacing
  scattered literals (`z-index: 100`, `50`, `3`, `2`) so the new global `ToastHost` and per-view
  modals can never fight over stacking.

### 0.2 Headless primitives library

**Recommendation: Reka UI** (`reka-ui` on npm). One correction to the brief: **Radix Vue was
renamed to Reka UI in 2024** — `radix-vue` is now a maintenance-mode alias pointing at the same
maintainer's successor package, so "Radix Vue" and "Reka UI" are the same library under two names;
install `reka-ui` directly, not the deprecated name. It is Vue-3-native, ships unstyled by design
(matches the "style entirely with our own tokens" decision), and is consumed via plain named
imports from `<script setup>` — it's authored in TypeScript but compiles to plain JS + `.d.ts`, so
it works from this project's JS-only SFCs with no `tsc`/`vue-tsc` step and no `vite.config.js`
change.

Two corrections/clarifications to the alternatives named in the brief:

- **Melt UI is not usable here at all** — it's a Svelte-specific builder library with no Vue
  bindings. It isn't a real contender for this stack and should be dropped from consideration
  rather than evaluated further.
- **Ark UI** (`@ark-ui/vue`) is a legitimate framework-agnostic alternative (Chakra team, built on
  the `zag-js` state-machine core, also usable from JS), but its docs/ecosystem lean
  TypeScript-first and it pulls in `zag-js` as a transitive dependency layer — more conceptual and
  dependency surface than this app's narrow needs justify. Note it, don't default to it.
- **`@headlessui/vue`** is the credible fallback if a bundle-size spike (below) shows Reka UI's
  Dialog+Toast footprint is heavier than wanted: smaller surface area, covers `Dialog` and
  `Combobox`, actively maintained by Tailwind Labs, same "bring your own markup/CSS" philosophy.

Concrete mapping of primitives to this app's actual gaps (not a blanket "use it everywhere"):

| Need | Primitive | Notes |
|---|---|---|
| Modal focus-trap/Escape/return-focus | `DialogRoot`/`DialogPortal`/`DialogOverlay`/`DialogContent`/`DialogTitle` | Wrapped once by `ui/Modal.vue` (§0.3). Also removes the `<Teleport>`-vs-`<style scoped>` workaround visible today at `AttendanceView.vue:1706-1719`, where modal CSS had to be pulled into a second, *unscoped* `<style>` block because Teleported content escapes the host SFC's scoped attribute. A dedicated `Modal.vue` doesn't have this problem — its own scoped styles travel with content it Teleports. |
| Toast host | `ToastProvider`/`ToastRoot`/`ToastViewport` | Optional but recommended once the dependency is already paid for: correct `aria-live` region semantics, pause-on-hover, swipe-to-dismiss, for free. |
| Combobox keyboard nav | `ComboboxRoot`/`ComboboxContent`/`ComboboxItem` | **Not required for D11.** See §0.3 — `MemberAutocomplete.vue` already implements `role="combobox"`, `aria-expanded`, `aria-activedescendant`, and full arrow/Enter/Escape/Tab handling by hand, correctly. Re-platforming it onto the primitive is an optional future consistency cleanup, not a defect fix. |
| Tabs (`FundsTabs.vue`, the Ministry tab bar) | *(none needed)* | These are real `<router-link>`/`<button>` elements today — already natively keyboard-operable. Do not "upgrade" them to a Tabs primitive; that would add dependency surface for zero accessibility gain. |
| Church selector | *(none needed)* | It's a native `<select>` (`ChurchSelector.vue`). A native select already beats any JS reimplementation for keyboard/screen-reader/mobile behaviour. Reskin with tokens; do not replace with a styled Listbox. |

**Free-tier / bundle-size impact note** (per CLAUDE.md's "never add a runtime dependency without a
stated reason and a free-tier impact note"):

- **Reason:** closes D11 (no modal focus trap, anywhere) with tested interaction logic instead of a
  fifth hand-rolled implementation, on top of the four (DashboardView, MinistrySmallGroupView ×3,
  CollectionsInputView, AttendanceView ×2) already diverging today.
- **Impact:** it is a client-side npm package bundled by Vite into first-party JS served from the
  same origin — it does not touch `connect-src`, `script-src`, or any Supabase egress, and (unlike
  a webfont) needs no CSP change since nothing is fetched cross-origin. Cost is purely the
  incremental gzipped bytes shipped to whichever *lazy chunks* import `Modal.vue`/`ToastHost.vue`.
  That must be measured, not assumed — see the bundle-size gate below — and the one number that
  must not move is **`dist/assets/CheckinView-*.js`** (6,675 B today), since the router's own
  comment (`src/router/index.js:6-10`) exists specifically to keep the public check-in page from
  ever downloading staff-dashboard code. If a build after adding the dependency shows
  `CheckinView-*.js` growing, something is wrong (e.g. the dependency leaking into the shared entry
  chunk) and must be fixed before merging, not accepted.

**Standing caution:** the dependency is justified by `Modal` and, optionally, `Toast` — and this
same section rules it out for combobox, tabs, and select. That is one runtime dependency for
roughly one and a half components. Defensible, because hand-rolled focus traps are genuinely easy
to get wrong and there are already four divergent ones. But it must not become the reflex answer
for the next primitive that comes up; each additional use needs its own reason.

### 0.3 Shared component set — `src/components/ui/`

A new directory, deliberately separate from `src/components/`. Convention going forward:
**`src/components/` holds domain-aware shared components** (know about capabilities/roles/church
context — `AppSidebar`, `ChurchSelector`, `FundsTabs`, `MemberAutocomplete`, and the new
`AppLogo`); **`src/components/ui/` holds domain-blind generic primitives** (could be dropped into
any Vue app). `MemberAutocomplete.vue` is **not** moved — it's already correctly placed and already
reusable; relocating it would be pure churn.

| File | Replaces / fixes | Notes |
|---|---|---|
| `src/components/ui/Button.vue` | `.btn-primary`, `.btn-secondary`, `.btn-tertiary`, `.btn-login`, `.btn-submit`, `.btn-logout` (all hand-rolled per view) | Variants `primary\|secondary\|tertiary\|danger\|ghost`; `loading` prop swaps in `Spinner`. No headless primitive needed — plain buttons need no interaction-logic library. |
| `src/components/ui/Card.vue` | `.card` (dashboard views) and `.login-card`/`.set-password-card`/`.pending-card`/`.checkin-card`/`.not-found-card` (auth family) — same radius/shadow/padding recipe, different max-widths | One primitive serves both families via a `max-width`/`padding` prop. |
| `src/components/ui/Modal.vue` | The 4 hand-rolled modal implementations: `DashboardView.vue:91-320`, `MinistrySmallGroupView.vue:160-330` (×3 modals), `CollectionsInputView.vue:161-230`, `AttendanceView.vue:845-926` (×2) | Wraps Reka UI's Dialog. Props: `open` (v-model), `title`, `size` ('default' 520px \| 'wide' 580px, matching the existing two widths found in `MinistrySmallGroupView.vue:1003-1033`). Slots: default (body), `footer`. Retires the byte-identical `@keyframes fadeIn`/`slideUp` duplicated at `DashboardView.vue:998-1017` and `MinistrySmallGroupView.vue:1015-1038` by hosting them once. |
| `src/components/ui/Toast.vue` + `src/components/ui/ToastHost.vue` | 3 duplicated toast implementations (`DashboardView.vue`, `MinistrySmallGroupView.vue`, `AttendanceView.vue`) | **Correction to the brief:** DashboardView and MinistrySmallGroupView *do* both already animate correctly — each defines matching `.toast-enter-active/.toast-leave-active/.toast-enter-from/.toast-leave-to` CSS (confirmed at `DashboardView.vue:1383-1389` and `MinistrySmallGroupView.vue:1628-1634`). It's specifically **AttendanceView** (`AttendanceView.vue:925`) that's a bare `v-if` with no `<Transition>` at all. So: 2-of-3 already animate, 1 doesn't — the shared host should standardise on the behaviour already proven twice, not invent a fourth variant. Backed by `src/composables/useToast.js` (module-scope reactive queue, `showToast(message, type)`), mounted once as `<ToastHost />` in `App.vue` next to `<router-view />` — this is the concrete fix for **backlog B10**'s toast-container half (its offline-banner/error-boundary examples stay out of scope). |
| `src/components/ui/Badge.vue` | `.stat-badge`, `.church-switcher-badge`, `.closing-note` pill, group-type tags | Variants `neutral\|accent\|success\|warning\|danger`. |
| `src/components/ui/Input.vue` | The repeated `.form-group` (label + input + `.field-note` + error) pattern identical across LoginView/SetPasswordView/CheckinView/CollectionsInputView/etc. | Plain wrapper, no primitive needed. |
| `src/components/ui/Spinner.vue` | Two byte-identical `@keyframes spin` (`LoginView.vue:211`, `SetPasswordView.vue:233`) plus DashboardView's separate `.spinner` | Self-contained; the keyframe only needs to exist inside this one file. |
| `src/components/ui/TableSortHeader.vue` + `src/composables/useSortState.js` + `src/utils/sortState.js` | D11's `aria-sort`/keyboard gap — see [D11 and D12](#d11-and-d12--exactly-where-and-how) | Scoped narrowly: only `DashboardView.vue`'s member table is actually sortable today (`DashboardView.vue:46-58`). ChurchFundsView's three tables (`ChurchFundsView.vue:132-138, 285-288, 351-357`) and the others found via `<table>` search (AttendanceView, ExpensesInputView, CollectionsInputView) are fixed-order reports — they get consistent token-driven `.table` CSS, not a sort component, since a generic `<Table>` wrapper would fight their differing colspans/print stylesheet (`ChurchFundsView` §4.7 print CSS) for no payoff. |
| `src/components/AppLogo.vue` | 3× byte-identical inline logo SVG (`LoginView.vue:6-12`, `SetPasswordView.vue:6-12`, `AccountPendingView.vue:6-12`) | One additional, non-obvious finding: **the sidebar brand mark and the auth-page logo are already two different glyphs** (`AppSidebar.vue:5-10` is a door/circle icon; the auth pages use a cross/steeple shape). The rebrand should pick one mark and use `AppLogo.vue` everywhere, including a real `public/favicon.svg` replacing the default `vite.svg` still referenced in `index.html:5`. |
| Icons | Not a new dependency by default | Consolidate the hand-drawn, copy-drifted glyphs (e.g. the "X" close icon duplicated with drift across ≥4 files) into a small local `src/components/ui/icons/` set or a single name-keyed `Icon.vue` — **zero new dependency, $0 cost**. `lucide-vue-next` is a defensible optional upgrade later (tree-shaken, ~1-3 KB/icon, no CSP interaction) but wasn't part of the pre-approved library decision, so it needs its own explicit ask/reason note if proposed — don't fold it in silently. |

Explicitly **not** building (avoiding speculative extras): a generic `<DataTable>` abstraction, a
`ConfirmDialog` wrapper (use `Modal` directly with a footer slot — the pattern is cheap enough that
a second abstraction layer isn't earning its keep), a styled `Listbox`/`Popover` (nothing needs
one).

> The original plan also listed dark mode here as "not requested anywhere in scope." That is
> superseded by [Amendment 1](#amendment-1--dark-mode) — the mockup requests it.

### 0.4 Rebrand: typography and the CSP constraint

Superseded in full by [Amendment 2](#amendment-2--typography). Retained here as the pointer,
because the constraint is the reason the decision exists: `netlify.toml`'s CSP is
`style-src 'self' 'unsafe-inline'; font-src 'self' data:` — no external domain is allowlisted
anywhere, so a `<link>` to any font CDN is silently blocked and would stay blocked unless the CSP
itself is edited, which is a security-header change its own posture treats as review-worthy.

### 0.5 Validating the rebrand before it touches 11 views

Sequence deliberately decouples "does the component system work" from "do we like this palette":

1. Build `tokens.css` + the `ui/` components first against a **neutral placeholder palette (the
   current blue is fine as a placeholder)** — this proves the architecture without yet risking a
   design opinion.
2. Add a **dev-only route**, `src/views/dev/StyleGuideView.vue`, registered in
   `src/router/index.js` behind `import.meta.env.DEV` (so it adds a route entry only in
   `npm run dev`, and contributes **zero bytes to the production build** — respecting the
   cost-first/bundle-discipline priority exactly). It renders every `ui/` component with its real
   states (hover, focus, disabled, loading, an open `Modal`, a fired `Toast`) — a genuine
   rendered-component preview, not a static mockup, so it also catches integration bugs a plain
   HTML style tile can't.
3. Get sign-off on the component system's *mechanics* on the neutral palette.
4. **Then** do the actual rebrand as a `tokens.css`-only edit (primitive colour ramp + semantic
   aliases + `--font-sans`), re-open the same style-guide route, and get explicit visual sign-off
   there. A rejected palette costs a token edit and a look at one throwaway page — not a re-review
   of 11 views.
5. Only after that sign-off does Phase 1 (real view migration) begin.

> If dark mode is adopted, the style-guide route gets a theme toggle and **both themes are signed
> off at step 4**, together. Signing off light and discovering dark later is the failure this
> sequencing exists to prevent.

### 0.6 ADR and CLAUDE.md update

New file: **`docs/decisions/0009-headless-primitives-for-accessibility.md`** (per
[Amendment 5](#amendment-5--adr-number-correction)), recording: context (D11, four divergent
hand-rolled modals), decision (Reka UI for interaction logic only; Button/Card/Badge/Input/Table/
Toast/Spinner remain hand-rolled against project tokens; full styled kits like Vuetify/PrimeVue
stay rejected), consequences (one new runtime dependency, bundle delta tracked per §0.2).

`CLAUDE.md` edits: the opening line ("Vite, no TypeScript, no state library, no UI kit") needs a
parenthetical narrowing to point at the ADR rather than reading as a still-total prohibition, and
the "Code conventions" section gets one new bullet naming Reka UI as the sanctioned exception with
a link to `0009`. Both edits are narrow, not a rewrite of the file. The palette line is updated
later, when the rebrand actually lands ([Amendment 3](#amendment-3--brand-colour)).

---

## Phase 1 — Prove it

The brief frames the auth pages as the obvious low-risk "prove it" target. **Confirmed, but
incomplete alone** — and the plan should say so rather than rubber-stamp it.

### 1a. The auth-page family (treated as one migration unit)

`LoginView.vue`, `SetPasswordView.vue`, `AccountPendingView.vue` — genuinely the right first
target: near-byte-identical gradient/card/logo/spinner/error-message/success-message markup across
all three, zero tables, zero modals, zero finance/attendance gating, low traffic relative to the
dashboard (once per session vs. continuous staff use). Migrate all three together, not just "1-2 of
the 3" — since they share one card-chrome pattern, doing two and leaving the third on old styles
would produce a visibly half-migrated auth flow for no benefit. `NotFoundView.vue` (71 lines, zero
logic) is a near-free bonus add-on to the same batch.

This proves: tokens, brand direction on a real user-facing surface, `Card`, `Button`, `Input`,
`Spinner`, `AppLogo`.

**What it does *not* prove:** `Modal`, `ToastHost`, or the Reka UI integration at all — none of
these four views uses a modal or a toast. Declaring the rebrand "proven" after only this step would
mean the highest-risk, most novel piece (a third-party dependency wired into focus-trap-critical
UI) ships for the first time simultaneously across three large views (Stage 2+) instead of being
isolated and validated once.

### 1b. Shell + one real modal + the toast host (the actually-missing proof)

A second, small, contained slice, still before wide rollout:

- Migrate `AppSidebar.vue` and `DashboardLayout.vue` chrome onto tokens/`Button`. This incidentally
  fixes the wrong-blue bug for free — `AppSidebar.vue:251` uses `#3b82f6` (Tailwind blue-500) for
  the active-nav-item background, not the documented `#1a56db`.
- Wire `<ToastHost />` into `App.vue`.
- Migrate **exactly one** existing modal call-site onto the new `Modal.vue`. Recommend
  **MinistrySmallGroupView's delete-confirmation modal** (`MinistrySmallGroupView.vue:266-294`) as
  the specific target: it's the simplest possible modal in the entire inventory (title + warning
  text + two buttons, no form fields, no nested validation), making it the cheapest place to prove
  focus-trap/Escape/return-focus end-to-end before applying `Modal.vue` to the more complex form-
  and detail-modals in Stage 2-5.
- Land the D12 fix here too, since it's shell-scoped work anyway.
- **Raise the Lighthouse accessibility threshold to 0.9** at the end of this phase
  ([Amendment 6](#amendment-6--wire-the-accessibility-work-to-the-gate)), and capture the
  performance baseline.
- **If dark mode is in:** the theme toggle lands here, in the sidebar footer where the mockup puts
  it, since this is the phase that owns the shell.

This is what actually validates decision #1 (headless primitives + consolidated components) before
it's baked into 8-9 more views, and it's cheap: one small modal, the shell, and the toast host —
not a full view.

---

## Phase 2 onward — Sequencing the remaining views

After Phase 1, 7 dashboard-family views plus `CheckinView` remain. Sequencing criteria, not a rigid
order:

1. **Risk** — views touching finance-gating or the public/anonymous surface get scheduled once the
   pattern is already proven twice, and always paired with their specific isolation-matrix re-check
   ([Security](#security-load-bearing-behaviour--anchored-to-the-exact-touch-point)) — never first,
   never rushed.
2. **Shared-component payoff** — views currently hand-rolling their *own* full modal+toast+keyframes
   (DashboardView, MinistrySmallGroupView, AttendanceView) retire the most duplicated code per
   migration; prioritise them over views with neither (ExpensesInputView has no modal or toast at
   all).
3. **Traffic** — `/dashboard` redirects to `/dashboard/members` (`router/index.js:48`), making
   DashboardView the highest-traffic authenticated view; migrating it early makes the rebrand
   visible to staff soonest.
4. **Coupling** — `CollectionsInputView`, `ExpensesInputView`, and `ChurchFundsView` all hang off
   `FundsTabs.vue`. Migrate `FundsTabs.vue` once, then do all three destination views back-to-back,
   so the tab bar and its destinations are never in a half-migrated, visually inconsistent state.
5. **Complexity margin** — the view with the most distinct interactive surface (AttendanceView: tabs
   + 2 Teleported modals + toast + multi-step form) goes last among the dashboard-family, once 4
   prior migrations have exercised the pattern.

Illustrative order under those criteria:

| Stage | View(s) | Why here |
|---|---|---|
| 2 | `DashboardView.vue` | Highest traffic; modal pattern already rehearsed in 1b; retires the most duplicated code in one pass; D11 `aria-sort` fix lands here (only view with a genuinely sortable table). **Revisit the mobile decision at the end of this stage** ([Amendment 4](#amendment-4--new-screens-move-to-their-own-track)). |
| 3 | `MinistrySmallGroupView.vue` | Same duplication class as Stage 2; its 3 modals (view/detail, delete-confirm already done in 1b, create/edit form) stress-test `Modal.vue`'s flexibility before finance work begins. |
| 4 | `FundsTabs.vue` → `ChurchFundsView.vue` → `CollectionsInputView.vue` → `ExpensesInputView.vue` | Tight cluster per criterion 4. `CollectionsInputView`'s hand-rolled autocomplete duplicate (`CollectionsInputView.vue:53-95`) gets folded into `MemberAutocomplete.vue` here. Isolation-matrix re-check required at every step. |
| 5 | `AttendanceView.vue` | Most complex remaining view; scheduled last for maximum practice margin; still requires the attendance-specific isolation-matrix rows. |
| 6 (can float earlier on the calendar, but always done deliberately) | `CheckinView.vue` | Smallest visual surface but highest special-handling requirement (ADR-0007). Do it once the token/brand direction is fully stable, never bundled silently into a batch with other views, always with its own dedicated ADR-0007 checklist run. |

---

## D11 and D12 — exactly where and how

**D11 has three genuinely different sub-fixes, not one:**

1. **Modal focus trap** — closed by `ui/Modal.vue` wrapping Reka UI's Dialog, applied at each of the
   4 existing call sites as that view is migrated (not all at once in Phase 0 — only the shell/1b
   instance moves early).
2. **`aria-sort` + keyboard sort** — this is a **plain-HTML/ARIA fix, not a headless-primitive one**
   (Reka UI has no table-header primitive). The concrete bug: `DashboardView.vue:46-58` has
   `<th @click="setSort(...)">` with no `aria-sort` and no keyboard handler — a `<th>` is not
   natively focusable or activatable no matter what ARIA is added to it. The fix
   (`TableSortHeader.vue` + `useSortState.js`/`sortState.js`) puts a real `<button>` inside each
   `<th>` carrying the click handler, plus a computed `aria-sort="ascending|descending|none"` on the
   `<th>` itself. This is the only view in the inventory needing it — ChurchFundsView's tables are
   fixed-order reports.
3. **Keyboard access to rows** — the concrete bug is `DashboardView.vue:67-71`:
   `<tr @click="canSeeMemberDetail && openDetails(member)" class="member-row clickable">` on a
   plain, non-interactive `<tr>`. Fix: put the row-opening action on a real interactive element (a
   button around the primary cell's content), not `tabindex`+`role` hacks on the `<tr>` itself.
   **Worth noting explicitly: `MinistrySmallGroupView.vue`'s group cards already do this
   correctly** — `MinistrySmallGroupView.vue:135-141` uses a real
   `<button type="button" class="group-card">` for the equivalent interaction. That's the existing
   model to copy into DashboardView, not a new pattern to invent.

**D12** (`DashboardLayout.vue:44-51` vs `DashboardView.vue:725,773-779` clear different
`localStorage` key sets on sign-out): fix lives in a new **`src/composables/useSession.js`**, backed
by a pure **`src/utils/sessionCleanup.js`** (matching this codebase's own established convention of
pure-logic-in-`utils/` + thin composable wrapper, e.g. `checkinMemory.js`/`CheckinView.vue`).
`sessionCleanup.js` exports one function clearing exactly `udfc.myChurchName` and `udfc.myUserName`
— and **must not** touch `udfc.checkin.recorded` (the key `checkinMemory.js` owns), since that key
is intentionally device-scoped and must outlive any staff session per its own design rationale.
(Per [Amendment 1](#amendment-1--dark-mode), a `udfc.theme` key would join that same do-not-clear
list.) `useSession.js`'s `signOut()` calls that cleanup, then `supabase.auth.signOut()` (which is
what triggers the `SIGNED_OUT` event `useCurrentRole.js` and `useActiveChurch.js` already listen for
— no need to duplicate that half), then `router.push('/login')`. Both `AppSidebar`'s emit-driven
handler and DashboardView's own button call this one function in Phase 1b. The more thorough
version of the same fix lands in Stage 2: **delete DashboardView's own duplicate local header**
(`DashboardView.vue:9-12`, a second "UDFC Dashboard" title + a second "Sign Out" button, entirely
redundant with the chrome `DashboardLayout`/`AppSidebar` already render) — which removes the second
sign-out code path's reason to exist at all, rather than just making two paths agree.

---

## Security-load-bearing behaviour — anchored to the exact touch point

| Behaviour | Where it's touched | What must not change |
|---|---|---|
| Check-in oracle resistance (ADR-0007) | Stage 6, `CheckinView.vue` | The `STATE` machine's `'recorded'`/`'closed'` responses stay visually undifferentiated; the "already checked in" branch (`state.value = STATE.ALREADY`) stays driven only by `readCheckedInNames()` from `checkinMemory.js`, never a server round-trip. Restyling the card/button/input via `ui/` components is fine; touching `loadSession()`/`handleSubmit()`'s branching logic is not in scope. Re-run [VERIFICATION.md](security/VERIFICATION.md) §4.1's response-uniformity and already-checked-in rows after this stage. |
| Finance-gated reactivity | Stage 4, `FundsTabs.vue` and `ChurchFundsView.vue:308` (`v-if="canWriteFinance"` on the contributors section) | These must remain plain template `v-if` bindings reading live composable state, not memoised/computed-once at mount. Re-run VERIFICATION.md §3.15 (sign out of a finance role, into a non-finance role, same tab, no reload → Collections/Expenses links and the contributors section must vanish) immediately after migrating these two files. |
| `AppSidebar.vue`'s `v-html` icon injection | Stage 1b, when the sidebar is retouched | If icons are consolidated into a shared `Icon.vue`/icon set, the source must stay a static, hardcoded module constant — never a value that could originate from the database or a prop threaded from user data (per [ARCHITECTURE.md](ARCHITECTURE.md) §4.7 and [SECURITY.md](SECURITY.md) §4.1, which already treat this `v-html` as a latent sink). |
| `facebook_link` scheme validation | Only if triggered — Stage 2, `DashboardView.vue`'s member-detail modal redesign | Today it's safe plain-text interpolation. If the visual redesign of the member-detail modal adds a clickable `<a>` for this field "while we're in there," it must first get the `https:`-only scheme check + `rel="noopener noreferrer"` + `target="_blank"` from SECURITY.md §4.1. **Default recommendation: don't add link behaviour at all as part of this redesign** — leave it as styled plain text, since doing so silently would convert a documented-safe pattern into the exact latent XSS/phishing risk that finding describes. |

---

## Verification per phase

- **Visual check** — `npm run dev` + manual browser check after every phase, per the project's
  existing convention (the `run` skill covers launching the app when implementation starts).
- **Isolation matrix** — only the specific rows that changed, not the full matrix (this is
  presentation-only work, no policy/grant/view changes): the finance same-tab-role-switch row
  (§3.15) after Stage 4, and the check-in response-uniformity / already-checked-in rows (§4.1) after
  Stage 6.
- **`code-reviewer` pass** — the project's existing exit gate, run on every phase's diff per
  CLAUDE.md's Always rule; not something this plan needs to separately schedule.
- **Lighthouse** — the gate is `lighthouserc.json`, hard-fail. Baseline captured in Phase 1;
  accessibility raised to 0.9 at the end of Phase 1
  ([Amendment 6](#amendment-6--wire-the-accessibility-work-to-the-gate)).
- **Bundle-size sanity check** — baseline captured from the built `dist/`: shared entry `index-*.js`
  320,530 B; `CheckinView-*.js` 6,675 B + 2,497 B CSS; `DashboardView-*` 20,750 B JS / 9,599 B CSS;
  `MinistrySmallGroupView-*` 19,835 B / 15,637 B; `AttendanceView-*` 25,130 B / 12,933 B;
  `ChurchFundsView-*` 24,473 B / 9,160 B; `CollectionsInputView-*` 12,474 B / 8,004 B;
  `ExpensesInputView-*` 6,894 B / 3,411 B; the 3 auth views 2–3.4 KB each. After Phase 0's
  dependency lands, and again after each migration stage, re-run `npm run build` and diff
  `dist/assets/*` against these numbers. The one non-negotiable check: **`CheckinView-*.js` must not
  grow** — if it does, the new dependency has leaked into a shared chunk instead of staying confined
  to the dashboard-family views that actually import `Modal.vue`. A `rollup-plugin-visualizer`
  devDependency is an optional (build-time only, zero production cost) nicety for this, not required
  — plain `dist/assets` size diffing is sufficient and free.
- **Testing tooling gap, flagged explicitly**: there is no `@vue/test-utils` and no jsdom/happy-dom
  environment in this project today (`vitest.config.js` runs `environment: 'node'`); the one
  existing "component test" (`tests/views/churchFundsView.test.js`) is an SSR smoke-render via
  `vue/server-renderer`, not a DOM-interaction test. Plan accordingly: pure logic extracted into
  `src/utils/sessionCleanup.js` and `src/utils/sortState.js` gets ordinary function tests (matches
  convention exactly); each new `ui/` component gets at minimum an SSR smoke-render test under a new
  `tests/components/ui/` directory; genuine interaction assertions (e.g. "Escape closes the modal")
  don't need re-testing since that's Reka UI's own tested responsibility, not this app's. If deeper
  DOM interaction testing is wanted later, adding `@vue/test-utils` + `happy-dom` is a small,
  dev-only (non-runtime) dependency addition worth calling out before doing it, even though
  CLAUDE.md's "never add a runtime dependency" rule technically doesn't gate devDependencies.

---

## Explicitly out of scope

- **The mockup's new screens** — superseded and widened by
  [Amendment 9](#amendment-9--scope-is-the-existing-feature-set-not-the-mockups-feature-set); the
  full list is the handoff below. Mobile is the exception that came *back* into scope, see
  [Amendment 12](#amendment-12--mobile-lands-now-the-tab-bar-does-not).
- **D5/D6/D7** (stale role-based nav state), **D14** (formatMoney/date/name duplication), any router
  restructuring, and all Prisma/RLS/backend logic. Nothing above touches any of these — with two
  named exceptions the amendments introduce deliberately: the router renders a no-access state
  instead of redirecting ([A17](#amendment-17--smaller-reversals-and-confirmations-in-one-place)),
  and `listRecords()` gains `.range()`/`.order()`/search
  ([A13](#amendment-13--members-stops-being-a-restyle)).

### Deferred work — the spec handoff list

Everything below was cut from this redesign **by decision, not by oversight**, on 2026-08-11. Each
needs a spec before it needs a ticket. Grouped by why it was cut, because that determines how much
design work each one still needs.

**Whole surfaces from the mockups — need a spec each.**
Overview / home · ~~Statistics~~ **specced: [#56](https://github.com/aesir19/church-sysyem/issues/56)** · What's next (roadmap + submit-a-request, which is a *write* path
needing a table and policies) · the nine detail views in file 3 (group detail, member profile page,
service detail, count sheet, report builder, approval queue, follow-up worklist, the mobile
screens) · the five admin pages (users & roles, churches, my profile, settings, audit log) ·
modal 11 invite user · modal 14 export · the bulk selection bar · the notification panel · the
offline banner and pending-sync queue · the mobile bottom tab bar.

**Contradict an accepted ADR — each opens with an ADR amendment, not just a spec.**

- **Fund allocation editor** (mockup 3.3). Makes allocation *data*: sliders, a percent input, a
  computed peso column, allocation history. [ADR-0004](decisions/0004-view-aggregates-but-does-not-allocate.md)
  puts the 10/5/5/50-50 rules in `collectivesReport.js` and **nowhere in SQL**. Extending that is
  anticipated; it still needs the record amended, and the ADR's warning about a second source of
  truth that "reconciles most months" is the exact failure to design against.
- **Closing the month** (modal 10, plus locked banners, "Request reopen", and the approval and
  audit trail behind it). ADR-0004 is blunt: *"There is no close step and nothing is ever frozen."*
  A close step reintroduces a stored balance that drifts the moment a correction lands behind it,
  and drags in two unbuilt subsystems (approvals, audit) to serve one modal. **This needs its own
  ADR arguing the reversal on its merits** — it should not arrive as a consequence of a redesign.

**Blocked on data the schema does not carry.**
Expense **categories** (the Expenses category chart and the Settings category chips) · member
**notes** · **mentors** and "assign a mentor" · **approvals** as a concept · per-group meeting
attendance.

**Small, well-understood, and cut for scope discipline.**

- `directory_search` **`p_offset`** — proper pagination for the directory path, replacing the
  honest cap in [A15](#amendment-15--the-directory-caps-honestly-rather-than-silently). A
  migration touching a `SECURITY DEFINER` function; needs a security review.
- **Age + Groups in one member table** — needs group membership on the detail path, which costs a
  second round-trip however it is done. See [A13](#amendment-13--members-stops-being-a-restyle).
- **The four filter pills** on Members — the mockup shows four and defines none. "Archived" among
  them is not a filter but an inversion of the mandatory archived-row read rule, and needs its own
  path.
- **The "Personal detail" field tier.** The owner distinguishes personal details — address,
  contact number, facebook link, which stay with the Secretariat ministry — from the rest of a
  member record, with a view to letting Head Pastor see the latter. Today
  `can_see_member_detail()` is all-or-nothing: a caller gets all seventeen columns or the
  Directory. Splitting it is a change to the authorization model and needs its own ADR and
  security review. [#56](https://github.com/aesir19/church-sysyem/issues/56) deliberately needs
  none of it, because it ships only counts.
- **The archived count** in the Members header — a second count query against `members`.
- **Attendance roster pagination.** At ~150 active members the member list is comfortable; the
  roster can reach **~300**, which makes it the list actually nearest a threshold. Look here next.

**Already filed, not deferred:** enforcing the Journey stage order in the schema —
[issue #55](https://github.com/aesir19/church-sysyem/issues/55).

### Critical files for implementation

- `src/styles/tokens.css` (new — the token layer everything else consumes)
- `src/main.js` (needs the new `tokens.css` import)
- `package.json` (where `reka-ui` gets declared, with the ADR-linked reason/impact note)
- `src/components/ui/Modal.vue` (new — highest-risk/highest-payoff component; wraps the new
  dependency; fixes the core of D11)
- `src/composables/useSession.js` (new — consolidates the D12 sign-out divergence)

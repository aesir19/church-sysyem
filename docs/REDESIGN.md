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
| Branch | `redesign` (currently empty — no work started) |
| Phase | Not started. **Phase 0 is blocked on two open decisions** — see below. |
| Mockups | `UI mockups for form/` — untracked, see [Mockups](#mockups) |

### Open decisions blocking Phase 0

Both change what goes into `src/styles/tokens.css`, so both must be settled before that file is
written. Deciding either one *after* the views are migrated means reopening all eleven.

1. **Dark mode — in or out?** The mockup ships a complete dark theme; this plan originally scoped
   it out. See [Amendment 1](#amendment-1--dark-mode).
2. **Typography — self-hosted Manrope or the system stack?** The mockup's Google Fonts link is
   blocked by our own CSP and cannot ship as drawn. See [Amendment 2](#amendment-2--typography).

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

Housekeeping: the folder is untracked, sits beside a duplicate `UI mockups for form.zip`, and
carries ~250 KB of unused design system. Decide whether it belongs in the repo or outside it
before it gets committed by accident.

### The mockup and this plan disagree

They were produced independently. Three conflicts, resolved by the amendments below, plus a
scope difference resolved by [Amendment 4](#amendment-4--new-screens-move-to-their-own-track).

| | This plan said | The mockup shows | Resolution |
|---|---|---|---|
| Dark mode | Explicitly out of scope | Full dark theme, 28 tokens, a toggle | [A1](#amendment-1--dark-mode) — decide before Phase 0 |
| Typography | System stack *or* self-hosted, undecided | Manrope via Google Fonts (**CSP-blocked**) | [A2](#amendment-2--typography) — decide before Phase 0 |
| Brand colour | `#1a56db` (per CLAUDE.md) | Cyan `#0088b0` + magenta | [A3](#amendment-3--brand-colour) — absorbed by §0.5 as-is |
| Scope | 11 existing views, restyle only | + Overview, Statistics, roadmap, mobile layout | [A4](#amendment-4--new-screens-move-to-their-own-track) — separate track |

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
| **Statistics Report** | [BACKLOG.md](BACKLOG.md) **B26**, unbuilt. Needs its own `src/utils/` aggregator. Its AI-narrative layer is blocked behind an unwritten ADR. |
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

- **The mockup's new screens** — Overview, Statistics Report, the roadmap/request page, and the
  mobile layout. Separate track, see
  [Amendment 4](#amendment-4--new-screens-move-to-their-own-track).
- **D5/D6/D7** (stale role-based nav state), **D14** (formatMoney/date/name duplication), any router
  restructuring, and all Prisma/RLS/backend logic. Nothing above touches any of these.

### Critical files for implementation

- `src/styles/tokens.css` (new — the token layer everything else consumes)
- `src/main.js` (needs the new `tokens.css` import)
- `package.json` (where `reka-ui` gets declared, with the ADR-linked reason/impact note)
- `src/components/ui/Modal.vue` (new — highest-risk/highest-payoff component; wraps the new
  dependency; fixes the core of D11)
- `src/composables/useSession.js` (new — consolidates the D12 sign-out divergence)

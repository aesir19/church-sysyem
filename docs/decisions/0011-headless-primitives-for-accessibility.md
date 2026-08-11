# ADR-0011 — Reka UI supplies interaction logic; everything else stays hand-rolled

**Status:** Accepted · **Date:** 2026-08-11 · **Implemented by:** the redesign's Phase 0 (`docs/REDESIGN.md` §0.2)

## Context

The application has **no modal focus trap anywhere**. There are four hand-rolled modal
implementations — in `DashboardView`, `MinistrySmallGroupView` (three of them), `CollectionsInputView`
and `AttendanceView` — and they have already drifted apart from one another. Keyboard users can tab
out of an open dialog into the page behind it; Escape and return-focus behave differently depending
on which view you happen to be in. This is the accessibility defect the redesign has to close, and
`lighthouserc.json` is a hard-fail gate that will eventually be raised to 0.9 against it.

The redesign adds two more dialogs on top of those four: a shared `ui/Modal.vue`, and the church
switcher becoming a real dialog rather than a native `<select>`. Writing a fifth and sixth focus
trap by hand is the alternative this record rejects.

[ADR-0009](0009-vetted-runtime-dependency-candidates.md) pre-vets three runtime dependencies so
their sizing does not get re-derived. **Reka UI is not one of them**, so by that record's own terms
this proposal "starts from scratch under the CLAUDE.md rule": a stated reason, and a free-tier
impact note.

One naming correction, because it wastes time otherwise: **Radix Vue was renamed to Reka UI in
2024.** `radix-vue` is a maintenance-mode alias pointing at the same maintainer's successor
package. They are one library under two names. Install `reka-ui`.

## Decision

**Adopt `reka-ui` for interaction logic only — concretely, `Dialog` and optionally `Toast` — and
hand-roll everything else against the project's own tokens.**

What it is used for:

| Need | Primitive | Why the library rather than by hand |
|---|---|---|
| Modal focus trap, Escape, return-focus, scroll lock, `aria-modal` | `DialogRoot` / `DialogPortal` / `DialogOverlay` / `DialogContent` / `DialogTitle` | Four divergent hand-rolled attempts already exist and none traps focus. This is tested interaction logic, not styling. |
| Toast region semantics | `ToastProvider` / `ToastRoot` / `ToastViewport` | Correct `aria-live`, pause-on-hover and swipe-to-dismiss, once the dependency is already paid for. Optional — **and declined at adoption, see below.** |

**The Toast option was taken up and declined, Phase 0.** `<ToastHost />` mounts in `App.vue`, and
`App.vue` is in the **shared entry chunk** — so anything it imports is downloaded by every visitor
to `/checkin`, not by the lazy dashboard chunks. Reka UI's Toast would have landed there. The gate
above watches `CheckinView-*.js`, which would not have moved; `index-*.js` would have, and that
ships to strictly more people. The trade is also weaker than Dialog's: a focus trap is genuinely
easy to get wrong and there were four broken attempts proving it, where a toast's semantics are an
`aria-live` region and a role. `src/components/ui/Toast.vue` is hand-rolled against the tokens and
gives up swipe-to-dismiss and pause-on-hover, carrying an explicit dismiss button instead — which
is the accessible affordance regardless. **Reka UI is therefore scoped to `Dialog` alone.**

What it is explicitly **not** used for, so this does not become the reflex answer:

- **Combobox** — `MemberAutocomplete.vue` already implements `role="combobox"`, `aria-expanded`,
  `aria-activedescendant` and full arrow/Enter/Escape/Tab handling by hand, correctly. Re-platforming
  it is optional consistency work, not a defect fix.
- **Tabs** — `FundsTabs.vue` and the Ministry tab bar are real `<router-link>`/`<button>` elements
  and are already keyboard-operable. Upgrading them adds surface for zero accessibility gain.
- **Select** — the church switcher becomes a *dialog*, not a styled listbox. Where a native
  `<select>` remains the right control, it stays native; a JS reimplementation loses on keyboard,
  screen reader and mobile.
- **Icons** — a local `src/components/ui/icons/` set. `lucide-vue-next` was considered and
  rejected: it buys convenience, where this record buys correctness.
- **Button, Card, Badge, Input, Table, Spinner** — hand-rolled against `tokens.css`. Plain elements
  need no interaction-logic library.

Full styled component kits — Vuetify, PrimeVue, Element Plus — stay rejected. They ship a design
system, and this project is in the middle of adopting its own.

## Free-tier impact note

Required by CLAUDE.md, and the part that must not be hand-waved.

**Reason:** closes the no-focus-trap defect with tested interaction logic instead of a fifth
hand-rolled implementation, and retires four divergent existing ones.

**Impact:** a client-side npm package bundled by Vite into first-party JS, served same-origin from
`/assets/` under the existing immutable long-cache rule. It touches **no** CSP directive — nothing
is fetched cross-origin — and adds **no** Supabase egress. The cost is purely incremental gzipped
bytes in whichever lazy chunks import `Modal.vue` / `ToastHost.vue`.

**The gate, which is a real number and not an estimate:** `dist/assets/CheckinView-*.js` is
**6,675 B** today. The router lazy-loads every route specifically so an attendee's phone never
downloads staff-dashboard code over church wifi at every service. **If a build after adding this
dependency shows that artifact growing, the dependency has leaked into the shared entry chunk.
That is a bug to fix before merging, not a cost to accept.**

The measured delta on the dashboard chunks is recorded at adoption, not predicted here. If it comes
in heavier than wanted, `@headlessui/vue` is the credible fallback — smaller surface, same
bring-your-own-markup philosophy, covers Dialog.

### Recorded at adoption — Phase 0, 2026-08-11

**The gate holds: `dist/assets/CheckinView-*.js` is 6,675 B before and 6,675 B after.** Byte for
byte unchanged. The dependency did not leak into a shared chunk.

**But it is not yet paid for, and that must not be misread.** `reka-ui` does not appear anywhere in
the production build after Phase 0, because nothing in a production route imports `Modal.vue` yet —
the only consumer is the `import.meta.env.DEV`-gated style-guide route, which Rollup drops
entirely. The dependency's real cost lands in **Phase 1b**, when the first existing modal call site
is migrated, and it is that build which must be diffed against these numbers. Phase 0 proves the
dependency installs, tree-shakes, and renders; it does not prove its weight.

What Phase 0 *did* add to the shared entry chunk, which every `/checkin` visitor downloads:

| Artifact | Before | After | Δ raw | Δ gzip |
|---|---|---|---|---|
| `index-*.css` (tokens.css) | 172 B | 8,051 B | +7,879 B | ≈ +1.9 KB |
| `index-*.js` (theme boot) | 442,359 B | 443,137 B | +778 B | ≈ +0.2 KB |
| `manrope-latin-*.woff2` | — | 24,836 B | new asset | n/a (already compressed) |

The font is the number worth arguing about, and Amendment 8 asked for exactly this check. It is
**24.8 KB on the critical path of the page attendees open on their phones, on church wifi, at every
service.** Three things make it acceptable rather than merely tolerated: `font-display: swap` means
it never blocks first paint, only the latin subset is declared so the other five the package ships
are never emitted, and `/assets/` is immutable-cached so it is one download per new device, ever.
If that trade is later judged wrong, the cheapest reversal is pointing `--font-sans` at the system
stack — one token, no other file.

### The dependency, paid for — Phase 1b, 2026-08-11

The first production call site landed: `MinistrySmallGroupView`'s delete-confirmation dialog, the
simplest modal in the inventory, chosen so the focus trap could be proved somewhere cheap. This is
the build the section above deferred to.

| Artifact | Before | After | Δ raw | Δ gzip |
|---|---|---|---|---|
| `CheckinView-*.js` | 6,675 B | **6,675 B** | **0** | 0 |
| `MinistrySmallGroupView-*.js` | 20,260 B | 51,429 B | +31,169 B | +9,961 B |
| `index-*.js` (shared entry) | 443,137 B | 453,913 B | +10,776 B | +4,228 B |

**The gate holds a second time, and this time it means something**: `reka-ui` is now genuinely in
the production build, and `CheckinView-*.js` is still byte-identical. The library is confined to
the one lazy chunk that imports `Modal.vue`, exactly as the router's lazy loading intends.

**≈10 KB gzip is what the Dialog costs**, on a chunk only signed-in staff on a dashboard route ever
fetch. That is the number to weigh before the second and third call sites — it does not repeat per
modal (the module is shared), so migrating the remaining six call sites in Stages 2–5 adds their
markup and nothing else.

**The entry chunk's +4.2 KB gzip is NOT this dependency.** It is `<ToastHost />` mounting in
`App.vue`, which pulls Vue's `TransitionGroup` runtime into the shared chunk — measured separately
by building with the host removed: 138,260 B gzip without it against 140,905 B with. Every
`/checkin` visitor pays it. It is the cost this ADR's "Reka UI's Toast was declined" decision was
weighing, and declining that library there is why the number is 2.6 KB rather than another 10.

## Consequences

- CLAUDE.md's opening line ("no UI kit") is narrowed to point here. It is no longer a total
  prohibition, and it was never meant to forbid a headless primitive.
- One runtime dependency for roughly one and a half components. Defensible, because hand-rolled
  focus traps are genuinely easy to get wrong and there are already four of them — but **each
  additional use of this library needs its own reason.** The table above is the boundary.
- Reka UI is authored in TypeScript and compiles to plain JS plus `.d.ts`. It is consumed from
  this project's JS-only SFCs by named import with no `tsc`/`vue-tsc` step and no `vite.config.js`
  change. This does not reopen the no-TypeScript decision.
- ADR-0009's closing caution applies transitively: if two of its three vetted candidates are later
  adopted *as well as* this one, revisit the bundle budget against the Netlify egress threshold
  rather than approving each in isolation.

## What would supersede this

Evidence that the library is unmaintained; a measured bundle delta large enough to move to
`@headlessui/vue`; or a platform baseline where `<dialog>` plus the popover API covers focus
trapping natively across the browsers this congregation actually uses — at which point the
dependency buys nothing and should be removed.

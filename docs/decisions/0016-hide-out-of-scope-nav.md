# ADR-0016 — Out-of-scope navigation is hidden, not locked

**Status:** Accepted · **Date:** 2026-08-18 · **Supersedes** the "locked, not hidden" nav handoff

## Context

The dashboard originally showed *every* navigation item to every user. An item the
caller lacked the capability for was rendered **locked** — a lock icon plus a
"Request access" screen behind it — on the reasoning that a nav which shortens itself
teaches people a feature does not exist. `AppSidebar`, `AppTabBar` and `NotYoursPanel`
all stated this rule at length.

In review the owner rejected that posture for this app: users should not be shown
navigation toward things that are not their job. A Welcome-Team member has no reason to
see Church Funds; a non-Finance user has no reason to see Collections or Expenses.
Showing locked entries was judged to *add* cognitive load, not remove confusion — the
opposite of the original justification's premise.

## Decision

Navigation items outside the caller's scope are **hidden entirely**, per role, with no
lock affordance and no "Request access" prompt. Discoverability is explicitly not a
goal — the owner does not want the dashboard to overwhelm users with what is not theirs.

- `AppSidebar` and `AppTabBar` **filter** their item lists on the same
  `requiresCapability`-style `needs` key they previously used to mark items locked.
- The mobile "More" drawer reuses `AppSidebar`, so it is filtered by the same rule; the
  phone never surfaces an out-of-scope destination either.
- The lock-icon treatment and its CSS are removed from both nav components.
- Route guards still redirect a capability-failing deep link to `/dashboard/members`
  (`router/index.js`), so hiding the entry is not the only line of defence.
- `NotYoursPanel` remains, but only as a deep-link backstop for the settings pages
  (reached via the gear, which is itself hidden for anyone who cannot open it), not as a
  nav state.

## Consequences

- Each role sees a nav containing only what it can act on. The per-role matrix is a
  function of the capability map in `src/utils/capabilities.js`.
- There is no in-app path to discover or request a capability you lack; granting access
  is an administrator action (role/ministry assignment), out of band by design.
- This is UI-gating only. RLS remains the enforcement boundary
  ([ADR-0001](0001-rls-is-the-only-authz.md)); a hidden item is a convenience, not a
  security control.

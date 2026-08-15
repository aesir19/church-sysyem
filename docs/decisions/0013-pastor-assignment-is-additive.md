# ADR-0013 — Pastor assignment is additive, with no handover

**Status:** Accepted · **Date:** 2026-08-14 · **Migration:** `0022_admin_access` · Screen: Pastor assignment (mockup 4b)

## Context

The mockup (4b) assumes each church has exactly one pastor and models every change as a
handover: pick a successor, choose where the outgoing pastor lands, confirm. Our model
disagrees — a church may have several pastors, and a pastor's church comes from their
member record, not from the role.

## Decision

Assignment is additive and removal is its own action. There is no successor and no "where
does the outgoing pastor go" step: removing a pastor drops them to `member` and never
touches the church roll. A church row lists the pastors it has, or says it has none.

## Consequences

- The mockup's step 2 disappears; "handover history" has no table and is drawn as `Soon`.
- A Head Pastor can drive this screen without seeing PII: candidates come from
  `list_church_accounts()` (names + roles, no e-mail), not `list_accounts()`. See
  [ADR-0015](0015-names-only-directory-without-pii.md) for the names-without-PII pattern.
- What was kept from 4b is purely visual (the compact rows, the dashed inset panel, the
  radio candidate list) — see `src/views/settings/PastorAssignmentView.vue`.

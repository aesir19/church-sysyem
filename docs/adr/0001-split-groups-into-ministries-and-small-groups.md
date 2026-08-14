# ADR-0001 — Groups are two things: ministries and small groups

Status: accepted · Migration: `0026_split_groups`

## Context

Originally one `groups` table carried both church-spanning teams (Worship, Finance) and
per-church gatherings. The two behave differently — a ministry's membership is global, a
small group belongs to one church — and forcing them through one table meant every query
re-encoded "which kind is this" with a discriminator column, and got the church-scoping
wrong when it forgot to.

## Decision

Split into `ministries` and `small_groups`, with membership in `ministry_members` and
`small_group_members`. There is no `groups` table. The mapping from the "group" vocabulary
to the concrete tables lives in one place: `src/lib/data/groups.js`.

## Consequences

- A group id alone does not say which table it lives in; code probes/resolves the type
  first (see `fetchGroup` in `src/lib/data/group.js`).
- A ministry roster must still be church-scoped for display even though its membership is
  global — the scoping is the caller's job, documented in `group.js`.
- Rollback exists (`0026_split_groups/rollback.sql`) but is lossy; treat the split as
  one-way in practice.

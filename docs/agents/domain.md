# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

This is a **single-context** repo — one `CONTEXT.md` at the root, one ADR directory.

## Before exploring, read these

- **[`CONTEXT.md`](../../CONTEXT.md)** at the repo root — the glossary / ubiquitous language.
  Created 2026-08-11. Defines Church, Active church, Member, Member record, Directory, Archive,
  Blocked write, Capability, Service, Check-in, Guest — and the distinctions between them that the
  code depends on.
- **[`docs/decisions/`](../decisions/)** — this repo's ADR directory. Note the path: decisions live
  in `docs/decisions/`, **not** `docs/adr/`. Read the records that touch the area you're about to
  work in; [docs/decisions/README.md](../decisions/README.md) is the index.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest
creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and
`/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

Beyond the domain docs, [CLAUDE.md](../../CLAUDE.md) is the binding rulebook, and its
_"Where things are written down"_ table routes to the rest — architecture, security, defects,
backlog, operations. Read those when the task touches them, not up front.

## File structure

```
/
├── CONTEXT.md                  ← glossary
├── CLAUDE.md                   ← binding rules + doc map
├── docs/
│   ├── decisions/              ← ADRs 0001–0010, plus README index
│   ├── ARCHITECTURE.md
│   ├── SECURITY.md
│   ├── DEFECTS.md
│   ├── BACKLOG.md
│   └── OPERATIONS.md
└── src/
```

If this repo ever splits into multiple bounded contexts, the layout becomes a root `CONTEXT-MAP.md`
pointing at one `CONTEXT.md` per context, with context-scoped decisions under
`src/<context>/docs/decisions/`. It is not there today.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0001 (RLS is the only authz) — but worth reopening because…_

Per [docs/decisions/README.md](../decisions/README.md), a reversal is a **new numbered record** that
marks the old one `Superseded by NNNN` — never an edit to the existing record.

## New ADRs

Writing one is the `software-architecture` skill's job, and that skill is **invoked explicitly by
name** — see the _Review and design tooling_ section of [CLAUDE.md](../../CLAUDE.md). Don't reach
for it just because a task touches system design.

# ADR-0002 — RLS is the enforcement; capabilities only gate the UI

Status: accepted · Migrations: `0014_rbac_predicates`–`0017`, extended by `0022`

## Context

The app is on the public internet and stores member PII. Authorization has to be enforced
where it cannot be bypassed — not in the browser, which a determined user controls. But the
UI also needs to know what to show, so *some* representation of the rules has to exist
client-side.

## Decision

Postgres Row-Level Security is the single enforcement boundary. `src/utils/capabilities.js`
holds a **mirror** of the RLS composites, used only to decide which controls to render. The
mirror is derived from `get_my_permissions()` and must not drift from the SQL; when they
disagree, the SQL is right.

## Consequences

- A false capability hides a control. It is never a security guarantee — the same action
  attempted anyway is refused by RLS.
- Because refusal happens by *filtering* (RLS returns no rows rather than an error), "no
  rows" and "not permitted" can look identical. The data layer reports `permitted`
  separately so screens can tell them apart; see `src/lib/data/admin.js`.
- Capability gates must be defined once in `capabilities.js`, not re-derived from raw role
  flags in views — re-derivation is how the mirror silently cracks. (This is the drift that
  issue #77 exists to close.)
- Fail closed: if a feature can't be gated safely for free, it isn't shipped.

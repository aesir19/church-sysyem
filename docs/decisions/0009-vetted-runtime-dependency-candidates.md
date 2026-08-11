# ADR-0009 — Three runtime dependencies are vetted but unjustified

**Status:** Accepted — standing evaluation, revisit per candidate

## Context

[CLAUDE.md](../../CLAUDE.md) forbids adding a runtime dependency "without a stated reason and a
free-tier impact note," because every one ships to every user on every uncached visit. That rule
works, but it has a failure mode: the same three libraries keep getting proposed, evaluated from
scratch, and rejected — and the evaluation is thrown away each time.

This record exists so the argument is made once. It is not an approval.

## Decision

Three candidates are **vetted and named, and none is justified today**. Adopting any one still
requires a stated reason at the time — but the sizing work below does not need redoing.

| Candidate | What it would buy | Cost |
|---|---|---|
| **VueUse** | Tree-shakeable composables — debounce, storage sync, event listeners | Only imported functions ship; typically a few KB |
| **Valibot** or **Zod** | Schema validation at input/RPC boundaries, matching this codebase's existing validate-at-the-boundary convention | Valibot ~1–3 KB gzip; Zod ~10–13 KB |
| **date-fns** | General date formatting and math | Moderate; tree-shakeable per-function |

**Valibot over Zod** if that slot is ever filled — same role, roughly a fifth of the bytes, and
this project has no TypeScript to benefit from Zod's inference story.

**date-fns is only justified as the fix vehicle for the duplicated date formatting** (three
`formatMoney` copies and four date formatters — see the `defect` issues), adopted *with that
intent specifically*. Adding it ad hoc and then still hand-rolling formatters in views buys the
bytes and none of the benefit.

## Consequences

- A proposal to add one of these should cite this record and supply only what is missing: the
  reason *now*, and what it replaces. It should not re-derive the sizing.
- A proposal to add something **not** on this list starts from scratch under the CLAUDE.md rule.
- If two of the three are ever adopted, revisit whether the bundle budget still holds against the
  Netlify egress threshold rather than approving each in isolation.

## What would supersede this

Adoption of any candidate, recorded as its own ADR stating the reason and the measured bundle
delta. Or evidence that one of these is no longer maintained, which removes it from the list.

## Related

- Error monitoring was the fourth recurring candidate. It is settled:
  [ADR-0006](0006-error-sink-in-stack.md) rejected a third-party processor, and
  [ADR-0008](0008-sentry-alongside-in-stack-sink.md) adopted Sentry alongside the in-stack sink
  conditional on PII scrubbing. Do not reopen it here.
- TypeScript is a build-time dependency, not a runtime one, and is out of scope for this record.

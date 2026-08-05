# Decision records

Why the load-bearing choices were made, and what breaks if they are reversed.

These exist because the reasoning that stops someone re-breaking something has a different
lifespan from the code it describes. A route table goes stale in a week; *"do not add
`is_member_in_my_church()` to the collections INSERT policy"* stays true until someone
deliberately decides otherwise — and when they do, that becomes a new record rather than an edit
to this one.

**Read the relevant record before changing auth, RLS policies, the ledger, or the report
calculator.** A change that contradicts one of these is not necessarily wrong, but it needs to
supersede the record explicitly.

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-rls-is-the-only-authz.md) | Postgres RLS is the only authorization boundary | Accepted |
| [0002](0002-no-second-compute-vendor.md) | No second compute vendor; Supabase Edge Functions are the only escape hatch | Accepted |
| [0003](0003-nullable-collections-from.md) | `collections.from IS NULL` means anonymous | Accepted |
| [0004](0004-view-aggregates-but-does-not-allocate.md) | The SQL view aggregates; only the JS calculator allocates | Accepted |
| [0005](0005-jwt-in-localstorage-accepted.md) | The JWT stays in `localStorage`; `HttpOnly` cookies rejected | Accepted (residual risk) |
| [0006](0006-error-sink-in-stack.md) | Error monitoring is an in-stack table, not a third-party processor | Accepted |

## Format

Keep them short. Context (the forces), Decision (what was chosen), Consequences (what this
commits us to, including the annoying parts). If a decision is reversed, add a new numbered
record and mark the old one `Superseded by NNNN` — do not delete it.

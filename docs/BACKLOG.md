# Backlog

**Deferred features live in the [issue tracker](https://github.com/aesir19/church-sysyem/issues?q=is%3Aissue+is%3Aopen+label%3Afeature), not here.**

Everything there is **absent, not broken** — for things that are *wrong*, see the
[`defect`](https://github.com/aesir19/church-sysyem/issues?q=is%3Aissue+is%3Aopen+label%3Adefect)
label. Old `B*` ids are preserved in the issue titles.

Migrated 2026-08-11. This file was two different documents wearing one name: a list of features
someone should build, and a set of constraints explaining why certain obvious-looking changes are
wrong. Only the first belongs in a tracker.

---

## The reasoning became decision records

Three entries were never really backlog items. They were arguments, and arguments belong where
someone will look before re-making the decision:

| Was | Now | Why it moved |
|---|---|---|
| `B27` — vetted dependency candidates | [ADR-0009](decisions/0009-vetted-runtime-dependency-candidates.md) | The same three libraries kept being evaluated from scratch and rejected. The evaluation is now made once. |
| `B26` — AI integration | [ADR-0010](decisions/0010-ai-features-need-an-edge-function.md) | ~100 lines on why an API key must never reach the browser, and what a superseding record must pin. That is a decision, not a ticket. |
| `B17`'s policy warning | [ADR-0003](decisions/0003-nullable-collections-from.md) | Already recorded there. The backlog was duplicating it — the *feature* is now an issue, the *rule* stays in the ADR. |

The rule that follows: **if an entry explains why not to do something, it is an ADR.** A tracker
item is work someone can pick up. A constraint is something someone must read before picking up
unrelated work — and nobody reads a backlog for that.

## Two entries were already shipped

- **`B8` — multi-church admin.** Shipped. `isCrossChurch` (SuperAdmin / Head Pastor),
  the `list_churches` RPC, and the church selector in `useActiveChurch`. Not migrated.
- **`B20` — attendance records.** Half shipped in `0013_attendance_and_checkin`. The open half —
  correlating the report's weeks with `services` rather than transaction dates — is an issue.

## Where the rest went

- Things that are *wrong* → [`defect`](https://github.com/aesir19/church-sysyem/issues?q=is%3Aissue+is%3Aopen+label%3Adefect) issues, and [DEFECTS.md](DEFECTS.md) for why that list rotted
- Things needed to *operate* the system → [OPERATIONS.md](OPERATIONS.md)
- *Why* a load-bearing choice was made → [decisions/](decisions/)

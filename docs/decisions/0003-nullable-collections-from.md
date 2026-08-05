# ADR-0003 — `collections.from IS NULL` means anonymous

**Status:** Accepted · **Date:** 2026-08-03 · **Implemented by:** `0011_collections_anonymous_from`

## Context

The Collections form had offered an "Anonymous" option since it was written, and **every attempt
had failed.** `handleSubmit()` omitted `from` from the insert payload on that path, but
`collections.from` was `NOT NULL DEFAULT gen_random_uuid()` — so Postgres minted a random UUID
and the foreign key rejected it. Verified against production inside a rolled-back transaction:

```
23503: insert or update on table "collections" violates foreign key constraint "collections_from_fkey"
```

The actual request was broader than "let anonymous work": staff needed **multiple anonymous givers
per service**, each with their own amount, so that the count of anonymous givers and the spread of
their amounts both survive into the monthly report.

Three designs were available:

1. **Nullable `from`** — drop the default, allow `NULL`, treat `NULL` as anonymous.
2. **A sentinel "Anonymous" member row per church** — pollutes member counts and pickers, and
   collides with the `0010` archived-member filters that every member read now applies.
3. **A separate `anonymous_collections` table** — duplicates the amount/date/church/edit-window
   logic and forces every report query to union two shapes.

## Decision

**Nullable `from`. `from IS NULL` means anonymous.**

Each anonymous gift stays its own row, so multiple anonymous givers per service works *by
construction* rather than by a counting column — which was the actual request. Options 2 and 3
both require extra machinery to reach the same place.

## Consequences

**Three states must not collapse into two.** Reads joining `members` through `collections.from`
have to distinguish:

| State | Means | Renders as |
|---|---|---|
| `from IS NULL` | Deliberately anonymous | "Anonymous" |
| `from` set, member readable | A known giver | Their name |
| `from` set, member embed empty | Referential or RLS failure | "Unknown" |

Use `contributorLabel()` in
[collectionPayload.js](../../src/utils/collectionPayload.js) rather than re-deriving this. The
third state is not cosmetic — collapsing it into "Anonymous" would hide a data problem behind a
legitimate-looking label.

**`buildCollectionPayload()` always sends `from` explicitly** rather than omitting it. Omission is
what caused the original bug; an explicit `null` is unambiguous.

**`onDelete` on the `from` relation stays `Cascade`.** `SetNull` would silently reclassify a
deleted member's gifts as anonymous — turning an audit record into a false one.

**The report deliberately does not aggregate anonymous rows together.** `aggregateContributors()`
in [collectivesReport.js](../../src/utils/collectivesReport.js) folds named givers into one line
each but keys anonymous gifts on the collection row id, so each stays its own row. Collapsing them
by their shared "Anonymous" label would discard exactly the giver count and amount spread this
design exists to preserve.

**The INSERT policy stays permissive about the contributor's church.**
`collections_insert_own_church` scopes on `from_church` and says nothing about `from`. Adding
`("from" IS NULL OR public.is_member_in_my_church("from"))` looks like obvious hardening — it is
the pattern `0004` uses for `group_members` — but visiting members give at other churches'
services, and that check would reject the case. See [BACKLOG.md](../BACKLOG.md) B17, which is the
open design for recording visitors by name; resolve it before tightening this policy.

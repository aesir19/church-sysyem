# ADR-0017 — The directory carries ministry-operational fields; leaders record two journey steps

**Status:** Accepted · **Date:** 2026-08-18 · **Migration:** `0028_directory_journey_access` · **Amends** [ADR-0015](0015-names-only-directory-without-pii.md)

## Context

[ADR-0015](0015-names-only-directory-without-pii.md) gave non-detail roles a
names-and-groups directory with "no birthdate, contact, or **journey**." In practice that
line was drawn too tight for how the church works, confirmed with the owner:

- A Welcome-Team member recording attendance saw member attendees as **"Unknown"** on the
  roster, because that view read member names through an RLS-blanked `members(...)` embed.
- Non-detail roles (Welcome, Finance, small-group leaders, a Head Pastor) could not see a
  member's **gender**, **middle name**, or **discipleship journey** — the operational
  facts those roles actually work from.

The owner ruled that name, gender, group membership and the four journey milestones
(one-to-one, turning point, baptism, membership certification) are **ministry-operational,
not the PII that rule 2 of `CLAUDE.md` protects** (birthdate, address, contact, marital
status). Baptismal status travels with the journey under that same ruling — an explicit,
recorded relaxation of treating "baptismal status" as protected PII.

Two guard-rails came with it:

1. A brand-new **scopeless** account (plain `member`/`unassigned`, no ministry, leads no
   group) should *not* be able to browse the congregation — the one place "show everyone"
   met fail-closed, and the owner chose to close it.
2. Small-group **leaders** should be able to record the **one-to-one** and **turning-point**
   milestones (only) for members of the groups they lead. Baptism and certification stay a
   Secretariat/SuperAdmin write.

## Decision

- `directory_search()` (migration `0028`) is widened to return `middle_name`, `gender`
  and the four journey booleans, alongside the existing names and group arrays. It still
  returns **no** birthdate, address, contact, email, marital status, anniversary or
  facebook — those remain on the base `members` table behind `can_see_member_detail()`
  ([0015](0015-names-only-directory-without-pii.md)), which is unchanged.
- Directory access is gated by a new `has_directory_access()` predicate (any assigned
  role or ministry). A scopeless account gets **zero rows**; the Members page renders it a
  "no access yet" state rather than the roll. The JS mirror is `canBrowseDirectory`.
- `set_member_journey(member_id, one_to_one, turning_point)` — a SECURITY DEFINER function
  — lets a small-group leader write **only** those two columns, and **only** for a member
  of a group they lead (SuperAdmin also permitted). RLS scopes rows, not columns, so a
  two-column write for a role that cannot write the table is necessarily a definer
  function, matching every other leader power. The JS mirror is `canRecordJourney`.
- The attendance roster resolves member names client-side from the directory the picker
  already loads, ending the "Unknown" rendering for callers whose `members(...)` embed is
  blanked by RLS.

## Consequences

- `canSeeMemberDetail` and Head Pastor's exclusion from it are unchanged; Head Pastor
  still goes through Secretariat for PII detail and sees the directory like everyone else.
- Journey **writes** remain narrow: Secretariat/SuperAdmin via the full member form, and
  now small-group leaders via `set_member_journey` for their own groups. No other role
  gains a write.
- The SQL capability composites and their `src/utils/capabilities.js` mirror must stay in
  sync, as always ([ADR-0001](0001-rls-is-the-only-authz.md)).

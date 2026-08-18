# ADR-0015 — A names-only directory for roles that may not see PII

**Status:** Accepted · **Date:** 2026-08-14 · **Migrations:** `0015_members_rbac`, `0022_admin_access` · Story 20 · **Amended by** [ADR-0017](0017-directory-carries-operational-fields.md)

## Context

Some roles must see *who* is in a church or a group without seeing member PII — a Head
Pastor is deliberately outside member-detail access but still needs the directory and the
pastor-assignment candidate list. A normal join to `members` returns such a caller zero
rows under RLS (`members!inner` silently drops everything), which reads as "empty group"
rather than "you may not see the records" — two very different statements.

## Decision

Names-without-PII come from SECURITY DEFINER functions that return names and group
memberships and nothing protected — no birthdate, contact, or journey:
`directory_search()` for the roster/directory, `list_church_accounts()` for the
pastor-assignment candidates. (Since [ADR-0017](0017-directory-carries-operational-fields.md)
`directory_search()` also carries gender, middle name and the journey flags — ministry-
operational fields the owner ruled are not PII — but still no birthdate/address/contact.) Reads report which projection they returned
(`detail: 'full' | 'names'`) so the screen can distinguish "nobody is here" from "you may
not see who."

## Consequences

- The names-only roster is read through `directory_search()`, not the membership join; it
  is church-scoped inside the function.
- Because ministry names are globally unique and small-group names unique per church, a
  returned row can be matched to a group by name — no group id needs to cross into the
  directory function.
- A restricted caller gets a leader marked "assigned" with no name, never a false "no
  leader." Withholding the name is correct; inventing one is the bug this prevents.

This decision is an application of [ADR-0001](0001-rls-is-the-only-authz.md): the SECURITY
DEFINER functions are the enforced boundary; the `detail` flag is only how the UI presents
what the boundary returned.

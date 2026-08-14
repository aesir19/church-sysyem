# ADR-0004 — Small Group Leader is derived from leadership, not a role

Status: accepted · Migrations: `0022_admin_access`, `0027_leader_candidates`

## Context

A small group's leader has slightly wider sight (their group's attendance) than a plain
member. The obvious modelling — a `small_group_leader` role on the account — would collide
with the account's actual role (usually `member`) and force a choice between the two.

## Decision

"Small Group Leader" is not a role. It is derived from leading at least one small group,
recorded in `small_group_leaders` (keyed to the **account**, because the powers follow the
sign-in). The account's `role` is unchanged. `capabilities.js` surfaces
`isSmallGroupLeader` from `get_my_permissions()`, computed from the leadership table.

## Consequences

- Anything that authorizes on the role string alone will miss leaders. Gate on the
  capability, not the role.
- A leader is stored account-side while a roster is member-side; matching one to the other
  needs a deliberate resolution step (`get_small_group_leader`, `0027`), which is why the
  group page can mark a roster row as the leader at all.
- The candidate list for leadership is the group's own roster (a leader must already be a
  member of the group) intersected with having an account — see
  `list_small_group_leader_candidates` (`0027`).

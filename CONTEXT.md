# Context

Orientation, not law. This file names the domain and **points at where each truth
actually lives in the code** — it does not restate the truth here, because a copy is a
thing that can disagree with the original.

Read it like this:

- **A name or a concept?** It belongs here — those don't drift.
- **A rule, a value, a permission, a token?** It belongs in the code this file points to.
  If you catch this document *declaring* one (a colour, a font, who-can-do-what), that
  line is a bug: replace it with a pointer.

The test for anything added here: *could this line contradict the code?* If yes, it's a
rule — move it into the code and link to it. If no, it's a name — it's safe.

---

## Where the sources of truth live

| Question | The answer lives in | Not here because |
| --- | --- | --- |
| Who may see or do what (enforcement) | Postgres RLS — `prisma/migrations/0014`–`0017`, extended by `0022`, `0026`, `0027` | RLS is the *enforcement*; prose can only drift from it |
| Who may see or do what (UI gating) | `src/utils/capabilities.js` (`deriveCapabilities`) | It mirrors the SQL; two copies of the mirror is worse than one |
| The shape of the data | `prisma/schema.prisma` + the migrations | Generated/authoritative; describing columns here dates instantly |
| How a screen reads/writes data | `src/lib/data/*` | The data modules are the seam; call sites and this doc both defer to them |
| Colours, spacing, radii, shadows, type scale | `src/styles/tokens.css` | Design tokens are values — the one place they're defined |
| The typeface | `src/main.js` (imports the face) + `--font-sans` in `tokens.css` | A font name written twice is a font that eventually loads wrong |
| Global reset / cascade order | `src/style.css`, imported after tokens in `src/main.js` | — |

If you need a rule, follow the pointer. Don't quote the destination back into this file.

---

## Domain glossary

Concepts and the words we use for them. Each entry says what the thing *is* and where it
is *defined* — never what it's *allowed to do* (that's RLS/capabilities).

- **Church** — a congregation. Members belong to one; some roles act across all of them.
  See the church-scoping in `0004` and the active-church selector,
  `src/composables/useActiveChurch.js`.

- **Member** — a person on a church roll, with PII (name, birthdate, contact, journey).
  Table: `members`. A member is not a login.

- **Account** — a sign-in (`user_accounts`, `0022`). Grants nothing until it is linked to
  a member and given a role. An *unlinked* account is the normal state of every fresh
  sign-up, not an error. Linking happens on the Roles & account-linking screen.

- **Role** — what an account may do, as a single string on the account. The set of roles
  and their powers are defined in the RBAC migrations (`0014`+) and mirrored for the UI in
  `capabilities.js`. Ask that file what a role means; don't infer it from the name.

- **Small Group Leader** — **not a role.** It comes from leading at least one small group
  (`small_group_leaders`, `0022`); a leader's `role` stays whatever it was. Anything that
  keys on the role string alone will miss it. See `docs/decisions/0014`.

- **Group** — an umbrella word only. There is no `groups` table since `0026`. A group is
  one of two distinct things:
  - **Ministry** — church-spanning (a person's Worship Team membership is global).
    Tables: `ministries`, membership in `ministry_members`.
  - **Small Group** — belongs to one church. Tables: `small_groups`,
    membership in `small_group_members`.
  The two are mapped from vocabulary in `src/lib/data/groups.js`
  (`GROUP_TABLES`, `MEMBERSHIP_TABLES`, `MEMBERSHIP_PARENT_KEY`). Which table a group uses
  depends on its type — an id alone does not tell you which.

- **Pastor / Head Pastor** — pastoral roles. A pastor is a member of the church they
  pastor, so the church follows from their member record, and a church may have more than
  one. Assignment is additive (no handover) — see `docs/decisions/0013`.

- **Journey** — a member's discipleship milestones (baptised, one-to-one, turning point).
  Flags on `members`; aggregated for a group in `src/lib/data/group.js` (`journeyFor`).

- **Directory** — names-and-groups without PII, readable by roles that may *not* see
  member detail (e.g. Head Pastor). Backed by `directory_search()` (SECURITY DEFINER).
  This is why a roster can show *who* is in a group without exposing their records.
  See `docs/decisions/0015`.

---

## Conventions worth knowing (pointers, not rules)

- **The `Result` envelope.** Every `src/lib/data/*` function returns a consistent result
  object rather than throwing — `ok`, `message`, `permitted`, `cause`, and a payload. Read
  the header of `src/lib/data/admin.js`; it is the fullest statement of the convention and
  of *why* "no rows" and "not permitted" must be reported as different things.

- **Reads vs writes go through the data module, not the view.** A view orchestrates and
  presents; the schema knowledge (which table, which key, how RLS answers a refusal) lives
  in `src/lib/data/*`. When a write's rule leaks into a `.vue`, that's the drift to fix.

- **Capabilities gate the UI; RLS enforces.** A capability being false hides a control; it
  is not a security boundary. The database is. See `docs/decisions/0001`.

- **`Soon` marks a drawn-but-dataless surface.** `src/components/ui/Soon.vue`. Some mockup
  elements (meetings, audit log, match confidence) have no table behind them and are shown
  as *coming* rather than faked. Don't wire one up without the table it needs first.

---

## Decisions

Load-bearing choices and their *why* live in `docs/decisions/`. Read them before
re-proposing something the project already weighed — that's what they're for. The
admin-access work added `0012`–`0015` (group split, additive pastor assignment, Small
Group Leader as derived, names-only directory).

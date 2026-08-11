# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues in [`aesir19/church-sysyem`](https://github.com/aesir19/church-sysyem). Use the `gh` CLI for all operations.

> **Authenticated** as `aesir19` (scopes: `gist`, `read:org`, `repo`, `workflow`), ADMIN on the
> repo, issues enabled.
>
> **If a shell reports `gh: command not found`**, that shell's PATH predates the install rather
> than the binary being absent. Restart VS Code (the extension host inherits its parent's
> environment, so reopening only the integrated terminal is not always enough). To unblock the
> current session without restarting, prefix the call:
> `$env:Path = "C:\Program Files\GitHub CLI;$env:Path"` — PowerShell tool calls do not share
> shell state, so this must be repeated per invocation, or the full path used directly.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v` — `gh` does this automatically when run inside a clone.

## This repo is PUBLIC — issues are world-readable

`aesir19/church-sysyem` is a public repository, so every issue title, body, comment, and attachment
is visible to anyone on the internet and indexed by search engines. Deleting a comment does not
reliably un-publish it.

Per priority 2 in [CLAUDE.md](../../CLAUDE.md), this app stores member PII — names, birthdates,
addresses, contact details, baptismal status. **Never paste real member data into an issue.** When
a defect report needs a reproduction, use fabricated names and dates, or reference a row by id
alone. The same applies to Supabase keys, JWTs, connection strings, and `.env*` contents — treat a
paste into an issue as a publication.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments` then keep only `authorAssociation` of `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, or `NONE` (drop `OWNER`/`MEMBER`/`COLLABORATOR`).
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either — resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Relationship to the in-repo registers

Defects (`D*`) and deferred features (`B*`) **were migrated into this tracker on 2026-08-11**. The
old ids are preserved in the issue titles (`D1 — …`, `B17 — …`) so older commits and ADRs still
resolve. [DEFECTS.md](../DEFECTS.md) and [BACKLOG.md](../BACKLOG.md) are now pointers.

Two registers stay in-repo, deliberately:

- [docs/OPERATIONS.md](../OPERATIONS.md) `O1`–`O26` — a **runbook**, not a queue. You read it
  during an incident, in order, offline if need be.
- [docs/SECURITY.md](../SECURITY.md) — open findings with threat-model context. This repo is
  public; a filed, labelled, searchable list of its own weaknesses is a disclosure document.

When an issue relates to one of those, cross-reference the id (`O5`, `§3.16`) rather than
restating it.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (`gh api` on the sub-issues endpoint). Where sub-issues aren't enabled, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: GitHub's **native issue dependencies** — the canonical, UI-visible representation. Add an edge with `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). GitHub reports `issue_dependencies_summary.blocked_by` (open blockers only — the live gate). Where dependencies aren't available, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children (`gh issue list --state open`, scoped to the map's sub-issues / task list), drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the `Blocked by` line) or an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me` — the session's first write.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far.

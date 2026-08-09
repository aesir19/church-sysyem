# UDFC Church Dashboard — working rules

A Vue 3 SPA (Vite, no TypeScript, no state library, no UI kit) served as static files from
Netlify, talking directly to Supabase — Postgres + Auth + PostgREST. There is no application
server. Business logic lives in the SPA; **authorization lives entirely in Postgres RLS.**
Prisma is schema/migration tooling only and never runs in the browser.

This file is the rulebook. It is binding. Reference material lives in `docs/` — see
[Where things are written down](#where-things-are-written-down) at the bottom and read those
files when the task actually touches them.

---

## Priority order

Evaluate every decision against this order, in order:

1. **Cost — keep operating cost at $0/month indefinitely.** Binding. Any change that risks
   pushing the project off a free tier needs an explicit owner decision *before* work begins.
2. **Security — a close second.** The app is on the public internet and stores member PII
   (names, birthdates, addresses, contact details, baptismal status). Apply security controls
   unless they conflict with priority 1; when they do, prefer the free controls in
   [SECURITY.md](docs/SECURITY.md) and document what was deferred and why. Default posture is
   **fail closed** — if a feature can't be made safe for free, it isn't built.
3. Everything else — DX, polish, extra features.

---

## Never

- **Never use the `service_role` key in the frontend.** The RLS-only model is what makes a
  public anon key safe. Bypassing policies in shipped code forces a paid hosting tier and
  discards every policy in `0004`–`0012`.
- **Never add a second compute vendor** — no Netlify Functions, no Render/Fly/Railway service,
  no separate API server. All logic stays in the SPA + Postgres. The one sanctioned escape
  hatch, if server-side code ever becomes genuinely necessary, is a Supabase Edge Function.
  See [ADR-0002](docs/decisions/0002-no-second-compute-vendor.md).
- **Never replicate authorization in the frontend.** If a user shouldn't see a row, the *policy*
  must reject it. UI gating is presentation, never enforcement.
- **Never `select('*')` on `members`.** Enumerate columns. Reuse the shared `MEMBER_COLUMNS`
  constant.
- **Never add realtime subscriptions** unless explicitly requested. The static-snapshot model
  is intentional; websockets burn egress continuously.
- **Never edit or re-run a deployed migration.** In particular `0006_baseline_rls` is a record
  of state that was already live and **must not be executed** — it is registered via
  `prisma migrate resolve --applied`.
- **Never add a runtime dependency** without a stated reason and a free-tier impact note. Every
  one ships to every user on every uncached visit.
- **Never add a synthetic keep-alive cron** to dodge Supabase auto-pause. Budget spend for no
  real-user benefit, and it risks tripping abuse policies.

## Always

- **Every read of `members` must add `.is('archived_at', null)`.** The SELECT policy
  deliberately returns archived rows — filtering them is the *application's* job. A read that
  forgets shows archived people in lists and pickers. See
  [ADR-0001](docs/decisions/0001-rls-is-the-only-authz.md).
- **Every new database view over an RLS-protected table must declare `security_invoker = on`.**
  Views run as their owner by default, which silently bypasses the base tables' policies and
  leaks across churches.
- **Every new authenticated route needs `meta: { requiresAuth: true }`** in
  [src/router/index.js](src/router/index.js).
- **Every schema change goes through Prisma** (`prisma/schema.prisma` + `prisma/migrations/`),
  and **the migration deploys before the SPA release that depends on it.** Nothing enforces
  this ordering; the failure mode is a live column-not-found error.
- **Every Supabase call uses the shared client** imported from
  [src/lib/supabase.js](src/lib/supabase.js). Do not construct a second one.
- **Every code or schema change gets a `code-reviewer` pass before it is called done.** Dispatch
  the `code-reviewer` agent (or run `/code-review`) on the working diff and resolve CRITICAL and
  HIGH findings before merge — those are blocking. This is in addition to `/security-review` for
  any change to policies, grants, helper functions, or views. See [Review and design tooling](#review-and-design-tooling).

## Review and design tooling

Two project tools formalize how review and load-bearing design happen here. Both live under
`.claude/` and load on session start (reload after adding or editing them).

- **`code-reviewer` agent** ([.claude/agents/code-reviewer.md](.claude/agents/code-reviewer.md)) —
  a read-only reviewer, dispatched after writing or modifying code per the Always rule above. It
  reads this file for project conventions. Its generic React/Node checklist items do not all apply
  (this is Vue 3 + Supabase, **no TypeScript**, no state library) — but its security, data-policy,
  cost-awareness, and correctness checks do. It never substitutes for `/security-review` on
  RLS/grant/function/view changes, nor for the isolation matrix in
  [docs/security/VERIFICATION.md](docs/security/VERIFICATION.md).
- **`software-architecture` skill** ([.claude/skills/software-architecture/SKILL.md](.claude/skills/software-architecture/SKILL.md)) —
  a "what's hard to change?" lens for **load-bearing** decisions (the data model, the auth/RLS
  model, service boundaries, an API's public shape). It is **invoked explicitly** — reach for it
  by name when scoping a new subsystem, reviewing a design, or writing an ADR under
  [docs/decisions/](docs/decisions/). It is *not* triggered automatically just because a task
  touches system design.

## Code conventions

- Vue 3 Composition API with `<script setup>`. No Options API.
- `<style scoped>` per SFC; only truly global rules go in [src/style.css](src/style.css).
- Palette: primary `#1a56db`, slate neutrals (`#f8fafc`, `#e2e8f0`, `#1e293b`, `#64748b`),
  error `#dc2626`. Cards use a `12px` radius.
- Surface Supabase failures as `error.message` to the user — the existing pattern. Avoid throwing.
- New behaviour needs a test. Pure logic belongs in `src/utils/` where it can be tested without
  mounting a view; that separation is the point, not a style preference.

## Efficiency rules

These follow from priority 1 and are binding unless the owner overrides them.

1. **Select only what you render.** List views select the columns the table shows; full rows are
   fetched by id only when a modal opens.
2. **One round-trip per intent.** Prefer a single RPC or PostgREST query over chained awaits.
   Never serialize what can be parallel.
3. **Cache church identity for the session.** `churchId` / `churchName` change essentially never
   — resolve once, reuse. Do not re-query per navigation.
4. **No Supabase Storage** without a written sizing plan first.
5. **Long-cache hashed assets.** Vite emits content-hashed filenames; `/assets/*` is
   `immutable`, `index.html` is `no-cache`. Already configured in
   [netlify.toml](netlify.toml) — don't regress it.

## Thresholds that force a change

| Signal | Threshold | Required response |
|---|---|---|
| Active members in one church | 300 | Add `.range()` pagination *before* the next list feature |
| Routes registered | ≥ 3 | Convert `router/index.js` to `() => import(...)` lazy imports |
| Supabase egress | 60 % of 5 GB/mo | Audit list queries; tighten column selection |
| Netlify credits | 60 % of 300/mo | Check Usage tab (bandwidth + deploys share one pool); verify cache headers |
| Database storage | 60 % of 500 MB | Audit text column sizes; archive old data offline |

The route threshold is **already breached** — every view is eagerly imported into a single
chunk. See [DEFECTS.md](docs/DEFECTS.md) D9.

---

## Where things are written down

Read these when the task touches them. Do not read them all up front.

| File | What it answers | Read it when |
|---|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the system is wired *today* — routes, views, RLS model, data flows | Changing structure, adding a route/view/table |
| [docs/decisions/](docs/decisions/) | *Why* the load-bearing choices were made, and what breaks if reversed | Before changing auth, policies, the ledger, or the report calculator |
| [docs/SECURITY.md](docs/SECURITY.md) | Threat model and **open** security findings | Touching auth, RLS, grants, headers, or data exposure |
| [docs/security/VERIFICATION.md](docs/security/VERIFICATION.md) | How to prove a control works; the two-church isolation matrix | After changing any policy, grant, helper function, or view |
| [docs/security/RESOLVED.md](docs/security/RESOLVED.md) | Closed security findings and why each fix took its shape | Before "improving" something that was already deliberately fixed |
| [docs/DEFECTS.md](docs/DEFECTS.md) | Confirmed bugs, `D1`–`D16`, with reproductions | Picking up a fix, or before "improving" something already known-broken |
| [docs/BACKLOG.md](docs/BACKLOG.md) | Deferred features, `B1`–`B25` — absent, not broken | Asked for a feature that may already be specced |
| [docs/REDESIGN.md](docs/REDESIGN.md) | The phased frontend redesign — token layer, `ui/` components, per-view sequencing, and what the mockups do *not* cover | Touching presentation on any view, or picking up a redesign stage |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Free-tier budgets, deploy/rollback, backups, monitoring gaps `O1`–`O25` | Deploying, migrating, or asked why the site is down |
| `prisma/schema.prisma` | The canonical table/column inventory | Any question about the data model — it is the source of truth, not the docs |

**Schema is never documented twice.** `prisma/schema.prisma` and `prisma/migrations/` are the
source of truth for tables, columns, policies, grants, and functions. Docs describe intent and
consequence; they do not transcribe the schema.

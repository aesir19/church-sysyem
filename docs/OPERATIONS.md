# Operations

How to run, deploy, and recover this system — and an honest register of what it still cannot do
for itself. Everything here has a **$0 path**, per priority 1 in [CLAUDE.md](../CLAUDE.md).

- Bugs in the product → [DEFECTS.md](DEFECTS.md) · Missing features → [BACKLOG.md](BACKLOG.md)
- Threat model and verification steps → [SECURITY.md](SECURITY.md)

`O`-prefixed IDs are stable; reference them in commits and PRs.

---

## 1. Free-tier budgets

Vendor-published limits. **Verify before any major change** — quotas move.

| Vendor | Resource | Limit | Risk here |
|---|---|---|---|
| Supabase | Database storage | 500 MB | Low — narrow text data; 100 K rows ≪ 500 MB |
| Supabase | Egress / month | 5 GB | **Medium** — the dominant cost as use grows |
| Supabase | Monthly active users | 50 000 | Negligible — internal staff only |
| Supabase | File storage | 1 GB | None today; re-evaluate if member photos land |
| Supabase | Free projects | 2 per org | Constrains a staging project *and* multi-tenancy — pick one |
| Supabase | **Auto-pause** | after 7 days idle | **High operationally** — see below |
| Netlify | Credits / month (Free plan) | 300 | **Medium** — one shared pool, see below |
| Netlify | Functions | — | **Unused and must stay unused** ([ADR-0002](decisions/0002-no-second-compute-vendor.md)) |

**Netlify moved to credit-based billing in September 2025** — there is no separate bandwidth or
build-minute quota anymore; build minutes aren't metered at all. Everything draws from one
300-credit/month pool, hard-capped with no auto-recharge (the site pauses when it's gone):

| Metered item | Cost |
|---|---|
| Production deploy (push to `main`) | 15 credits |
| Bandwidth | 20 credits / GB |
| Web requests | 2 credits / 10,000 |
| Compute (Functions) | 10 credits / GB-hour — n/a, Functions unused |
| Deploy previews / branch deploys | **Free** (0 credits) — PR previews from [ci.yml](../.github/workflows/ci.yml) don't touch the budget |

Deploy capacity depends on bandwidth drawn from the same pool, so there's no fixed "N deploys per
month" — check the Netlify dashboard Usage tab for actual bandwidth before assuming headroom.
Rough shape: at ~0 GB bandwidth, 300 credits ≈ 20 production deploys/month; at a few GB of
real traffic, closer to 10–16.

Thresholds that force an engineering response are in [CLAUDE.md](../CLAUDE.md).

**Auto-pause.** A church using the dashboard weekly keeps the project warm. For a longer gap
(seasonal closure), expect a one-time manual unpause from the Supabase dashboard. **Do not add a
synthetic keep-alive cron** — budget spend for no real-user benefit, and it risks tripping abuse
policies.

## 2. Deploying

Netlify builds `npm run build` and publishes `dist/`. `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` are set in the Netlify dashboard and must exist **at build time**.

**Database migrations deploy before the SPA release that depends on them.** Nothing enforces
this; the failure mode is a live column-not-found error (O16).

```bash
npm run prisma:migrate:status    # what's pending
npm run prisma:migrate:deploy    # apply
```

Every migration directory also carries a `rollback.sql`. **Prisma never executes these** — they
are operational, for pasting into the Supabase SQL editor. Keep the relevant one open in a second
tab while deploying. After running one, record it:

```bash
npx prisma migrate resolve --rolled-back 0009_narrow_grants
```

There is no staging project (O15), so behaviour-changing migrations deploy one at a time with
verification between each.

### Schema change workflow

1. Configure `.env` with `DATABASE_URL` (pooled) and `DIRECT_URL` (direct, port 5432).
2. `npm run prisma:pull` — introspect current state.
3. Edit `prisma/schema.prisma`.
4. `npm run prisma:migrate:create -- --name your_change_name`.
5. Review the generated SQL, add a `rollback.sql`, then deploy.

### Migrations with operator caveats

| Migration | Caveat |
|---|---|
| `0004_church_scoped_groups` | Must deploy before the updated Ministries screen. Preserves ministry definitions, dedupes memberships, assigns colors deterministically. **Aborts** if it finds any existing non-Ministry group — assigning those to a church automatically would risk cross-tenant exposure. If it aborts, inspect the rows and either remove them or add a reviewed backfill. |
| `0005_group_color_slots` | Deploy **after** `0004`, and before any frontend that selects `groups.color_slot`. Replaces the old eight-token `color` column with 3,240 unique integer slots. **Aborts** if the existing group count exceeds 3,240. Verify: existing groups have distinct slots; concurrent inserts get distinct slots; small-group creation works with no color field; authenticated attempts to write `color_slot` are denied. |
| `0006_baseline_rls` | **Do not run this.** It is a record of state that was already live, transcribed so future policy changes are reviewable diffs. Registered with `npx prisma migrate resolve --applied 0006_baseline_rls`. It records **known-flawed** policies unchanged — a baseline that silently improves reality is not a baseline. Those flaws are fixed by `0007`–`0009`, not by editing `0006`. |
| `0007_members_policy_split` | Fixes: hard DELETE of active members was possible, and the archive UPDATE was blocked by its own policy. **Verify:** list loads → create → edit → **archive a member** → a `DELETE` from devtools affects 0 rows. |
| `0008_funds_write_policies` | Fixes: finance authorization was browser-only; `collections` had no UPDATE/DELETE policy; the 3-hour window was advisory. **Verify:** a finance user records a collection, edits it within 3 hours, is refused outside it; a non-finance user's direct PostgREST write to `expenses` is rejected; **the reports page still loads for a non-finance user.** |
| `0009_narrow_grants` | Fixes: default `GRANT ALL` to `anon`/`authenticated` on five tables, and the `churches` cross-tenant leak. **Verify every view** — a grant that is too tight produces no build or test failure, only a runtime error on whichever page needed it. |

Re-run `scripts/sql/capture-security-state.sql` (read-only, Supabase SQL editor) afterwards and
diff against the migrations to detect drift.

---

## 3. Observability — the system cannot report on itself

| ID | Gap |
|---|---|
| O1 | **No logging abstraction.** Every failure path is `error.value = err.message`, then discarded. No `src/lib/logger.js`, no levels, no correlation id. |
| O2 | **No global Vue error handler.** `app.config.errorHandler` is unset in [main.js](../src/main.js). A render-time throw produces a white screen and no record. |
| O3 | **No `window.onerror` / `unhandledrejection` capture.** Async failures outside a `try` vanish. |
| O4 | **No error sink.** Nobody ever learns that `handleCreate` failed for three users on Sunday. The only channel is a staff member choosing to mention it. |
| O5 | **No domain audit log.** See below — the ledger needs this more than `members` does. |
| O6 | **No DB performance visibility.** `pg_stat_statements` is available free and reviewed by no one, so D2-class problems stay invisible until they become outages. |

**O4 — two free paths, and they are not equivalent.**

- *Sentry free tier* — 5k errors/month, well above this app's volume, but adds a third-party
  processor holding fragments of member PII in error payloads. That is a privacy trade-off, not
  merely a cost one.
- *In-stack, $0, no new processor* — a bounded `public.client_errors` table with `INSERT`-only
  RLS for `authenticated` and no `SELECT` grant, a row cap enforced by a trigger (keep the most
  recent ~5,000), and a scrubber reducing message bodies to a whitelist of known error codes
  before insert. Stays inside the existing Supabase footprint, adds no dependency, keeps PII in
  the one database that already holds it. **Preferred.** It also gives O21 a destination for free.

**O5 — the ledger, not the member table, is the urgent case.** [SECURITY.md](SECURITY.md) §3.7
scopes the audit-trail gap to `members`. But `collections` enforces a 3-hour edit window, permits
in-window `UPDATE` and `DELETE`, and records **no `created_by` at all** (`expenses` does). The
system cannot answer *"who changed this amount, from what, to what, and when"* for the one table
where that question is guaranteed to be asked, and [BACKLOG.md](BACKLOG.md) B15 has nothing to
build on until it can. A trigger-written, append-only `collections_history` costs one migration.
**Fix [DEFECTS.md](DEFECTS.md) D1 first**, or the history records drifting float values.

## 4. Availability — nothing detects failure

| ID | Gap |
|---|---|
| O7 | **No uptime monitoring, no health check.** Supabase auto-pauses after 7 days idle, and a church dashboard is plausibly idle for a week. The first signal that the system is down is currently a phone call on a Sunday morning. |
| O8 | **No degraded-mode UX.** Each view renders its own inline error string. There is no app-level banner and no distinction between "you are offline", "the database is paused", and "your session expired". |
| O9 | **No retry or backoff.** `supabase-js` does not retry by default. One dropped request during a Sunday count is a hard failure to a volunteer mid-entry. |
| O10 | **No offline tolerance.** Collections are entered on-site, on church wifi, on a phone. There is not even a `navigator.onLine` check before a submit that is certain to fail. |

O7's $0 fix: an external pinger (UptimeRobot / Better Stack free tiers) against the Netlify URL
*plus* a route that performs one cheap query, so a paused database registers as **down** rather
than as a white page that loads fine.

## 5. Durability — the system cannot currently be rebuilt

**This is the most serious item in this document.**

| ID | Gap |
|---|---|
| O11 | **No backup beyond platform defaults.** Free-tier Supabase provides daily backups with short retention and no PITR (confirm current terms). No `pg_dump` runs anywhere, and no restore has ever been tested. |
| O12 | **Clean-room rebuild is impossible.** See below. |
| O13 | **No seed or fixture path.** A fresh environment cannot reach a working state without hand-editing production-shaped data. This is also why O15 is hard to close. |
| O14 | **No retention or erasure policy.** Soft delete is forever; there is no hard-delete path and no documented subject-access or erasure procedure. Under the PH **Data Privacy Act (RA 10173)** the church is a personal information controller for this data, which makes retention an obligation rather than a preference. Cross-ref [SECURITY.md](SECURITY.md) §3.10. |

**O12 in detail.** Two separately-documented facts combine into something worse than either:

1. `0006_baseline_rls` is a record of live state that **must not be executed**.
2. The trigger on `auth.users` calling `handle_new_user()`, and the event trigger calling
   `rls_auto_enable()`, live outside the `public` schema and exist in **no migration**
   ([SECURITY.md](SECURITY.md) §3.13).

Therefore `prisma/migrations/` cannot reconstruct a working database, and the one migration that
describes the missing security state is by design non-runnable. Without the `auth.users` trigger,
every user signs in to an empty dashboard. If the Supabase project were lost tomorrow, recovery
would depend on a never-restore-tested backup plus institutional memory of manual dashboard
steps. **The repository is not currently a sufficient disaster-recovery artifact.**

Closing it requires: (a) an idempotent `scripts/sql/bootstrap-triggers.sql` covering the two
out-of-schema triggers, (b) a scheduled `pg_dump` to a GitHub Actions artifact, and (c) one
documented, dated restore drill.

## 6. Environments and release safety

| ID | Gap |
|---|---|
| O15 | **No staging.** RLS changes — the highest-blast-radius change type in this architecture — go straight to production with `rollback.sql` open in another tab. A second free Supabase project costs $0 (but see the 2-project cap in §1). |
| O16 | **Deploy ordering is human memory.** Migrations must land before the matching SPA release; nothing enforces it. |
| O17 | **Netlify builds are not gated on CI.** [ci.yml](../.github/workflows/ci.yml) runs `test` + `build`, but Netlify builds on push independently unless configured otherwise — verify the dashboard setting. A red build can currently ship. |
| O18 | **No version tag, changelog, or rollback runbook.** Netlify supports instant rollback to a prior deploy; nobody has written down that this is the procedure, so it will not be found under pressure. |
| O19 | **No secret rotation runbook.** No procedure or trigger condition for rotating `VITE_SUPABASE_ANON_KEY`, `DATABASE_URL`, or `DIRECT_URL`, and no statement of who holds a service-role key, if anyone. |

## 7. Supply chain and runtime abuse

| ID | Gap |
|---|---|
| O20 | **No dependency scanning.** Dependabot and `npm audit --audit-level=high` in CI are both free and one file each. Cross-ref [SECURITY.md](SECURITY.md) §3.8. |
| O21 | **CSP violations are silent.** [netlify.toml](../netlify.toml) sets a genuinely strict CSP but no `report-uri` / `report-to`, so a blocked injection attempt produces no signal. Point it at the O4 sink. |
| O22 | **No mutation throttling.** RLS authorizes but does not rate-limit. One compromised staff credential can enumerate the congregation or write unbounded ledger rows at API speed. Supabase Auth rate limits are dashboard configuration and are unreviewed. |

## 8. Engineering hygiene

| ID | Gap |
|---|---|
| O23 | **No linter or formatter.** `eslint-plugin-vue` catches a class of template bug — unused refs, missing `:key`, unresolved components, typo'd bindings — that Vitest structurally cannot, because those files are never mounted. Prettier is the natural pairing (removes formatting bikeshedding from review), and a Husky + `lint-staged` pre-commit hook makes both self-enforcing instead of advisory. All three are devDependencies — zero runtime/bundle impact. |
| O24 | **Interaction tests are impossible today.** [vitest.config.js](../vitest.config.js) sets `environment: 'node'` and `@vue/test-utils` is not installed, so nothing can click, type, or open a modal. Coverage is inverted against risk: pure date helpers are well tested; the archive flow, the modal state machine, the 3-hour lock, and finance gating have none. **Partially narrowed** — `vue/server-renderer` needs no new dependency, and [tests/views/churchFundsView.test.js](../tests/views/churchFundsView.test.js) uses it to assert a view's `setup()` runs, queries the right tables, and renders the right initial state. It caught a real crash that `npm run build` passed. Worth copying to the other views. A separate, complementary gap: none of this exercises a real browser — Playwright is the closer-to-industry-standard tool for true end-to-end coverage (real clicks, real navigation, runs against a built preview) and would run on its own free CI-minutes budget independently of whether jsdom is ever added here. |
| O25 | **No type checking.** Cross-ref [BACKLOG.md](BACKLOG.md) B7. Noted because O23/O24 partially compensate and are cheaper. |
| O26 | **No performance/accessibility budget in CI.** Nothing catches a bundle-size or accessibility regression before it ships — the D9/CLAUDE.md route-count threshold (§ thresholds table) is checked by memory, not tooling. Lighthouse CI (or the `netlify-plugin-lighthouse` build plugin) is the standard fit: dev/CI-time only, no runtime dependency, runs against Netlify preview deploys for free. Only has teeth if wired into [ci.yml](../.github/workflows/ci.yml) or the Netlify build — a manual local Lighthouse run is easy to skip. |

**O24's two traps** for anyone copying that SSR test: SSR skips `onMounted`, and Vue routes
watcher failures to `app.config.errorHandler` rather than rejecting the render — so a test that
does not collect from that handler will pass straight over a thrown exception.

The fix is `npm i -D jsdom @vue/test-utils` plus `environment: 'jsdom'`. First three tests worth
writing, in order: archive removes the row and closes the modal; an out-of-window edit surfaces
`EDIT_WINDOW_CLOSED_MESSAGE` rather than silently succeeding (the
[mutationResult.js](../src/utils/mutationResult.js) contract, currently only unit-tested in
isolation); a non-finance user does not see `FundsTabs` links.

---

## 9. Minimum viable baseline

If only a subset is done, do these — ordered by consequence-if-skipped, all $0:

1. **O12 + O11** — bootstrap script for the out-of-schema triggers, a scheduled `pg_dump`, one
   dated restore drill. Without this every other item is moot, because a bad day ends the project.
2. **O5 (ledger audit)** — `collections_history`, trigger-written. Cheapest now, impossible to
   backfill later. Do [DEFECTS.md](DEFECTS.md) D1 first.
3. **O7** — external uptime check. Turns "a volunteer noticed on Sunday" into "we knew on Thursday".
4. **O4 + O2 / O3** — the in-stack error sink plus global handlers. Ends learning about failures socially.
5. **O15** — a second free Supabase project as staging, which also gives O13 somewhere to matter.
6. **O20 + O17** — Dependabot, `npm audit` in CI, and gate the Netlify deploy on a green build.
7. **O23 + O24** — ESLint and a jsdom test environment, so the fixes above stay fixed.

None of this conflicts with priority 1. O2, O6, and O22 actively *protect* the cost line by making
budget-breaching regressions visible before they arrive as a bill.

**Security cross-reference.** Items with a security dimension are filed in
[SECURITY.md](SECURITY.md) §3.14–§3.20 with threat-model context and verification steps:
D4 → §3.14, D5/D6 → §3.15, O5 → §3.16, O21 → §3.17, O22 → §3.18, O12 → §3.19, O17/O19 → §3.20.

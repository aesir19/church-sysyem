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
| Supabase | Free projects | 2 per org | **Both now in use** — production + staging ([STAGING.md](STAGING.md)). No slot left for a third environment |
| Supabase | **Auto-pause** | after 7 days idle | **High operationally** — see below; now applies to staging too |
| Netlify | Credits / month (Free plan) | 300 | **Medium** — one shared pool, see below |
| Netlify | Functions | — | **Unused and must stay unused** ([ADR-0002](decisions/0002-no-second-compute-vendor.md)) |
| Sentry | Errors / month (Developer plan) | 5 000 | Low at current volume — but a render error in a hot loop can exhaust a month in minutes. Tracing and replay are off for this reason ([ADR-0008](decisions/0008-sentry-alongside-in-stack-sink.md)) |

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

**Bandwidth per visit grew ~41% when Sentry landed.** Measured at
[ADR-0008](decisions/0008-sentry-alongside-in-stack-sink.md): the entry chunk went from 96.59 KB
to 136.45 KB gzip. This is a **Netlify** cost, not a Supabase one — the bundle is a static asset,
so it draws on the credit pool at 20 credits/GB and never touches Supabase egress. It lands in the
entry chunk, so every visit pays it regardless of route.

**Only when the DSN is actually set, though.** Vite replaces `import.meta.env.VITE_SENTRY_DSN` with
a literal at build time, so with it unset the `if (sentryDsn)` guard in `main.js` is statically
false and Rollup tree-shakes `@sentry/vue` out of the bundle entirely — confirmed by measurement: a
DSN-less production build is 320 KB, the same as before Sentry existed. A staging or CI build
therefore carries no Sentry weight at all.

In absolute terms this is small: ~26,000 uncached loads to spend 1 GB (20 of 300 credits), and
`/assets/*` is cached `immutable`, so a returning user re-downloads only after a deploy changes the
hash. It matters more for load time on a volunteer's phone, and for the Lighthouse `performance`
gate in [ci.yml](../.github/workflows/ci.yml). If the Netlify credit threshold in
[CLAUDE.md](../CLAUDE.md) is ever breached, making the Sentry import dynamic (`await import()`
after mount) is the first lever — at the cost of missing errors thrown during initial render.

**The two project slots.** An earlier version of this table claimed the 2-project cap forced a
choice between staging and multi-tenancy. That was wrong: multi-tenancy here is single-database
RLS — a church is a **row** in `churches`, not a project ([ADR-0001](decisions/0001-rls-is-the-only-authz.md)),
and the two-church isolation matrix already runs as two rows inside one project. Adding churches
costs no project slots. The two slots are production and staging.

**Auto-pause.** A church using the dashboard weekly keeps production warm. For a longer gap
(seasonal closure), expect a one-time manual unpause from the Supabase dashboard. **Do not add a
synthetic keep-alive cron** — budget spend for no real-user benefit, and it risks tripping abuse
policies.

Staging pauses far more readily, because it is only touched while someone is actively developing
against it. Expect to unpause it manually most times you return to it after a quiet stretch, and
expect the first `npm run prisma:migrate:*` run after that to fail on connection until it is awake.
This is normal and not worth engineering around — a paused project also stops counting against the
2-project cap.

## 2. Deploying

Netlify's own git-triggered auto-deploy is **stopped** (Site configuration → Build & deploy →
Continuous deployment → Build settings → "Stopped builds") — it never builds or publishes on its
own. **"Enforce deployment methods" (same Continuous deployment section) must also be off**, or the
CLI deploy below is rejected with an unexplained `Forbidden` and nothing can reach production at
all — see [STAGING.md](STAGING.md) §3. [ci.yml](../.github/workflows/ci.yml)'s `deploy` job is the only thing that publishes,
building with `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` from GitHub Actions repository
*variables* (not secrets — the anon key is safe to publish; RLS is the actual control) and
publishing via `netlify deploy --prod` (the Netlify CLI, run through `npx`, never installed as a
project dependency — see [STAGING.md](STAGING.md) §3 for why).

**Database migrations deploy before the SPA release that depends on them — enforced by GitHub
Actions' own dependency graph, not a Netlify setting.** `deploy` has `needs: [test, lighthouse,
migrate]` in the same workflow file, so it cannot run unless the migration job actually succeeded
first (O16, O17). An earlier version of this document assumed Netlify had a dashboard toggle for
this; it doesn't — verified directly against Netlify's docs, not assumed. See
[STAGING.md](STAGING.md) §3 for the full reasoning.

### Never mark a `VITE_*` value secret in Netlify

**No Netlify environment variable on this site may have "contains secret values" set.** A value
marked secret is redacted out of the deployed files, and every `VITE_*` value is compiled into the
JavaScript bundle every visitor downloads. Marking one secret guarantees a broken site.

This cost hours to find, because all three status lights stay green: the build succeeds, the deploy
succeeds, Netlify reports **Site is live**, and the served bundle is corrupt. The only symptom is in
the browser — `Uncaught Error: Invalid supabaseUrl: Must be a valid HTTP or HTTPS URL`.

It is a direct consequence of moving the build off Netlify. While Netlify built the site, its own
build read the real values — per Netlify's docs, *"only code running on Netlify's systems can read
the original, unmasked values"* — so secret-marked variables worked fine. Once
[ci.yml](../.github/workflows/ci.yml) took over the build, Netlify stopped being the producer and
became a scanner of someone else's output: it finds strings it was told are secrets and replaces
each with 16 asterisks plus the last four characters. `https://<ref>.supabase.co` becomes
`****************e.co`. **Nothing in the repo changed to cause this and nothing in the repo can
prevent it.**

Two properties make it maximally confusing, both worth recognising directly:

- **It is invisible from the GitHub side.** Repository variables can be correct, environment-level
  overrides absent, and `scripts/ci/check-build-env.js` can pass — because at build time the values
  *are* correct. The corruption happens after the artifact leaves the runner.
- **It is invisible from the deploy side.** A CLI deploy from a laptop fails identically, because
  the redaction is attached to the site, not the deployer or the credentials.

**Diagnosis — compare byte counts, not contents.** What identified it was arithmetic. A local build
was 442,313 bytes; the deployed bundle was 442,267. The 46-byte gap is exactly the masking delta:
URL (40) + anon key (46) = 86 real characters, replaced by two 20-character masks = 40, and
86 − 40 = 46. Everything else was byte-identical. The decisive detail was that **`VITE_SENTRY_DSN`
survived untouched** — one value passing through while two are mangled cannot be explained by the
build, only by something that knows which two are special. Checking which keys Netlify holds
confirmed it:

```bash
curl -s "https://api.netlify.com/api/v1/accounts/<account-slug>/env?site_id=<site-id>" \
  -H "Authorization: Bearer $NETLIFY_AUTH_TOKEN" \
  | grep -o '"key":"[^"]*"\|"is_secret":[a-z]*'
```

**Fix:** delete `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from Netlify entirely. With builds
stopped they are dead configuration — GitHub Actions supplies these values now. Unchecking "contains
secret values" also works but leaves a variable that does nothing except wait to be re-marked.

The conceptual rule underneath: **a value that must ship in a browser bundle cannot be a secret.**
The anon key is public by design and RLS is the access control
([ADR-0001](decisions/0001-rls-is-the-only-authz.md)). The key that must never appear in the
frontend is `service_role`, which has no business in any build environment in the first place.

The manual commands remain, for recovery and for inspection. **The unqualified ones target
staging** — production needs an explicit `:prod`, which reads `.env.production` and prints the
resolved host before it does anything:

```bash
npm run prisma:migrate:status         # staging — what's pending
npm run prisma:migrate:deploy         # staging — apply

npm run prisma:migrate:status:prod    # production — inspection is safe
npm run prisma:migrate:deploy:prod    # production — recovery only; ci.yml normally does this
```

Every migration directory also carries a `rollback.sql`. **Prisma never executes these** — they
are operational, for pasting into the Supabase SQL editor. Keep the relevant one open in a second
tab while deploying. After running one, record it:

```bash
npx prisma migrate resolve --rolled-back 0009_narrow_grants
```

Behaviour-changing migrations are rehearsed on staging first — see [STAGING.md](STAGING.md) for the
full flow. On a fresh database (staging, or a rebuild) `0006_baseline_rls` **is** executed rather
than resolved-as-applied; the "do not run this" caveat below is specific to production, where that
state predates the migration.

### Schema change workflow

1. Credentials are already split by environment: staging in `.env.staging`, production in
   `.env.production`, and **`.env` deliberately holds nothing** — see [STAGING.md](STAGING.md) §1
   for why that split is what prevents a local command reaching production. All are gitignored.
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
| O2 | ~~**No global Vue error handler.**~~ **Closed for JS errors.** `Sentry.init({ app })` installs `app.config.errorHandler` ([ADR-0008](decisions/0008-sentry-alongside-in-stack-sink.md)). A render-time throw is now recorded. |
| O3 | ~~**No `window.onerror` / `unhandledrejection` capture.**~~ **Closed for JS errors.** Sentry's default `globalHandlersIntegration` attaches both. |
| O4 | **No error sink — narrowed, not closed.** Sentry now receives *JavaScript* failures. Database failures are deliberately **dropped** before send (constraint text carries member PII), so `handleCreate` failing for three users on Sunday is still invisible until `client_errors` exists. See below. |
| O5 | **No domain audit log.** See below — the ledger needs this more than `members` does. |
| O6 | **No DB performance visibility.** `pg_stat_statements` is available free and reviewed by no one, so D2-class problems stay invisible until they become outages. |

**O4 — both free paths are now in play, and they cover different things.**

- *Sentry free tier* — **adopted** ([ADR-0008](decisions/0008-sentry-alongside-in-stack-sink.md)).
  5k errors/month, well above this app's volume. The privacy trade-off was paid explicitly, not
  waived: collection defaults are inverted (no headers, bodies, cookies, query params, user info,
  or Vue props) and [src/utils/sentryScrub.js](../src/utils/sentryScrub.js) drops database-shaped
  events entirely and redacts what remains. Covers render throws, unhandled rejections, and
  genuine JS bugs — **not** database failures.
- *In-stack, $0, no new processor* — a bounded `public.client_errors` table with `INSERT`-only
  RLS for `authenticated` and no `SELECT` grant, a row cap enforced by a trigger (keep the most
  recent ~5,000), and a scrubber reducing message bodies to a whitelist of known error codes
  before insert. Stays inside the existing Supabase footprint, adds no dependency, keeps PII in
  the one database that already holds it. **Still to build**, and now the *only* path for the
  database-failure class Sentry deliberately refuses. It also gives O21 a destination for free.

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
| O12 | **Clean-room rebuild is impossible.** Substantially narrowed — see below. |
| O13 | **No seed or fixture path.** A fresh environment cannot reach a working state without hand-editing production-shaped data. Still open, but no longer blocking: [STAGING.md](STAGING.md) §2 documents the manual seed as a procedure, which is what standing up staging actually needed. Two scripted fixtures now exist on top of it — `seed-staging-rbac.sql` (roles, one-shot) and `seed-staging-attendance.sql` (services and rosters, idempotent, `npm run seed:attendance`). Neither covers collections or expenses, so a finance-shaped environment is still hand-built. |
| O14 | **No retention or erasure policy.** Soft delete is forever; there is no hard-delete path and no documented subject-access or erasure procedure. Under the PH **Data Privacy Act (RA 10173)** the church is a personal information controller for this data, which makes retention an obligation rather than a preference. Cross-ref [SECURITY.md](SECURITY.md) §3.10. |

**O12 in detail.** Two separately-documented facts combined into something worse than either:

1. `0006_baseline_rls` is a record of live state that **must not be executed** *against production*.
2. The trigger on `auth.users` calling `handle_new_user()`, and the event trigger calling
   `rls_auto_enable()`, live outside the `public` schema and exist in **no migration**
   ([SECURITY.md](SECURITY.md) §3.13).

Both are now addressed. [scripts/sql/bootstrap-triggers.sql](../scripts/sql/bootstrap-triggers.sql)
recreates the two triggers idempotently, and point 1 turned out to be narrower than written: 0006
is non-runnable *against production only*, because that state predates it. On a fresh database it
executes normally, which is what its own header always said ("its first real execution will be a
rebuild, which is why every statement is idempotent").

The bootstrap script discovers triggers **by the function they call, not by name** — the names
production uses are recorded nowhere in this repository, and a name-matching script run against a
real restore would create a second parallel trigger rather than replacing the original, making
`handle_new_user()` fire twice per signup.

**This is no longer theoretical: standing up staging exercised the whole path end to end**
(migrations → bootstrap → seed → sign in), which is the closest thing to a rebuild drill this
project has had — and it surfaced two *additional* landmines that this document did not previously
know about, beyond the two it was written to close:

3. **`0001_baseline` cannot execute as literal SQL, on any fresh Supabase project, ever.** It
   recreates Supabase's own built-in `auth.*` tables (via `prisma migrate diff --from-empty`
   against production), and the connecting role has no `CREATE` privilege on the `auth` schema
   (owned by `supabase_admin` — confirmed via `has_schema_privilege`). This is not a
   staging-specific quirk; it means production's `public` tables were never created by literally
   running this file either. The fix (extract the `public`-only statements, run those, mark the
   whole migration applied) is documented in [STAGING.md](STAGING.md) §2, step 2.
4. **Migration order isn't strictly linear.** `0003_expenses` calls `get_my_church_id()`, which
   isn't created until `0004_church_scoped_groups` — invisible on production because that database
   was built by hand first and captured into numbered files afterward, so the numbering doesn't
   fully match creation order. `0004` has to run before `0003` on a truly fresh database. Full
   dependency mapping (confirmed: `0006` needs nothing from `0002`/`0003`/`0005`; nothing in
   `0002`-`0018` besides `0001` touches the `auth` schema) is in [STAGING.md](STAGING.md) §2.

Point 1 in this list means the "0006 is idempotent, let it run normally on a rebuild" note above,
while still true, undersold the problem — `0006` was never the hard part of a rebuild; `0001` was,
and the docs didn't know that until this was actually attempted.

Still open before O12 can be called closed: (b) a scheduled `pg_dump` to a GitHub Actions artifact,
and (c) one documented, dated restore drill against a *production* backup. Until (b) exists there
is still no artifact to restore *from* — the repository can now rebuild the schema and its security
surface, but not the data.

## 6. Environments and release safety

| ID | Gap |
|---|---|
| O15 | ~~**No staging.**~~ **Closed.** A second free Supabase project is now the staging database, reached from local dev via `npm run dev` and `npm run prisma:migrate:deploy` — see [STAGING.md](STAGING.md). Database only: there is no staging website, by decision, since one developer testing locally is the whole use case. |
| O16 | ~~**Deploy ordering is human memory.**~~ **Closed.** `deploy` (in [ci.yml](../.github/workflows/ci.yml)) has `needs: [test, lighthouse, migrate]` — GitHub Actions' own dependency graph, not a Netlify setting, guarantees the migration lands before the SPA that depends on it. See [STAGING.md](STAGING.md) §3. |
| O17 | ~~**Netlify builds are not gated on CI.**~~ **Closed, by removing Netlify from the decision entirely.** Netlify has **no native way** to make a deploy wait on external check results — verified against Netlify's own docs, not assumed (an earlier version of this row assumed a dashboard toggle existed; it doesn't). Instead, Netlify's git-triggered auto-deploy is disabled outright (Site configuration → Build & deploy → Continuous deployment → Build settings → "Stopped builds"), and `ci.yml`'s `deploy` job is the *only* thing that publishes, via `netlify deploy --prod` after `needs: [test, lighthouse, migrate]` all succeed. |
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

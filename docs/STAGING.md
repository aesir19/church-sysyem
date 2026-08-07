# Staging

A second Supabase project used **only as a database for local development**. There is no staging
website — no Netlify branch, no second Netlify site. With one developer on this project, the sole
purpose is to give local `npm run dev` and Prisma commands somewhere safe to point that is not
production.

This closes [OPERATIONS.md](OPERATIONS.md) O15. The related durability gap O12 is closed by
[scripts/sql/bootstrap-triggers.sql](../scripts/sql/bootstrap-triggers.sql), written for this.

- Free-tier budgets and why a second project is affordable → [OPERATIONS.md](OPERATIONS.md) §1
- The release flow this feeds into → [OPERATIONS.md](OPERATIONS.md) §2

---

## 1. How environments are selected

**Local development cannot reach production. That is structural, not a convention** — there is no
command to type wrongly and no variable to forget.

Credentials live in three gitignored files at the repo root (`.gitignore` ignores `.env` and
`.env.*` wholesale, so a new variant can't be missed):

| File | Holds | Loaded by |
|---|---|---|
| `.env` | **nothing** — a comment explaining the split | every mode (which is why it must stay empty) |
| `.env.staging` | staging | `npm run dev`, and the default Prisma commands |
| `.env.production` | production | `npm run build` only, and the explicit `:prod` Prisma commands |

| Command | Database | Sentry |
|---|---|---|
| `npm run dev` | **staging** | disabled |
| `npm run build` | production | enabled |
| `npm run prisma:migrate:status` / `:deploy` | **staging** | — |
| `npm run prisma:migrate:status:prod` / `:deploy:prod` | production | — |

The unqualified commands are the safe ones. Production requires typing `:prod`, and normally isn't
typed at all — [ci.yml](../.github/workflows/ci.yml) runs the production migration.

Two mechanisms enforce this, and it is worth knowing why each is shaped the way it is:

- **Vite** loads `.env` first, then layers `.env.<mode>` over it — and a key *absent* from the mode
  file falls through to `.env`. That fallback used to be the real footgun: when `.env` held
  production values, one missing line in `.env.staging` silently pointed the browser at production
  with no error. It is gone because **`.env` now holds no credentials at all**. `npm run dev` runs
  in mode `staging`, which never loads `.env.production`, so the worst case is now a missing
  variable and a loud throw from [src/lib/supabase.js](../src/lib/supabase.js) — fail closed
  instead of fail silent. **Do not put credentials back into `.env`;** doing so re-creates exactly
  that footgun.
- **Prisma** goes through [scripts/prisma/with-env-file.js](../scripts/prisma/with-env-file.js),
  which loads the named file with `override: true` and prints the resolved database host before
  running anything. Check that line — it is the confirmation of which database you are about to
  touch:
  ```
  [prisma-env] using .env.staging — database host: aws-0-ap-northeast-1.pooler.supabase.com
  ```

  The wrapper exists because the obvious approach is quietly unsafe. `dotenv` **never overwrites a
  variable that is already set in the environment**, so simply pointing it at a different file does
  not make that file win — it only fills in variables that are still unset. If `DATABASE_URL` is
  exported in your shell, set as a Windows user/system variable, or injected by an IDE run
  configuration, then a plain redirect would ignore `.env.staging` entirely and run the migration
  against whatever that ambient value points at, with no visible difference in the output. The
  wrapper forces the file to win.

`.env.staging` must therefore contain all four variables — a missing one is now a startup throw,
not a silent switch to production:

```
DATABASE_URL=            # staging pooled connection (port 6543)
DIRECT_URL=              # staging direct connection (port 5432), used for migrations
VITE_SUPABASE_URL=       # staging project URL
VITE_SUPABASE_ANON_KEY=  # staging anon key
VITE_SENTRY_DSN=         # deliberately EMPTY — see below
```

**`VITE_SENTRY_DSN` must stay present and empty in `.env.staging`.** `main.js` skips
`Sentry.init()` entirely when it is unset ([ADR-0008](decisions/0008-sentry-alongside-in-stack-sink.md)),
which is what keeps local development from reporting into the production Sentry project and
burning its 5k/month event quota on your own debugging. Keep the line, empty, rather than deleting
it — so it reads as a decision rather than an omission someone should "fix".

**Encode `@` in the password as `%40`.** Supabase-generated passwords often contain `@`, which
breaks connection-string parsing. `npm run prisma:check:migrate` catches this and refuses to run —
if you see `contains an unencoded @ in username/password`, that is what it means.

## 2. Standing up a staging project from scratch

Do this once. It is also the procedure for a disaster-recovery rebuild — the steps are identical
apart from which credentials you use.

1. **Create the project** in the Supabase dashboard. Copy the pooled and direct connection strings
   from Project Settings → Database into `.env.staging`, plus the project URL and anon key from
   Project Settings → API.

2. **Apply the migration history — expect two manual interventions, not a clean run.** This was
   proven end to end once, and a truly fresh database hits two real obstacles that a normal
   `prisma migrate deploy` cannot get past on its own:

   ```bash
   npm run prisma:migrate:status   # expect: all migrations pending
   npm run prisma:migrate:deploy
   ```

   **Obstacle 1 — `0001_baseline` cannot run as written.** It was captured via
   `prisma migrate diff --from-empty` against production, so it contains full
   `CREATE TABLE "auth"."..."` statements recreating Supabase's own built-in auth tables
   (`auth.users`, `auth.sessions`, etc.) — tables that already exist on **every** Supabase project
   from the moment it's created, owned by `supabase_admin`, not `postgres`. The connecting role has
   no `CREATE` privilege on the `auth` schema (confirmed: `has_schema_privilege(current_user, 'auth',
   'CREATE')` is `false` even for `postgres`), so this fails with `permission denied for schema auth`
   before it ever reaches the six `public` tables in the same file. This isn't a staging-specific
   quirk — it would hit any fresh Supabase project, which means it was **never actually executable
   as literal SQL**, on production either; production's `public` tables must predate Prisma's
   adoption by some other path.

   Fix: extract only the statements whose target is `public` (6 `CREATE TABLE`, 7
   `ALTER TABLE ... ADD CONSTRAINT`, both harmless `CREATE SCHEMA IF NOT EXISTS`) — filter by the
   first non-comment line of each `;`-terminated statement, not by line range; the auth-schema
   noise is interleaved with the `public` content, not confined to one contiguous block. Run that
   filtered SQL directly (`prisma db execute --file=...`), then mark the whole migration applied
   without re-running it:
   ```bash
   npx prisma migrate resolve --applied 0001_baseline
   ```

   **Obstacle 2 — `0003_expenses` needs `get_my_church_id()`, which isn't created until
   `0004_church_scoped_groups`.** Production never hit this because its migrations chronicle a
   database that was built by hand first and captured into numbered files afterward — the numbering
   doesn't perfectly match creation order. Fix: run `0004_church_scoped_groups` in full
   (`prisma db execute --file=...`) and mark it applied *before* continuing:
   ```bash
   npx prisma migrate resolve --applied 0004_church_scoped_groups
   npm run prisma:migrate:deploy   # now completes 0002,0003,0005,0006,0007-0018 normally
   ```
   Confirmed: `0006_baseline_rls` needs nothing from `0002`/`0003`/`0005`, and nothing else in
   `0002`-`0018` creates or alters an `auth`-schema object — these are the only two obstacles.

   If a step ever fails partway, `prisma db execute` runs the whole file as one transaction (a
   failure leaves no partial rows — verified), but `prisma migrate resolve --applied` does **not**
   check whether the SQL actually ran; if you mark something applied and then discover it errored,
   the row has to be removed directly (`DELETE FROM public._prisma_migrations WHERE migration_name
   = '...'`) since `migrate resolve --rolled-back` only works on a migration `migrate deploy`
   itself marked as failed, not one you resolved by hand.

3. **Create the two out-of-migration triggers.** Run
   [scripts/sql/bootstrap-triggers.sql](../scripts/sql/bootstrap-triggers.sql) (Supabase SQL editor,
   or `prisma db execute --file=...`). Its two verification queries must each return exactly one
   row: `on_auth_user_created` on `auth.users`, and the `rls_auto_enable_on_create_table` event
   trigger.

   Skipping this is the failure mode O12 describes: migrations alone produce a database where
   signing up creates no `public.user_accounts` row, so every new user gets an empty dashboard.

4. **Seed data.** [scripts/sql/seed-staging-rbac.sql](../scripts/sql/seed-staging-rbac.sql) is a
   proven, working fixture covering every role in the RBAC model (ADR/0014_rbac_predicates): 3
   churches (Tala, Graceville, Cogon), the Finance ministry group (staging never got one — see the
   comment in the script for why), and 13 members spanning `super_admin`/`head_pastor`/`pastor`/
   `church_leader` plus Finance/Secretariat/Welcome ministry membership. It expects the 13 auth
   users already created (Authentication → Users → Add user, on **staging**) with the UUIDs it
   hardcodes at the top of the file — update that list for a different set of testers.

   It is **not idempotent** — re-running it duplicates `members` rows for the same auth users
   (`user_accounts` upserts safely, since the `on_auth_user_created` trigger already creates that
   row; `members`/`churches`/the Finance group do not). For a single throwaway user instead, do the
   four inserts by hand: one `churches` row, one `members` row (`member_of` = that church), then
   `UPDATE public.user_accounts SET member_id = ..., role = ... WHERE id = '<the auth uuid>'` — an
   `UPDATE`, not an `INSERT`, since the trigger already created the row.

5. **Verify end to end:** `npm run dev`, sign in as one of the seeded users, confirm the
   dashboard loads with the right church name and role-appropriate capabilities.

For any change to policies, grants, helper functions, or views, add a second church row here and
run the two-church isolation matrix in [security/VERIFICATION.md](security/VERIFICATION.md) §4
against staging rather than production.

## 3. The release flow

Staging is a rehearsal surface, not a deployment target. The intended sequence for a change that
includes a migration:

1. Author the migration (`npm run prisma:migrate:create -- --name your_change`).
2. Apply it to staging: `npm run prisma:migrate:deploy`.
3. Test against staging: `npm run dev`.
4. Open the PR. CI runs `test` and `lighthouse` (both also run on every push to `main`).
5. **Merge to `main`.** This is the approval signal — the merge itself authorizes the production
   migration, because verification already happened at step 3.
6. Three more jobs run, all defined in [ci.yml](../.github/workflows/ci.yml) (single workflow file
   — a job can only `needs:` another job in the *same* file, which is why this isn't split across
   files the way an earlier draft of this had it):
   - `migrate` — applies the migration to production, using the `PROD_DATABASE_URL` /
     `PROD_DIRECT_URL` repository secrets.
   - `deploy` — `needs: [test, lighthouse, migrate]`. Builds the app with real production
     `VITE_SUPABASE_*` values (not secrets — see the inline comment) and publishes it via the
     Netlify CLI, authenticated with the `NETLIFY_AUTH_TOKEN` / `NETLIFY_SITE_ID` repository
     secrets. **This is the only thing that publishes to production.**

**Why a CLI deploy from Actions, not Netlify's own git integration:** Netlify has no native way to
make a deploy wait for external GitHub check results — verified directly against Netlify's docs,
not assumed. The only related feature, "Stop builds," is a manual global on/off switch, not a
per-commit condition. So Netlify's git-triggered auto-deploy for this site is disabled entirely
(**Site configuration → Build & deploy → Continuous deployment → Build settings → "Stopped
builds"**), and GitHub Actions' own `needs:` graph is what actually enforces "migration before
deploy" (O16) and "nothing red ships" (O17) — not any Netlify setting. Netlify's own docs confirm a
CLI deploy (`netlify deploy --prod`) is a separate direct-upload path, independent of the stopped
build pipeline, which is exactly why this still works with builds stopped.

**Two Netlify settings must be changed, not one — and the second one bites silently.** Alongside
"Stopped builds", **Project configuration → Build & deploy → Continuous deployment → "Enforce
deployment methods"** must be **off**. That feature requires every production deploy to come
through a Git workflow and, per Netlify's changelog, "prevents accidental production publishes from
the Netlify CLI, MCP server, or API" — which is precisely how this project deploys. With both
settings on, *nothing* can reach production: Netlify won't build from Git, and it rejects the CLI
upload. The symptom is a bare `JSONHTTPError: Forbidden` from `netlify deploy --prod`, with no
mention of the setting, from CI **and** from a laptop, and it survives rotating the auth token.
Diagnose it by reading `prevent_non_git_prod_deploys` in
`GET https://api.netlify.com/api/v1/sites/<site-id>`; the CLI never surfaces the real reason.

`netlify-cli` is deliberately not a project devDependency (it conflicts with vitest's peer
dependencies via `@netlify/otel`) — both the CI step and `npm run deploy:prod` run it through `npx`
instead, which resolves it in an isolated environment per invocation.

Production migrations and deploys are never run by hand from a laptop as part of the normal flow.
If you need to run one manually (recovering from a failed workflow run, applying a `rollback.sql`),
the existing procedure in [OPERATIONS.md](OPERATIONS.md) §2 still applies, and `npm run deploy:prod`
covers a manual Netlify publish.

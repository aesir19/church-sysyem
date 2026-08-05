# Prisma + Supabase Migration Plan

> **HISTORICAL — this plan shipped.** Retained as a record of intent and rationale.
> The current workflow, commands, and the per-migration operator caveats are in
> [OPERATIONS.md](OPERATIONS.md) §2, which is what you want if you are about to deploy something.

This document defines how to manage the existing Supabase Postgres schema through Prisma so schema changes are versioned in code.

## Scope

- Keep Supabase as the database, auth, and RLS authority.
- Keep frontend runtime data access on `@supabase/supabase-js`.
- Add Prisma for schema introspection and migrations.

## Why this architecture

Prisma cannot run directly in the browser because it requires direct database connectivity and credentials that must not be exposed to clients. In this project, Prisma is used from local/CI Node CLI workflows to manage schema, while the Vue app continues to query via Supabase with RLS.

## Environment variables

Add both variables to your local `.env` and your CI/deployment environment where migrations run:

- `DATABASE_URL`: Supabase pooled connection string (pooler host or port 6543 is acceptable).
- `DIRECT_URL`: Supabase direct Postgres connection string (non-pooling, usually port 5432).

## One-time baseline adoption (existing database)

1. Point `DATABASE_URL` and `DIRECT_URL` to your existing Supabase project.
2. Pull the current schema:

```bash
npm run prisma:pull
```

3. Create a baseline migration SQL from the pulled schema:

```bash
mkdir -p prisma/migrations/0001_baseline
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/0001_baseline/migration.sql
```

4. Mark the baseline migration as already applied in the existing database:

```bash
npx prisma migrate resolve --applied 0001_baseline
```

At this point, migration history is aligned without changing existing tables.

## Ongoing schema change workflow

1. Edit `prisma/schema.prisma`.
2. Create migration SQL:

```bash
npm run prisma:migrate:create -- --name your_change_name
```

3. Review the generated SQL under `prisma/migrations/*/migration.sql`.
4. Apply migrations:

```bash
npm run prisma:migrate:deploy
```

5. Regenerate Prisma client if needed by Node scripts:

```bash
npm run prisma:generate
```

## Current challenge and fix

### Challenge: `prisma db pull` targets localhost

If `DATABASE_URL` is left as the default localhost value, introspection fails with `P1001`.

### Fix

Set `DATABASE_URL` and `DIRECT_URL` to Supabase connection strings, then rerun:

```bash
npm run prisma:pull
```

## Security requirements

- Never store service-role secrets in frontend code.
- Keep RLS policies as the authorization boundary.
- Run migrations from trusted environments only.
- Keep `DIRECT_URL` out of browser-exposed variables.

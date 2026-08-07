-- Recreate the two triggers that live OUTSIDE prisma/migrations.
--
-- PURPOSE
-- `prisma/migrations/` cannot reconstruct a working database on its own. Migration
-- 0006_baseline_rls creates the two functions below, but explicitly does NOT create
-- the triggers that invoke them (see its header, and docs/OPERATIONS.md O12):
--   * a trigger on `auth.users`  calling public.handle_new_user()
--   * an event trigger           calling public.rls_auto_enable()
-- Neither is reachable by `prisma db pull` — Prisma does not introspect triggers on
-- the `auth` schema, and event triggers are cluster-level objects with no schema.
--
-- Without the first trigger, `public.user_accounts` gets no row when someone signs
-- up, so every new user lands on an empty dashboard and the app looks broken.
--
-- WHEN TO RUN
--   * standing up a new project (staging, or a disaster-recovery rebuild), AFTER
--     `prisma migrate deploy` has applied the full migration history
--   * during a restore drill, to put a restored database back into a working state
--
-- Run it in the Supabase SQL editor. It is idempotent — safe to re-run.
--
-- WHY IT DISCOVERS TRIGGERS BY FUNCTION, NOT BY NAME
-- The names these triggers carry in production are not recorded anywhere in this
-- repository. Hardcoding a guessed name would mean a run against a real production
-- restore CREATES A SECOND, PARALLEL TRIGGER alongside the original rather than
-- replacing it — `handle_new_user()` would fire twice per signup and the second
-- insert would raise a duplicate-key error. So instead of matching on name, the
-- DO blocks below drop whatever trigger is bound to each function, whatever it is
-- called, and then create it under the canonical name used here.

-- ---------------------------------------------------------------------------
-- 0. Preconditions. Fail loudly rather than half-applying.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.handle_new_user()') IS NULL THEN
    RAISE EXCEPTION
      'public.handle_new_user() does not exist. Run `prisma migrate deploy` first (it is created by 0006_baseline_rls).';
  END IF;
  IF to_regprocedure('public.rls_auto_enable()') IS NULL THEN
    RAISE EXCEPTION
      'public.rls_auto_enable() does not exist. Run `prisma migrate deploy` first (it is created by 0006_baseline_rls).';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 1. auth.users -> public.handle_new_user()
--    Creates the public.user_accounts row for each new auth user.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  existing record;
BEGIN
  FOR existing IN
    SELECT tgname
    FROM pg_trigger
    WHERE tgrelid = 'auth.users'::regclass
      AND tgfoid  = 'public.handle_new_user()'::regprocedure
      AND NOT tgisinternal
  LOOP
    EXECUTE format('DROP TRIGGER %I ON auth.users', existing.tgname);
    RAISE NOTICE 'dropped existing trigger % on auth.users', existing.tgname;
  END LOOP;
END
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 2. event trigger -> public.rls_auto_enable()
--    Defence in depth: auto-enables RLS on any new table in `public`, so a table
--    added through the dashboard cannot ship without RLS.
--
--    The tag list must stay in sync with the command_tag filter inside the
--    function body (0006_baseline_rls); Postgres will not warn if they diverge,
--    it will just silently stop firing for the missing tag.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  existing record;
BEGIN
  FOR existing IN
    SELECT evtname
    FROM pg_event_trigger
    WHERE evtfoid = 'public.rls_auto_enable()'::regprocedure
  LOOP
    EXECUTE format('DROP EVENT TRIGGER %I', existing.evtname);
    RAISE NOTICE 'dropped existing event trigger %', existing.evtname;
  END LOOP;
END
$$;

CREATE EVENT TRIGGER rls_auto_enable_on_create_table
  ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  EXECUTE FUNCTION public.rls_auto_enable();

-- ---------------------------------------------------------------------------
-- 3. Verify. Both queries must return exactly one row.
-- ---------------------------------------------------------------------------
SELECT tgname AS auth_users_trigger, tgenabled AS enabled
FROM pg_trigger
WHERE tgrelid = 'auth.users'::regclass
  AND tgfoid  = 'public.handle_new_user()'::regprocedure
  AND NOT tgisinternal;

SELECT evtname AS event_trigger, evtenabled AS enabled, evttags AS tags
FROM pg_event_trigger
WHERE evtfoid = 'public.rls_auto_enable()'::regprocedure;

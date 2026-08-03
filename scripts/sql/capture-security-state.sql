-- Capture the live database security surface (policies, grants, functions, triggers).
--
-- PURPOSE
-- Migration 0006_baseline_rls records this state in source control. Re-run this
-- script whenever you need to verify that the deployed database still matches the
-- migrations, or before authoring a migration that changes policies or grants.
--
-- Every statement here is READ-ONLY. Run it in the Supabase SQL editor.
--
-- Objects this script does NOT capture (they live outside `public` and must be
-- inspected separately — see 0006_baseline_rls for why this matters):
--   * triggers on `auth.users`  (e.g. the one calling public.handle_new_user)
--   * event triggers            (e.g. the one calling public.rls_auto_enable)
--   * sequence SELECT/UPDATE grants (query 8 covers USAGE only)

-- 1. All RLS policies. `qual` and `with_check` are the authoritative policy bodies.
SELECT tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- 2. RLS enablement per table.
SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relname;

-- 3. Table-level grants.
SELECT table_name, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee IN ('anon', 'authenticated', 'service_role')
ORDER BY table_name, grantee, privilege_type;

-- 4. Column-level grants. 0004_church_scoped_groups depends on these for `groups`.
SELECT table_name, column_name, grantee, privilege_type
FROM information_schema.column_privileges
WHERE table_schema = 'public'
  AND grantee IN ('anon', 'authenticated')
ORDER BY table_name, column_name, grantee;

-- 5. Full definitions of every function in `public`.
SELECT p.proname, pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
ORDER BY p.proname;

-- 6. EXECUTE grants on those functions.
SELECT routine_name, grantee, privilege_type
FROM information_schema.role_routine_grants
WHERE routine_schema = 'public'
  AND grantee IN ('anon', 'authenticated', 'service_role')
ORDER BY routine_name, grantee;

-- 7. Non-internal triggers on `public` tables.
SELECT c.relname AS table_name, t.tgname, pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE NOT t.tgisinternal AND n.nspname = 'public'
ORDER BY c.relname, t.tgname;

-- 8. Sequence USAGE grants (collections.id / expenses.id are bigserial).
SELECT c.relname, r.grantee, r.privilege_type
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN information_schema.role_usage_grants r ON r.object_name = c.relname
WHERE n.nspname = 'public' AND c.relkind = 'S'
ORDER BY c.relname, r.grantee;

-- ============================================================================
-- ROLLBACK for 0020_my_profile_name
-- ============================================================================
-- Prisma has no down-migrations. This file is operational only — it is never
-- executed by `prisma migrate deploy`. Paste it into the Supabase SQL editor.
--
-- THIS ROLLBACK IS CLEAN. The function stores nothing and no other object
-- depends on it. Dropping it destroys no data and locks nothing out.
--
-- WHAT BREAKS INSTEAD — the greeting, cosmetically. src/composables/useCurrentUser.js
-- calls this RPC and treats any failure as "no name", falling back to the
-- titlecased local part of the email address. So the dashboard goes back to
-- reading "Good evening, Fjhaze" and nothing else changes.
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_my_profile();

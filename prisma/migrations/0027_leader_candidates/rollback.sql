-- Undo 0027: drop the two leader RPCs it added.
--
-- Nothing depends on them — both are leaf reads called only by the group page — so the
-- drops are unconditional. The page falls back to its pre-0027 behaviour: an empty
-- candidate list, and a leader line that cannot resolve a name.

BEGIN;

DROP FUNCTION IF EXISTS public.list_small_group_leader_candidates(uuid);
DROP FUNCTION IF EXISTS public.get_small_group_leader(uuid);

COMMIT;

-- The function list changed:
--   NOTIFY pgrst, 'reload schema';

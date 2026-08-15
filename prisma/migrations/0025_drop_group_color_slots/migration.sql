-- Remove groups.color_slot, undoing the second half of 0005_group_color_slots.
--
-- WHY NOW, AND WHY ON ITS OWN. The next migration splits `groups` into `ministries`
-- and `small_groups`. color_slot is globally unique across every group, so carrying
-- it across a split means one counter spanning two tables and an allocation trigger
-- that probes both while staying race-safe against two separate unique indexes.
-- That is the single ugliest part of the split, and it would be written only to be
-- deleted when the colour work lands.
--
-- It is dead already. Nothing renders it: the redesign (4e22a5b) moved group colour
-- to the token palette, and no component or view reads the column — it survives only
-- because `GROUP_COLUMNS` still names it in the PostgREST select list. This migration
-- drops it there too.
--
-- Deliberately its own migration rather than a step inside the split, so that the one
-- irreversible part of this work — losing the slot assignments — has its own rollback
-- and can be backed out without reverting the refactor. The slot values are not worth
-- preserving (they are a deterministic function of name order; the rollback recomputes
-- them the same way 0005 did), but a drop hidden inside a 500-line refactor is not
-- reviewable, and this project's posture is that a destructive step should be small
-- enough to read in one sitting.

BEGIN;

-- The trigger and the column go together, and no insert may land between the two.
LOCK TABLE public.groups IN ACCESS EXCLUSIVE MODE;

DROP TRIGGER IF EXISTS groups_assign_color_slot ON public.groups;
DROP FUNCTION IF EXISTS public.assign_group_color_slot();

-- Dropping the column takes groups_color_slot_key and groups_color_slot_check with
-- it; both are named here anyway so this file records exactly what 0005 leaves
-- behind and the rollback has a checklist to restore.
ALTER TABLE public.groups
  DROP CONSTRAINT IF EXISTS groups_color_slot_key,
  DROP CONSTRAINT IF EXISTS groups_color_slot_check,
  DROP COLUMN IF EXISTS color_slot;

COMMIT;

-- The column list on `groups` changed, so PostgREST's cached schema is now stale:
--   NOTIFY pgrst, 'reload schema';
--
-- DEPLOY THE FRONTEND FIRST. This is the one ordering trap in this migration. A select
-- that omits color_slot works perfectly against a table that still has it, so shipping
-- the `GROUP_COLUMNS` change ahead of this migration is safe in both directions. The
-- reverse is not: drop the column while the live frontend still names it in its select
-- list and every read of `groups` 400s — the Groups page, the Members page's group
-- names, and the Overview tiles, all at once.

-- ROLLBACK for 0025_drop_group_color_slots.
--
-- Prisma has no down-migrations. This file is operational only. Paste it into the
-- Supabase SQL editor.
--
-- WHAT YOU GET BACK, AND WHAT YOU DO NOT. The column, its check, its unique constraint
-- and the allocation trigger all return. The original slot *values* do not: they were a
-- deterministic ranking over lower(name), and any group created or renamed since 0025
-- ranks differently now. Every group therefore gets a valid, distinct slot, but not
-- necessarily the one it had. Since nothing renders the column this is invisible; it is
-- recorded here so nobody treats a restored slot as the historical one.
--
-- After running this:
--   npx prisma migrate resolve --rolled-back 0025_drop_group_color_slots
--
-- If 0026_split_groups has been applied, roll that back FIRST — `groups` is a view by
-- then, and none of the statements below can run against it.

BEGIN;

LOCK TABLE public.groups IN ACCESS EXCLUSIVE MODE;

-- 0005's capacity guard, restated: the restore cannot succeed if the roster has since
-- outgrown the slot space, and a half-restored column is worse than none.
DO $$
DECLARE
  group_count BIGINT;
BEGIN
  SELECT count(*) INTO group_count FROM public.groups;

  IF group_count > 3240 THEN
    RAISE EXCEPTION USING
      MESSAGE = format(
        '0025 rollback aborted: %s groups exceed the 3240-slot color capacity.',
        group_count
      ),
      HINT = 'The roster has outgrown 0005''s slot space. Raise the capacity in this file and in the frontend together before retrying; no rows were changed.';
  END IF;
END
$$;

ALTER TABLE public.groups
  ADD COLUMN color_slot INTEGER;

-- Same deterministic ranking 0005 used, for the same reason: the frontend permuted
-- sequential slots across the hue wheel, so a stable name ordering also distributes well.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (ORDER BY lower(name), id) - 1 AS color_slot
  FROM public.groups
)
UPDATE public.groups AS g
SET color_slot = ranked.color_slot
FROM ranked
WHERE ranked.id = g.id;

ALTER TABLE public.groups
  ALTER COLUMN color_slot SET NOT NULL,
  ADD CONSTRAINT groups_color_slot_check
    CHECK (color_slot >= 0 AND color_slot < 3240),
  ADD CONSTRAINT groups_color_slot_key UNIQUE (color_slot);

-- 0005's allocator, verbatim. SECURITY DEFINER because an ordinary caller holds no
-- INSERT grant on color_slot and must not; the trigger is what fills it.
CREATE FUNCTION public.assign_group_color_slot()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  slot_capacity CONSTANT INTEGER := 3240;
  start_slot INTEGER;
BEGIN
  -- One transaction-scoped lock is sufficient because slots are globally unique.
  PERFORM pg_catalog.pg_advisory_xact_lock(1977010505);

  start_slot := (
    ('x' || substr(md5(NEW.id::text), 1, 8))::bit(32)::bigint
    % slot_capacity
  )::integer;

  SELECT (start_slot + candidate.probe_offset) % slot_capacity
  INTO NEW.color_slot
  FROM generate_series(0, slot_capacity - 1) AS candidate(probe_offset)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.groups AS existing
    WHERE existing.color_slot = (start_slot + candidate.probe_offset) % slot_capacity
  )
  ORDER BY candidate.probe_offset
  LIMIT 1;

  IF NEW.color_slot IS NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Cannot create group: all 3240 generated color slots are in use.',
      HINT = 'Increase the database and frontend slot capacity together before creating more groups.';
  END IF;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.assign_group_color_slot() FROM PUBLIC;

CREATE TRIGGER groups_assign_color_slot
BEFORE INSERT ON public.groups
FOR EACH ROW
EXECUTE FUNCTION public.assign_group_color_slot();

COMMIT;

-- The column is back, so reload the cache before a frontend that names it:
--   NOTIFY pgrst, 'reload schema';

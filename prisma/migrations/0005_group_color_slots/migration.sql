-- Replace the eight user-selected color tokens with stable, database-assigned slots.
-- This migration is intentionally additive after 0004_church_scoped_groups; never
-- fold it into 0004 because that migration may already be deployed.

BEGIN;

-- Keep the capacity check, backfill, and trigger installation atomic, and prevent
-- a concurrent insert from changing the row count between validation and backfill.
LOCK TABLE public.groups IN ACCESS EXCLUSIVE MODE;

-- 360 hues x 9 saturation/lightness bands = 3,240 globally unique slots.
DO $$
DECLARE
  group_count BIGINT;
BEGIN
  SELECT count(*) INTO group_count FROM public.groups;

  IF group_count > 3240 THEN
    RAISE EXCEPTION USING
      MESSAGE = format(
        '0005_group_color_slots aborted: %s groups exceed the 3240-slot color capacity.',
        group_count
      ),
      HINT = 'Increase the database and frontend slot capacity together before retrying; no rows were changed.';
  END IF;
END
$$;

ALTER TABLE public.groups
  ADD COLUMN color_slot INTEGER;

-- Existing rows receive distinct slots in a deterministic order. The frontend
-- permutes sequential slots across the hue wheel, so this stable ranking is also
-- visually well distributed.
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
  ADD CONSTRAINT groups_color_slot_key UNIQUE (color_slot),
  DROP CONSTRAINT groups_color_check,
  DROP COLUMN color;

-- Serialize slot allocation so two concurrent inserts cannot choose the same
-- apparent free slot. The unique constraint remains the final integrity guard.
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

-- RLS remains authoritative for row access. Column grants additionally ensure
-- ordinary app users cannot choose or alter generated slots, ownership, or type.
REVOKE ALL ON TABLE public.groups FROM anon, authenticated;
GRANT SELECT ON TABLE public.groups TO authenticated;
GRANT INSERT (name, type, church_id) ON TABLE public.groups TO authenticated;
GRANT UPDATE (name) ON TABLE public.groups TO authenticated;
GRANT DELETE ON TABLE public.groups TO authenticated;

COMMIT;

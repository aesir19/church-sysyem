-- ============================================================================
-- ROLLBACK for 0021_member_contact_number_text
-- ============================================================================
-- Prisma has no down-migrations. This file is operational only — it is never
-- executed by `prisma migrate deploy`. Paste it into the Supabase SQL editor.
--
-- THIS ROLLBACK IS LOSSY, AND WILL PROBABLY FAIL OUTRIGHT.
--
-- Going back to DECIMAL destroys the very thing the migration was written to
-- preserve: every leading zero is dropped again, permanently, for all rows.
-- Worse, any value that is not a bare number — '+639171234567', '0917 123
-- 4567', 'none' — cannot cast at all, and the ALTER aborts. The USING clause
-- below therefore nulls anything non-numeric rather than failing the statement,
-- which means running this DELETES those phone numbers.
--
-- Take a copy first if you ever have cause to run it:
--   CREATE TABLE members_contact_backup AS
--     SELECT id, contact_number FROM public.members;
--
-- WHAT BREAKS IF YOU DON'T ROLL BACK — nothing. The SPA already coerces this
-- column to a string at every read site, so text is the shape it always wanted.
-- There is no realistic reason to run this file.
-- ============================================================================

ALTER TABLE public.members
  ALTER COLUMN contact_number TYPE decimal
  USING CASE
          WHEN contact_number IS NULL THEN NULL
          WHEN contact_number ~ '^[0-9]+$' THEN contact_number::decimal
          ELSE NULL
        END;

COMMENT ON COLUMN public.members.contact_number IS NULL;

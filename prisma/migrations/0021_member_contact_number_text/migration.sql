-- ============================================================================
-- 0021_member_contact_number_text — stop the phone column eating leading zeros
-- ============================================================================
--
-- WHY
-- `members.contact_number` has been DECIMAL since 0001. Philippine mobile
-- numbers are written `09XXXXXXXXX` — eleven digits, leading zero. A numeric
-- column cannot hold a leading zero, so every number stored so far has been
-- silently truncated to ten digits on the way in. The damage is invisible in
-- the UI: `09171234567` comes back as `9171234567`, which still looks like a
-- phone number to a human reading the roster.
--
-- 0013 already refused to repeat the mistake — `attendance.guest_contact` was
-- deliberately made text, with a comment saying exactly why. This migration
-- brings `members` in line with that decision.
--
-- WHY NOW
-- A bulk import of the membership form is about to load real numbers. Doing
-- this first means those rows land intact rather than needing a second repair
-- pass. The source spreadsheet already demonstrates the failure mode: one cell
-- had been coerced to the float 9.700227392E9 by Excel for the same reason.
--
-- WHY NOTHING IN THE APP CHANGES
-- The SPA never treated this as a number. Every read site already coerces:
-- MemberDetailPanel.vue does `String(member.contact_number)`, MembersView.vue
-- does `String(m.contact_number).replace(/\D/g, '')`, memberPayload.js sends
-- text. tests/utils/memberValidation.test.js even carries a comment noting that
-- Postgres hands the value back as a Decimal and form state must not assume a
-- string. Widening to text makes those coercions no-ops instead of load-bearing.
--
-- WHY GRANTS AND POLICIES ARE UNAFFECTED
-- `members` carries table-level grants (0009: GRANT SELECT, INSERT, UPDATE ON
-- TABLE public.members TO authenticated), not column-level ones, so changing a
-- column's type neither drops nor needs to re-issue any grant. No RLS policy,
-- index, generated column or function references contact_number.
--
-- WHAT THIS DOES NOT DO
-- It does not repair rows already stored. A ten-digit value that lost its zero
-- stays ten digits — this migration cannot tell a truncated `09171234567` from
-- a legitimately different number, and inventing a digit across the whole table
-- is not something a schema change should do quietly. Existing values are cast
-- verbatim; new writes keep whatever the client sends.
-- ============================================================================

ALTER TABLE public.members
  ALTER COLUMN contact_number TYPE text
  USING CASE
          WHEN contact_number IS NULL THEN NULL
          -- trim_scale drops the trailing zeros DECIMAL carries around, so
          -- 9171234567 casts to '9171234567' and never '9171234567.0000'.
          ELSE trim_scale(contact_number)::text
        END;

COMMENT ON COLUMN public.members.contact_number IS
  'Free text, not a number. Philippine mobile numbers lead with 0 and DECIMAL '
  'destroyed it — see 0021. Values written before that migration may be missing '
  'their leading zero. Format is not enforced; the SPA normalizes for display.';

-- ============================================================================
-- 0019_attendance_guest_link — let staff repoint a guest attendance row at the
-- member it was really meant to be, in place.
-- ============================================================================
--
-- WHY
-- submit_checkin (0013) matches a self check-in to a member by normalized full
-- name. "Maria Sntos" does not match, so a real member who mistypes their name on
-- the public QR page lands as a guest row: miscounted against the guest total, and
-- never attached to their member record.
--
-- Before this migration the only available correction was DELETE + INSERT, because
-- `attendance` carries NO update grant and NO update policy at all — 0013 grants
-- SELECT, DELETE and a column-scoped INSERT, and nothing else. That correction is
-- lossy in a way that matters: it rewrites created_at, and the INSERT trigger
-- set_attendance_recorder flips source from 'self' to 'staff' with a non-NULL
-- recorded_by. The roster would then claim staff verified someone who in fact
-- self-asserted, which is exactly the distinction 0013's COMMENT ON COLUMN calls
-- out as one every roster must surface.
--
-- WHAT
-- A column-scoped UPDATE grant plus one narrow policy. Together they permit exactly
-- one transition — guest row -> member row of the same church — and nothing else.
--
-- The grant lists only the three identity columns. service_id, church_id, source,
-- recorded_by and created_at stay unwritable by any client, so provenance survives
-- the link untouched. guest_name_norm is GENERATED ALWAYS and cannot be written
-- regardless; nulling guest_name recomputes it to NULL, which also frees that
-- service's attendance_self_guest_key slot.
--
-- The policy's two halves do different work and both are load-bearing:
--
--   USING      is evaluated against the row as it EXISTS. Requiring guest_name to
--              be non-NULL means a member row is not updatable at all, so this
--              cannot be turned into "repoint member A's attendance at member B".
--
--   WITH CHECK is evaluated against the row as it WILL BE. Requiring member_id to
--              be non-NULL means a guest cannot be quietly renamed into a different
--              guest, and is_member_in_church ties the member to the attendance
--              row's OWN church rather than the caller's — the same construction
--              0016 uses on attendance_insert_own_church.
--
-- Drop either half and the policy becomes materially wider than the feature.
--
-- No constraint changes are needed. Nulling guest_name and guest_contact in the
-- same statement that sets member_id satisfies attendance_identity_check
-- (num_nonnulls(member_id, guest_name) = 1) and attendance_contact_needs_guest by
-- construction. A client that writes a partial payload is rejected, as intended.
--
-- The (service_id, member_id) unique index still applies: linking a guest to a
-- member already on that roster raises 23505. That is deliberate — the SPA treats
-- the conflict as the merge signal and deletes the now-redundant guest row through
-- the existing DELETE policy.
--
-- No prisma/schema.prisma change: no column or table is added or altered. Grants
-- and policies are not modelled by Prisma, same as 0016 and 0018.
--
-- ORDERING: deploy this before the SPA release that calls it.
-- ROLLBACK: see rollback.sql.
-- ============================================================================

BEGIN;

-- Column-scoped on purpose — see the header. Everything absent from this list
-- stays unwritable, which is what keeps source/created_at/recorded_by honest.
GRANT UPDATE (member_id, guest_name, guest_contact) ON TABLE public.attendance TO authenticated;

DROP POLICY IF EXISTS attendance_update_link_guest ON public.attendance;
CREATE POLICY attendance_update_link_guest ON public.attendance
  FOR UPDATE
  TO authenticated
  -- The row as it is: guest rows only.
  USING (
    public.can_manage_attendance()
    AND public.can_write_church(church_id)
    AND guest_name IS NOT NULL
  )
  -- The row as it will be: a member row, of this row's own church.
  WITH CHECK (
    public.can_manage_attendance()
    AND public.can_write_church(church_id)
    AND member_id IS NOT NULL
    AND public.is_member_in_church(member_id, church_id)
  );

COMMENT ON POLICY attendance_update_link_guest ON public.attendance IS
  'The single permitted UPDATE on attendance: convert a guest row into a member row of the same church, so a mistyped self check-in can be corrected without losing source, created_at or recorded_by. USING restricts it to guest rows; WITH CHECK restricts the result to a member of the row own church.';

COMMIT;

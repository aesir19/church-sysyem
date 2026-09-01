-- 0035_events_stage3 — Calendar & Events, Stage 3 (#87).
--
-- Makes an event OPERATIONAL: volunteers, a programme, rooms, and a post-event
-- closeout wired into attendance/expense/collection — each honouring the write
-- boundary rule 2 settled in the Stage-1 grilling and re-grilled at the start of
-- this stage. RLS/functions are the enforcement (ADR 0001); capabilities.js only
-- mirrors these predicates for UI gating and must not drift.
--
-- THE WRITE BOUNDARY IS THE POINT OF THIS MIGRATION. Events Team gains the power to
-- create THIS EVENT's own attendance (through a linked ad-hoc service) and THIS
-- EVENT's own expense — but NOT the general attendance or finance domains, and
-- NEVER a collection or a contributor's identity. Every OR-path added below to the
-- services / attendance / expenses policies is exactly that widening and no wider;
-- read each against rule 2.
--
-- Grilled decisions this migration encodes (session 2026-08-25, see #87):
--   Q1  Cross-church volunteers are entered as GUESTS; no cross-church member read.
--   Q4  Rooms are managed by Church Leader (+ SuperAdmin): can_manage_rooms().
--   Q5  A guest stores a name (required) and, at most, one free-text contact and one
--       free-text affiliation. Nothing else. Data minimisation (rule 2).
--   Q7  A finance-required role rejects a guest and any non-finance member — enforced
--       in the assignment write path (trigger), not merely dimmed in the UI.
--   Q9/Q17 Attendance is a single-day head count through an ad-hoc service the event
--       links by services.event_id; the app times its window start-2h .. end+1h.
--   Q10 Collection total reaches Events Team as an AGGREGATE via event_collection_total();
--       the identity-bearing rows are never fetched for an Events-Team caller (0031).
--   Q14 A draft needs only a title: starts_at and kind become nullable; a published
--       event still must have both (events_publishable_check). "Tentative" is derived
--       (status='draft' AND starts_at IS NOT NULL), not a new status.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Predicates and helpers.
-- ---------------------------------------------------------------------------

-- Is a GIVEN member in a ministry? is_in_ministry() answers that for the CALLER;
-- eligibility (Q7) has to answer it for the member being ASSIGNED, so this takes an
-- explicit member id. Mirrors is_in_ministry's re-homed body (0026) over
-- ministry_members + ministries. Definer so the assignment guard can call it
-- regardless of who is assigning.
CREATE OR REPLACE FUNCTION public.member_in_ministry(p_member_id uuid, p_key text)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.ministry_members AS mm
    JOIN public.ministries       AS mi ON mi.id = mm.ministry_id
    WHERE mm.member_id = p_member_id
      AND mi.ministry_key = p_key
  )
$$;

-- Who owns the per-church room list (Q4). Church Leader is the per-church admin;
-- SuperAdmin retains it for setup. Events Team USES rooms (picks one) but does not
-- MANAGE the list — that separation is the whole point of the predicate.
CREATE OR REPLACE FUNCTION public.can_manage_rooms()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$ SELECT public.is_super_admin() OR public.is_church_leader() $$;

-- ---------------------------------------------------------------------------
-- 2. events — Stage-3 columns and the draft/publish looseness (Q14, Q15, Q16, Q17).
-- ---------------------------------------------------------------------------
-- A draft is a loose sketch: only the title is required. starts_at and kind become
-- nullable so an event can be drafted before its date or type is known; the
-- publish path re-tightens them. A dateless draft simply never appears on the
-- calendar (listEvents filters on starts_at); a draft WITH a date is "tentative".
ALTER TABLE public.events ALTER COLUMN starts_at DROP NOT NULL;
ALTER TABLE public.events ALTER COLUMN kind      DROP NOT NULL;

ALTER TABLE public.events
  -- Q17: the "track attendance" switch. When true, publishing provisions the
  -- ad-hoc service (app-side) so live check-in is possible during the event.
  ADD COLUMN attendance_tracked boolean NOT NULL DEFAULT false,
  -- Where the event is held (Q2 room clash is a soft warning computed app-side, so
  -- this is a plain nullable link, not an exclusion constraint). "No room needed"
  -- is NULL. Composite FK carries church_id so a room can never cross churches.
  ADD COLUMN room_id uuid,
  -- Closeout (Q10, Q15): the date passing is derived ("Happened"); marking Closed is
  -- an explicit act stamped here once records are settled and the review written.
  ADD COLUMN closed_at timestamptz,
  -- The debrief (Q16): three free-text fields, prompted but not required to close.
  ADD COLUMN review_went_well  text,
  ADD COLUMN review_went_wrong text,
  ADD COLUMN review_followups  text;

-- A published (or cancelled) event must carry the facts a draft may omit. This is the
-- publish-time gate as a declarative CHECK — the app cannot flip status to published
-- while starts_at or kind is still blank.
ALTER TABLE public.events
  ADD CONSTRAINT events_publishable_check CHECK (
    status = 'draft'
    OR (starts_at IS NOT NULL AND kind IS NOT NULL)
  );

-- An end time without a start is nonsense; a dateless draft has neither.
ALTER TABLE public.events
  ADD CONSTRAINT events_ends_needs_start CHECK (
    ends_at IS NULL OR starts_at IS NOT NULL
  );

-- ---------------------------------------------------------------------------
-- 3. event_rooms — the per-church bookable list (stories 20–24, 26).
-- ---------------------------------------------------------------------------
CREATE TABLE public.event_rooms (
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  church_id   uuid NOT NULL,
  label       text NOT NULL,
  capacity    integer,
  -- An unbookable space (the pastor's office) is listed but not selectable (story 23):
  -- the list stays complete without being wrong.
  is_bookable boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  CONSTRAINT event_rooms_pkey PRIMARY KEY (id),
  CONSTRAINT event_rooms_id_church_key UNIQUE (id, church_id),
  CONSTRAINT event_rooms_church_fkey FOREIGN KEY (church_id)
    REFERENCES public.churches (id) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT event_rooms_label_shape CHECK (
    label = btrim(label) AND char_length(label) BETWEEN 1 AND 80
  ),
  CONSTRAINT event_rooms_capacity_check CHECK (capacity IS NULL OR capacity > 0)
);

ALTER TABLE public.events
  ADD CONSTRAINT events_room_fkey FOREIGN KEY (room_id, church_id)
    REFERENCES public.event_rooms (id, church_id) ON DELETE SET NULL ON UPDATE NO ACTION;
CREATE INDEX events_room_idx ON public.events (room_id) WHERE room_id IS NOT NULL;

ALTER TABLE public.event_rooms ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.event_rooms FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.event_rooms TO authenticated;

-- READ: anyone who can view events in a readable church (so Events Team can pick a
-- room, and the oversight roles see placements). Not published-gated — a plain
-- member has no room picker.
CREATE POLICY event_rooms_select
ON public.event_rooms FOR SELECT TO authenticated
USING (public.can_read_church(church_id) AND public.can_view_events());

-- WRITE: Church Leader (+ SuperAdmin) only (Q4), own church.
CREATE POLICY event_rooms_insert
ON public.event_rooms FOR INSERT TO authenticated
WITH CHECK (public.can_manage_rooms() AND public.can_write_church(church_id));

CREATE POLICY event_rooms_update
ON public.event_rooms FOR UPDATE TO authenticated
USING (public.can_manage_rooms() AND public.can_write_church(church_id))
WITH CHECK (public.can_manage_rooms() AND public.can_write_church(church_id));

CREATE POLICY event_rooms_delete
ON public.event_rooms FOR DELETE TO authenticated
USING (public.can_manage_rooms() AND public.can_write_church(church_id));

-- ---------------------------------------------------------------------------
-- 4. event_roles — the roles an event needs (stories 1–5).
-- ---------------------------------------------------------------------------
CREATE TABLE public.event_roles (
  id               uuid NOT NULL DEFAULT gen_random_uuid(),
  church_id        uuid NOT NULL,
  event_id         uuid NOT NULL,
  label            text NOT NULL,
  count_required   integer NOT NULL DEFAULT 1,
  -- The eligibility rule made visible, not folded (story 5). Enforced by the
  -- assignment guard (section 5), not just dimmed in the UI (Q7).
  requires_finance boolean NOT NULL DEFAULT false,
  note             text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid,
  CONSTRAINT event_roles_pkey PRIMARY KEY (id),
  CONSTRAINT event_roles_id_church_key UNIQUE (id, church_id),
  CONSTRAINT event_roles_event_fkey FOREIGN KEY (event_id, church_id)
    REFERENCES public.events (id, church_id) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT event_roles_label_shape CHECK (
    label = btrim(label) AND char_length(label) BETWEEN 1 AND 80
  ),
  CONSTRAINT event_roles_count_check CHECK (count_required BETWEEN 1 AND 999)
);
CREATE INDEX event_roles_event_idx ON public.event_roles (event_id);

ALTER TABLE public.event_roles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.event_roles FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.event_roles TO authenticated;

-- READ: mirrors the event's own visibility — viewers see every event's roles; a plain
-- member sees the roles of a PUBLISHED event (so the mobile "I can serve" sheet can
-- list them). A role carries no PII.
CREATE POLICY event_roles_select
ON public.event_roles FOR SELECT TO authenticated
USING (
  public.can_read_church(church_id)
  AND (
    public.can_view_events()
    OR EXISTS (SELECT 1 FROM public.events e
               WHERE e.id = event_id AND e.status = 'published')
  )
);

CREATE POLICY event_roles_write_insert
ON public.event_roles FOR INSERT TO authenticated
WITH CHECK (public.can_manage_events() AND public.can_write_church(church_id));

CREATE POLICY event_roles_write_update
ON public.event_roles FOR UPDATE TO authenticated
USING (public.can_manage_events() AND public.can_write_church(church_id))
WITH CHECK (public.can_manage_events() AND public.can_write_church(church_id));

CREATE POLICY event_roles_write_delete
ON public.event_roles FOR DELETE TO authenticated
USING (public.can_manage_events() AND public.can_write_church(church_id));

-- ---------------------------------------------------------------------------
-- 5. event_assignments — who fills a role (stories 6–15).
-- ---------------------------------------------------------------------------
-- Either a member OR a guest, never both (the CHECK enforces it). A guest is
-- event-local — a name and, at most, one contact and one affiliation (Q1/Q5) —
-- never promoted into members. member_id references members(id); RLS keeps that to
-- the caller's readable churches, so a cross-church member cannot be browsed in —
-- cross-church helpers come in as guests (Q1).
CREATE TABLE public.event_assignments (
  id               uuid NOT NULL DEFAULT gen_random_uuid(),
  church_id        uuid NOT NULL,
  event_id         uuid NOT NULL,
  role_id          uuid NOT NULL,
  member_id        uuid,
  guest_name        text,
  guest_contact     text,
  guest_affiliation text,
  status           text NOT NULL DEFAULT 'open',
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid,
  CONSTRAINT event_assignments_pkey PRIMARY KEY (id),
  CONSTRAINT event_assignments_id_church_key UNIQUE (id, church_id),
  CONSTRAINT event_assignments_event_fkey FOREIGN KEY (event_id, church_id)
    REFERENCES public.events (id, church_id) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT event_assignments_role_fkey FOREIGN KEY (role_id, church_id)
    REFERENCES public.event_roles (id, church_id) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT event_assignments_member_fkey FOREIGN KEY (member_id)
    REFERENCES public.members (id) ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT event_assignments_status_check CHECK (status IN ('open', 'confirmed')),
  -- Exactly one of member / guest. A guest is identified by a name; the two contact
  -- fields hang off that name and are meaningless without it.
  CONSTRAINT event_assignments_who_check CHECK (
    (member_id IS NOT NULL AND guest_name IS NULL)
    OR (member_id IS NULL AND guest_name IS NOT NULL
        AND btrim(guest_name) <> '')
  )
);
CREATE INDEX event_assignments_role_idx  ON public.event_assignments (role_id);
CREATE INDEX event_assignments_event_idx ON public.event_assignments (event_id);

ALTER TABLE public.event_assignments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.event_assignments FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.event_assignments TO authenticated;

-- READ: viewers only. Unlike roles, an assignment carries identities and a guest's
-- contact, so a plain member does NOT read the raw roster — they get fill COUNTS via
-- event_role_fill() (section 8) and volunteer through offer_to_serve(), never a
-- direct read of who-is-who. Fail closed (rule 2).
CREATE POLICY event_assignments_select
ON public.event_assignments FOR SELECT TO authenticated
USING (public.can_read_church(church_id) AND public.can_view_events());

CREATE POLICY event_assignments_insert
ON public.event_assignments FOR INSERT TO authenticated
WITH CHECK (public.can_manage_events() AND public.can_write_church(church_id));

CREATE POLICY event_assignments_update
ON public.event_assignments FOR UPDATE TO authenticated
USING (public.can_manage_events() AND public.can_write_church(church_id))
WITH CHECK (public.can_manage_events() AND public.can_write_church(church_id));

CREATE POLICY event_assignments_delete
ON public.event_assignments FOR DELETE TO authenticated
USING (public.can_manage_events() AND public.can_write_church(church_id));

-- Eligibility enforcement (Q7, story 9). A finance-required role can be filled ONLY
-- by a member who is on the finance team — a guest can never satisfy it, and a
-- non-finance member is refused however the write is shaped (UI dimming is the
-- affordance, this trigger is the authz — ADR 0001). Definer so it can read
-- ministry membership regardless of who is assigning.
CREATE OR REPLACE FUNCTION public.event_assignment_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_requires_finance boolean;
BEGIN
  SELECT requires_finance INTO v_requires_finance
  FROM public.event_roles WHERE id = NEW.role_id;

  IF v_requires_finance THEN
    IF NEW.member_id IS NULL THEN
      RAISE EXCEPTION 'A finance-required role must be filled by a finance-team member, not a guest.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT public.member_in_ministry(NEW.member_id, 'finance') THEN
      RAISE EXCEPTION 'This person is not on the finance team and cannot be assigned to count the offering.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- The row's church must match its role's church (defence in depth; the composite
  -- FKs already tie role and event to church_id).
  RETURN NEW;
END;
$$;

CREATE TRIGGER event_assignments_guard
BEFORE INSERT OR UPDATE ON public.event_assignments
FOR EACH ROW EXECUTE FUNCTION public.event_assignment_guard();

-- ---------------------------------------------------------------------------
-- 6. event_programme_items — the running order (stories 16–19).
-- ---------------------------------------------------------------------------
-- SEPARATE from the roster (Q11): a programme lead is a plain note (free text OR a
-- member reference), never an event_assignment — no eligibility, no clash, no gauge
-- impact. An "unassigned" lead is a visible blank, not an open volunteer role.
CREATE TABLE public.event_programme_items (
  id             uuid NOT NULL DEFAULT gen_random_uuid(),
  church_id      uuid NOT NULL,
  event_id       uuid NOT NULL,
  item_time      timestamptz,
  title          text NOT NULL,
  note           text,
  lead_member_id uuid,
  lead_name      text,
  position       integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  CONSTRAINT event_programme_items_pkey PRIMARY KEY (id),
  CONSTRAINT event_programme_items_id_church_key UNIQUE (id, church_id),
  CONSTRAINT event_programme_items_event_fkey FOREIGN KEY (event_id, church_id)
    REFERENCES public.events (id, church_id) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT event_programme_items_lead_fkey FOREIGN KEY (lead_member_id)
    REFERENCES public.members (id) ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT event_programme_items_title_shape CHECK (
    title = btrim(title) AND char_length(title) BETWEEN 1 AND 120
  )
);
CREATE INDEX event_programme_items_event_idx
  ON public.event_programme_items (event_id, position);

ALTER TABLE public.event_programme_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.event_programme_items FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.event_programme_items TO authenticated;

-- READ: any user who can see the event may read its programme (story 18) — viewers
-- always, plain members for a published event.
CREATE POLICY event_programme_items_select
ON public.event_programme_items FOR SELECT TO authenticated
USING (
  public.can_read_church(church_id)
  AND (
    public.can_view_events()
    OR EXISTS (SELECT 1 FROM public.events e
               WHERE e.id = event_id AND e.status = 'published')
  )
);

CREATE POLICY event_programme_items_insert
ON public.event_programme_items FOR INSERT TO authenticated
WITH CHECK (public.can_manage_events() AND public.can_write_church(church_id));

CREATE POLICY event_programme_items_update
ON public.event_programme_items FOR UPDATE TO authenticated
USING (public.can_manage_events() AND public.can_write_church(church_id))
WITH CHECK (public.can_manage_events() AND public.can_write_church(church_id));

CREATE POLICY event_programme_items_delete
ON public.event_programme_items FOR DELETE TO authenticated
USING (public.can_manage_events() AND public.can_write_church(church_id));

-- ---------------------------------------------------------------------------
-- 7. Closeout — attendance and expense, event-scoped (stories 27–35).
-- ---------------------------------------------------------------------------
-- The event links to an ad-hoc service (Q9/Q17). services.event_id lets the closeout
-- provision one head-count service per event (per date for a multi-day event) and
-- read its count. ON DELETE SET NULL: deleting an event must never cascade into an
-- attendance record. Composite FK carries church_id so a service can never point at
-- another church's event.
ALTER TABLE public.services
  ADD COLUMN event_id uuid,
  ADD CONSTRAINT services_event_fkey FOREIGN KEY (event_id, church_id)
    REFERENCES public.events (id, church_id) ON DELETE SET NULL ON UPDATE NO ACTION;
CREATE INDEX services_event_idx ON public.services (event_id) WHERE event_id IS NOT NULL;

-- The event-scoped widening of the attendance subsystem. Events Team may act on a
-- service ONLY because it carries one of their events (an "event I own"), and never
-- on the general attendance domain. Each policy is the 0016 original with a single
-- OR-path added; can_manage_attendance() callers are unaffected.

-- A service the caller may act on because it belongs to an event they manage.
CREATE OR REPLACE FUNCTION public.is_own_event_service(p_event_id uuid, p_church_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT p_event_id IS NOT NULL
     AND public.can_manage_events()
     AND public.can_write_church(p_church_id)
     AND EXISTS (SELECT 1 FROM public.events e
                 WHERE e.id = p_event_id AND e.church_id = p_church_id)
$$;

DROP POLICY IF EXISTS services_select_own_church ON public.services;
CREATE POLICY services_select_own_church ON public.services
  FOR SELECT TO authenticated
  USING (
    (public.can_view_attendance() AND public.can_read_church(church_id))
    OR public.is_own_event_service(event_id, church_id)
  );

DROP POLICY IF EXISTS services_insert_own_church ON public.services;
CREATE POLICY services_insert_own_church ON public.services
  FOR INSERT TO authenticated
  WITH CHECK (
    (public.can_manage_attendance() AND public.can_write_church(church_id))
    -- Events Team may create ONLY an event-linked service (event_id NOT NULL and
    -- theirs). They cannot open a general, event-less service.
    OR public.is_own_event_service(event_id, church_id)
  );

-- attendance rows carry church_id and service_id. The added OR-path lets an Events
-- Team member read/write the attendance of a service that belongs to their event —
-- and only that service.
DROP POLICY IF EXISTS attendance_select_own_church ON public.attendance;
CREATE POLICY attendance_select_own_church ON public.attendance
  FOR SELECT TO authenticated
  USING (
    (public.can_view_attendance() AND public.can_read_church(church_id))
    OR EXISTS (
      SELECT 1 FROM public.services s
      WHERE s.id = attendance.service_id
        AND public.is_own_event_service(s.event_id, s.church_id)
    )
  );

DROP POLICY IF EXISTS attendance_insert_own_church ON public.attendance;
CREATE POLICY attendance_insert_own_church ON public.attendance
  FOR INSERT TO authenticated
  WITH CHECK (
    (
      public.can_manage_attendance()
      AND public.can_write_church(church_id)
      AND (member_id IS NULL OR public.is_member_in_church(member_id, church_id))
    )
    OR (
      (member_id IS NULL OR public.is_member_in_church(member_id, church_id))
      AND EXISTS (
        SELECT 1 FROM public.services s
        WHERE s.id = attendance.service_id
          AND public.is_own_event_service(s.event_id, s.church_id)
      )
    )
  );

DROP POLICY IF EXISTS attendance_delete_own_church ON public.attendance;
CREATE POLICY attendance_delete_own_church ON public.attendance
  FOR DELETE TO authenticated
  USING (
    (public.can_manage_attendance() AND public.can_write_church(church_id))
    OR EXISTS (
      SELECT 1 FROM public.services s
      WHERE s.id = attendance.service_id
        AND public.is_own_event_service(s.event_id, s.church_id)
    )
  );

-- The event-scoped widening of expenses. Events Team may read / insert / update ONLY
-- an expense that carries one of their events (event_id NOT NULL and theirs) — never
-- a general, event-less expense, and never a collection (below, unchanged). The 0016
-- finance predicates stay as the first branch; a single OR-path is added.

-- An expense row the caller may touch because it belongs to an event they manage.
CREATE OR REPLACE FUNCTION public.is_own_event_expense(p_event_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT p_event_id IS NOT NULL
     AND public.can_manage_events()
     AND EXISTS (SELECT 1 FROM public.events e
                 WHERE e.id = p_event_id AND public.can_write_church(e.church_id))
$$;

DROP POLICY IF EXISTS expenses_select_own_church ON public.expenses;
CREATE POLICY expenses_select_own_church ON public.expenses
  FOR SELECT TO authenticated
  USING (
    (public.can_view_finance() AND public.can_read_church(from_church))
    OR public.is_own_event_expense(event_id)
  );

DROP POLICY IF EXISTS expenses_insert_own_church ON public.expenses;
CREATE POLICY expenses_insert_own_church ON public.expenses
  FOR INSERT TO authenticated
  WITH CHECK (
    (public.can_write_finance() AND public.can_write_church(from_church))
    OR (public.is_own_event_expense(event_id) AND public.can_write_church(from_church))
  );

DROP POLICY IF EXISTS expenses_update_own_church ON public.expenses;
CREATE POLICY expenses_update_own_church ON public.expenses
  FOR UPDATE TO authenticated
  USING (
    (public.can_write_finance() AND public.can_write_church(from_church))
    OR public.is_own_event_expense(event_id)
  )
  WITH CHECK (
    (public.can_write_finance() AND public.can_write_church(from_church))
    OR (public.is_own_event_expense(event_id) AND public.can_write_church(from_church))
  );

-- collections are DELIBERATELY UNTOUCHED. Events Team cannot write a collection
-- (Finance only, story 31) and cannot read its identity-bearing rows (0031). The
-- only figure they get is the aggregate, via the definer RPC below.

-- ---------------------------------------------------------------------------
-- 8. Read RPCs for the boundary — aggregate total, fill counts, self-offer.
-- ---------------------------------------------------------------------------

-- The event's collection TOTAL and nothing more (Q10, story 33). Returns a single
-- number; the identity-bearing rows are never selected for the caller. Guarded so
-- the caller must be able to read the church and be an events- or finance-viewer.
-- This is what lets Events Team see "₱X collected" without 0031 being weakened.
CREATE OR REPLACE FUNCTION public.event_collection_total(p_event_id uuid)
RETURNS numeric
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT COALESCE(SUM(c.amount::numeric), 0)
  FROM public.collections c
  JOIN public.events e ON e.id = c.event_id
  WHERE c.event_id = p_event_id
    AND public.can_read_church(e.church_id)
    AND (public.can_view_events() OR public.can_view_finance())
$$;

-- Per-role fill counts for an event (story 2 gauge; the members' mobile sheet). No
-- identities — just how many of each role are filled vs needed. Definer so a plain
-- member can read the gauge of a published event without reading the roster rows.
CREATE OR REPLACE FUNCTION public.event_role_fill(p_event_id uuid)
RETURNS TABLE (role_id uuid, label text, count_required integer, filled integer, requires_finance boolean)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT r.id, r.label, r.count_required,
         (SELECT count(*)::int FROM public.event_assignments a WHERE a.role_id = r.id),
         r.requires_finance
  FROM public.event_roles r
  JOIN public.events e ON e.id = r.event_id
  WHERE r.event_id = p_event_id
    AND public.can_read_church(e.church_id)
    AND (public.can_view_events() OR e.status = 'published')
  ORDER BY r.created_at
$$;

-- A member offers themselves to a role from the mobile sheet (stories 36–37). Q3:
-- auto-accept (status confirmed). Q7: a finance-required role is not self-offerable.
-- Q8: refused when the role is full; a person-clash is NOT blocked here (the UI shows
-- it before the tap). No notification is sent (out of scope). Definer, self-checking.
CREATE OR REPLACE FUNCTION public.offer_to_serve(p_role_id uuid)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_member_id uuid;
  v_role      public.event_roles%ROWTYPE;
  v_filled    integer;
  v_new_id    uuid;
BEGIN
  SELECT member_id INTO v_member_id FROM public.user_accounts WHERE id = auth.uid();
  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'Your account is not linked to a member profile.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_role FROM public.event_roles WHERE id = p_role_id;
  IF v_role.id IS NULL THEN
    RAISE EXCEPTION 'That role no longer exists.' USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = v_role.event_id
      AND public.can_read_church(e.church_id)
      AND e.status = 'published'
  ) THEN
    RAISE EXCEPTION 'That event is not open for volunteering.' USING ERRCODE = 'check_violation';
  END IF;

  IF v_role.requires_finance THEN
    RAISE EXCEPTION 'This role is filled by the events team.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO v_filled FROM public.event_assignments WHERE role_id = p_role_id;
  IF v_filled >= v_role.count_required THEN
    RAISE EXCEPTION 'This role is already full.' USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (SELECT 1 FROM public.event_assignments
             WHERE role_id = p_role_id AND member_id = v_member_id) THEN
    RAISE EXCEPTION 'You are already signed up for this role.' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.event_assignments (church_id, event_id, role_id, member_id, status, created_by)
  VALUES (v_role.church_id, v_role.event_id, p_role_id, v_member_id, 'confirmed', v_member_id)
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 9. Grants — REVOKE the PUBLIC/anon default, GRANT authenticated.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.member_in_ministry(uuid, text)     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_manage_rooms()                 FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.event_assignment_guard()           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_own_event_service(uuid, uuid)   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_own_event_expense(uuid)         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.event_collection_total(uuid)       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.event_role_fill(uuid)              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.offer_to_serve(uuid)               FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.member_in_ministry(uuid, text)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_rooms()                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_own_event_service(uuid, uuid)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_own_event_expense(uuid)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.event_collection_total(uuid)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.event_role_fill(uuid)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.offer_to_serve(uuid)               TO authenticated;
-- event_assignment_guard() is a trigger function, invoked by the trigger machinery,
-- not by a client: neither anon nor authenticated needs EXECUTE (0009 pattern).

COMMIT;

-- PostgREST caches the schema. New tables, columns, and RPCs will 404 until reload:
--   NOTIFY pgrst, 'reload schema';

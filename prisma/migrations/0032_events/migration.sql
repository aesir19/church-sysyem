-- 0032_events — Calendar & Events, Stage 1.
--
-- Adds the events table, the Events Team authorization slug, the two capability
-- composites the feature needs, and the forward-compatible cross-link columns on
-- expenses and collections. RLS is the enforcement (ADR 0001); the SPA's
-- capabilities.js only mirrors these predicates for UI gating and must not drift.
--
-- Design decisions this migration encodes (see issues for the full spec; Stage 2 = #86,
-- Stage 3 = #87):
--   * Events Team is an existing ministry PROMOTED to an authorization slug, exactly as
--     Finance/Welcome/Secretariat are (0014). It gains ministry_key = 'events'.
--   * Two capabilities, deliberately distinct: can_view_events() gates the Events page
--     for the oversight roles; can_manage_events() gates every write. Pastor / Church
--     Leader / Head Pastor SEE the planning phase (drafts included) and cannot write.
--   * The events SELECT policy has TWO audiences: the five privileged roles read every
--     event in their church including drafts; every other authenticated member reads
--     ONLY published events in their own church — that second clause is the members'
--     Calendar. Writes are Events Team (+ SuperAdmin), own church only.
--   * status is draft | published | cancelled. Cancel (frame 7h) keeps a published event
--     on the calendar marked cancelled, so it is a status, not a delete.
--   * projected_budget is a display-only figure (no approval route — that was cut from
--     v1); see #87.
--   * expenses.event_id / collections.event_id are added now, nullable, WITHOUT any
--     policy change, so Stage 3's closeout does not have to re-migrate those tables. They
--     stay NULL until Stage 3 wires the event-scoped write paths.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Promote the Events Team ministry to an authorization slug.
-- ---------------------------------------------------------------------------
-- Idempotent and defensive. The seed data does not carry an Events Team ministry, so
-- this both promotes an existing row (however it was named) and creates one if none is
-- present. If a differently-named row is meant to be Events, an operator renames it and
-- re-points the key; this migration guarantees exactly one ministry keyed 'events'.
UPDATE public.ministries
   SET ministry_key = 'events'
 WHERE ministry_key IS NULL
   AND lower(name) IN ('events team', 'events ministry', 'events');

INSERT INTO public.ministries (name, ministry_key)
SELECT 'Events Team', 'events'
WHERE NOT EXISTS (
  SELECT 1 FROM public.ministries WHERE ministry_key = 'events'
);

-- ---------------------------------------------------------------------------
-- 2. Predicates — the Events Team role and its two capability composites.
-- ---------------------------------------------------------------------------
-- Keyed on the slug via is_in_ministry (0014, re-homed onto ministry_members in 0026),
-- the same door Finance/Welcome/Secretariat use.
CREATE OR REPLACE FUNCTION public.is_events_team()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$ SELECT public.is_in_ministry('events') $$;

-- VIEW: the five roles that may open the Events page and see the planning phase. Mirrors
-- can_view_finance's shape but swaps the ministry in. Head Pastor is a cross-church
-- viewer here (can_read_church already lets it read any church).
CREATE OR REPLACE FUNCTION public.can_view_events()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT public.is_super_admin()
      OR public.is_head_pastor()
      OR public.is_pastor()
      OR public.is_church_leader()
      OR public.is_events_team()
$$;

-- WRITE: ministry-governed (+ SuperAdmin), exactly like can_write_finance. The oversight
-- roles are deliberately absent — they view only.
CREATE OR REPLACE FUNCTION public.can_manage_events()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$ SELECT public.is_super_admin() OR public.is_events_team() $$;

-- ---------------------------------------------------------------------------
-- 3. get_my_permissions() gains is_events_team.
-- ---------------------------------------------------------------------------
-- DROP first: CREATE OR REPLACE cannot change a function's return type, and this one
-- gains a column (same reason as 0022).
DROP FUNCTION IF EXISTS public.get_my_permissions();

CREATE FUNCTION public.get_my_permissions()
RETURNS TABLE (
  role                   text,
  is_super_admin         boolean,
  is_head_pastor         boolean,
  is_pastor              boolean,
  is_church_leader       boolean,
  is_finance             boolean,
  is_secretariat         boolean,
  is_welcome             boolean,
  is_small_group_leader  boolean,
  is_events_team         boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    public.my_role(),
    public.is_super_admin(),
    public.is_head_pastor(),
    public.is_pastor(),
    public.is_church_leader(),
    public.is_finance_member(),
    public.is_secretariat(),
    public.is_welcome_team(),
    public.is_small_group_leader(),
    public.is_events_team()
$$;

-- ---------------------------------------------------------------------------
-- 4. The events table.
-- ---------------------------------------------------------------------------
CREATE TABLE public.events (
  id               uuid        NOT NULL DEFAULT gen_random_uuid(),
  church_id        uuid        NOT NULL,
  title            text        NOT NULL,
  kind             text        NOT NULL,
  status           text        NOT NULL DEFAULT 'draft',
  starts_at        timestamptz NOT NULL,
  ends_at          timestamptz,
  location         text,
  description      text,
  run_by           text,
  projected_budget numeric(12,2),
  cancel_reason    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  published_at     timestamptz,
  CONSTRAINT events_pkey PRIMARY KEY (id),
  -- Composite unique so later stages can FK (event_id, church_id) and keep an event's
  -- children from ever crossing a church boundary, the same guard services uses.
  CONSTRAINT events_id_church_key UNIQUE (id, church_id),
  CONSTRAINT events_church_fkey FOREIGN KEY (church_id)
    REFERENCES public.churches (id) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT events_kind_check CHECK (kind IN
    ('service', 'group_meeting', 'special_service', 'outreach', 'administrative')),
  CONSTRAINT events_status_check CHECK (status IN ('draft', 'published', 'cancelled')),
  -- A published event has a publish time; a draft does not. Keeps the two states honest.
  CONSTRAINT events_published_at_check CHECK (
    (status = 'published' AND published_at IS NOT NULL)
    OR (status <> 'published')
  ),
  CONSTRAINT events_time_order_check CHECK (ends_at IS NULL OR ends_at >= starts_at)
);

CREATE INDEX events_church_starts_idx ON public.events (church_id, starts_at);
CREATE INDEX events_church_status_idx ON public.events (church_id, status);

COMMENT ON TABLE public.events IS
  'Calendar events (Stage 1). A one-off event today; Stage 2 (#86) adds series_id so an '
  'occurrence is just an event that points at a series. status draft|published|cancelled: '
  'published is what the members'' Calendar shows; cancelled stays visible, marked.';

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.events FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.events TO authenticated;

-- SELECT — the two audiences. The privileged five see everything in a readable church;
-- everyone else sees only published events, and only in their own church (can_read_church
-- returns their church for a plain member). This one policy is both the Events page read
-- and the members' Calendar read.
CREATE POLICY events_select_visible
ON public.events
FOR SELECT
TO authenticated
USING (
  public.can_read_church(church_id)
  AND (public.can_view_events() OR status = 'published')
);

-- INSERT / UPDATE / DELETE — Events Team (+ SuperAdmin), own church only.
CREATE POLICY events_insert_own_church
ON public.events
FOR INSERT
TO authenticated
WITH CHECK (public.can_manage_events() AND public.can_write_church(church_id));

CREATE POLICY events_update_own_church
ON public.events
FOR UPDATE
TO authenticated
USING (public.can_manage_events() AND public.can_write_church(church_id))
WITH CHECK (public.can_manage_events() AND public.can_write_church(church_id));

CREATE POLICY events_delete_own_church
ON public.events
FOR DELETE
TO authenticated
USING (public.can_manage_events() AND public.can_write_church(church_id));

-- ---------------------------------------------------------------------------
-- 5. Forward-compatible cross-link columns (no behaviour yet).
-- ---------------------------------------------------------------------------
-- Added now so Stage 3's closeout does not re-migrate these tables. Nullable, ON DELETE
-- SET NULL: deleting an event must never cascade into finance history. No policy changes
-- — these stay NULL until Stage 3 introduces the event-scoped write paths, and Events
-- Team still cannot write finance today.
ALTER TABLE public.expenses
  ADD COLUMN event_id uuid,
  ADD CONSTRAINT expenses_event_fkey FOREIGN KEY (event_id)
    REFERENCES public.events (id) ON DELETE SET NULL ON UPDATE NO ACTION;
CREATE INDEX expenses_event_idx ON public.expenses (event_id) WHERE event_id IS NOT NULL;

ALTER TABLE public.collections
  ADD COLUMN event_id uuid,
  ADD CONSTRAINT collections_event_fkey FOREIGN KEY (event_id)
    REFERENCES public.events (id) ON DELETE SET NULL ON UPDATE NO ACTION;
CREATE INDEX collections_event_idx ON public.collections (event_id) WHERE event_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 6. Grants on the new functions — REVOKE the PUBLIC/anon default, GRANT authenticated.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.is_events_team()        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_view_events()       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_manage_events()     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_permissions()    FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.is_events_team()     TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_events()    TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_events()  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_permissions() TO authenticated;

COMMIT;

-- PostgREST caches the schema. get_my_permissions() changed shape and events/columns are
-- new, so they will 404 until the cache reloads:  NOTIFY pgrst, 'reload schema';

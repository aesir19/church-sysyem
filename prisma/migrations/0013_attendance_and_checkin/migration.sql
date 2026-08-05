-- ============================================================================
-- 0013_attendance_and_checkin — Service records, attendance, and the first
-- unauthenticated write path in this system.
-- ============================================================================
--
-- WHY
-- docs/BACKLOG.md B20: there is no `services` or `attendance` table. The monthly
-- report infers "weeks" from distinct collectedOn / spent_on values because a
-- service does not exist as a thing in its own right, and B22 records that the
-- primary pastoral question — "who is due for follow-up?" — has no data behind
-- it. This migration adds the service concept, the attendance record, and a
-- public self check-in endpoint reachable from a QR code.
--
-- THE CAUSE — why this migration is different from every one before it.
-- 0009_narrow_grants revoked every table privilege AND every function EXECUTE
-- from `anon`, and docs/security/VERIFICATION.md asserts "Anonymous caller
-- touches either table → Denied". A QR page that a visitor opens on their phone
-- with no account is the first anonymous write path this system has ever had.
--
-- The shape below reopens exactly one door and no more:
--
--   * `anon` receives EXECUTE on TWO functions and NOTHING else. No table
--     grant, no sequence grant, no policy naming `anon` anywhere. The assertion
--     "anon holds zero table privileges" stays literally true and the
--     VERIFICATION matrix row stays valid as written.
--   * Both functions are SECURITY DEFINER, so the anon caller never reaches a
--     table directly — the function reaches it on their behalf, under scoping
--     the caller cannot influence beyond the token they present.
--
-- See docs/decisions/0007-public-checkin-endpoint.md for why a static token
-- beats rotation, why the open window is the cost control, and why
-- self-registered attendance is self-asserted rather than verified.
--
-- TRADE-OFF — what this deliberately accepts.
--
--   Nothing inside Postgres can rate-limit an unauthenticated PostgREST
--   endpoint. By the time a function body runs, the connection, the parse, and
--   the planner time have already been spent. Edge rate limiting would need
--   Cloudflare, which ADR-0005 considered and declined. What actually bounds
--   the exposure is that the endpoint is INERT roughly 166 hours out of every
--   168 — outside a church's configured window, a call costs two index probes
--   and writes nothing. That is why the order of operations inside
--   submit_checkin is load-bearing and is commented as such: token lookup, then
--   window lookup, and only then any sanitizing, matching or writing. Anyone
--   reordering it for readability removes the control.
--
--   Self-registered attendance is SELF-ASSERTED. A static token plus a typed
--   name means anyone holding the token can claim any member was present, or
--   squat a name and pre-empt the real person's row. `attendance.source`
--   records the distinction ('self' vs 'staff') and every roster must surface
--   it. This is a stated limitation, not an oversight: the alternative is
--   per-attendee credentials, which is the entire membership onboarding problem.
--
-- WHAT IS DELIBERATELY NOT CHANGED
--
--   get_my_church()'s signature. It is called in four views. A RETURNS TABLE
--   signature cannot be widened by CREATE OR REPLACE, so the check-in token is
--   exposed through a separate get_my_checkin_link() instead of being bolted on.
--
--   `churches` grants. That table has held zero privileges for both roles since
--   0009 and still does. checkin_token is reachable only through an RPC.
--
--   A new role model. Any linked member of a church may manage its schedules
--   and record attendance. The finance gate binds authorization to
--   groups.name = 'Finance Team', a mutable display name — docs/DEFECTS.md D4.
--   Copying that pattern here would double the defect rather than contain it.
--   Attendance is not financial data; the church-scope check is the control.
--
--   Overnight recurring services. CHECK (ends_at > starts_at) forbids a
--   22:00–01:00 watchnight slot in the RECURRING schedule, because supporting it
--   means also evaluating Saturday's schedules at 00:30 Sunday, roughly doubling
--   the resolver. Overnight services are ad-hoc: a `services` row carries raw
--   timestamptz bounds and can span anything up to 24 hours.
--
--   Sequence grants. 0009 granted USAGE on collections_id_seq and
--   expenses_id_seq because those tables are bigserial. Every table here uses
--   uuid DEFAULT gen_random_uuid(), so no sequence exists and no sequence grant
--   is needed. The absence is deliberate, not an omission.
--
--   FORCE ROW LEVEL SECURITY. Do not add it to these tables as a hardening pass.
--   A table's owner is not subject to its own policies, and that is precisely
--   what lets the SECURITY DEFINER functions write on an anonymous caller's
--   behalf. Forcing RLS would break the anon path with no error at deploy time.
--
-- ROLLBACK: see rollback.sql in this directory. It is NOT clean — it destroys
-- attendance history. Read its header before running it.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The per-church check-in token.
-- ---------------------------------------------------------------------------
-- NOT gen_random_bytes(). That is pgcrypto, and on Supabase pgcrypto is
-- installed into the `extensions` schema — with search_path = public the call
-- resolves to nothing and this migration fails outright. gen_random_uuid() is
-- core since PG13, is VOLATILE so it evaluates once per row, and 122 bits of
-- entropy is not meaningfully weaker than 128 for an unguessable URL.
--
-- The DEFAULT matters as much as the backfill: without it, creating a church
-- later would violate the NOT NULL and nobody would find out until the insert.

ALTER TABLE public.churches
  ADD COLUMN checkin_token text DEFAULT translate(gen_random_uuid()::text, '-', ''),
  ADD COLUMN checkin_token_rotated_at timestamptz DEFAULT now();

UPDATE public.churches
   SET checkin_token = translate(gen_random_uuid()::text, '-', ''),
       checkin_token_rotated_at = now()
 WHERE checkin_token IS NULL;

ALTER TABLE public.churches
  ALTER COLUMN checkin_token SET NOT NULL,
  ADD CONSTRAINT churches_checkin_token_key UNIQUE (checkin_token),
  ADD CONSTRAINT churches_checkin_token_shape CHECK (checkin_token ~ '^[0-9a-f]{32}$');

COMMENT ON COLUMN public.churches.checkin_token IS
  'Static per-church QR secret. Printed once and laminated; the open window is the control, not rotation. Reachable only through get_my_checkin_link().';

-- ---------------------------------------------------------------------------
-- 2. service_schedules — recurring weekly slots.
-- ---------------------------------------------------------------------------

CREATE TABLE public.service_schedules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id   uuid NOT NULL REFERENCES public.churches (id) ON DELETE CASCADE,
  label       text NOT NULL,
  weekday     smallint NOT NULL,
  starts_at   time NOT NULL,
  ends_at     time NOT NULL,
  timezone    text NOT NULL DEFAULT 'Asia/Manila',
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,

  CONSTRAINT service_schedules_label_shape CHECK (
    label = btrim(label) AND char_length(label) BETWEEN 2 AND 60
  ),
  CONSTRAINT service_schedules_weekday_check CHECK (weekday BETWEEN 0 AND 6),
  CONSTRAINT service_schedules_window_check CHECK (ends_at > starts_at),
  -- Cannot be CHECK (timezone IN (SELECT ...)) — a subquery is not allowed in a
  -- CHECK. An unvalidated name would raise invalid_parameter_value at runtime,
  -- inside the anon RPC, mid-service. Every church is in the Philippines, so pin
  -- it. The column exists so that widening is a CHECK change (plus a validation
  -- trigger against pg_timezone_names) rather than a data migration.
  CONSTRAINT service_schedules_timezone_check CHECK (timezone = 'Asia/Manila')
);

COMMENT ON COLUMN public.service_schedules.weekday IS
  '0 = Sunday, matching extract(dow ...). NOT isodow (1=Mon..7=Sun) — choosing silently is how a Sunday service lands on Monday.';

-- Without this, two identical active schedules materialize two services in the
-- same instant and re-open the overlapping-window ambiguity at its source.
CREATE UNIQUE INDEX service_schedules_slot_key
  ON public.service_schedules (church_id, weekday, starts_at)
  WHERE is_active;

-- The composite-FK target. See section 4.
ALTER TABLE public.service_schedules
  ADD CONSTRAINT service_schedules_id_church_key UNIQUE (id, church_id);

-- ---------------------------------------------------------------------------
-- 3. services — a concrete occurrence.
-- ---------------------------------------------------------------------------

CREATE TABLE public.services (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id    uuid NOT NULL REFERENCES public.churches (id) ON DELETE CASCADE,
  schedule_id  uuid,
  label        text NOT NULL,
  opens_at     timestamptz NOT NULL,
  closes_at    timestamptz NOT NULL,

  -- Derived in the database so no client can compute it, and so it can never
  -- disagree with the window. docs/DEFECTS.md D8 is exactly this bug in the
  -- frontend: new Date().toISOString().slice(0,10) is wrong for the first eight
  -- hours of every Manila day, which includes an 08:00 Sunday service.
  -- current_date is the SAME bug in SQL — PostgREST's session TimeZone is UTC.
  service_date date GENERATED ALWAYS AS ((opens_at AT TIME ZONE 'Asia/Manila')::date) STORED,

  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid,

  CONSTRAINT services_label_shape CHECK (
    label = btrim(label) AND char_length(label) BETWEEN 2 AND 60
  ),

  -- `>=`, not `>`. closes_at = opens_at is the canonical cancelled state; a
  -- strict `>` would make pre-emptive cancellation (a typhoon Sunday, closed
  -- before it opens) raise 23514 with the constraint name rendered straight to
  -- the user — docs/SECURITY.md §3.5.
  --
  -- The 24-hour cap is not decoration. An accidentally-open window is an
  -- unbounded unauthenticated write endpoint, and a fat-fingered year in a date
  -- picker is exactly how that happens.
  CONSTRAINT services_window_check CHECK (
    closes_at >= opens_at AND closes_at <= opens_at + interval '24 hours'
  ),

  -- ON DELETE RESTRICT, not SET NULL: SET NULL would silently reclassify every
  -- historical service as ad-hoc, destroy the reporting link, and drop those
  -- rows out of services_schedule_day_key. Deactivate a schedule instead.
  --
  -- The church_id column is carried into the FK so a service can never point at
  -- another church's schedule. MATCH SIMPLE (the default) skips the check
  -- entirely when schedule_id IS NULL, which is exactly the semantics ad-hoc
  -- rows need — no extra predicate required.
  CONSTRAINT services_schedule_fkey FOREIGN KEY (schedule_id, church_id)
    REFERENCES public.service_schedules (id, church_id) ON DELETE RESTRICT
);

ALTER TABLE public.services
  ADD CONSTRAINT services_id_church_key UNIQUE (id, church_id);

-- The materialization anchor for ON CONFLICT. Ad-hoc rows are excluded because
-- NULLs are DISTINCT in a unique index: a single combined constraint would be
-- silently inert for every ad-hoc row, which is worse than having none.
CREATE UNIQUE INDEX services_schedule_day_key
  ON public.services (church_id, schedule_id, service_date)
  WHERE schedule_id IS NOT NULL;

-- Ad-hoc rows get no global uniqueness (a church may legitimately hold morning
-- prayer and an evening revival on one date), but a double-tapped Create button
-- must not produce twins.
CREATE UNIQUE INDEX services_adhoc_label_key
  ON public.services (church_id, service_date, lower(btrim(label)))
  WHERE schedule_id IS NULL;

CREATE INDEX services_church_date_idx ON public.services (church_id, service_date DESC);
CREATE INDEX services_church_open_idx ON public.services (church_id, opens_at);

-- ---------------------------------------------------------------------------
-- 4. attendance.
-- ---------------------------------------------------------------------------
-- church_id is denormalized so the RLS predicate stays join-free, matching
-- collections.from_church. That alone would be a CROSS-CHURCH WRITE HOLE:
-- nothing ties church_id to service_id, so church A could insert church_id = A
-- with a church B service_id. The policy would pass, the row would land, and
-- B's per-service counts would be wrong — invisibly, because B's SELECT filters
-- on church_id and never sees it. The composite FK below is what closes that.
-- It is NOT the RLS policy doing this work.

CREATE TABLE public.attendance (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id    uuid NOT NULL,
  church_id     uuid NOT NULL REFERENCES public.churches (id) ON DELETE CASCADE,
  member_id     uuid REFERENCES public.members (id) ON DELETE CASCADE,
  guest_name    text,
  guest_contact text,

  -- Materialized rather than an expression index purely so ON CONFLICT can
  -- infer it by plain column name. Expression-index inference in ON CONFLICT is
  -- brittle; a mismatch raises 42P10 at runtime, on a Sunday, to a phone.
  guest_name_norm text GENERATED ALWAYS AS (
    lower(regexp_replace(btrim(guest_name), '\s+', ' ', 'g'))
  ) STORED,

  source        text NOT NULL DEFAULT 'staff',
  recorded_by   uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT attendance_identity_check CHECK (num_nonnulls(member_id, guest_name) = 1),
  CONSTRAINT attendance_contact_needs_guest CHECK (
    guest_contact IS NULL OR guest_name IS NOT NULL
  ),

  -- text + char_length rather than varchar(80): the staff path inserts straight
  -- through PostgREST and will eventually paste an 85-character name. That
  -- should trip a constraint we named, not a raw
  -- "22001 value too long for type character varying(80)".
  CONSTRAINT attendance_guest_name_shape CHECK (
    guest_name IS NULL
    OR (guest_name = btrim(guest_name) AND char_length(guest_name) BETWEEN 2 AND 80)
  ),

  -- text, NOT Decimal. members.contact_number is Decimal and destroys Philippine
  -- numbers by dropping the leading zero — docs/DEFECTS.md D3. Do not repeat it.
  --
  -- The leading character set includes '(' because Philippine landlines are
  -- routinely written with a parenthesised area code, e.g. (02) 8123-4567.
  -- This bounds the field; it does not validate PH numbering plans.
  CONSTRAINT attendance_guest_contact_shape CHECK (
    guest_contact IS NULL OR guest_contact ~ '^[0-9+(][0-9 ()+-]{6,31}$'
  ),

  CONSTRAINT attendance_source_check CHECK (source IN ('staff', 'self')),
  CONSTRAINT attendance_recorder_check CHECK ((source = 'staff') = (recorded_by IS NOT NULL)),

  CONSTRAINT attendance_service_fkey FOREIGN KEY (service_id, church_id)
    REFERENCES public.services (id, church_id) ON DELETE CASCADE
);

COMMENT ON COLUMN public.attendance.source IS
  'self = the attendee registered themselves via the public QR page and is UNVERIFIED. staff = recorded by a signed-in member. Every roster must surface the difference.';

-- Idempotent member check-in: a second scan is a no-op, not a second row.
CREATE UNIQUE INDEX attendance_service_member_key
  ON public.attendance (service_id, member_id)
  WHERE member_id IS NOT NULL;

-- Anti-spam on the anon path only. Staff may still record two real people who
-- share a name; a self check-in may not multiply itself. Scoped to the
-- normalized column so 'Juan', ' Juan' and 'Juan  Cruz' collide as intended —
-- bare lower() would let all three through. Diacritic and homoglyph variants
-- ('Juán') still slip past; this bounds accidental and casual duplication, not a
-- determined one.
CREATE UNIQUE INDEX attendance_self_guest_key
  ON public.attendance (service_id, guest_name_norm)
  WHERE guest_name IS NOT NULL AND source = 'self';

-- docs/DEFECTS.md D2 — ship indexes with the migration, not after. service_id
-- leads because every real query filters it, and it already implies church_id.
CREATE INDEX attendance_service_idx ON public.attendance (service_id, created_at);
CREATE INDEX attendance_member_idx  ON public.attendance (member_id, created_at DESC)
  WHERE member_id IS NOT NULL;

-- The member-name match runs on the anonymous hot path, and D2 records that
-- `members` carries no index on member_of at all. The normalization in
-- submit_checkin must stay character-identical to this expression or the index
-- is dead weight and the match degrades to a sequential scan.
CREATE INDEX members_church_fullname_idx ON public.members (
  member_of,
  lower(regexp_replace(btrim(first_name || ' ' || last_name), '\s+', ' ', 'g'))
) WHERE archived_at IS NULL;

-- ---------------------------------------------------------------------------
-- 5. Provenance triggers.
-- ---------------------------------------------------------------------------
-- docs/SECURITY.md §3.16: created_by is "cheapest now, impossible to backfill
-- later". §3.13/§3.19 record that two load-bearing triggers exist in no
-- migration and therefore cannot be rebuilt — these are in the migration.

CREATE FUNCTION public.set_created_by()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  NEW.created_by := auth.uid();
  RETURN NEW;
END
$$;

-- recorded_by is derived from `source`, never from the caller. A signed-in staff
-- member who scans the QR on their own phone still reaches submit_checkin, where
-- auth.uid() is non-NULL — deriving it any other way would write source='self'
-- with a non-NULL recorder and violate attendance_recorder_check on what is a
-- completely ordinary action.
CREATE FUNCTION public.set_attendance_recorder()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  NEW.recorded_by := CASE WHEN NEW.source = 'staff' THEN auth.uid() ELSE NULL END;
  RETURN NEW;
END
$$;

CREATE TRIGGER service_schedules_set_created_by
BEFORE INSERT ON public.service_schedules
FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER services_set_created_by
BEFORE INSERT ON public.services
FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER attendance_set_recorder
BEFORE INSERT ON public.attendance
FOR EACH ROW EXECUTE FUNCTION public.set_attendance_recorder();

-- ---------------------------------------------------------------------------
-- 6. The window resolver.
-- ---------------------------------------------------------------------------
-- Three live traps in the timezone arithmetic below:
--
--   1. AT TIME ZONE binds TIGHTER than `+`. `t.d + sch.starts_at AT TIME ZONE tz`
--      parses as `t.d + (sch.starts_at AT TIME ZONE tz)`, which is nonsense.
--      The parentheses are mandatory, not stylistic.
--   2. AT TIME ZONE REVERSES DIRECTION by input type: applied to timestamptz it
--      strips the zone and yields a wall clock; applied to timestamp it attaches
--      one and yields timestamptz. Both directions appear here, lines apart.
--   3. extract(dow FROM <timestamptz>) uses the SESSION TimeZone, which is UTC
--      under PostgREST. Extract from the already-converted local date, which
--      carries no zone and cannot be misread.
--
-- THE INVARIANT: a materialized `services` row is authoritative when present and
-- wins ENTIRELY, never partially — hence coalesce() on both bounds rather than
-- one. An early close must not be re-opened by the schedule fallback, and an
-- extended closes_at must hold. Anyone "helpfully" re-deriving the window from
-- the schedule undoes every manual override.

CREATE FUNCTION public.checkin_open_service(p_church_id uuid)
RETURNS TABLE (
  service_id  uuid,
  schedule_id uuid,
  label       text,
  opens_at    timestamptz,
  closes_at   timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  WITH today AS (
    SELECT (now() AT TIME ZONE 'Asia/Manila')::date AS d
  ),
  scheduled AS (
    SELECT svc.id AS service_id,
           sch.id AS schedule_id,
           coalesce(svc.label, sch.label) AS label,
           coalesce(svc.opens_at,  (t.d + sch.starts_at) AT TIME ZONE sch.timezone) AS opens_at,
           coalesce(svc.closes_at, (t.d + sch.ends_at)   AT TIME ZONE sch.timezone) AS closes_at
    FROM public.service_schedules AS sch
    CROSS JOIN today AS t
    LEFT JOIN public.services AS svc
           ON svc.church_id    = sch.church_id
          AND svc.schedule_id  = sch.id
          AND svc.service_date = t.d
    WHERE sch.church_id = p_church_id
      AND sch.is_active
      AND sch.weekday = extract(dow FROM t.d)::smallint
  ),
  adhoc AS (
    SELECT svc.id AS service_id,
           NULL::uuid AS schedule_id,
           svc.label,
           svc.opens_at,
           svc.closes_at
    FROM public.services AS svc
    WHERE svc.church_id = p_church_id
      AND svc.schedule_id IS NULL
  )
  -- Overlapping windows (kids 08:00–10:00 and main 09:00–11:00, at 09:30) are
  -- legitimate. Staff pick explicitly; an anonymous caller cannot, so a TOTAL
  -- ORDER is imposed and documented: the most recently opened service wins.
  -- Leaving this undefined would record attendance against an arbitrary service
  -- with no error anywhere — the invisible-correctness failure class.
  SELECT w.service_id, w.schedule_id, w.label, w.opens_at, w.closes_at
  FROM (SELECT * FROM scheduled UNION ALL SELECT * FROM adhoc) AS w
  WHERE now() >= w.opens_at AND now() < w.closes_at
  ORDER BY w.opens_at DESC, w.service_id NULLS LAST
  LIMIT 1
$$;

-- Resolve the open window and materialize its `services` row if the schedule has
-- not produced one yet today. Returns NULL when nothing is open.
--
-- CONCURRENCY: two phones at 08:00:00.1 both find nothing and both try to
-- insert. Double-checked locking, following 0005's advisory-lock precedent.
-- Taking the lock unconditionally would serialize every check-in for a church
-- and hand a flooder a connection-exhaustion lever on a 60-connection free tier,
-- so it is taken only on the request that actually materializes.
--
-- This function MUST stay VOLATILE. A STABLE plpgsql function reuses the
-- caller's snapshot for every statement, so the re-SELECT after a lost
-- ON CONFLICT race would find nothing and return "closed" to a person standing
-- in the building. The correctness of the retry depends on READ COMMITTED taking
-- a fresh snapshot per statement, which volatility is what preserves.
CREATE FUNCTION public.checkin_ensure_service(p_church_id uuid)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_window record;
  v_service_id uuid;
  v_local_date date;
BEGIN
  SELECT * INTO v_window FROM public.checkin_open_service(p_church_id);
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_window.service_id IS NOT NULL THEN
    RETURN v_window.service_id;
  END IF;

  -- Only a schedule-backed window can be unmaterialized; an ad-hoc window is a
  -- `services` row by definition. So schedule_id is non-NULL here, and the
  -- partial index below is the right conflict target.
  v_local_date := (now() AT TIME ZONE 'Asia/Manila')::date;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    13001300,
    ('x' || substr(md5(p_church_id::text || v_local_date::text), 1, 8))::bit(32)::int
  );

  SELECT s.service_id INTO v_service_id
  FROM public.checkin_open_service(p_church_id) AS s;
  IF v_service_id IS NOT NULL THEN
    RETURN v_service_id;
  END IF;

  -- The WHERE predicate in the ON CONFLICT clause is MANDATORY when inferring a
  -- partial index. Omit it and this raises 42P10 at runtime.
  INSERT INTO public.services (church_id, schedule_id, label, opens_at, closes_at)
  VALUES (p_church_id, v_window.schedule_id, v_window.label, v_window.opens_at, v_window.closes_at)
  ON CONFLICT (church_id, schedule_id, service_date) WHERE schedule_id IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_service_id;

  IF v_service_id IS NULL THEN
    SELECT s.service_id INTO v_service_id
    FROM public.checkin_open_service(p_church_id) AS s;
  END IF;

  RETURN v_service_id;
END
$$;

-- ---------------------------------------------------------------------------
-- 7. The two anon-reachable functions.
-- ---------------------------------------------------------------------------
-- Every function in this migration sets search_path = pg_catalog, public,
-- pg_temp. The pg_temp entry is LOAD-BEARING for these two specifically: when
-- pg_temp is not named it is searched FIRST, ahead of pg_catalog, and TEMPORARY
-- is granted to PUBLIC by default. An anonymous caller could therefore create
-- pg_temp.services and shadow the real table inside a definer function running
-- as the owner. 0004 and 0005 omit pg_temp safely only because neither is
-- reachable without a JWT. These are.

-- VOLATILE IS DELIBERATE AND MUST NOT BE "OPTIMIZED" TO STABLE.
-- PostgREST exposes STABLE and IMMUTABLE functions over GET, which would put the
-- check-in token in a query string — and therefore into Netlify access logs,
-- browser history, and any Referer header. VOLATILE keeps it POST-only.
--
-- Returns zero rows for BOTH "no such token" and "nothing open right now", so
-- the endpoint cannot be used to discover which tokens are live.
CREATE FUNCTION public.checkin_session_status(p_token text)
RETURNS TABLE (
  church_name   text,
  service_label text,
  service_date  date,
  closes_at     timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_church record;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{32}$' THEN
    RETURN;
  END IF;

  SELECT c.id, c.name INTO v_church
  FROM public.churches AS c
  WHERE c.checkin_token = p_token;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Read-only: this deliberately calls the resolver, not checkin_ensure_service.
  -- Merely looking at a closed page must never create a `services` row.
  RETURN QUERY
  SELECT v_church.name::text,
         w.label,
         (w.opens_at AT TIME ZONE 'Asia/Manila')::date,
         w.closes_at
  FROM public.checkin_open_service(v_church.id) AS w;
END
$$;

-- Returns 'recorded' or 'closed'. NOTHING ELSE.
--
-- 'recorded' covers matched-a-member, matched-nobody, AND already-checked-in.
-- Distinguishing them would turn this endpoint into an oracle for "is X a member
-- of this church" and "is X here today" — both answerable by anyone holding a
-- token that is printed on a wall and will be photographed. Uniformity costs the
-- attendee nothing; the resolution is visible to staff on the roster.
CREATE FUNCTION public.submit_checkin(p_token text, p_name text, p_contact text)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  -- Derived from CLAUDE.md's 300-active-members-per-church threshold with room
  -- for guests. This is an INTEGRITY guard, not a cost guard: a row is ~100
  -- bytes and 500 MB holds ~5M of them. What it bounds is one service's roster
  -- turning into garbage.
  self_checkin_ceiling CONSTANT integer := 500;

  v_church_id  uuid;
  v_service_id uuid;
  v_name       text;
  v_normalized text;
  v_contact    text;
  v_matches    uuid[];
  v_member_id  uuid;
  v_self_count integer;
BEGIN
  -- STEP 1 — shape checks, before touching any table. An abusive call should be
  -- rejected on string length, not after a query.
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{32}$' THEN
    RETURN 'closed';
  END IF;
  IF p_name IS NULL OR char_length(p_name) > 200 THEN
    RETURN 'closed';
  END IF;

  -- STEP 2 — token to church. One index probe on churches_checkin_token_key.
  SELECT c.id INTO v_church_id
  FROM public.churches AS c
  WHERE c.checkin_token = p_token;

  IF v_church_id IS NULL THEN
    RETURN 'closed';
  END IF;

  -- STEP 3 — the window. THE ORDER OF STEPS 1-3 IS THE COST CONTROL: outside a
  -- configured window, which is ~166 hours of every 168, a call reaches here
  -- and stops, having cost two index probes and written nothing. Moving the
  -- sanitizing or matching above this line removes that property.
  v_service_id := public.checkin_ensure_service(v_church_id);
  IF v_service_id IS NULL THEN
    RETURN 'closed';
  END IF;

  -- STEP 4 — ceiling. Degrades rather than fails: self-registration stops, and
  -- the authenticated staff path is completely unaffected, so the service can
  -- still be recorded. A hard failure here would let 500 scripted requests at
  -- 07:55 take check-in away from the whole congregation.
  SELECT count(*) INTO v_self_count
  FROM public.attendance AS a
  WHERE a.service_id = v_service_id AND a.source = 'self';

  IF v_self_count >= self_checkin_ceiling THEN
    RETURN 'closed';
  END IF;

  -- STEP 5 — normalize. Control characters become a SPACE rather than being
  -- deleted: [[:cntrl:]] includes tab and newline, so deleting them would glue
  -- 'Juan<TAB>Dela' into 'JuanDela' and stop it matching the member 'Juan Dela'.
  -- Whitespace is then collapsed, capped, and re-trimmed — left() can sever
  -- mid-space and attendance_guest_name_shape requires an already-trimmed value.
  -- src/utils/checkinPayload.js performs these steps in this order; the two must
  -- not drift.
  v_name := regexp_replace(p_name, '[[:cntrl:]]', ' ', 'g');
  v_name := btrim(regexp_replace(v_name, '\s+', ' ', 'g'));
  v_name := btrim(left(v_name, 80));
  IF char_length(v_name) < 2 THEN
    RETURN 'closed';
  END IF;

  -- Character-identical to members_church_fullname_idx. Changing one without the
  -- other silently drops the index and turns this into a sequential scan.
  v_normalized := lower(regexp_replace(btrim(v_name), '\s+', ' ', 'g'));

  v_contact := regexp_replace(coalesce(p_contact, ''), '[[:cntrl:]]', ' ', 'g');
  v_contact := nullif(btrim(regexp_replace(v_contact, '\s+', ' ', 'g')), '');
  -- Dropped rather than rejected: a malformed number is not worth refusing an
  -- attendance record over, and raising 23514 here would leak the constraint.
  IF v_contact IS NOT NULL AND v_contact !~ '^[0-9+(][0-9 ()+-]{6,31}$' THEN
    v_contact := NULL;
  END IF;

  -- STEP 6 — match. LIMIT 2 bounds the scan and distinguishes "exactly one" from
  -- "ambiguous": two members sharing a name must NOT be guessed between. An
  -- ambiguous name is recorded as a guest and reconciled by staff, which is also
  -- why the return value cannot say whether a match happened.
  --
  -- archived_at IS NULL mirrors is_member_in_my_church(); this function bypasses
  -- RLS entirely, so it repeats the check rather than inheriting it.
  SELECT array_agg(x.id) INTO v_matches
  FROM (
    SELECT m.id
    FROM public.members AS m
    WHERE m.member_of = v_church_id
      AND m.archived_at IS NULL
      AND lower(regexp_replace(btrim(m.first_name || ' ' || m.last_name), '\s+', ' ', 'g')) = v_normalized
    LIMIT 2
  ) AS x;

  IF array_length(v_matches, 1) = 1 THEN
    v_member_id := v_matches[1];
  END IF;

  -- STEP 7 — write. ON CONFLICT DO NOTHING, never EXCEPTION WHEN unique_violation:
  -- an exception block opens a subtransaction and costs orders of magnitude more
  -- on the error path, which is a timing oracle measurable through mobile jitter
  -- given enough samples. It would also surface the index name to the browser
  -- (docs/SECURITY.md §3.5). There is no EXCEPTION block anywhere in this
  -- function, and no early RETURN past step 3, so every accepted call runs the
  -- same statements in the same order.
  IF v_member_id IS NOT NULL THEN
    INSERT INTO public.attendance (service_id, church_id, member_id, source)
    VALUES (v_service_id, v_church_id, v_member_id, 'self')
    ON CONFLICT (service_id, member_id) WHERE member_id IS NOT NULL
    DO NOTHING;
  ELSE
    INSERT INTO public.attendance (service_id, church_id, guest_name, guest_contact, source)
    VALUES (v_service_id, v_church_id, v_name, v_contact, 'self')
    ON CONFLICT (service_id, guest_name_norm) WHERE guest_name IS NOT NULL AND source = 'self'
    DO NOTHING;
  END IF;

  RETURN 'recorded';
END
$$;

-- ---------------------------------------------------------------------------
-- 8. The authenticated-only functions.
-- ---------------------------------------------------------------------------

-- A separate function rather than widening get_my_church(): a RETURNS TABLE
-- signature cannot be changed by CREATE OR REPLACE, and that function is called
-- in four views.
CREATE FUNCTION public.get_my_checkin_link()
RETURNS TABLE (token text, church_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT c.checkin_token, c.name::text
  FROM public.churches AS c
  WHERE c.id = public.get_my_church_id()
  LIMIT 1
$$;

-- Without this, rotation is a manual SQL-editor action and docs/SECURITY.md
-- §3.20 wants an enumerable rotation runbook. Own church only.
CREATE FUNCTION public.rotate_my_checkin_token()
RETURNS text
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  UPDATE public.churches
     SET checkin_token = translate(gen_random_uuid()::text, '-', ''),
         checkin_token_rotated_at = now()
   WHERE id = public.get_my_church_id()
  RETURNING checkin_token
$$;

-- Staff materialize today's service by opening the roster, so the "close now"
-- and "add attendee" paths always have a real service id to work with — without
-- waiting for an attendee to create it by scanning.
CREATE FUNCTION public.ensure_my_open_service()
RETURNS uuid
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT public.checkin_ensure_service(public.get_my_church_id())
$$;

-- LEAST/GREATEST clamps so "close now" can never extend a window and can never
-- violate services_window_check. That makes the CHECK structurally unreachable
-- from any client, which is why `services` needs no UPDATE grant at all — see
-- section 9. Reaching for GRANT UPDATE (closes_at) and hoping the client clamps
-- would put a 23514 in front of a user on a typhoon Sunday.
CREATE FUNCTION public.close_service_now(p_service_id uuid)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  UPDATE public.services
     SET closes_at = LEAST(closes_at, GREATEST(opens_at, now()))
   WHERE id = p_service_id
     AND church_id = public.get_my_church_id()
$$;

-- ---------------------------------------------------------------------------
-- 9. Grants.
-- ---------------------------------------------------------------------------
-- REVOKE FIRST. Supabase's ALTER DEFAULT PRIVILEGES fire on every new object in
-- `public`, so these three tables arrive with ALL privileges already granted to
-- anon AND authenticated. GRANT is additive and cannot displace them. Verified
-- empirically in 0012; the same order as 0009.

REVOKE ALL ON TABLE public.service_schedules FROM anon, authenticated;
REVOKE ALL ON TABLE public.services          FROM anon, authenticated;
REVOKE ALL ON TABLE public.attendance        FROM anon, authenticated;

GRANT SELECT ON TABLE public.service_schedules TO authenticated;
GRANT INSERT (church_id, label, weekday, starts_at, ends_at) ON TABLE public.service_schedules TO authenticated;
GRANT UPDATE (label, weekday, starts_at, ends_at, is_active) ON TABLE public.service_schedules TO authenticated;
-- No DELETE: deactivate via is_active. Deleting a schedule is blocked by
-- services_schedule_fkey's RESTRICT anyway, and this makes that explicit.
-- `timezone` ungranted: CHECK-pinned to Asia/Manila and always the default.
-- `created_by` ungranted: trigger-set.

GRANT SELECT ON TABLE public.services TO authenticated;
GRANT INSERT (church_id, schedule_id, label, opens_at, closes_at) ON TABLE public.services TO authenticated;
-- No UPDATE: closes_at moves only through close_service_now(), which keeps
-- services_window_check unreachable. No DELETE: it would CASCADE attendance away.
-- service_date is GENERATED and cannot be granted.

GRANT SELECT, DELETE ON TABLE public.attendance TO authenticated;
GRANT INSERT (service_id, church_id, member_id, guest_name, guest_contact) ON TABLE public.attendance TO authenticated;
-- `source` IS WITHHELD DELIBERATELY, AND IT IS THE WHOLE CONTROL.
-- With it granted, any client holding a staff JWT could write source = 'self' to
-- forge self-registrations, or source = 'staff' to escape attendance_self_guest_key.
-- The column grant is what makes provenance unforgeable — the same reasoning as
-- groups.color_slot in 0005, and ADR-0001 consequence 3: "adding a field to a
-- form is not enough to make it writable."
-- `recorded_by` withheld: trigger-derived from source.

-- churches: NO new grant. It has held zero privileges for both roles since 0009
-- and continues to. checkin_token is reachable only through get_my_checkin_link().

-- 0009's lesson: REVOKE ... FROM PUBLIC alone does NOT remove anon's EXECUTE,
-- because Supabase's default privileges grant it to the role directly. Name
-- every role explicitly.
REVOKE ALL ON FUNCTION public.set_created_by()                       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_attendance_recorder()              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.checkin_open_service(uuid)             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.checkin_ensure_service(uuid)           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.checkin_session_status(text)           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.submit_checkin(text, text, text)       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_checkin_link()                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rotate_my_checkin_token()              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ensure_my_open_service()               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.close_service_now(uuid)                FROM PUBLIC, anon, authenticated;

-- THE ONLY TWO GRANTS TO anon IN THIS ENTIRE SYSTEM. A third entry appearing in
-- the capture script's function-grant query is a regression, and
-- docs/security/VERIFICATION.md now checks for exactly this.
GRANT EXECUTE ON FUNCTION public.checkin_session_status(text)     TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_checkin(text, text, text) TO anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_my_checkin_link()     TO authenticated;
GRANT EXECUTE ON FUNCTION public.rotate_my_checkin_token() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_my_open_service()  TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_service_now(uuid)   TO authenticated;

-- checkin_open_service and checkin_ensure_service stay unreachable by both
-- roles: they take a church_id parameter and would otherwise let any caller
-- resolve or materialize another church's service.

-- ---------------------------------------------------------------------------
-- 10. RLS.
-- ---------------------------------------------------------------------------
-- Explicit, because the rls_auto_enable() event trigger that would otherwise do
-- this exists in no migration (docs/SECURITY.md §3.13) and will not fire on a
-- rebuilt database. A table created without RLS looks exactly like a working one.

ALTER TABLE public.service_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance        ENABLE ROW LEVEL SECURITY;

-- Per-command policies, following 0007's split rather than FOR ALL.
-- NO POLICY NAMES anon ANYWHERE. An anonymous caller never touches these tables;
-- the definer functions do, as the owner, which RLS does not constrain.

CREATE POLICY service_schedules_select_own_church ON public.service_schedules
  FOR SELECT TO authenticated
  USING (church_id = public.get_my_church_id());

CREATE POLICY service_schedules_insert_own_church ON public.service_schedules
  FOR INSERT TO authenticated
  WITH CHECK (church_id = public.get_my_church_id());

CREATE POLICY service_schedules_update_own_church ON public.service_schedules
  FOR UPDATE TO authenticated
  USING (church_id = public.get_my_church_id())
  WITH CHECK (church_id = public.get_my_church_id());

CREATE POLICY services_select_own_church ON public.services
  FOR SELECT TO authenticated
  USING (church_id = public.get_my_church_id());

CREATE POLICY services_insert_own_church ON public.services
  FOR INSERT TO authenticated
  WITH CHECK (church_id = public.get_my_church_id());

CREATE POLICY attendance_select_own_church ON public.attendance
  FOR SELECT TO authenticated
  USING (church_id = public.get_my_church_id());

-- is_member_in_my_church() (0004) is the member-side scope check; the composite
-- FK is the service-side one. Neither substitutes for the other: the FK cannot
-- see auth.uid(), and the policy cannot cheaply see the service's church.
CREATE POLICY attendance_insert_own_church ON public.attendance
  FOR INSERT TO authenticated
  WITH CHECK (
    church_id = public.get_my_church_id()
    AND (member_id IS NULL OR public.is_member_in_my_church(member_id))
  );

CREATE POLICY attendance_delete_own_church ON public.attendance
  FOR DELETE TO authenticated
  USING (church_id = public.get_my_church_id());

COMMIT;

-- PostgREST caches the schema. Supabase's own event trigger normally reloads it
-- after DDL; if the new RPCs 404 immediately after deploy, run:
--   NOTIFY pgrst, 'reload schema';

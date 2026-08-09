-- ============================================================================
-- Attendance fixture for the STAGING database.
-- ============================================================================
-- Fills in a plausible history of services and attendance so the Attendance view
-- has something to show: a weekly Sunday schedule per church, one materialized
-- service per past Sunday, member rows with a realistic staff/self provenance
-- mix, and guest rows.
--
-- The guest rows are the point, not filler. Three populations are seeded
-- deliberately, because they are the three cases the "Link to member" action
-- (0019_attendance_guest_link) has to handle and they are tedious to produce by
-- hand:
--
--   A. Mistyped members whose member row is ABSENT from that service — linking
--      succeeds and rewrites the row in place.
--   B. Mistyped members whose member row is PRESENT — linking trips
--      attendance_service_member_key and takes the merge path instead.
--   C. Genuine visitors who match nobody — linking should never be attempted.
--
-- WHY SQL RATHER THAN A NODE SCRIPT
-- Sibling of scripts/sql/seed-staging-rbac.sql, run the same two ways. Seeding
-- through PostgREST would need a service_role key in a shipped script, which
-- CLAUDE.md forbids outright; seeding through the anon key as a signed-in user
-- cannot write `source` at all (it is withheld from the INSERT grant, which is
-- what makes provenance unforgeable) and so could not produce a single 'self'
-- row. Running as the table owner is the only way to build a fixture whose
-- provenance mix looks like production.
--
--   npm run seed:attendance          -- .env.staging, prints the host first
--   -- or paste into the Supabase SQL editor, on STAGING
--
-- There is deliberately no :prod sibling. This writes fake people.
--
-- PRECONDITIONS
--   * scripts/sql/seed-staging-rbac.sql has run — churches, members and at least
--     one user_accounts row must exist. Roster size is bounded by how many
--     members each church has; with the RBAC fixture alone that is 3-6 per
--     church, which is small but exercises every path.
--   * bootstrap-triggers.sql has run (this relies on the provenance triggers
--     behaving exactly as they do in production).
--
-- IDEMPOTENT. Unlike the RBAC fixture, this can be re-run: every insert either
-- has an ON CONFLICT arm or a NOT EXISTS guard. Re-running after time has passed
-- adds the Sundays that have happened since and leaves everything else alone.
-- Tunable via seed_params below.
--
-- Cleanup is at the bottom of this file, commented out.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Knobs.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE seed_params AS SELECT
  8   AS weeks_back,             -- how many past Sundays to materialize
  72  AS attendance_rate,        -- % of a church's active members per service
  30  AS self_rate,              -- % of those recorded as self check-ins
  2   AS mistyped_absent,        -- population A, per service
  1   AS mistyped_present,       -- population B, per service
  2   AS visitors;               -- population C, per service

-- ---------------------------------------------------------------------------
-- 1. Seed actor.
-- ---------------------------------------------------------------------------
-- set_attendance_recorder and set_created_by both derive their column from
-- auth.uid(), and attendance_recorder_check requires recorded_by to be non-NULL
-- for every source='staff' row. In a SQL session auth.uid() is NULL unless the
-- JWT claim is set, so without this every staff row below would fail 23514 with
-- a constraint name and no explanation. Session scope (is_local = false) so it
-- survives whether or not the caller wrapped this file in a transaction.
DO $$
DECLARE actor uuid;
BEGIN
  SELECT id INTO actor FROM public.user_accounts ORDER BY id LIMIT 1;

  IF actor IS NULL THEN
    RAISE EXCEPTION 'No user_accounts row exists. Run scripts/sql/seed-staging-rbac.sql first — every staff attendance row needs a recorder.';
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', actor, 'role', 'authenticated')::text,
    false
  );

  -- Prove it took, here, rather than discovering it four statements later as a
  -- bare 23514 on attendance_recorder_check. The setting is session-scoped, and a
  -- connection pooler in transaction mode can hand out a different backend between
  -- statements and silently drop it — which is why npm run seed:attendance goes
  -- through DIRECT_URL (scripts/prisma/db-execute.js) rather than the pooled
  -- DATABASE_URL. If this raises, that routing is what to check first.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is still NULL after setting request.jwt.claims. This session cannot record a staff attendance row. Run via `npm run seed:attendance` (direct connection), not over the pooled DATABASE_URL.';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. A weekly Sunday slot per church.
-- ---------------------------------------------------------------------------
-- weekday 0 = Sunday (extract(dow ...), NOT isodow). Only churches with active
-- members get one; a church with nobody in it would produce empty rosters.
INSERT INTO public.service_schedules (church_id, label, weekday, starts_at, ends_at)
SELECT c.id, 'Sunday Service', 0, TIME '08:00', TIME '11:00'
FROM public.churches c
WHERE EXISTS (
  SELECT 1 FROM public.members m WHERE m.member_of = c.id AND m.archived_at IS NULL
)
AND NOT EXISTS (
  SELECT 1 FROM public.service_schedules s
  WHERE s.church_id = c.id AND s.weekday = 0 AND s.starts_at = TIME '08:00'
);

-- The slots this run owns, named ONCE. Everything downstream derives from this
-- table rather than repeating the predicate, so the services that get created and
-- the services that get a roster cannot drift apart. They did in an earlier draft:
-- section 3 matched every active schedule while section 4 matched only these,
-- which materialized empty services for any Wednesday or evening slot already on
-- the database and left them with nobody in them.
CREATE TEMP TABLE seed_schedules AS
SELECT id, church_id, label, starts_at, ends_at, weekday, timezone
FROM public.service_schedules
WHERE is_active AND weekday = 0 AND starts_at = TIME '08:00';

-- ---------------------------------------------------------------------------
-- 3. One service per past Sunday.
-- ---------------------------------------------------------------------------
-- Two traps here, both real:
--
--   1. AT TIME ZONE binds tighter than '+', so `d + sch.starts_at AT TIME ZONE tz`
--      parses as `d + (starts_at AT TIME ZONE tz)`, which is nonsense. 0013 flags
--      this explicitly. Hence the inner parentheses.
--   2. generate_series over two dates returns TIMESTAMP, not date — and there is
--      no `timestamp + time` operator. The `::date` cast is what makes the
--      documented `date + time -> timestamp` operator apply.
--
-- service_date is GENERATED from opens_at and is never written.
--
-- The ON CONFLICT target repeats the index predicate because
-- services_schedule_day_key is PARTIAL; omitting `WHERE schedule_id IS NOT NULL`
-- raises 42P10 rather than inferring it.
INSERT INTO public.services (church_id, schedule_id, label, opens_at, closes_at)
SELECT
  sch.church_id,
  sch.id,
  sch.label,
  ((g.day::date + sch.starts_at) AT TIME ZONE sch.timezone),
  ((g.day::date + sch.ends_at) AT TIME ZONE sch.timezone)
FROM seed_schedules sch
CROSS JOIN seed_params p
CROSS JOIN LATERAL generate_series(
  (now() AT TIME ZONE sch.timezone)::date - (7 * p.weeks_back),
  (now() AT TIME ZONE sch.timezone)::date,
  interval '1 day'
) AS g(day)
WHERE sch.weekday = extract(dow FROM g.day)
  -- Never seed a window that has not opened yet: an open window is a live
  -- unauthenticated write endpoint, and a fixture has no business creating one.
  AND ((g.day::date + sch.ends_at) AT TIME ZONE sch.timezone) < now()
ON CONFLICT (church_id, schedule_id, service_date) WHERE schedule_id IS NOT NULL
DO NOTHING;

-- The services this run is allowed to touch — the ones belonging to the slots
-- above, and nothing else. An ad-hoc service someone created by hand while
-- testing is deliberately left alone.
CREATE TEMP TABLE seed_services AS
SELECT s.id, s.church_id, s.service_date
FROM public.services s
JOIN seed_schedules sch ON sch.id = s.schedule_id
CROSS JOIN seed_params p
WHERE s.service_date >= (now() AT TIME ZONE 'Asia/Manila')::date - (7 * p.weeks_back);

-- ---------------------------------------------------------------------------
-- 4. Member attendance.
-- ---------------------------------------------------------------------------
-- Deterministic pseudo-randomness: hashtext over (member, service) gives the same
-- roster on every re-run, so a bug that reproduces once reproduces again.
--
-- `% 100` BEFORE abs(), not after: hashtext can return -2147483648, and abs() of
-- that overflows integer.
--
-- `source` is written directly here. That is only possible because this runs as
-- the table owner — the column is withheld from the authenticated INSERT grant
-- precisely so no client can forge it. The trigger still owns recorded_by, and
-- derives it from source, so the two can never disagree.
INSERT INTO public.attendance (service_id, church_id, member_id, source)
SELECT
  s.id,
  s.church_id,
  m.id,
  CASE WHEN abs(hashtext('src' || m.id::text || s.id::text) % 100) < p.self_rate
       THEN 'self' ELSE 'staff' END
FROM seed_services s
CROSS JOIN seed_params p
JOIN public.members m ON m.member_of = s.church_id AND m.archived_at IS NULL
WHERE abs(hashtext(m.id::text || s.id::text) % 100) < p.attendance_rate
ON CONFLICT (service_id, member_id) WHERE member_id IS NOT NULL
DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5. Population A — mistyped members who are NOT otherwise on the roster.
-- ---------------------------------------------------------------------------
-- This is the case the feature exists for: a real member typed their own name
-- into the public QR page, got it slightly wrong, and fell through
-- submit_checkin's exact-name match into a guest row. Linking these rewrites the
-- row in place and the guest count drops.
--
-- The "typo" is one dropped vowel — regexp_replace without the 'g' flag replaces
-- only the first match. Santos -> Sntos.
--
-- source = 'self' because that is the only way this happens in reality; a staff
-- member recording someone would have picked them from the member list.
WITH candidate AS (
  SELECT
    s.id AS service_id,
    s.church_id,
    m.first_name || ' ' || regexp_replace(m.last_name, '[aeiou]', '') AS guest_name,
    row_number() OVER (
      PARTITION BY s.id ORDER BY hashtext('absent' || m.id::text || s.id::text)
    ) AS rn
  FROM seed_services s
  JOIN public.members m ON m.member_of = s.church_id AND m.archived_at IS NULL
  WHERE NOT EXISTS (
    SELECT 1 FROM public.attendance a WHERE a.service_id = s.id AND a.member_id = m.id
  )
)
INSERT INTO public.attendance (service_id, church_id, guest_name, source)
SELECT c.service_id, c.church_id, c.guest_name, 'self'
FROM candidate c
CROSS JOIN seed_params p
WHERE c.rn <= p.mistyped_absent
  AND char_length(c.guest_name) BETWEEN 2 AND 80
ON CONFLICT (service_id, guest_name_norm) WHERE guest_name IS NOT NULL AND source = 'self'
DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6. Population B — mistyped members who ARE already on the roster.
-- ---------------------------------------------------------------------------
-- Same mistake, but the person also got recorded properly, so the roster
-- double-counts them. Linking these cannot rewrite the row —
-- attendance_service_member_key rejects a second row for the same member — so it
-- takes the merge path and deletes the duplicate instead. Seeded separately
-- because that branch is otherwise almost impossible to reach by hand.
--
-- A different typo (dropped final letter) so these are distinguishable from
-- population A at a glance, and so the two cannot collide on guest_name_norm.
WITH candidate AS (
  SELECT
    s.id AS service_id,
    s.church_id,
    m.first_name || ' ' || left(m.last_name, greatest(char_length(m.last_name) - 1, 1)) AS guest_name,
    row_number() OVER (
      PARTITION BY s.id ORDER BY hashtext('present' || m.id::text || s.id::text)
    ) AS rn
  FROM seed_services s
  JOIN public.members m ON m.member_of = s.church_id AND m.archived_at IS NULL
  WHERE EXISTS (
    SELECT 1 FROM public.attendance a WHERE a.service_id = s.id AND a.member_id = m.id
  )
)
INSERT INTO public.attendance (service_id, church_id, guest_name, source)
SELECT c.service_id, c.church_id, c.guest_name, 'self'
FROM candidate c
CROSS JOIN seed_params p
WHERE c.rn <= p.mistyped_present
  AND char_length(c.guest_name) BETWEEN 2 AND 80
ON CONFLICT (service_id, guest_name_norm) WHERE guest_name IS NOT NULL AND source = 'self'
DO NOTHING;

-- ---------------------------------------------------------------------------
-- 7. Population C — genuine visitors.
-- ---------------------------------------------------------------------------
-- Recorded by staff, with a contact number, matching nobody in `members`. These
-- must stay guests; if someone links one of these the fixture has been
-- misunderstood.
--
-- The number is shaped to satisfy attendance_guest_contact_shape
-- ('^[0-9+(][0-9 ()+-]{6,31}$') and kept as TEXT throughout — members.contact_number
-- is Decimal and eats the leading zero of every Philippine mobile number (D3).
-- Do not "improve" this into a numeric.
-- NOT EXISTS rather than ON CONFLICT, unlike the two populations above. The only
-- guest-name unique index is attendance_self_guest_key, which is partial on
-- source = 'self' — staff-recorded guests are deliberately not covered by it,
-- because staff may legitimately record two real people who share a name. An
-- ON CONFLICT arm here would name an arbiter that these rows can never violate,
-- and re-running the fixture would duplicate every visitor.
INSERT INTO public.attendance (service_id, church_id, guest_name, guest_contact, source)
SELECT
  s.id,
  s.church_id,
  v.name,
  '0917 ' || lpad((abs(hashtext(v.name || s.id::text) % 10000000))::text, 7, '0'),
  'staff'
FROM seed_services s
CROSS JOIN seed_params p
CROSS JOIN unnest(ARRAY[
  'Bisita Reyes', 'Ana Villanueva', 'Mark Del Rosario',
  'Joy Bautista', 'Ramon Aquino'
]) WITH ORDINALITY AS v(name, pos)
WHERE v.pos <= p.visitors
  AND NOT EXISTS (
    SELECT 1 FROM public.attendance a
    WHERE a.service_id = s.id AND a.guest_name = v.name
  );

-- ---------------------------------------------------------------------------
-- 8. Verify.
-- ---------------------------------------------------------------------------
-- Per-service shape. `guests` here must match what summariseRoster computes in
-- the SPA (rows with no member_id).
SELECT
  c.name          AS church,
  s.service_date,
  count(*)                                        AS total,
  count(*) FILTER (WHERE a.member_id IS NOT NULL) AS members,
  count(*) FILTER (WHERE a.member_id IS NULL)     AS guests,
  count(*) FILTER (WHERE a.source = 'self')       AS self_checkins
FROM seed_services s
JOIN public.churches c ON c.id = s.church_id
LEFT JOIN public.attendance a ON a.service_id = s.id
GROUP BY c.name, s.service_date
ORDER BY c.name, s.service_date DESC;

-- Every guest row now waiting to be linked, and which population it came from.
-- `merge (duplicate)` rows are the ones that exercise the 23505 branch.
SELECT
  c.name AS church,
  s.service_date,
  a.guest_name,
  a.source,
  CASE
    WHEN a.guest_contact IS NOT NULL THEN 'visitor (leave as guest)'
    WHEN EXISTS (
      SELECT 1 FROM public.attendance dup
      JOIN public.members m ON m.id = dup.member_id
      WHERE dup.service_id = a.service_id
        AND lower(m.first_name) = lower(split_part(a.guest_name, ' ', 1))
    ) THEN 'merge (duplicate)'
    ELSE 'link (in place)'
  END AS expected_outcome
FROM public.attendance a
JOIN seed_services s ON s.id = a.service_id
JOIN public.churches c ON c.id = a.church_id
WHERE a.guest_name IS NOT NULL
ORDER BY c.name, s.service_date DESC, a.guest_name;

DROP TABLE seed_services;
DROP TABLE seed_schedules;
DROP TABLE seed_params;

-- ---------------------------------------------------------------------------
-- 9. Cleanup — uncomment to remove everything this fixture created.
-- ---------------------------------------------------------------------------
-- Order matters: attendance first, then services, then the schedule. Deleting
-- the schedule first fails on services_schedule_fkey, which is ON DELETE RESTRICT
-- deliberately so history is never silently reclassified as ad-hoc.
--
-- DELETE FROM public.attendance a
--  USING public.services s, public.service_schedules sch
--  WHERE a.service_id = s.id AND s.schedule_id = sch.id
--    AND sch.weekday = 0 AND sch.starts_at = TIME '08:00';
--
-- DELETE FROM public.services s
--  USING public.service_schedules sch
--  WHERE s.schedule_id = sch.id
--    AND sch.weekday = 0 AND sch.starts_at = TIME '08:00';
--
-- DELETE FROM public.service_schedules
--  WHERE weekday = 0 AND starts_at = TIME '08:00' AND label = 'Sunday Service';

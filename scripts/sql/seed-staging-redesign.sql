-- ============================================================================
-- Roster, groups, collections and expenses fixture for the STAGING database.
-- ============================================================================
-- Written for the redesign. The mockups render their own density as copy —
-- "248 active records · 39 archived", "6 groups · 82 assignments · 41 members in
-- none", "₱60,500.00 · 86 entries across 4 service dates" — and several layouts
-- only read correctly when the data is actually there: the members table's
-- pagination, the group cards' "+N more" avatar overflow, the funds allocation
-- bar, the by-description expense chart. Staging held 13 members, 3 groups and
-- ZERO collections and expenses, so those two screens rendered empty and could
-- not be reviewed against the design at all.
--
-- WHY SQL RATHER THAN A NODE SCRIPT
-- Sibling of seed-staging-rbac.sql and seed-staging-attendance.sql, run the same
-- two ways. Seeding through PostgREST would need a service_role key in a shipped
-- script, which rule 1's security sibling forbids outright.
--
--   npm run seed:redesign            -- .env.staging, prints the host first
--   -- or paste into the Supabase SQL editor, on STAGING
--
-- There is deliberately no :prod sibling. This writes fake people.
--
-- EVERY PERSON IN HERE IS FABRICATED. The names are common Filipino given and
-- family names combined arithmetically; any resemblance to a real member of any
-- UDFC church is coincidence. That matters beyond taste: these rows end up in
-- screenshots passed back and forth during design review, and real member PII in
-- a review transcript is the thing docs/SECURITY.md exists to prevent.
--
-- IDEMPOTENT AND REVERSIBLE. Every row this file owns carries a recognisable
-- primary key — members are '5eed0000-…', groups are '5eed0001-…' — so section 1
-- can delete exactly what a previous run created and nothing else. Collections
-- and expenses use bigint identities and cannot be tagged that way, so they are
-- scoped by church and by the seeded date window instead; see section 6.
-- Teardown is section 8, commented out.
--
-- PRECONDITIONS
--   * seed-staging-rbac.sql has run — churches and at least one user_accounts
--     row must exist.
--   * Run seed-staging-attendance.sql AFTER this one. It is roster-driven (72%
--     of a church's active members per service), so running it second is what
--     gives the 248 new members an attendance history; running it first leaves
--     the Attendance screen showing thirteen people out of two hundred.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Knobs.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE seed_params AS SELECT
  'Cogon'::text AS church_name,   -- the superadmin's home church; the mockups' "Bethel"
  248           AS active_members,
  39            AS archived_members,
  41            AS members_in_no_group,
  DATE '2026-07-01' AS ledger_month;  -- the month collections/expenses are built for

-- ---------------------------------------------------------------------------
-- 1. Refuse to run anywhere but staging, then clear the previous run.
-- ---------------------------------------------------------------------------
-- The npm script routes through .env.staging and db-execute.js prints the host
-- first, but neither stops a hand-paste into the wrong SQL editor. 'Staging Test
-- Church' exists only on staging and is the cheapest available fingerprint.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.churches WHERE name = 'Staging Test Church') THEN
    RAISE EXCEPTION
      'Refusing to run: this database has no "Staging Test Church" row, so it does not look like staging. This script writes several hundred fabricated people. If you are certain, remove this guard deliberately rather than by accident.';
  END IF;
END
$$;

CREATE TEMP TABLE seed_church AS
SELECT c.id
FROM public.churches c, seed_params p
WHERE c.name = p.church_name;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM seed_church) THEN
    RAISE EXCEPTION 'Target church not found. Check seed_params.church_name.';
  END IF;
END
$$;

-- Delete in dependency order. group_members and collections cascade from members
-- anyway, but being explicit keeps the intent readable.
DELETE FROM public.group_members WHERE member_id::text LIKE '5eed0000-%';
DELETE FROM public.group_members WHERE group_id::text  LIKE '5eed0001-%';
DELETE FROM public.collections   WHERE "from"::text    LIKE '5eed0000-%';
DELETE FROM public.attendance    WHERE member_id::text LIKE '5eed0000-%';
DELETE FROM public.members       WHERE id::text        LIKE '5eed0000-%';
DELETE FROM public.groups        WHERE id::text        LIKE '5eed0001-%';

-- ---------------------------------------------------------------------------
-- 2. Name pools.
-- ---------------------------------------------------------------------------
-- Indexed by three DIFFERENT primes below so first name, last name and middle
-- initial do not march in lockstep and produce visible repetition down the table.
CREATE TEMP TABLE seed_first_f AS SELECT * FROM unnest(ARRAY[
  'Maria','Grace','Anna','Rita','Marites','Liza','Elena','Rowena','Cecilia','Divina',
  'Jocelyn','Analyn','Bernadette','Cristina','Dolores','Editha','Fe','Gloria','Herminia','Imelda',
  'Josefina','Katherine','Lourdes','Mercedes','Nenita','Olivia','Perlita','Remedios','Sonia','Teresita',
  'Ursula','Violeta','Wilma','Yolanda','Zenaida','Angelica','Beatriz','Carmela','Daisy','Evangeline'
]) WITH ORDINALITY AS t(name, ord);

CREATE TEMP TABLE seed_first_m AS SELECT * FROM unnest(ARRAY[
  'Jose','Juan','Daniel','Michael','Joel','Ramon','Arnel','Jerome','Paolo','Ricardo',
  'Alfredo','Benigno','Carlito','Domingo','Eduardo','Ferdinand','Gregorio','Hernan','Ignacio','Jaime',
  'Kristoffer','Leonardo','Mariano','Nestor','Orlando','Patricio','Quirino','Rodolfo','Salvador','Teodoro',
  'Ulysses','Vicente','Wilfredo','Xavier','Yves','Zaldy','Antonio','Bernardo','Cesar','Dominador'
]) WITH ORDINALITY AS t(name, ord);

CREATE TEMP TABLE seed_last AS SELECT * FROM unnest(ARRAY[
  'Abad','Bautista','Cordero','Delos Reyes','Escuadro','Fajardo','Gonzales','Hernandez','Ibarra','Jimenez',
  'Katigbak','Lacsamana','Mendoza','Navarro','Ocampo','Pascual','Quijano','Ramos','Santos','Tolentino',
  'Urbano','Villanueva','Wagan','Ycasiano','Zamora','Aguilar','Bacani','Cabral','Dizon','Espino',
  'Flores','Galang','Hizon','Icasiano','Javier','Lim','Macaraeg','Nicolas','Olivares','Padilla',
  'Reyes','Salazar','Tan','Uy','Valdez','Yap','Alonzo','Bernardo','Castillo','Domingo'
]) WITH ORDINALITY AS t(name, ord);

-- ---------------------------------------------------------------------------
-- 3. The roster.
-- ---------------------------------------------------------------------------
-- 287 rows: 248 active and 39 archived.
--
-- Variability is deliberate and per-field, because a table where everyone is 34,
-- female and married tells you nothing about whether the design holds. Age
-- follows the mockup's own demographic split (0–17: 22, 18–29: 70, 30–44: 83,
-- 45–59: 47, 60+: 26) and gender its 57/43 female/male split, so the Statistics
-- screen's age bands and gender bar have something true to draw when they are
-- eventually built.
--
-- The journey booleans deliberately include OUT-OF-ORDER completions — people
-- baptized with no one-to-one recorded, a few with the membership certification
-- and nothing else. The owner's rule is that the four steps are not hard entries
-- into one another, and a fixture where progress is always a clean prefix would
-- let a UI quietly reintroduce gating without anything looking wrong.
CREATE TEMP TABLE seed_people AS
WITH p AS (SELECT * FROM seed_params),
n AS (
  SELECT
    i,
    i <= (SELECT active_members FROM p) AS is_active,
    -- Three different primes, so the fields do not correlate.
    ((i * 7)  % 40) + 1 AS first_ix,
    ((i * 13) % 50) + 1 AS last_ix,
    ((i * 17) % 26)     AS middle_ix,
    (i * 31) % 100      AS r_gender,
    (i * 37) % 100      AS r_age,
    (i * 41) % 100      AS r_journey,
    (i * 43) % 100      AS r_contact,
    (i * 47) % 100      AS r_marital,
    (i * 53) % 100      AS r_quirk
  FROM generate_series(1, (SELECT active_members + archived_members FROM p)) AS i
)
SELECT
  ('5eed0000-0000-4000-8000-' || lpad(n.i::text, 12, '0'))::uuid AS id,
  n.is_active,
  CASE WHEN n.r_gender < 57 THEN 'Female' ELSE 'Male' END AS gender,
  CASE WHEN n.r_gender < 57
       THEN (SELECT name FROM seed_first_f WHERE ord = n.first_ix)
       ELSE (SELECT name FROM seed_first_m WHERE ord = n.first_ix)
  END AS first_name,
  (SELECT name FROM seed_last WHERE ord = n.last_ix) AS last_name,
  -- A quarter of people have no middle initial recorded, which is what the real
  -- roll looks like and what the "Optional" placeholder in the add-member modal
  -- is there for.
  CASE WHEN n.r_quirk < 25 THEN NULL
       ELSE chr(65 + n.middle_ix) END AS middle_name,
  -- Age bands, then a deterministic day-of-year offset inside the band.
  (DATE '2026-08-12' - (
     (CASE
        WHEN n.r_age <  9 THEN 8   + (n.i % 10)   -- 0–17   ~22/248
        WHEN n.r_age < 37 THEN 18  + (n.i % 12)   -- 18–29  ~70/248
        WHEN n.r_age < 70 THEN 30  + (n.i % 15)   -- 30–44  ~83/248
        WHEN n.r_age < 89 THEN 45  + (n.i % 15)   -- 45–59  ~47/248
        ELSE                   60  + (n.i % 22)   -- 60+    ~26/248
      END) * 365 + (n.i * 11) % 365
   ))::date AS birthdate,
  CASE
    WHEN n.r_marital < 46 THEN 'Married'
    WHEN n.r_marital < 88 THEN 'Single'
    WHEN n.r_marital < 95 THEN 'Widowed'
    ELSE 'Separated'
  END AS marital_status,
  -- Joined between 2004 and 2026, weighted recent.
  (DATE '2026-08-01' - ((n.i * 29) % 7800))::date AS date_joined,
  -- 8% have no phone on record; the rest get a distinct fabricated 09xx number.
  CASE WHEN n.r_contact < 8 THEN NULL
       ELSE 9170000000::numeric + (n.i * 4177) % 9999999 END AS contact_number,
  -- 34% have no email — common on a provincial roll and the reason the members
  -- table shows a phone under the name rather than an address.
  CASE WHEN n.r_contact >= 66 THEN NULL
       ELSE lower(
              regexp_replace(
                (CASE WHEN n.r_gender < 57
                      THEN (SELECT name FROM seed_first_f WHERE ord = n.first_ix)
                      ELSE (SELECT name FROM seed_first_m WHERE ord = n.first_ix) END)
                || '.' ||
                (SELECT name FROM seed_last WHERE ord = n.last_ix)
              , '\s+', '', 'g')
            ) || n.i || '@example.invalid'
  END AS email,
  -- 55% have no address, which is what makes the edit-member modal's "the
  -- address is too short to be useful for visitation" validation worth having.
  CASE WHEN n.r_quirk >= 45 THEN NULL
       ELSE (10 + (n.i % 89))::text || ' ' ||
            (ARRAY['Sampaguita','Rosal','Ilang-Ilang','Camia','Dahlia','Waling-Waling','Gumamela','Santan'])[1 + (n.i % 8)]
            || ' Street, Barangay ' ||
            (ARRAY['Uno','Dos','Tres','Kuatro'])[1 + (n.i % 4)]
  END AS address,
  -- 30% have a facebook link, and the values deliberately exercise BOTH arms of
  -- utils/memberLink.js: most are well-formed https facebook.com URLs that
  -- render as anchors, and a slice are bare hostnames with no scheme, which that
  -- module refuses and the panel renders as plain text. A fixture where every
  -- value is valid would never prove the refusal path renders at all.
  CASE
    WHEN n.r_quirk >= 76
      THEN 'https://facebook.com/' || lower(regexp_replace(
             (SELECT name FROM seed_last WHERE ord = n.last_ix), '\s+', '', 'g')) || n.i
    WHEN n.r_quirk >= 70
      THEN 'facebook.com/' || lower(regexp_replace(
             (SELECT name FROM seed_last WHERE ord = n.last_ix), '\s+', '', 'g')) || n.i
    ELSE NULL
  END AS facebook_link,
  -- Journey. r_journey is a progress score; the thresholds reproduce the
  -- mockup's funnel (baptized 84%, one-to-one 65%, turning point 47%).
  -- r_quirk carves out the out-of-order cases described above.
  (n.r_journey < 65 OR n.r_quirk < 4)                       AS one_to_one,
  (n.r_journey < 47 AND n.r_quirk >= 2)                     AS turning_point,
  (n.r_journey < 84 OR n.r_quirk >= 93)                     AS baptized,
  (n.r_journey < 40 AND n.r_quirk >= 6) OR (n.r_quirk = 99) AS membership_cert,
  (DATE '2026-08-12' - ((n.i * 19) % 900))::date            AS archived_on
FROM n;

INSERT INTO public.members (
  id, first_name, last_name, middle_name, birthdate, gender, address, date_joined,
  contact_number, email, member_of, archived_at, archived_reason, facebook_link,
  marital_status,
  is_one_to_one_completed, is_turning_point_completed, is_baptized,
  has_submitted_membership_form
)
SELECT
  sp.id, sp.first_name, sp.last_name, sp.middle_name, sp.birthdate, sp.gender,
  sp.address, sp.date_joined, sp.contact_number, sp.email,
  (SELECT id FROM seed_church),
  CASE WHEN sp.is_active THEN NULL ELSE sp.archived_on::timestamptz END,
  CASE WHEN sp.is_active THEN NULL
       ELSE (ARRAY['Moved to another city','Transferred to another church',
                   'No longer attending','Deceased','Requested removal'])[1 + (abs(hashtext(sp.id::text)) % 5)]
  END,
  sp.facebook_link, sp.marital_status,
  sp.one_to_one, sp.turning_point, sp.baptized, sp.membership_cert
FROM seed_people sp;

-- ---------------------------------------------------------------------------
-- 4. Groups.
-- ---------------------------------------------------------------------------
-- 0004_church_scoped_groups enforces, and this is a domain rule rather than a
-- detail:
--
--   CHECK ( (type = 'Ministry'    AND church_id IS NULL)
--        OR (type = 'Small Group' AND church_id IS NOT NULL) )
--
-- MINISTRIES ARE NETWORK-WIDE. Only small groups belong to a church. So a
-- church's Groups page is "every ministry, plus my church's small groups" — the
-- mockup draws both as cards side by side with a type tag, which is still exactly
-- right, but a ministry card is not scoped to the church you are looking at.
--
-- The three EXISTING rows (Finance Team, Welcome Team, Secretariat) are the
-- system ministries carrying ministry_key — they are what authorization keys on,
-- and this file does not touch them.
--
-- color_slot is omitted deliberately: 0005_group_color_slots installs a BEFORE
-- INSERT trigger that assigns one from 3240 slots and the column is globally
-- unique, so naming a slot here would be a collision waiting to happen.
INSERT INTO public.groups (id, name, type, church_id)
SELECT
  ('5eed0001-0000-4000-8000-' || lpad(g.ord::text, 12, '0'))::uuid,
  g.name, g.type,
  CASE WHEN g.type = 'Small Group' THEN (SELECT id FROM seed_church) END
FROM (VALUES
  (1, 'Worship Team',       'Ministry'),
  (2, 'Ushering Ministry',  'Ministry'),
  (3, 'Youth Ministry',     'Ministry'),
  (4, 'Prayer Warriors',    'Ministry'),
  (5, 'Tuesday Group',      'Small Group'),
  (6, 'Men''s Fellowship',  'Small Group'),
  (7, 'Thursday Group',     'Small Group')
) AS g(ord, name, type);

-- ---------------------------------------------------------------------------
-- 5. Group membership.
-- ---------------------------------------------------------------------------
-- Exactly `members_in_no_group` active members are left in nothing, because that
-- figure is rendered as copy in two places — the Groups header ("41 members in
-- none") and the Overview's "In no ministry or group" attention row — and a
-- fixture that misses it makes both look broken.
--
-- The rest get one or two groups, spread unevenly so the cards have visibly
-- different sizes and the "+N more" avatar overflow appears on the large ones.
INSERT INTO public.group_members (member_id, group_id)
SELECT DISTINCT
  a.id,
  ('5eed0001-0000-4000-8000-' || lpad(a.grp::text, 12, '0'))::uuid
FROM (
  SELECT
    sp.id,
    row_number() OVER (ORDER BY sp.id) AS rn,
    1 + (abs(hashtext(sp.id::text || 'primary')) % 7) AS grp
  FROM seed_people sp
  WHERE sp.is_active
) a
WHERE a.rn > (SELECT members_in_no_group FROM seed_params)
UNION
-- A third of the assigned also carry a second group.
SELECT DISTINCT
  b.id,
  ('5eed0001-0000-4000-8000-' || lpad(b.grp::text, 12, '0'))::uuid
FROM (
  SELECT
    sp.id,
    row_number() OVER (ORDER BY sp.id) AS rn,
    1 + (abs(hashtext(sp.id::text || 'second')) % 7) AS grp
  FROM seed_people sp
  WHERE sp.is_active
) b
WHERE b.rn > (SELECT members_in_no_group FROM seed_params)
  AND (abs(hashtext(b.id::text)) % 3) = 0
ON CONFLICT (group_id, member_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6. Collections.
-- ---------------------------------------------------------------------------
-- The mockup's July: ₱60,500.00 total across 4 service dates and 86 entries,
-- ₱42,000 tithes (69.4%) against ₱18,500 offering (30.6%), 18 of them anonymous.
-- Those exact figures are worth hitting rather than approximating, because the
-- Funds screen derives visible numbers from them — the five-segment allocation
-- bar reads 40% of ₱60,500 as ₱24,200, and a total that is merely close makes
-- every derived figure merely close too.
--
-- The totals are hit by construction: n-1 entries are generated from a
-- deterministic spread, and the final entry of each type is the remainder.
--
-- These rows cannot carry a '5eed' key — the table uses a bigint identity — so
-- section 1 removes them via their member (all seeded givers are '5eed0000-…')
-- and this section removes the anonymous ones by church and date window. That is
-- the one place this file could touch a row it did not create; on staging both
-- tables were empty when it was written.
DELETE FROM public.collections
WHERE from_church = (SELECT id FROM seed_church)
  AND "collectedOn" >= (SELECT ledger_month FROM seed_params)
  AND "collectedOn" <  (SELECT ledger_month + INTERVAL '2 month' FROM seed_params);

INSERT INTO public.collections ("from", amount, is_tithes, "collectedOn", from_church)
WITH p AS (SELECT * FROM seed_params),
dates AS (
  SELECT d::date AS collected_on, row_number() OVER (ORDER BY d) AS ix
  FROM generate_series(
    (SELECT ledger_month FROM p) + 4,          -- first Sunday of July 2026 = Jul 5
    (SELECT ledger_month FROM p) + 25,         -- Jul 26
    INTERVAL '7 day'
  ) AS d
),
givers AS (
  SELECT id, row_number() OVER (ORDER BY id) AS rn
  FROM seed_people WHERE is_active
),
-- 60 tithes entries and 26 offering entries = 86.
slots AS (
  SELECT i, TRUE AS is_tithes FROM generate_series(1, 60) i
  UNION ALL
  SELECT i, FALSE            FROM generate_series(1, 26) i
),
priced AS (
  SELECT
    s.i, s.is_tithes,
    ((s.i - 1) % 4) + 1 AS date_ix,
    -- 21% anonymous (18 of 86): NULL giver.
    CASE WHEN (s.i * 23) % 100 < 21 THEN NULL
         ELSE (SELECT id FROM givers WHERE rn = 1 + ((s.i * 71) % 240)) END AS giver,
    CASE WHEN s.is_tithes
         THEN 300 + ((s.i * 137) % 40) * 25      -- 300 – 1,275, step 25
         ELSE 150 + ((s.i * 91)  % 30) * 25      -- 150 –   875, step 25
    END::numeric AS amount,
    row_number() OVER (PARTITION BY s.is_tithes ORDER BY s.i) AS rn,
    count(*)     OVER (PARTITION BY s.is_tithes)              AS n
  FROM slots s
),
balanced AS (
  SELECT
    p2.giver, p2.is_tithes, p2.date_ix,
    CASE
      WHEN p2.rn < p2.n THEN p2.amount
      ELSE (CASE WHEN p2.is_tithes THEN 42000 ELSE 18500 END)
           - sum(p2.amount) OVER (PARTITION BY p2.is_tithes ORDER BY p2.rn
                                  ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING)
    END AS amount
  FROM priced p2
)
SELECT b.giver, b.amount, b.is_tithes, d.collected_on, (SELECT id FROM seed_church)
FROM balanced b JOIN dates d ON d.ix = b.date_ix;

-- A partial August, so the screen has something to show when it opens on the
-- current month rather than looking like the church stopped giving.
INSERT INTO public.collections ("from", amount, is_tithes, "collectedOn", from_church)
WITH givers AS (
  SELECT id, row_number() OVER (ORDER BY id) AS rn FROM seed_people WHERE is_active
)
SELECT
  CASE WHEN (i * 17) % 100 < 20 THEN NULL
       ELSE (SELECT id FROM givers WHERE rn = 1 + ((i * 53) % 240)) END,
  (CASE WHEN i % 3 = 0 THEN 250 + (i % 20) * 25 ELSE 400 + (i % 32) * 25 END)::numeric,
  (i % 3 <> 0),
  (DATE '2026-08-02' + ((i % 2) * 7))::date,
  (SELECT id FROM seed_church)
FROM generate_series(1, 34) AS i;

-- ---------------------------------------------------------------------------
-- 7. Expenses.
-- ---------------------------------------------------------------------------
-- The mockup's July: ₱12,100.00 over 6 entries and 5 distinct descriptions, with
-- Electricity the largest line at ₱4,200 (34.7%). Descriptions repeat across
-- months on purpose — the record-expense modal offers previously used ones as
-- chips, and the by-description chart groups on them.
DELETE FROM public.expenses
WHERE from_church = (SELECT id FROM seed_church)
  AND spent_on >= (SELECT ledger_month FROM seed_params)
  AND spent_on <  (SELECT ledger_month + INTERVAL '2 month' FROM seed_params);

INSERT INTO public.expenses (from_church, spent_on, description, amount, notes)
SELECT (SELECT id FROM seed_church), e.spent_on, e.description, e.amount, e.notes
FROM (VALUES
  (DATE '2026-07-28', 'Electricity',  4200.00, 'Meralco, July billing'),
  (DATE '2026-07-24', 'Honorarium',   2500.00, 'Guest speaker'),
  (DATE '2026-07-20', 'Supplies',     1600.00, 'Communion elements'),
  (DATE '2026-07-14', 'Internet',     1850.00, NULL),          -- em-dash placeholder
  (DATE '2026-07-09', 'Supplies',      800.00, 'Printer ink'),
  (DATE '2026-07-03', 'Water',        1150.00, NULL),          -- em-dash placeholder
  (DATE '2026-08-06', 'Electricity',  3980.00, 'Meralco, August billing'),
  (DATE '2026-08-04', 'Transportation', 620.00, 'Fuel, home visitations')
) AS e(spent_on, description, amount, notes);

-- ---------------------------------------------------------------------------
-- 8. What this produced, and how to undo it.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  church uuid := (SELECT id FROM seed_church);
  n_active int; n_arch int; n_grp int; n_asg int; n_none int;
  col_jul numeric; col_n int; exp_jul numeric;
BEGIN
  SELECT count(*) FILTER (WHERE archived_at IS NULL),
         count(*) FILTER (WHERE archived_at IS NOT NULL)
    INTO n_active, n_arch
    FROM public.members WHERE member_of = church;

  SELECT count(*) INTO n_grp FROM public.groups WHERE church_id = church;

  SELECT count(*) INTO n_asg
    FROM public.group_members gm
    JOIN public.members m ON m.id = gm.member_id
   WHERE m.member_of = church;

  SELECT count(*) INTO n_none
    FROM public.members m
   WHERE m.member_of = church AND m.archived_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.group_members gm WHERE gm.member_id = m.id);

  SELECT coalesce(sum(amount), 0), count(*) INTO col_jul, col_n
    FROM public.collections
   WHERE from_church = church
     AND "collectedOn" BETWEEN DATE '2026-07-01' AND DATE '2026-07-31';

  SELECT coalesce(sum(amount), 0) INTO exp_jul
    FROM public.expenses
   WHERE from_church = church
     AND spent_on BETWEEN DATE '2026-07-01' AND DATE '2026-07-31';

  RAISE NOTICE 'seed-staging-redesign complete';
  RAISE NOTICE '  members      : % active, % archived', n_active, n_arch;
  RAISE NOTICE '  groups       : %, % assignments, % active members in none', n_grp, n_asg, n_none;
  RAISE NOTICE '  collections  : July total %, % entries', col_jul, col_n;
  RAISE NOTICE '  expenses     : July total %', exp_jul;
  RAISE NOTICE '  NEXT: run `npm run seed:attendance` so the new roster gets an attendance history.';
END
$$;

-- TEARDOWN — removes everything this file created, and nothing else.
--
-- DELETE FROM public.group_members WHERE member_id::text LIKE '5eed0000-%';
-- DELETE FROM public.group_members WHERE group_id::text  LIKE '5eed0001-%';
-- DELETE FROM public.attendance    WHERE member_id::text LIKE '5eed0000-%';
-- DELETE FROM public.collections   WHERE "from"::text    LIKE '5eed0000-%';
-- DELETE FROM public.collections
--   WHERE from_church = (SELECT id FROM public.churches WHERE name = 'Cogon')
--     AND "collectedOn" >= DATE '2026-07-01' AND "collectedOn" < DATE '2026-09-01';
-- DELETE FROM public.expenses
--   WHERE from_church = (SELECT id FROM public.churches WHERE name = 'Cogon')
--     AND spent_on >= DATE '2026-07-01' AND spent_on < DATE '2026-09-01';
-- DELETE FROM public.members WHERE id::text LIKE '5eed0000-%';
-- DELETE FROM public.groups  WHERE id::text LIKE '5eed0001-%';

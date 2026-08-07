-- One-shot RBAC fixture for the staging database. NOT idempotent by design —
-- it seeds a fixed, known-in-advance set of auth users (created once via the
-- Supabase dashboard) into members/user_accounts/group_members so every role
-- in the RBAC model (docs/decisions, 0014_rbac_predicates) has a test account.
-- Names are placeholders; only the role/church/ministry shape matters.
--
-- Precondition: the auth_id values below must already exist in auth.users
-- (Authentication -> Users -> Add user, on STAGING). Run once. Re-running
-- would create duplicate members for the same auth users — check first.

CREATE TEMP TABLE staging_seed (
  auth_id      uuid,
  first_name   text,
  last_name    text,
  church_name  text,
  role         text,
  ministry_key text,
  member_id    uuid
);

INSERT INTO staging_seed (auth_id, first_name, last_name, church_name, role, ministry_key) VALUES
  ('f83e7825-713b-4ced-9f9f-9079d425dee2', 'Sam',    'Superadmin', 'Cogon',      'super_admin',   NULL),
  ('4ee6c35f-487c-4561-8638-1ec530900774', 'Helen',  'Shepherd',   'Tala',       'head_pastor',   NULL),
  ('6f42ad3f-bdba-4832-96ea-1084c741717e', 'Paul',   'Grace',      'Graceville', 'pastor',        NULL),
  ('a8efbec0-41c6-4eaf-8f55-a446652b8630', 'Peter',  'Cogono',     'Cogon',      'pastor',        NULL),
  ('20c44d9b-c40f-4ebd-8940-a7e420826dab', 'Leah',   'Leadwell',   'Cogon',      'church_leader', NULL),
  ('ac3ea9aa-fb27-4584-ba1a-dcf3d4212194', 'Talia',  'Leaderman',  'Tala',       'church_leader', NULL),
  ('772e8c67-54b5-4644-9a73-caf79ce1b98f', 'Tomas',  'Leaderson',  'Tala',       'church_leader', NULL),
  ('918102d1-c749-42cc-8e87-cc38d1c3cd41', 'Fina',   'Ledger',     'Cogon',      'unassigned',    'finance'),
  ('4f067d42-7224-4511-9e68-1469ccd73d92', 'Talon',  'Ledgerman',  'Tala',       'unassigned',    'finance'),
  ('02b91333-1b2d-41df-ac0d-87b4bd9d5b0d', 'Cora',   'Scribe',     'Cogon',      'unassigned',    'secretariat'),
  ('4e6c129a-3b0f-473e-8318-ce92af88e056', 'Grace',  'Scribeton',  'Graceville', 'unassigned',    'secretariat'),
  ('3710ae6e-e64e-446e-882c-dc1d14e4a3c0', 'Wendy',  'Welcomer',   'Cogon',      'unassigned',    'welcome'),
  ('a0eb1fba-8fa8-4e2e-90d2-18fcaa89e903', 'Talbot', 'Greeter',    'Tala',       'unassigned',    'welcome');

-- Churches, idempotent by name.
INSERT INTO public.churches (name)
SELECT DISTINCT s.church_name FROM staging_seed s
WHERE NOT EXISTS (SELECT 1 FROM public.churches c WHERE c.name = s.church_name);

-- The Finance ministry: 0014_rbac_predicates only *adopts* a pre-existing
-- 'Finance Team' group from production's out-of-band history (docs/DEFECTS.md
-- D4). A truly fresh database has nothing to adopt, so staging never got one.
INSERT INTO public.groups (name, type, ministry_key)
SELECT 'Finance Team', 'Ministry', 'finance'
WHERE NOT EXISTS (
  SELECT 1 FROM public.groups WHERE type = 'Ministry' AND church_id IS NULL AND ministry_key = 'finance'
);

-- Members, one per seed row. birthdate/gender have no meaningful default and
-- are NOT NULL, so a placeholder is required; member_of is real (the church
-- created above).
WITH inserted AS (
  INSERT INTO public.members (first_name, last_name, birthdate, gender, member_of)
  SELECT s.first_name, s.last_name, DATE '1990-01-01', 'Other', c.id
  FROM staging_seed s
  JOIN public.churches c ON c.name = s.church_name
  RETURNING id, first_name, last_name
)
UPDATE staging_seed s
SET member_id = i.id
FROM inserted i
WHERE i.first_name = s.first_name AND i.last_name = s.last_name;

-- Account role. 'unassigned' here is the deliberate baseline for the three
-- ministry testers below — their access comes from group_members, not this
-- column (0014's two orthogonal role sources).
--
-- UPSERT, not INSERT: the on_auth_user_created trigger (bootstrap-triggers.sql)
-- already ran handle_new_user() for each of these the moment they were added
-- via the dashboard, creating a row with member_id NULL / role 'unassigned'.
-- This fills in the two columns the trigger deliberately leaves blank.
INSERT INTO public.user_accounts (id, member_id, role)
SELECT auth_id, member_id, role FROM staging_seed
ON CONFLICT (id) DO UPDATE SET member_id = EXCLUDED.member_id, role = EXCLUDED.role;

-- Ministry membership (Finance/Secretariat/Welcome) for the rows that have one.
INSERT INTO public.group_members (member_id, group_id)
SELECT s.member_id, g.id
FROM staging_seed s
JOIN public.groups g ON g.ministry_key = s.ministry_key AND g.type = 'Ministry' AND g.church_id IS NULL
WHERE s.ministry_key IS NOT NULL;

-- Verify: one row per seed user, with role and (if any) ministry attached.
SELECT s.first_name, s.last_name, c.name AS church, ua.role, g.name AS ministry
FROM staging_seed s
JOIN public.user_accounts ua ON ua.id = s.auth_id
JOIN public.members m ON m.id = ua.member_id
JOIN public.churches c ON c.id = m.member_of
LEFT JOIN public.group_members gm ON gm.member_id = m.id
LEFT JOIN public.groups g ON g.id = gm.group_id AND g.type = 'Ministry'
ORDER BY c.name, ua.role;

DROP TABLE staging_seed;

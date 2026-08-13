// Fixture builders for the database-level suite.
//
// Every builder runs as the owner, before the test switches to `authenticated`, and
// every row it makes dies with the transaction rollback. Names are prefixed and
// suffixed with a nonce so that a fixture can never collide with staging data or with
// a concurrent run — `groups` enforces case-insensitive unique names, globally for a
// ministry and per church for a small group, and a collision there would fail a test
// for a reason that has nothing to do with permissions.
//
// Tests assert on the ids these return, never on row counts of the whole table.
// Staging has real data in it; a count assertion would be a test that breaks whenever
// somebody adds a small group.

import { randomUUID } from 'node:crypto'

const nonce = () => randomUUID().slice(0, 8)

/** A church, isolated from every other church in the database. */
export async function makeChurch (tx, label = 'church') {
  const [row] = await tx.$queryRawUnsafe(
    `INSERT INTO public.churches (name) VALUES ($1) RETURNING id`,
    `zz-test-${label}-${nonce()}`
  )
  return row.id
}

/** An active member of `churchId`. */
export async function makeMember (tx, churchId, label = 'member') {
  const [row] = await tx.$queryRawUnsafe(
    `INSERT INTO public.members (first_name, last_name, birthdate, gender, member_of)
     VALUES ($1, 'Test', DATE '1990-01-01', 'Female', $2::uuid) RETURNING id`,
    `zz-${label}-${nonce()}`,
    churchId
  )
  return row.id
}

/**
 * A sign-in that the system will recognise.
 *
 * `auth.users` requires only an id, so a principal is three inserts: the auth row, a
 * member record to hang a church off, and the `user_accounts` row that carries the
 * role. Church comes from the member record and is never stored on the account —
 * that is the model, not a shortcut.
 *
 * Pass `churchId: null` for the unlinked baseline: an account that can sign in and has
 * no member record, which is what every new sign-up is until an admin acts.
 */
export async function makePrincipal (tx, { role = 'member', churchId = null, memberId = null } = {}) {
  const accountId = randomUUID()
  await tx.$executeRawUnsafe(`INSERT INTO auth.users (id) VALUES ($1::uuid)`, accountId)

  let linkedMember = memberId
  if (linkedMember === null && churchId) linkedMember = await makeMember(tx, churchId, 'principal')

  // handle_new_user() (0006) fires on auth.users and has already created the
  // user_accounts row — with member_id NULL and role 'unassigned', which is precisely
  // the gap #75 exists to close. Upsert rather than insert, so this helper works
  // whether or not that trigger is present.
  await tx.$executeRawUnsafe(
    `INSERT INTO public.user_accounts (id, member_id, role) VALUES ($1::uuid, $2::uuid, $3)
     ON CONFLICT (id) DO UPDATE SET member_id = EXCLUDED.member_id, role = EXCLUDED.role`,
    accountId,
    linkedMember,
    role
  )

  return { accountId, memberId: linkedMember }
}

/**
 * A global ministry.
 *
 * `ministry_key` is system-managed and absent from the authenticated column grants, so
 * it can only be set from here, as the owner — which is the point of keying
 * authorization on it rather than on the editable name (D4). Pass one only when the
 * test is about Finance / Secretariat / Welcome behaviour.
 */
export async function makeMinistry (tx, { label = 'ministry', ministryKey = null } = {}) {
  const [row] = await tx.$queryRawUnsafe(
    `INSERT INTO public.groups (name, type, ministry_key)
     VALUES ($1, 'Ministry', $2) RETURNING id`,
    `zz-test-${label}-${nonce()}`,
    ministryKey
  )
  return row.id
}

/**
 * A ministry carrying its own throwaway authorization slug.
 *
 * For testing the slug mechanism itself without touching Finance / Secretariat /
 * Welcome. Those three are seeded, global, and shared with whatever else is using the
 * database; renaming one — even inside a transaction that rolls back — takes a lock on
 * a row the rest of the system authorizes against, which is a needless thing to do to
 * a live environment.
 */
export async function makeKeyedMinistry (tx, label = 'keyed') {
  const ministryKey = `zz-test-key-${nonce()}`
  const id = await makeMinistry(tx, { label, ministryKey })
  return { id, ministryKey }
}

/** A small group belonging to one church. */
export async function makeSmallGroup (tx, churchId, label = 'small-group') {
  const [row] = await tx.$queryRawUnsafe(
    `INSERT INTO public.groups (name, type, church_id)
     VALUES ($1, 'Small Group', $2::uuid) RETURNING id`,
    `zz-test-${label}-${nonce()}`,
    churchId
  )
  return row.id
}

/** Put a member in a group. Used to grant ministry roles, among other things. */
export async function addToGroup (tx, groupId, memberId) {
  const [row] = await tx.$queryRawUnsafe(
    `INSERT INTO public.group_members (group_id, member_id)
     VALUES ($1::uuid, $2::uuid) RETURNING id`,
    groupId,
    memberId
  )
  return row.id
}

/**
 * The three system ministries are seeded by 0014 and are global, so a test that needs
 * "the real Finance ministry" must find it rather than make a second one — the unique
 * index on ministry_key would refuse the duplicate anyway.
 */
export async function findSystemMinistry (tx, ministryKey) {
  const [row] = await tx.$queryRawUnsafe(
    `SELECT id FROM public.groups WHERE ministry_key = $1`,
    ministryKey
  )
  // Throw rather than return null. A test that silently proceeds with an undefined
  // group id asserts something other than what it claims to, and in a permissions
  // suite that is the failure mode worth being loud about.
  if (!row) throw new Error(`no ministry with key '${ministryKey}' — 0014 should have seeded it`)
  return row.id
}

/** Ids of the groups the current principal can see. Order-independent by design. */
export async function visibleGroupIds (tx) {
  const rows = await tx.$queryRawUnsafe(`SELECT id FROM public.groups`)
  return new Set(rows.map(r => r.id))
}

/** Ids of the group_members rows the current principal can see. */
export async function visibleMembershipIds (tx) {
  const rows = await tx.$queryRawUnsafe(`SELECT id FROM public.group_members`)
  return new Set(rows.map(r => r.id))
}

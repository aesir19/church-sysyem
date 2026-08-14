// Every read of group data goes through here.
//
// Lifted out of MinistrySmallGroupView, which held its own queries inline — the
// same move members.js made, for the same reason: the rules below are not
// obvious from a call site and were being re-derived (and re-broken) each time.
//
// THIS MODULE IS NOW THE COMPATIBILITY LAYER, AND THAT IS DELIBERATE.
// 0026 split `groups` into `ministries` + `small_groups` and `group_members`
// into `ministry_members` + `small_group_members`. #74 wanted that hidden behind
// database views so no application code changed; it cannot be, because PostgREST
// resolves embeds through foreign keys and a UNION view has none — every
// `members!inner(...)` against such a view fails with PGRST200. See the header of
// tests/db/postgrest-contract.test.js.
//
// So the seam lives here instead. Everything below still returns a row shaped
// `{ id, name, type, church_id, ministry_key, ... }`, with `type` synthesised
// from which table the row came out of. Views, cards and tests downstream did not
// change. If you are adding a caller, you still get "a group"; there is simply no
// longer a table by that name.
//
// THREE THINGS THIS MODULE EXISTS TO STOP CALLERS GETTING WRONG:
//
// 1. A MINISTRY IS GLOBAL; A SMALL GROUP IS CHURCH-SCOPED. Since 0026 that is
//    structural — `ministries` has no church_id column at all and
//    `small_groups.church_id` is NOT NULL — rather than a CHECK constraint over a
//    `type` varchar. "The groups for this church" is therefore two queries, not
//    one filter, and no longer a hand-written PostgREST `or(and(...),and(...))`.
//
// 2. THE MEMBER COUNT MUST BE SCOPED TO THE ACTIVE CHURCH. Because a ministry is
//    global, its `ministry_members` rows span every church. Counting them all
//    reports a total that does not change when the church selector does — the
//    exact bug the inline version fixed and the exact bug an innocent-looking
//    refactor would reintroduce.
//
// 3. `members!inner` IS NOT FREE UNDER RLS. A caller without member-detail
//    access (Welcome, baseline) sees zero rows from `members`, so an inner join
//    silently drops every assignment and reports every group as empty. The
//    projection is therefore chosen by capability, and the caller is told which
//    one it got rather than being handed a zero that looks like data.

import { supabase } from '../supabase'

const MESSAGES = {
  loadFailed: 'Failed to load groups. Please try again.',
  noChurch: 'Cannot determine your church. Please reload.'
}

/**
 * The two kinds of group. Since 0026 these are table names in disguise rather
 * than values of a column, and `type` is synthesised on the way out of here.
 */
export const GROUP_TYPES = Object.freeze(['Ministry', 'Small Group'])

/** Which table a group of each type actually lives in. */
export const GROUP_TABLES = Object.freeze({
  Ministry: 'ministries',
  'Small Group': 'small_groups'
})

/** And which table its memberships live in, keyed the same way. */
export const MEMBERSHIP_TABLES = Object.freeze({
  Ministry: 'ministry_members',
  'Small Group': 'small_group_members'
})

/** The foreign key naming the parent, which differs per membership table. */
export const MEMBERSHIP_PARENT_KEY = Object.freeze({
  Ministry: 'ministry_id',
  'Small Group': 'small_group_id'
})

// Columns are now per-table: `ministries` has no church_id and `small_groups` has
// no ministry_key, so there is no single list that fits both. Neither names `*`.
export const MINISTRY_COLUMNS = 'id, name, ministry_key'
export const SMALL_GROUP_COLUMNS = 'id, name, church_id'

/**
 * Give a row from either table the shape the rest of the app still expects:
 * `{ id, name, type, church_id, ministry_key }`. The two absent columns are
 * filled with the constants the old CHECK constraint guaranteed — a ministry's
 * church_id was always NULL, a small group's ministry_key always NULL — so this
 * is a rename, not an invention.
 */
export function asGroup (row, type) {
  return type === 'Ministry'
    ? { id: row.id, name: row.name, type, church_id: null, ministry_key: row.ministry_key ?? null }
    : { id: row.id, name: row.name, type, church_id: row.church_id, ministry_key: null }
}

/**
 * Groups for a church, with per-church member counts.
 *
 * @param {{ churchId: string, canSeeMembers: boolean }} params
 *   `canSeeMembers` decides the projection — see rule 3 above. Pass the
 *   caller's canSeeMemberDetail capability; it is not read from the composable
 *   here so this stays testable without mounting anything.
 * @returns {Promise<{ ok: boolean, message: string, rows: object[],
 *   assignments: number, assignedMemberIds: Set<string>|null, cause: unknown }>}
 */
export async function listGroups ({ churchId, canSeeMembers }) {
  if (!churchId) {
    return { ok: false, message: MESSAGES.noChurch, rows: [], assignments: 0, assignedMemberIds: null, cause: null }
  }

  // A caller who can read members gets names along the same round-trip, which
  // is what fills the avatar stack on each card. A caller who cannot gets ids
  // only — the counts stay correct, and the cards simply have no faces.
  //
  // The `!inner` embeds resolve again after 0026 because ministry_members and
  // small_group_members each hold a real foreign key to `members`. That is the
  // whole reason the split had to reach the application instead of hiding in a
  // view: on a union view these same two selects returned PGRST200.
  const faces = 'member_id, members!inner(first_name, last_name, member_of)'

  let ministryAssignmentQuery = supabase
    .from('ministry_members')
    .select(canSeeMembers ? `ministry_id, ${faces}` : 'ministry_id')
  let smallGroupAssignmentQuery = supabase
    .from('small_group_members')
    .select(canSeeMembers ? `small_group_id, ${faces}` : 'small_group_id')

  // Scoping stays exactly where it was, on the embedded member's church, and
  // still only when the join exists to scope on. For everyone else RLS has
  // already narrowed these rows to their own church, which is why the
  // unfiltered branch is not the all-church total it looks like.
  if (canSeeMembers) {
    ministryAssignmentQuery = ministryAssignmentQuery.eq('members.member_of', churchId)
    smallGroupAssignmentQuery = smallGroupAssignmentQuery.eq('members.member_of', churchId)
  }

  const [ministriesRes, smallGroupsRes, ministryAssignmentsRes, smallGroupAssignmentsRes] =
    await Promise.all([
      supabase
        .from('ministries')
        .select(MINISTRY_COLUMNS)
        .order('name', { ascending: true }),
      supabase
        .from('small_groups')
        .select(SMALL_GROUP_COLUMNS)
        .eq('church_id', churchId)
        .order('name', { ascending: true }),
      ministryAssignmentQuery,
      smallGroupAssignmentQuery
    ])

  // Either half failing means the grid would silently lose a whole kind of
  // group, which reads as "these were deleted" rather than "this did not load".
  const failure = ministriesRes.error || smallGroupsRes.error
  if (failure) {
    return { ok: false, message: MESSAGES.loadFailed, rows: [], assignments: 0, assignedMemberIds: null, cause: failure }
  }

  const counts = new Map()
  const sample = new Map()
  const assignedMemberIds = canSeeMembers ? new Set() : null

  const tally = (rows, parentKey) => {
    for (const row of rows || []) {
      const groupId = row[parentKey]
      counts.set(groupId, (counts.get(groupId) || 0) + 1)
      if (!canSeeMembers) continue
      assignedMemberIds.add(row.member_id)
      // Four faces per card is what the design draws; collecting more would be
      // rendered by nobody.
      const seen = sample.get(groupId) || []
      if (seen.length < 4 && row.members) {
        seen.push(`${row.members.first_name} ${row.members.last_name}`.trim())
        sample.set(groupId, seen)
      }
    }
  }

  tally(ministryAssignmentsRes.data, 'ministry_id')
  tally(smallGroupAssignmentsRes.data, 'small_group_id')

  const assignments =
    (ministryAssignmentsRes.data || []).length + (smallGroupAssignmentsRes.data || []).length

  // Ministries first, then small groups, each by name. The old query said
  // `.order('type').order('name')`, and 'Ministry' sorts before 'Small Group',
  // so concatenating in this order reproduces it without relying on a column
  // that no longer exists.
  const rows = [
    ...(ministriesRes.data || []).map(row => asGroup(row, 'Ministry')),
    ...(smallGroupsRes.data || []).map(row => asGroup(row, 'Small Group'))
  ].map(group => ({
    ...group,
    member_count: counts.get(group.id) ?? 0,
    sample_names: sample.get(group.id) ?? []
  }))

  return {
    ok: true,
    message: '',
    rows,
    // Already a total across both tables, not a list to measure.
    assignments,
    assignedMemberIds,
    cause: null
  }
}

/**
 * How many active members belong to no group at all.
 *
 * A `head: true` count of the roll, minus the distinct members already seen in
 * the assignment list — so it costs one header and no rows, rather than a
 * second pass over group_members.
 *
 * Returns null when the caller could not read member ids, because "41 members
 * in none" and "we could not tell" are different statements and only one of
 * them should ever be rendered.
 */
export async function countMembersInNoGroup ({ churchId, assignedMemberIds }) {
  if (!churchId || !assignedMemberIds) return null

  const { count, error } = await supabase
    .from('members')
    .select('id', { count: 'exact', head: true })
    .eq('member_of', churchId)
    // Required since 0010_members_select_allow_archived stopped RLS hiding
    // archived rows: filtering them is the application's job at every read.
    .is('archived_at', null)

  if (error) return null
  return Math.max(0, (count ?? 0) - assignedMemberIds.size)
}

export const GROUP_MESSAGES = MESSAGES

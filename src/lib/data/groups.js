// Every read of group data goes through here.
//
// Lifted out of MinistrySmallGroupView, which held its own queries inline — the
// same move members.js made, for the same reason: the rules below are not
// obvious from a call site and were being re-derived (and re-broken) each time.
//
// THREE THINGS THIS MODULE EXISTS TO STOP CALLERS GETTING WRONG:
//
// 1. A MINISTRY IS GLOBAL; A SMALL GROUP IS CHURCH-SCOPED. That is a CHECK
//    constraint (0004): type='Ministry' requires church_id IS NULL, and
//    type='Small Group' requires it NOT NULL. So "the groups for this church"
//    is a union of two different conditions, never one filter.
//
// 2. THE MEMBER COUNT MUST BE SCOPED TO THE ACTIVE CHURCH. Because a Ministry
//    is global, its group_members rows span every church. An embedded
//    `group_members(count)` reports the all-church total, which does not change
//    when the church selector does — the exact bug the inline version fixed and
//    the exact bug an innocent-looking refactor would reintroduce.
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

/** Only these two exist, and the CHECK constraint enforces it. */
export const GROUP_TYPES = Object.freeze(['Ministry', 'Small Group'])

export const GROUP_COLUMNS = 'id, name, type, church_id, color_slot, ministry_key'

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
  const projection = canSeeMembers
    ? 'group_id, member_id, members!inner(first_name, last_name, member_of)'
    : 'group_id'

  let assignmentQuery = supabase.from('group_members').select(projection)
  if (canSeeMembers) assignmentQuery = assignmentQuery.eq('members.member_of', churchId)

  const [groupsRes, assignmentsRes] = await Promise.all([
    supabase
      .from('groups')
      .select(GROUP_COLUMNS)
      // PostgREST `or` with an embedded `and` — the union described in rule 1.
      .or(`and(type.eq.Ministry,church_id.is.null),and(type.eq.Small Group,church_id.eq.${churchId})`)
      .order('type', { ascending: true })
      .order('name', { ascending: true }),
    assignmentQuery
  ])

  if (groupsRes.error) {
    return { ok: false, message: MESSAGES.loadFailed, rows: [], assignments: 0, assignedMemberIds: null, cause: groupsRes.error }
  }

  const assignments = assignmentsRes.data || []
  const counts = new Map()
  const sample = new Map()
  const assignedMemberIds = canSeeMembers ? new Set() : null

  for (const row of assignments) {
    counts.set(row.group_id, (counts.get(row.group_id) || 0) + 1)
    if (!canSeeMembers) continue
    assignedMemberIds.add(row.member_id)
    // Four faces per card is what the design draws; collecting more would be
    // rendered by nobody.
    const faces = sample.get(row.group_id) || []
    if (faces.length < 4 && row.members) {
      faces.push(`${row.members.first_name} ${row.members.last_name}`.trim())
      sample.set(row.group_id, faces)
    }
  }

  const rows = (groupsRes.data || []).map(group => ({
    ...group,
    member_count: counts.get(group.id) ?? 0,
    sample_names: sample.get(group.id) ?? []
  }))

  return {
    ok: true,
    message: '',
    rows,
    assignments: assignments.length,
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

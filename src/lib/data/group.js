// Every read the group detail page makes. Issue #76.
//
// Singular, and deliberately separate from groups.js: that module answers "which groups
// are there", this one answers "what is this group". They share the storage vocabulary
// (GROUP_TABLES and friends) and nothing else.
//
// FOUR RULES THIS MODULE EXISTS TO KEEP. The first three carry over from groups.js
// because they are properties of the schema, not of the card grid, and were re-broken
// once already when the queries lived inline.
//
// 1. WHICH TABLE DEPENDS ON WHAT KIND OF GROUP IT IS. Since 0026 there is no `groups`
//    table: a ministry is a row in `ministries`, a small group one in `small_groups`,
//    and their memberships live in two more. A group id alone does not say which, so
//    fetchGroup() probes both and every later call takes the resolved group, not an id.
//
// 2. A MINISTRY'S ROSTER SPANS EVERY CHURCH. Its membership rows are global, so the
//    roster and the count must both be scoped to the active church. Unscoped, a
//    ministry's page would show another church's people and a number that does not
//    move when the church selector does.
//
// 3. `members!inner` IS NOT FREE UNDER RLS. A caller without member-detail access sees
//    zero rows from `members`, so an inner join silently drops every assignment and
//    reports an empty group. The projection is chosen by capability, and the result
//    says which one it got — `detail: 'full' | 'names'`. A full caller gets the roster
//    with ages, join dates and journey; a names-only caller gets names alone, read
//    through directory_search() rather than the membership join (Story 20). Either way
//    the page can tell "nobody is in this group" apart from "you may not see who".
//
// 4. ARCHIVED MEMBERS ARE VISIBLE TO RLS. Since 0010 the policy stopped hiding them;
//    excluding them is the application's job at every read, including this one.
//
// WHAT THIS MODULE WILL NOT DO: answer anything about group meetings. There is no
// meeting table — `attendance` records attendance at church *services* — so the page's
// meetings surfaces are inert by design and there is deliberately no function here for
// them to call. See Soon.vue, rule 3. If you are here to add one, the feature needs a
// table first.

import { supabase } from '../supabase'
import { GROUP_TABLES, MEMBERSHIP_TABLES, MEMBERSHIP_PARENT_KEY, asGroup } from './groups'

const MESSAGES = {
  notFound: 'That group could not be found.',
  loadFailed: 'Failed to load this group. Please try again.',
  rosterFailed: 'Could not load the members of this group.',
  noChurch: 'Cannot determine your church. Please reload.'
}

/** The member columns the roster renders, and nothing else. Never `*`. */
const ROSTER_MEMBER_COLUMNS =
  'id, first_name, last_name, birthdate, date_joined, member_of, archived_at, ' +
  'is_baptized, is_one_to_one_completed, is_turning_point_completed'

/**
 * A name as it appears in a URL: lowercase, spaces and punctuation to hyphens.
 *
 * Accent-folded first, so "Señora" and "Senora" produce the same slug rather than one
 * that percent-encodes into noise. Not reversible, which is why resolution below
 * compares slugs rather than trying to turn a slug back into a name.
 */
export function slugify (name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Find a group from the church and group names in the URL.
 *
 * WHY THE CHURCH IS IN THE PATH. A small group's name is unique only within its church,
 * so two churches may both have a "Thursday Group" and `/groups/thursday-group` cannot
 * say which. Naming the church resolves it without appending characters nobody can
 * read. It is also honest about what the page shows: a ministry is global, but its
 * ROSTER here is scoped to one church, so `/groups/cogon/worship-team` really does mean
 * "the Worship Team as Cogon sees it" rather than a claim that Cogon owns it.
 *
 * A ministry and a small group in one church could still share a name. That is rare and
 * has to resolve somehow, so the small group wins: it is the one that actually belongs
 * to the church in the path, and the ministry is reachable from every other church.
 *
 * Both name lists are small — the Groups page already fetches all of them on every
 * load — so this costs the same two queries listGroups() makes.
 */
export async function fetchGroupBySlug ({ churchId, groupSlug }) {
  if (!churchId || !groupSlug) {
    return { ok: true, message: '', group: null, cause: null }
  }

  const wanted = slugify(groupSlug)

  const [ministriesRes, smallGroupsRes] = await Promise.all([
    supabase.from(GROUP_TABLES.Ministry).select('id, name, ministry_key'),
    supabase.from(GROUP_TABLES['Small Group']).select('id, name, church_id').eq('church_id', churchId)
  ])

  const failure = ministriesRes.error || smallGroupsRes.error
  if (failure) {
    return { ok: false, message: MESSAGES.loadFailed, group: null, cause: failure }
  }

  const smallGroup = (smallGroupsRes.data || []).find(row => slugify(row.name) === wanted)
  if (smallGroup) {
    return { ok: true, message: '', group: asGroup(smallGroup, 'Small Group'), cause: null }
  }

  const ministry = (ministriesRes.data || []).find(row => slugify(row.name) === wanted)
  if (ministry) {
    return { ok: true, message: '', group: asGroup(ministry, 'Ministry'), cause: null }
  }

  // No match is the same answer as "not yours": RLS already removed the rows the caller
  // may not see, so an invisible group and a renamed one both land here.
  return { ok: true, message: '', group: null, cause: null }
}

/**
 * One group, by id, whichever table it lives in.
 *
 * Returns `{ ok: true, group: null }` for an id that resolves to nothing — which is
 * both "no such group" and "a group you may not see", because RLS returns no row for
 * either and the page must not distinguish them. Telling a Pastor that a small group
 * exists in a church that is not theirs is the leak this prevents.
 */
export async function fetchGroup ({ groupId }) {
  if (!groupId) return { ok: true, message: '', group: null, cause: null }

  const [ministryRes, smallGroupRes] = await Promise.all([
    supabase.from(GROUP_TABLES.Ministry)
      .select('id, name, ministry_key').eq('id', groupId).maybeSingle(),
    supabase.from(GROUP_TABLES['Small Group'])
      .select('id, name, church_id').eq('id', groupId).maybeSingle()
  ])

  // A failure is not an absence. Reporting "not found" when the query actually errored
  // would tell the user their group was deleted.
  const failure = ministryRes.error || smallGroupRes.error
  if (failure) {
    return { ok: false, message: MESSAGES.loadFailed, group: null, cause: failure }
  }

  const row = ministryRes.data || smallGroupRes.data
  if (!row) return { ok: true, message: '', group: null, cause: null }

  return {
    ok: true,
    message: '',
    group: asGroup(row, ministryRes.data ? 'Ministry' : 'Small Group'),
    cause: null
  }
}

/**
 * The roster of one group, scoped to the active church.
 *
 * @param {{ group: object, churchId: string, canSeeMemberDetail: boolean }} params
 * @returns {Promise<{ ok, message, rows, count, detail: 'full'|'names', cause }>}
 *   `detail: 'names'` means the caller may not read member records: `rows` carry names
 *   only — no age, join date or journey — and the journey aggregate is withheld. That
 *   is Story 20's names-only roster, distinct from an empty group, and the page renders
 *   it as a name list rather than a table of detail.
 */
export async function fetchRoster ({ group, churchId, canSeeMemberDetail }) {
  if (!group) {
    return { ok: false, message: MESSAGES.notFound, rows: [], count: 0, detail: 'count', cause: null }
  }
  if (!churchId) {
    return { ok: false, message: MESSAGES.noChurch, rows: [], count: 0, detail: 'count', cause: null }
  }

  const table = MEMBERSHIP_TABLES[group.type]
  const parentKey = MEMBERSHIP_PARENT_KEY[group.type]

  // STORY 20: names, not a bare count. A caller without member detail may still see WHO
  // is in the group — their names, and nothing else. `members!inner` returns them zero
  // rows (rule 3 above), so the names cannot come from the membership tables. They come
  // from directory_search(), a SECURITY DEFINER read that returns names and each
  // person's group memberships and nothing protected — no birthdate, contact or journey.
  //
  // It is church-scoped (its own `scope` CTE: the caller's church, or every church for a
  // global role, narrowed here to the active one by p_church_id), which is exactly
  // Rule 2 for a ministry roster. And because ministry names are globally unique and
  // small-group names unique per church, a returned row can be matched to THIS group by
  // name with no collision — so no group id needs to cross into directory_search.
  if (!canSeeMemberDetail) {
    const { data, error } = await supabase.rpc('directory_search', {
      p_query: null,
      p_church_id: churchId,
      // The whole church, so a group member past the default page of 200 is not dropped.
      p_limit: 1000
    })

    if (error) {
      return { ok: false, message: MESSAGES.rosterFailed, rows: [], count: 0, detail: 'names', cause: error }
    }

    const membershipKey = group.type === 'Small Group' ? 'small_groups' : 'ministries'
    const rows = (data || [])
      // directory_search already orders by last name, first name — the same order the
      // full roster uses — so the filter preserves it rather than re-sorting on a
      // display string that would sort by first name instead.
      .filter(r => Array.isArray(r[membershipKey]) && r[membershipKey].includes(group.name))
      .map(r => ({
        membershipId: r.member_id,
        memberId: r.member_id,
        name: `${r.first_name} ${r.last_name}`.trim(),
        // The columns a names-only row does not carry. The table template guards on
        // these being null, so the age/joined line renders empty rather than wrong.
        age: null,
        joined: null
      }))

    return { ok: true, message: '', rows, count: rows.length, detail: 'names', cause: null }
  }

  const { data, error } = await supabase
    .from(table)
    .select(`id, member_id, members!inner(${ROSTER_MEMBER_COLUMNS})`)
    // Rule 2. A ministry is global; without this a Super Admin sees every church.
    .eq(parentKey, group.id)
    .eq('members.member_of', churchId)
    // Rule 4. RLS stopped hiding archived members in 0010.
    .is('members.archived_at', null)

  if (error) {
    return { ok: false, message: MESSAGES.rosterFailed, rows: [], count: 0, detail: 'full', cause: error }
  }

  const rows = (data || [])
    .filter(row => row.members)
    .map(row => ({
      membershipId: row.id,
      memberId: row.member_id,
      firstName: row.members.first_name,
      lastName: row.members.last_name,
      name: `${row.members.first_name} ${row.members.last_name}`.trim(),
      age: ageFrom(row.members.birthdate),
      joined: row.members.date_joined ?? null,
      isBaptized: !!row.members.is_baptized,
      isOneToOneCompleted: !!row.members.is_one_to_one_completed,
      isTurningPointCompleted: !!row.members.is_turning_point_completed
    }))
    // Sorted by name. The mockup says "sorted by attendance", which needs a meetings
    // table that does not exist — so the page says what it actually did.
    .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName))

  return { ok: true, message: '', rows, count: rows.length, detail: 'full', cause: null }
}

/**
 * Who leads this small group, as a member rather than an account.
 *
 * The leader is stored account-side — `small_group_leaders.account_id` — because the
 * powers follow the sign-in (0022). The roster is member-side. Resolving one to the
 * other is this function's whole job, and it is why the page can mark a roster row as
 * the leader at all: without the member id there is nothing to match on.
 *
 * Ministries have no leaders, so callers should not ask; passing one returns null
 * rather than an error, since "no leader" is the truthful answer either way.
 */
export async function fetchLeader ({ group }) {
  if (!group || group.type !== 'Small Group') {
    return { ok: true, message: '', leader: null, cause: null }
  }

  // THROUGH AN RPC, for the same reason fetchLeaderCandidates is: the leader is stored
  // as an account, and turning that into a name means reading user_accounts, which has
  // no SELECT policy for an ordinary caller. The obvious embed —
  // small_group_leaders → user_accounts → members — returns a null user_accounts under
  // RLS, so the leader rendered as "not linked to a member" for everyone. get_small_
  // group_leader (0027) does the resolution under SECURITY DEFINER: its row visibility
  // matches the small_group_leaders SELECT policy, and it fills the name only for a
  // caller who may see member detail, so a restricted caller gets a leader with no name
  // rather than a false "no leader".
  const { data, error } = await supabase
    .rpc('get_small_group_leader', { p_group: group.id })

  // A failed lookup must not render as "no leader assigned" — that is a claim about
  // the group, and this only knows that it could not ask.
  if (error) return { ok: false, message: MESSAGES.loadFailed, leader: null, cause: error }

  const row = (data || [])[0]
  if (!row) return { ok: true, message: '', leader: null, cause: null }

  return {
    ok: true,
    message: '',
    leader: {
      accountId: row.account_id,
      memberId: row.member_id ?? null,
      // Null when the caller may not see member detail, or (impossibly, today) when the
      // leader's account has no member. Either way the page says "assigned" rather than
      // inventing a name.
      name: row.full_name || null
    },
    cause: null
  }
}

/**
 * Who could lead this group: the accounts belonging to people already in its roster.
 *
 * THE ROSTER IS THE CANDIDATE LIST, and that is a database rule rather than a UI
 * nicety — assign_small_group_leader() refuses an account whose member is not in the
 * group ("a leader must already be a member of the group"). Offering anyone else would
 * be offering an action that bounces.
 *
 * The other half of the filter is having an account at all: the leader powers follow a
 * sign-in (0022), so a member with no login cannot lead however senior they are.
 *
 * THIS GOES THROUGH AN RPC, NOT A DIRECT READ. `user_accounts` has no SELECT policy for
 * an ordinary caller, so `supabase.from('user_accounts').select(...)` returns zero rows
 * with no error — indistinguishable from a group where nobody has signed in. The RPC
 * (0027) does the join under SECURITY DEFINER and is gated by the same predicate the
 * assignment checks, so it hands back exactly the roster members who could be made
 * leader, and zero rows to a caller who could not assign one anyway.
 */
export async function fetchLeaderCandidates ({ group } = {}) {
  if (!group || group.type !== 'Small Group') {
    return { ok: true, message: '', candidates: [], cause: null }
  }

  const { data, error } = await supabase
    .rpc('list_small_group_leader_candidates', { p_group: group.id })

  if (error) return { ok: false, message: MESSAGES.loadFailed, candidates: [], cause: error }

  return {
    ok: true,
    message: '',
    candidates: (data || []).map(row => ({
      accountId: row.account_id,
      memberId: row.member_id,
      role: row.role,
      name: row.full_name
    })),
    cause: null
  }
}

/**
 * The journey breakdown, computed from the roster already in hand.
 *
 * No second query on purpose: the rows are here, and rule 1 makes egress rather than
 * latency the thing to minimise.
 *
 * Returns null — never zeroes — when the caller could not read the members. "0% are
 * baptized" and "you may not count them" are different statements, and only one of
 * them is true. An empty group returns a zero-total object instead, which the page
 * renders as "no members yet" rather than as 0%.
 */
export function journeyFor ({ rows, detail }) {
  if (detail !== 'full') return null

  const total = rows.length
  const count = predicate => rows.reduce((n, r) => n + (predicate(r) ? 1 : 0), 0)
  const percent = n => (total ? Math.round((n / total) * 100) : 0)

  const baptized = count(r => r.isBaptized)
  const oneToOne = count(r => r.isOneToOneCompleted)
  const turningPoint = count(r => r.isTurningPointCompleted)

  return {
    total,
    baptized: { count: baptized, percent: percent(baptized) },
    oneToOne: { count: oneToOne, percent: percent(oneToOne) },
    turningPoint: { count: turningPoint, percent: percent(turningPoint) },
    // The mockup's third tile. Complete means all three, not any of them.
    complete: count(r => r.isBaptized && r.isOneToOneCompleted && r.isTurningPointCompleted)
  }
}

/** Whole years, or null when the birthdate is absent — never 0, which reads as a baby. */
function ageFrom (birthdate) {
  if (!birthdate) return null
  const born = new Date(birthdate)
  if (Number.isNaN(born.getTime())) return null

  const now = new Date()
  let age = now.getFullYear() - born.getFullYear()
  const monthDelta = now.getMonth() - born.getMonth()
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < born.getDate())) age -= 1
  return age >= 0 ? age : null
}

export const GROUP_DETAIL_MESSAGES = MESSAGES

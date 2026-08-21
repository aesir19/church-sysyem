import { describe, it, expect, vi, beforeEach } from 'vitest'

// Same per-table chainable as groups.test.js, and for the same reason: this module
// fires several queries in one Promise.all against different tables, and a single
// shared builder would let an assertion about one be satisfied by another.
const state = vi.hoisted(() => ({ results: {}, calls: [] }))

function makeBuilder (table) {
  const record = (name, ...args) => state.calls.push([table, name, ...args])
  const settle = () => state.results[table] ?? { data: [], error: null }
  const builder = {
    select: vi.fn(function (c, o) { record('select', c, o); return this }),
    eq: vi.fn(function (c, v) { record('eq', c, v); return this }),
    is: vi.fn(function (c, v) { record('is', c, v); return this }),
    in: vi.fn(function (c, v) { record('in', c, v); return this }),
    maybeSingle: vi.fn(function () { record('maybeSingle'); return Promise.resolve(settle()) }),
    then (onFulfilled, onRejected) {
      return Promise.resolve(settle()).then(onFulfilled, onRejected)
    }
  }
  return builder
}

vi.mock('../../../src/lib/supabase', () => ({
  supabase: {
    from: vi.fn(table => { state.calls.push([table, 'from']); return makeBuilder(table) }),
    // RPC is settled by name, the same way `from` is by table, so a test can say what
    // list_small_group_leader_candidates returned without touching the table builders.
    rpc: vi.fn((name, args) => {
      state.calls.push(['rpc', name, args])
      return Promise.resolve(state.results[`rpc:${name}`] ?? { data: [], error: null })
    })
  }
}))

const { fetchGroup, fetchGroupBySlug, fetchRoster, fetchLeader, fetchLeaderCandidates, journeyFor, slugify, GROUP_DETAIL_MESSAGES } =
  await import('../../../src/lib/data/group')

const CHURCH = 'church-1'
const MINISTRY = { id: 'g-min', name: 'Worship Team', type: 'Ministry', church_id: null, ministry_key: null }
const SMALL_GROUP = { id: 'g-sml', name: 'Thursday Group', type: 'Small Group', church_id: CHURCH, ministry_key: null }

function on (table, method) {
  return state.calls.filter(c => c[0] === table && c[1] === method)
}

/** One membership row in the shape the embed returns. */
function memberRow (id, over = {}) {
  return {
    id: `mem-${id}`,
    member_id: id,
    members: {
      id,
      first_name: 'Juan',
      last_name: id,
      birthdate: '1990-01-01',
      date_joined: '2021-06-02',
      member_of: CHURCH,
      archived_at: null,
      is_baptized: false,
      is_one_to_one_completed: false,
      is_turning_point_completed: false,
      ...over
    }
  }
}

beforeEach(() => {
  state.results = {}
  state.calls = []
  vi.clearAllMocks()
})

describe('fetchGroup — finding a group without knowing its kind', () => {
  it('probes both tables, because an id does not say which one it is in', async () => {
    state.results.ministries = { data: null, error: null }
    state.results.small_groups = { data: { id: 'g-sml', name: 'Thursday Group', church_id: CHURCH }, error: null }

    const result = await fetchGroup({ groupId: 'g-sml' })

    expect(on('ministries', 'from')).toHaveLength(1)
    expect(on('small_groups', 'from')).toHaveLength(1)
    expect(result.group).toEqual(SMALL_GROUP)
  })

  it('labels a row from ministries as a Ministry, with no church', async () => {
    state.results.ministries = { data: { id: 'g-min', name: 'Worship Team', ministry_key: null }, error: null }
    state.results.small_groups = { data: null, error: null }

    expect((await fetchGroup({ groupId: 'g-min' })).group).toEqual(MINISTRY)
  })

  // The leak this prevents: telling a Pastor that a small group exists in a church
  // that is not theirs. RLS returns no row for "no such group" and for "not yours"
  // alike, and the page must not tell them apart either.
  it('reports an invisible group exactly as it reports a missing one', async () => {
    state.results.ministries = { data: null, error: null }
    state.results.small_groups = { data: null, error: null }

    const result = await fetchGroup({ groupId: 'nope' })
    expect(result.ok).toBe(true)
    expect(result.group).toBeNull()
  })

  // A failure is not an absence. "Not found" here would tell the user their group
  // was deleted when in fact the request broke.
  it('distinguishes a failed lookup from a group that is not there', async () => {
    state.results.ministries = { data: null, error: { message: 'permission denied' } }
    state.results.small_groups = { data: null, error: null }

    const result = await fetchGroup({ groupId: 'g-min' })
    expect(result.ok).toBe(false)
    expect(result.message).toBe(GROUP_DETAIL_MESSAGES.loadFailed)
    expect(result.group).toBeNull()
  })

  it('asks nothing at all without an id', async () => {
    const result = await fetchGroup({ groupId: null })
    expect(result.group).toBeNull()
    expect(state.calls).toHaveLength(0)
  })
})

describe('slugify', () => {
  it('makes a name safe to read in a URL', () => {
    expect(slugify('Thursday Group')).toBe('thursday-group')
    expect(slugify("Men's Fellowship")).toBe('mens-fellowship')
    expect(slugify('Lights and Sounds Team')).toBe('lights-and-sounds-team')
  })

  // Otherwise the accented name percent-encodes into exactly the noise the named URL
  // was meant to replace.
  it('folds accents rather than escaping them', () => {
    expect(slugify('Señora Group')).toBe('senora-group')
  })

  it('leaves no leading, trailing or doubled hyphens', () => {
    expect(slugify('  Youth   Ministry!  ')).toBe('youth-ministry')
  })
})

describe('fetchGroupBySlug — resolving a named URL', () => {
  it('finds this church\'s small group by name', async () => {
    state.results.ministries = { data: [], error: null }
    state.results.small_groups = { data: [{ id: 'g-sml', name: 'Thursday Group', church_id: CHURCH }], error: null }

    const result = await fetchGroupBySlug({ churchId: CHURCH, groupSlug: 'thursday-group' })
    expect(result.group).toEqual(SMALL_GROUP)
  })

  it('finds a ministry by name, since a ministry belongs to no church', async () => {
    state.results.ministries = { data: [{ id: 'g-min', name: 'Worship Team', ministry_key: null }], error: null }
    state.results.small_groups = { data: [], error: null }

    const result = await fetchGroupBySlug({ churchId: CHURCH, groupSlug: 'worship-team' })
    expect(result.group).toEqual(MINISTRY)
  })

  // The reason the church is in the path at all: small-group names are unique only
  // within a church, so the query is scoped and another church's identically named
  // group is simply not among the candidates.
  it('scopes the small-group half to the church in the path', async () => {
    state.results.ministries = { data: [], error: null }
    state.results.small_groups = { data: [], error: null }
    await fetchGroupBySlug({ churchId: CHURCH, groupSlug: 'thursday-group' })

    expect(on('small_groups', 'eq')).toContainEqual(['small_groups', 'eq', 'church_id', CHURCH])
    // Ministries are global, so filtering them by church would find none of them.
    expect(on('ministries', 'eq')).toHaveLength(0)
  })

  // Rare, but it has to resolve somehow. The small group wins: it is the one that
  // actually belongs to the church named in the path.
  it('prefers the small group when a ministry shares its name', async () => {
    state.results.ministries = { data: [{ id: 'g-min', name: 'Youth', ministry_key: null }], error: null }
    state.results.small_groups = { data: [{ id: 'g-sml', name: 'Youth', church_id: CHURCH }], error: null }

    const result = await fetchGroupBySlug({ churchId: CHURCH, groupSlug: 'youth' })
    expect(result.group.type).toBe('Small Group')
    expect(result.group.id).toBe('g-sml')
  })

  // The accepted cost of a name in the path. A stale link is not an error page.
  it('reports a renamed group as simply not found', async () => {
    state.results.ministries = { data: [], error: null }
    state.results.small_groups = { data: [{ id: 'g-sml', name: 'Friday Group', church_id: CHURCH }], error: null }

    const result = await fetchGroupBySlug({ churchId: CHURCH, groupSlug: 'thursday-group' })
    expect(result.ok).toBe(true)
    expect(result.group).toBeNull()
  })

  it('distinguishes a failed lookup from a name that matches nothing', async () => {
    state.results.ministries = { data: null, error: { message: 'permission denied' } }
    state.results.small_groups = { data: [], error: null }

    const result = await fetchGroupBySlug({ churchId: CHURCH, groupSlug: 'thursday-group' })
    expect(result.ok).toBe(false)
    expect(result.group).toBeNull()
  })

  it('asks nothing without a church or a name', async () => {
    expect((await fetchGroupBySlug({ churchId: null, groupSlug: 'x' })).group).toBeNull()
    expect((await fetchGroupBySlug({ churchId: CHURCH, groupSlug: '' })).group).toBeNull()
    expect(state.calls).toHaveLength(0)
  })
})

describe('fetchRoster — the right table, scoped to the right church', () => {
  it('reads ministry_members for a ministry', async () => {
    state.results.ministry_members = { data: [memberRow('a')], error: null }
    await fetchRoster({ group: MINISTRY, churchId: CHURCH, canSeeMemberDetail: true })

    expect(on('ministry_members', 'eq')).toContainEqual(['ministry_members', 'eq', 'ministry_id', 'g-min'])
    expect(on('small_group_members', 'from')).toHaveLength(0)
  })

  it('reads small_group_members for a small group', async () => {
    state.results.small_group_members = { data: [memberRow('a')], error: null }
    await fetchRoster({ group: SMALL_GROUP, churchId: CHURCH, canSeeMemberDetail: true })

    expect(on('small_group_members', 'eq'))
      .toContainEqual(['small_group_members', 'eq', 'small_group_id', 'g-sml'])
    expect(on('ministry_members', 'from')).toHaveLength(0)
  })

  // Rule 2, and the bug most easily reintroduced: a ministry's rows are global.
  it('scopes a ministry roster to the active church', async () => {
    state.results.ministry_members = { data: [], error: null }
    await fetchRoster({ group: MINISTRY, churchId: CHURCH, canSeeMemberDetail: true })

    expect(on('ministry_members', 'eq'))
      .toContainEqual(['ministry_members', 'eq', 'members.member_of', CHURCH])
  })

  // Rule 4. RLS stopped hiding archived members in 0010.
  it('excludes archived members', async () => {
    state.results.ministry_members = { data: [], error: null }
    await fetchRoster({ group: MINISTRY, churchId: CHURCH, canSeeMemberDetail: true })

    expect(on('ministry_members', 'is'))
      .toContainEqual(['ministry_members', 'is', 'members.archived_at', null])
  })

  it('enumerates member columns rather than selecting *', async () => {
    state.results.ministry_members = { data: [], error: null }
    await fetchRoster({ group: MINISTRY, churchId: CHURCH, canSeeMemberDetail: true })

    const projection = on('ministry_members', 'select')[0][2]
    expect(projection).toContain('members!inner')
    expect(projection).not.toContain('*')
    expect(projection).toContain('is_baptized')
  })

  it('fails closed without a church rather than reading every church', async () => {
    const result = await fetchRoster({ group: MINISTRY, churchId: null, canSeeMemberDetail: true })
    expect(result.ok).toBe(false)
    expect(result.message).toBe(GROUP_DETAIL_MESSAGES.noChurch)
    expect(state.calls).toHaveLength(0)
  })
})

describe('fetchRoster — what a caller without member detail gets', () => {
  const dirRow = (id, over = {}) => ({
    member_id: id, first_name: 'Ana', last_name: id,
    church_id: CHURCH, ministries: [], small_groups: [], ...over
  })

  // Story 20. `members!inner` returns them nothing, so the names come from
  // directory_search, not the membership tables, and the result is names — not a count.
  it('reads names from directory_search rather than joining members', async () => {
    state.results['rpc:directory_search'] = {
      data: [
        dirRow('1', { small_groups: ['Thursday Group'] }),
        dirRow('2', { small_groups: ['Other Group'] })
      ],
      error: null
    }
    const result = await fetchRoster({ group: SMALL_GROUP, churchId: CHURCH, canSeeMemberDetail: false })

    expect(on('rpc', 'directory_search')).toHaveLength(1)
    // No membership-table read, no members join.
    expect(state.calls.some(c => c[0] === 'small_group_members')).toBe(false)
    expect(result.detail).toBe('names')
    // Only the person actually in this group, matched by the group's name.
    expect(result.rows.map(r => r.name)).toEqual(['Ana 1'])
    expect(result.count).toBe(1)
  })

  it('scopes directory_search to the active church', async () => {
    state.results['rpc:directory_search'] = { data: [], error: null }
    await fetchRoster({ group: SMALL_GROUP, churchId: CHURCH, canSeeMemberDetail: false })
    const call = state.calls.find(c => c[0] === 'rpc' && c[1] === 'directory_search')
    expect(call[2].p_church_id).toBe(CHURCH)
  })

  // A ministry roster is matched on the ministry-name array, a small group on its own.
  it('matches a ministry roster by ministry name', async () => {
    state.results['rpc:directory_search'] = {
      data: [dirRow('7', { ministries: ['Worship Team'] }), dirRow('8', { ministries: ['Ushering'] })],
      error: null
    }
    const result = await fetchRoster({ group: MINISTRY, churchId: CHURCH, canSeeMemberDetail: false })
    expect(result.rows.map(r => r.memberId)).toEqual(['7'])
  })

  it('carries names only — no age or join date', async () => {
    state.results['rpc:directory_search'] = {
      data: [dirRow('1', { small_groups: ['Thursday Group'] })], error: null
    }
    const result = await fetchRoster({ group: SMALL_GROUP, churchId: CHURCH, canSeeMemberDetail: false })
    expect(result.rows[0]).toMatchObject({ memberId: '1', name: 'Ana 1', age: null, joined: null })
  })

  it('says the result is full detail for a caller who may see it', async () => {
    state.results.ministry_members = { data: [memberRow('a')], error: null }
    const result = await fetchRoster({ group: MINISTRY, churchId: CHURCH, canSeeMemberDetail: true })
    expect(result.detail).toBe('full')
  })

  it('reports a load failure rather than an empty roster (full)', async () => {
    state.results.ministry_members = { data: null, error: { message: 'boom' } }
    const result = await fetchRoster({ group: MINISTRY, churchId: CHURCH, canSeeMemberDetail: true })

    expect(result.ok).toBe(false)
    expect(result.message).toBe(GROUP_DETAIL_MESSAGES.rosterFailed)
    expect(result.rows).toEqual([])
  })

  // A directory_search failure is not an empty group — the names tier fails the same way.
  it('reports a directory_search failure rather than an empty roster (names)', async () => {
    state.results['rpc:directory_search'] = { data: null, error: { message: 'boom' } }
    const result = await fetchRoster({ group: SMALL_GROUP, churchId: CHURCH, canSeeMemberDetail: false })

    expect(result.ok).toBe(false)
    expect(result.detail).toBe('names')
    expect(result.rows).toEqual([])
  })
})

describe('fetchRoster — the rows it hands the page', () => {
  it('sorts by name, since sorting by attendance needs a table that does not exist', async () => {
    state.results.ministry_members = {
      data: [memberRow('Santos'), memberRow('Abad'), memberRow('Reyes')],
      error: null
    }
    const result = await fetchRoster({ group: MINISTRY, churchId: CHURCH, canSeeMemberDetail: true })
    expect(result.rows.map(r => r.lastName)).toEqual(['Abad', 'Reyes', 'Santos'])
  })

  it('gives a member with no birthdate a null age, never zero', async () => {
    state.results.ministry_members = { data: [memberRow('a', { birthdate: null })], error: null }
    const result = await fetchRoster({ group: MINISTRY, churchId: CHURCH, canSeeMemberDetail: true })
    expect(result.rows[0].age).toBeNull()
  })

  it('computes a whole-year age', async () => {
    const born = new Date()
    born.setFullYear(born.getFullYear() - 30)
    born.setDate(born.getDate() - 1)
    state.results.ministry_members = {
      data: [memberRow('a', { birthdate: born.toISOString().slice(0, 10) })],
      error: null
    }
    const result = await fetchRoster({ group: MINISTRY, churchId: CHURCH, canSeeMemberDetail: true })
    expect(result.rows[0].age).toBe(30)
  })
})

describe('journeyFor', () => {
  const rowsOf = flags => ({
    detail: 'full',
    rows: flags.map(f => ({
      isBaptized: !!f[0], isOneToOneCompleted: !!f[1], isTurningPointCompleted: !!f[2]
    }))
  })

  it('counts each stage and its share of the group', () => {
    const journey = journeyFor(rowsOf([[1, 1, 1], [1, 1, 0], [1, 0, 0], [0, 0, 0]]))

    expect(journey.total).toBe(4)
    expect(journey.baptized).toEqual({ count: 3, percent: 75 })
    expect(journey.oneToOne).toEqual({ count: 2, percent: 50 })
    expect(journey.turningPoint).toEqual({ count: 1, percent: 25 })
  })

  it('counts complete as all three stages, not any of them', () => {
    expect(journeyFor(rowsOf([[1, 1, 1], [1, 1, 0]])).complete).toBe(1)
  })

  // "0% are baptized" and "you may not count them" are different statements, and the
  // panel is hidden for the second rather than showing the first.
  it('returns null — not zeroes — when the caller could not read the members', () => {
    expect(journeyFor({ rows: [], detail: 'count' })).toBeNull()
  })

  // An empty group is a real answer, and distinct from the one above.
  it('returns a zero total for a group with no members', () => {
    const journey = journeyFor({ rows: [], detail: 'full' })
    expect(journey).not.toBeNull()
    expect(journey.total).toBe(0)
    expect(journey.baptized).toEqual({ count: 0, percent: 0 })
  })
})

describe('fetchLeader — who currently leads, resolved to a name', () => {
  const leaderRow = (over = {}) => ({
    account_id: 'acc-1',
    member_id: 'mem-1',
    full_name: 'Wendy Welcomer',
    ...over
  })

  // The bug this replaces: the old embed read user_accounts, which RLS empties, so the
  // leader rendered as "not linked" for everyone. This must call the RPC.
  it('reads through the RPC, not an embed on small_group_leaders', async () => {
    state.results['rpc:get_small_group_leader'] = { data: [leaderRow()], error: null }
    await fetchLeader({ group: SMALL_GROUP })

    expect(on('rpc', 'get_small_group_leader')).toHaveLength(1)
    expect(state.calls.some(c => c[0] === 'small_group_leaders')).toBe(false)
    expect(state.calls.some(c => c[0] === 'user_accounts')).toBe(false)
  })

  it('passes the group id', async () => {
    state.results['rpc:get_small_group_leader'] = { data: [], error: null }
    await fetchLeader({ group: SMALL_GROUP })
    const call = state.calls.find(c => c[0] === 'rpc' && c[1] === 'get_small_group_leader')
    expect(call[2]).toEqual({ p_group: SMALL_GROUP.id })
  })

  it('names the leader when the RPC returns a name', async () => {
    state.results['rpc:get_small_group_leader'] = { data: [leaderRow()], error: null }
    const result = await fetchLeader({ group: SMALL_GROUP })
    expect(result.leader).toEqual({ accountId: 'acc-1', memberId: 'mem-1', name: 'Wendy Welcomer' })
  })

  // A caller who may see a leader exists but not member detail gets a row with no name.
  // The leader still exists — name null must not collapse to "no leader".
  it('keeps the leader with a null name when the RPC withholds it', async () => {
    state.results['rpc:get_small_group_leader'] = { data: [leaderRow({ full_name: null })], error: null }
    const result = await fetchLeader({ group: SMALL_GROUP })
    expect(result.leader.accountId).toBe('acc-1')
    expect(result.leader.name).toBeNull()
  })

  it('reports no leader when the RPC returns no row', async () => {
    state.results['rpc:get_small_group_leader'] = { data: [], error: null }
    const result = await fetchLeader({ group: SMALL_GROUP })
    expect(result.ok).toBe(true)
    expect(result.leader).toBeNull()
  })

  // A ministry has no leader — no RPC call, and null, never an error.
  it('returns null for a ministry without calling the RPC', async () => {
    const result = await fetchLeader({ group: MINISTRY })
    expect(result.leader).toBeNull()
    expect(on('rpc', 'get_small_group_leader')).toHaveLength(0)
  })

  // A failed lookup is not "no leader assigned" — that is a claim about the group.
  it('reports failure rather than no-leader when the RPC errors', async () => {
    state.results['rpc:get_small_group_leader'] = { data: null, error: { message: 'boom' } }
    const result = await fetchLeader({ group: SMALL_GROUP })
    expect(result.ok).toBe(false)
    expect(result.leader).toBeNull()
  })
})

describe('fetchLeaderCandidates — who may be made leader', () => {
  const candidateRow = (id, over = {}) => ({
    account_id: `acc-${id}`,
    member_id: id,
    full_name: `Juan ${id}`,
    role: 'member',
    ...over
  })

  // The bug this whole migration replaces: the old direct read of user_accounts went
  // through PostgREST and returned nothing under RLS. This must call the RPC instead.
  it('reads through the RPC, not a direct user_accounts select', async () => {
    state.results['rpc:list_small_group_leader_candidates'] = { data: [candidateRow('a')], error: null }
    await fetchLeaderCandidates({ group: SMALL_GROUP })

    expect(on('rpc', 'list_small_group_leader_candidates')).toHaveLength(1)
    // Nothing reads user_accounts directly — that is the read RLS silently empties.
    expect(state.calls.some(c => c[0] === 'user_accounts')).toBe(false)
  })

  it('passes the group id the RPC is gated on', async () => {
    state.results['rpc:list_small_group_leader_candidates'] = { data: [], error: null }
    await fetchLeaderCandidates({ group: SMALL_GROUP })

    const call = state.calls.find(c => c[0] === 'rpc' && c[1] === 'list_small_group_leader_candidates')
    expect(call[2]).toEqual({ p_group: SMALL_GROUP.id })
  })

  it('maps the RPC columns to the shape the dialog binds', async () => {
    state.results['rpc:list_small_group_leader_candidates'] = {
      data: [candidateRow('Reyes', { account_id: 'acc-1', full_name: 'Ana Reyes', role: 'pastor' })],
      error: null
    }
    const result = await fetchLeaderCandidates({ group: SMALL_GROUP })

    expect(result.candidates).toEqual([
      { accountId: 'acc-1', memberId: 'Reyes', name: 'Ana Reyes', role: 'pastor' }
    ])
  })

  // A ministry has no leader, so there is nothing to ask for — and no RPC call to make.
  it('returns nothing for a ministry without calling the RPC', async () => {
    const result = await fetchLeaderCandidates({ group: MINISTRY })
    expect(result.candidates).toEqual([])
    expect(on('rpc', 'list_small_group_leader_candidates')).toHaveLength(0)
  })

  it('returns nothing when no group is given', async () => {
    const result = await fetchLeaderCandidates({})
    expect(result.ok).toBe(true)
    expect(result.candidates).toEqual([])
  })

  // An RPC error is not an empty candidate list — the dialog surfaces the difference.
  it('reports failure rather than an empty list when the RPC errors', async () => {
    state.results['rpc:list_small_group_leader_candidates'] = { data: null, error: { message: 'boom' } }
    const result = await fetchLeaderCandidates({ group: SMALL_GROUP })

    expect(result.ok).toBe(false)
    expect(result.message).toBe(GROUP_DETAIL_MESSAGES.loadFailed)
    expect(result.candidates).toEqual([])
  })
})

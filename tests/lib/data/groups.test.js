import { describe, it, expect, vi, beforeEach } from 'vitest'

// listGroups fires two requests in one Promise.all, against two different
// tables. members.test.js's single shared builder cannot express that — both
// queries would resolve to the same row set and every assertion about "the
// groups query" could be satisfied by the assignments query. So each from()
// hands back its OWN chainable, and results are keyed by table.
const state = vi.hoisted(() => ({ results: {}, calls: [] }))

function makeBuilder(table) {
  const record = (name, ...args) => state.calls.push([table, name, ...args])
  const builder = {
    select: vi.fn(function (columns, options) { record('select', columns, options); return this }),
    eq: vi.fn(function (col, val) { record('eq', col, val); return this }),
    is: vi.fn(function (col, val) { record('is', col, val); return this }),
    or: vi.fn(function (filter) { record('or', filter); return this }),
    order: vi.fn(function (col, options) { record('order', col, options); return this }),
    then(onFulfilled, onRejected) {
      const result = state.results[table] ?? { data: [], error: null }
      return Promise.resolve(result).then(onFulfilled, onRejected)
    },
  }
  return builder
}

vi.mock('../../../src/lib/supabase', () => ({
  supabase: {
    from: vi.fn((table) => { state.calls.push([table, 'from']); return makeBuilder(table) }),
  },
}))

const {
  listGroups, countMembersInNoGroup, asGroup,
  MINISTRY_COLUMNS, SMALL_GROUP_COLUMNS, GROUP_MESSAGES,
} = await import('../../../src/lib/data/groups')

const CHURCH = 'church-1'

function on(table, method) {
  return state.calls.filter((c) => c[0] === table && c[1] === method)
}

// FOUR TABLES SINCE 0026, and the fixtures below say which is which rather than
// carrying a `type` column — because there no longer is one. `type` is now
// produced by asGroup() from the table a row arrived from, so a test that sets
// `type: 'Ministry'` on a fixture would be asserting against its own input.

/** Two members in Worship, one in Youth. Both are ministries. */
function ministryAssignments() {
  return [
    { ministry_id: 'g-worship', member_id: 'm1', members: { first_name: 'Juan', last_name: 'Cruz', member_of: CHURCH } },
    { ministry_id: 'g-worship', member_id: 'm2', members: { first_name: 'Ana', last_name: 'Reyes', member_of: CHURCH } },
    { ministry_id: 'g-youth', member_id: 'm3', members: { first_name: 'Ben', last_name: 'Lim', member_of: CHURCH } },
  ]
}

function smallGroupAssignments() {
  return []
}

function ministryRows() {
  return [
    { id: 'g-worship', name: 'Worship Team', ministry_key: null },
    { id: 'g-youth', name: 'Youth', ministry_key: null },
  ]
}

function smallGroupRows() {
  return [{ id: 'g-thu', name: 'Thursday Group', church_id: CHURCH }]
}

/** The four results a full listGroups() call consumes. */
function seedAll({ ministries = ministryRows(), smallGroups = smallGroupRows(),
  ministryMembers = [], smallGroupMembers = [] } = {}) {
  state.results.ministries = { data: ministries, error: null }
  state.results.small_groups = { data: smallGroups, error: null }
  state.results.ministry_members = { data: ministryMembers, error: null }
  state.results.small_group_members = { data: smallGroupMembers, error: null }
}

beforeEach(() => {
  state.results = {}
  state.calls = []
  vi.clearAllMocks()
})

describe('listGroups — scope', () => {
  it('fails without a church rather than querying for every church', async () => {
    const result = await listGroups({ churchId: null, canSeeMembers: true })
    expect(result.ok).toBe(false)
    expect(result.message).toBe(GROUP_MESSAGES.noChurch)
    expect(state.calls).toHaveLength(0)
  })

  // Rule 1, restated for the split. A ministry is global — `ministries` has no
  // church_id column to filter on — and a small group is church-scoped. The old
  // hand-written `or(and(...),and(...))` union is gone; scoping one table and not
  // the other is what replaces it. Filtering ministries by church would hide all
  // of them, since there is nothing to match.
  it('asks for every ministry, unscoped, because a ministry is global', async () => {
    seedAll()
    await listGroups({ churchId: CHURCH, canSeeMembers: true })

    expect(on('ministries', 'eq')).toHaveLength(0)
    expect(on('ministries', 'or')).toHaveLength(0)
  })

  it('scopes small groups to the active church', async () => {
    seedAll()
    await listGroups({ churchId: CHURCH, canSeeMembers: true })
    expect(on('small_groups', 'eq')).toContainEqual(['small_groups', 'eq', 'church_id', CHURCH])
  })

  it('enumerates the columns of each table rather than selecting *', async () => {
    seedAll()
    await listGroups({ churchId: CHURCH, canSeeMembers: true })

    expect(on('ministries', 'select')[0][2]).toBe(MINISTRY_COLUMNS)
    expect(on('small_groups', 'select')[0][2]).toBe(SMALL_GROUP_COLUMNS)
    expect(MINISTRY_COLUMNS).not.toContain('*')
    expect(SMALL_GROUP_COLUMNS).not.toContain('*')
    // Neither table has the other's column, which is the point of the split.
    expect(MINISTRY_COLUMNS).not.toContain('church_id')
    expect(SMALL_GROUP_COLUMNS).not.toContain('ministry_key')
  })

  it('orders each table by name, and returns ministries before small groups', async () => {
    seedAll()
    const result = await listGroups({ churchId: CHURCH, canSeeMembers: true })

    expect(on('ministries', 'order')[0].slice(2)).toEqual(['name', { ascending: true }])
    expect(on('small_groups', 'order')[0].slice(2)).toEqual(['name', { ascending: true }])
    // The old query said .order('type').order('name'), and 'Ministry' sorts
    // before 'Small Group'. Concatenation has to reproduce that.
    expect(result.rows.map((g) => g.type)).toEqual(['Ministry', 'Ministry', 'Small Group'])
  })

  it('gives every row back the type and the null column its table does not store', async () => {
    seedAll()
    const result = await listGroups({ churchId: CHURCH, canSeeMembers: true })

    expect(result.rows[0]).toMatchObject({ type: 'Ministry', church_id: null })
    expect(result.rows[2]).toMatchObject({ type: 'Small Group', church_id: CHURCH, ministry_key: null })
  })

  it('does not surface raw error text when either half fails', async () => {
    seedAll()
    state.results.ministries = { data: null, error: { message: 'permission denied for table ministries' } }

    const result = await listGroups({ churchId: CHURCH, canSeeMembers: true })
    expect(result.ok).toBe(false)
    expect(result.message).toBe(GROUP_MESSAGES.loadFailed)
    expect(result.cause).toEqual({ message: 'permission denied for table ministries' })
  })

  // Half a grid is worse than an error: it reads as "the small groups were
  // deleted" rather than "this did not load".
  it('fails the whole load when only the small-group half fails', async () => {
    seedAll()
    state.results.small_groups = { data: null, error: { message: 'permission denied' } }

    const result = await listGroups({ churchId: CHURCH, canSeeMembers: true })
    expect(result.ok).toBe(false)
    expect(result.rows).toEqual([])
  })
})

describe('asGroup', () => {
  it('never invents a church for a ministry or a key for a small group', () => {
    expect(asGroup({ id: 'a', name: 'Finance', ministry_key: 'finance' }, 'Ministry'))
      .toEqual({ id: 'a', name: 'Finance', type: 'Ministry', church_id: null, ministry_key: 'finance' })

    expect(asGroup({ id: 'b', name: 'Thursday', church_id: CHURCH }, 'Small Group'))
      .toEqual({ id: 'b', name: 'Thursday', type: 'Small Group', church_id: CHURCH, ministry_key: null })
  })
})

describe('listGroups — counts', () => {
  // Rule 2, and the reason this module exists. A Ministry's group_members rows
  // span every church, so an unscoped count reports the all-church total and
  // does not change when the church selector does.
  it('scopes both assignment queries to the active church through the embed', async () => {
    seedAll()
    await listGroups({ churchId: CHURCH, canSeeMembers: true })

    expect(on('ministry_members', 'eq'))
      .toContainEqual(['ministry_members', 'eq', 'members.member_of', CHURCH])
    expect(on('small_group_members', 'eq'))
      .toContainEqual(['small_group_members', 'eq', 'members.member_of', CHURCH])
  })

  it('counts per group from the returned assignments, not from an embedded count', async () => {
    seedAll({
      ministryMembers: ministryAssignments(),
      smallGroupMembers: smallGroupAssignments(),
    })

    const result = await listGroups({ churchId: CHURCH, canSeeMembers: true })
    const counts = Object.fromEntries(result.rows.map((g) => [g.id, g.member_count]))
    expect(counts).toEqual({ 'g-worship': 2, 'g-youth': 1, 'g-thu': 0 })
  })

  // The two membership tables are counted into one map keyed by group id. A
  // small group's members must not be attributed to a ministry that happens to
  // sort into the same slot.
  it('keeps the two membership tables apart when counting', async () => {
    seedAll({
      ministryMembers: ministryAssignments(),
      smallGroupMembers: [
        { small_group_id: 'g-thu', member_id: 'm9', members: { first_name: 'Rosa', last_name: 'Diaz', member_of: CHURCH } },
      ],
    })

    const result = await listGroups({ churchId: CHURCH, canSeeMembers: true })
    const counts = Object.fromEntries(result.rows.map((g) => [g.id, g.member_count]))
    expect(counts).toEqual({ 'g-worship': 2, 'g-youth': 1, 'g-thu': 1 })
  })

  it('reports a group with no assignments as zero rather than dropping it', async () => {
    seedAll()

    const result = await listGroups({ churchId: CHURCH, canSeeMembers: true })
    expect(result.rows).toHaveLength(3)
    expect(result.rows.every((g) => g.member_count === 0)).toBe(true)
  })

  it('returns the total assignment count, across both tables, for the header', async () => {
    seedAll({
      ministryMembers: ministryAssignments(),
      smallGroupMembers: [
        { small_group_id: 'g-thu', member_id: 'm9', members: { first_name: 'Rosa', last_name: 'Diaz', member_of: CHURCH } },
      ],
    })
    expect((await listGroups({ churchId: CHURCH, canSeeMembers: true })).assignments).toBe(4)
  })

  it('caps the avatar stack at the four faces the card draws', async () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      ministry_id: 'g-worship',
      member_id: `m${i}`,
      members: { first_name: 'Member', last_name: `${i}`, member_of: CHURCH },
    }))
    seedAll({ ministryMembers: many })

    const worship = (await listGroups({ churchId: CHURCH, canSeeMembers: true })).rows[0]
    expect(worship.member_count).toBe(9)
    expect(worship.sample_names).toHaveLength(4)
    expect(worship.sample_names[0]).toBe('Member 0')
  })
})

describe('listGroups — RLS-safe projection', () => {
  // Rule 3. A caller without member-detail access sees zero rows from
  // `members`, so `members!inner` drops every assignment and reports every
  // group as empty. Asking only for group_id keeps the counts right.
  it('does not join members for a caller who cannot read them', async () => {
    seedAll()
    await listGroups({ churchId: CHURCH, canSeeMembers: false })

    expect(on('ministry_members', 'select')[0][2]).toBe('ministry_id')
    expect(on('small_group_members', 'select')[0][2]).toBe('small_group_id')
    expect(on('ministry_members', 'select')[0][2]).not.toContain('members')
    // …and no filter on the embed either, since there is no embed to filter.
    expect(on('ministry_members', 'eq')).toHaveLength(0)
    expect(on('small_group_members', 'eq')).toHaveLength(0)
  })

  it('joins members for a caller who can read them, so the cards get faces', async () => {
    seedAll()
    await listGroups({ churchId: CHURCH, canSeeMembers: true })

    expect(on('ministry_members', 'select')[0][2]).toContain('members!inner')
    expect(on('small_group_members', 'select')[0][2]).toContain('members!inner')
  })

  it('still counts correctly without the join', async () => {
    seedAll({
      ministryMembers: [
        { ministry_id: 'g-worship' }, { ministry_id: 'g-worship' }, { ministry_id: 'g-youth' },
      ],
    })

    const result = await listGroups({ churchId: CHURCH, canSeeMembers: false })
    expect(result.rows.map((g) => g.member_count)).toEqual([2, 1, 0])
    expect(result.rows.every((g) => g.sample_names.length === 0)).toBe(true)
  })

  // "41 members in none" and "we could not tell" are different statements, and
  // the view renders the header only when it is the first one.
  it('returns a null id set — not an empty one — when it could not read members', async () => {
    seedAll({ ministryMembers: [{ ministry_id: 'g-worship' }] })
    const result = await listGroups({ churchId: CHURCH, canSeeMembers: false })
    expect(result.assignedMemberIds).toBeNull()
  })

  // Now spanning two tables: the same person in a ministry and a small group is
  // two rows from two queries, and must still be one member.
  it('returns distinct member ids, so somebody in two groups is counted once', async () => {
    seedAll({
      ministryMembers: ministryAssignments(),
      smallGroupMembers: [
        { small_group_id: 'g-thu', member_id: 'm1', members: { first_name: 'Juan', last_name: 'Cruz', member_of: CHURCH } },
      ],
    })

    const result = await listGroups({ churchId: CHURCH, canSeeMembers: true })
    expect(result.assignments).toBe(4)
    expect(result.assignedMemberIds.size).toBe(3)
  })

  // A failed assignments query is not a failed load: the grid is still true,
  // it just has no numbers on it.
  it('still lists the groups when both assignment queries fail', async () => {
    seedAll()
    state.results.ministry_members = { data: null, error: { message: 'permission denied' } }
    state.results.small_group_members = { data: null, error: { message: 'permission denied' } }

    const result = await listGroups({ churchId: CHURCH, canSeeMembers: true })
    expect(result.ok).toBe(true)
    expect(result.rows).toHaveLength(3)
    expect(result.assignments).toBe(0)
  })
})

describe('countMembersInNoGroup', () => {
  it('subtracts the distinct assigned members from the active roll', async () => {
    state.results.members = { count: 44, error: null }
    const count = await countMembersInNoGroup({
      churchId: CHURCH,
      assignedMemberIds: new Set(['m1', 'm2', 'm3']),
    })
    expect(count).toBe(41)
  })

  it('counts by header only — it never pulls the roll into the browser', async () => {
    state.results.members = { count: 0, error: null }
    await countMembersInNoGroup({ churchId: CHURCH, assignedMemberIds: new Set() })
    expect(on('members', 'select')[0].slice(2)).toEqual(['id', { count: 'exact', head: true }])
  })

  it('scopes to the church and excludes archived members', async () => {
    state.results.members = { count: 0, error: null }
    await countMembersInNoGroup({ churchId: CHURCH, assignedMemberIds: new Set() })
    expect(on('members', 'eq')).toContainEqual(['members', 'eq', 'member_of', CHURCH])
    expect(on('members', 'is')).toContainEqual(['members', 'is', 'archived_at', null])
  })

  it('says null, not zero, when the caller could not read member ids', async () => {
    const count = await countMembersInNoGroup({ churchId: CHURCH, assignedMemberIds: null })
    expect(count).toBeNull()
    expect(state.calls).toHaveLength(0)
  })

  it('says null when the count itself failed', async () => {
    state.results.members = { count: null, error: { message: 'permission denied' } }
    expect(await countMembersInNoGroup({ churchId: CHURCH, assignedMemberIds: new Set() })).toBeNull()
  })

  // Assignments are church-scoped and the roll count is church-scoped, but a
  // stale id set from a previous church could still exceed it. Reporting -3
  // ungrouped members would be worse than reporting none.
  it('never reports a negative remainder', async () => {
    state.results.members = { count: 2, error: null }
    const count = await countMembersInNoGroup({
      churchId: CHURCH,
      assignedMemberIds: new Set(['m1', 'm2', 'm3', 'm4']),
    })
    expect(count).toBe(0)
  })

  it('fails closed without a church', async () => {
    expect(await countMembersInNoGroup({ churchId: '', assignedMemberIds: new Set() })).toBeNull()
    expect(state.calls).toHaveLength(0)
  })
})

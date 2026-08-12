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

const { listGroups, countMembersInNoGroup, GROUP_COLUMNS, GROUP_MESSAGES } =
  await import('../../../src/lib/data/groups')

const CHURCH = 'church-1'

function on(table, method) {
  return state.calls.filter((c) => c[0] === table && c[1] === method)
}

/** Two members in Worship, one in Youth — the shape the embed returns. */
function assignmentRows() {
  return [
    { group_id: 'g-worship', member_id: 'm1', members: { first_name: 'Juan', last_name: 'Cruz', member_of: CHURCH } },
    { group_id: 'g-worship', member_id: 'm2', members: { first_name: 'Ana', last_name: 'Reyes', member_of: CHURCH } },
    { group_id: 'g-youth', member_id: 'm3', members: { first_name: 'Ben', last_name: 'Lim', member_of: CHURCH } },
  ]
}

function groupRows() {
  return [
    { id: 'g-worship', name: 'Worship Team', type: 'Ministry', church_id: null },
    { id: 'g-youth', name: 'Youth', type: 'Ministry', church_id: null },
    { id: 'g-thu', name: 'Thursday Group', type: 'Small Group', church_id: CHURCH },
  ]
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

  // Rule 1. A Ministry is global (church_id IS NULL per the 0004 CHECK) and a
  // Small Group is church-scoped, so "the groups for this church" is a union of
  // two conditions. A plain .eq('church_id', churchId) would hide every
  // ministry; .is('church_id', null) would hide every small group.
  it('asks for global ministries AND this church’s small groups, in one filter', async () => {
    state.results.groups = { data: [], error: null }
    await listGroups({ churchId: CHURCH, canSeeMembers: true })

    const filter = on('groups', 'or')[0][2]
    expect(filter).toContain('and(type.eq.Ministry,church_id.is.null)')
    expect(filter).toContain(`and(type.eq.Small Group,church_id.eq.${CHURCH})`)
  })

  it('enumerates group columns rather than selecting *', async () => {
    state.results.groups = { data: [], error: null }
    await listGroups({ churchId: CHURCH, canSeeMembers: true })
    expect(on('groups', 'select')[0][2]).toBe(GROUP_COLUMNS)
    expect(GROUP_COLUMNS).not.toContain('*')
  })

  it('orders by type then name, so the grid is stable between loads', async () => {
    state.results.groups = { data: [], error: null }
    await listGroups({ churchId: CHURCH, canSeeMembers: true })
    const orders = on('groups', 'order')
    expect(orders[0].slice(2)).toEqual(['type', { ascending: true }])
    expect(orders[1].slice(2)).toEqual(['name', { ascending: true }])
  })

  it('does not surface raw error text when the groups query fails', async () => {
    state.results.groups = { data: null, error: { message: 'permission denied for table groups' } }
    const result = await listGroups({ churchId: CHURCH, canSeeMembers: true })
    expect(result.ok).toBe(false)
    expect(result.message).toBe(GROUP_MESSAGES.loadFailed)
    expect(result.cause).toEqual({ message: 'permission denied for table groups' })
  })
})

describe('listGroups — counts', () => {
  // Rule 2, and the reason this module exists. A Ministry's group_members rows
  // span every church, so an unscoped count reports the all-church total and
  // does not change when the church selector does.
  it('scopes the assignment query to the active church through the embed', async () => {
    state.results.groups = { data: [], error: null }
    state.results.group_members = { data: [], error: null }
    await listGroups({ churchId: CHURCH, canSeeMembers: true })
    expect(on('group_members', 'eq')).toContainEqual(['group_members', 'eq', 'members.member_of', CHURCH])
  })

  it('counts per group from the returned assignments, not from an embedded count', async () => {
    state.results.groups = { data: groupRows(), error: null }
    state.results.group_members = { data: assignmentRows(), error: null }

    const result = await listGroups({ churchId: CHURCH, canSeeMembers: true })
    const counts = Object.fromEntries(result.rows.map((g) => [g.id, g.member_count]))
    expect(counts).toEqual({ 'g-worship': 2, 'g-youth': 1, 'g-thu': 0 })
  })

  it('reports a group with no assignments as zero rather than dropping it', async () => {
    state.results.groups = { data: groupRows(), error: null }
    state.results.group_members = { data: [], error: null }

    const result = await listGroups({ churchId: CHURCH, canSeeMembers: true })
    expect(result.rows).toHaveLength(3)
    expect(result.rows.every((g) => g.member_count === 0)).toBe(true)
  })

  it('returns the total assignment count for the header', async () => {
    state.results.groups = { data: groupRows(), error: null }
    state.results.group_members = { data: assignmentRows(), error: null }
    expect((await listGroups({ churchId: CHURCH, canSeeMembers: true })).assignments).toBe(3)
  })

  it('caps the avatar stack at the four faces the card draws', async () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      group_id: 'g-worship',
      member_id: `m${i}`,
      members: { first_name: 'Member', last_name: `${i}`, member_of: CHURCH },
    }))
    state.results.groups = { data: groupRows(), error: null }
    state.results.group_members = { data: many, error: null }

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
    state.results.groups = { data: [], error: null }
    state.results.group_members = { data: [], error: null }
    await listGroups({ churchId: CHURCH, canSeeMembers: false })

    const projection = on('group_members', 'select')[0][2]
    expect(projection).toBe('group_id')
    expect(projection).not.toContain('members')
    // …and no filter on the embed either, since there is no embed to filter.
    expect(on('group_members', 'eq')).toHaveLength(0)
  })

  it('joins members for a caller who can read them, so the cards get faces', async () => {
    state.results.groups = { data: [], error: null }
    state.results.group_members = { data: [], error: null }
    await listGroups({ churchId: CHURCH, canSeeMembers: true })
    expect(on('group_members', 'select')[0][2]).toContain('members!inner')
  })

  it('still counts correctly without the join', async () => {
    state.results.groups = { data: groupRows(), error: null }
    state.results.group_members = {
      data: [{ group_id: 'g-worship' }, { group_id: 'g-worship' }, { group_id: 'g-youth' }],
      error: null,
    }

    const result = await listGroups({ churchId: CHURCH, canSeeMembers: false })
    expect(result.rows.map((g) => g.member_count)).toEqual([2, 1, 0])
    expect(result.rows.every((g) => g.sample_names.length === 0)).toBe(true)
  })

  // "41 members in none" and "we could not tell" are different statements, and
  // the view renders the header only when it is the first one.
  it('returns a null id set — not an empty one — when it could not read members', async () => {
    state.results.groups = { data: groupRows(), error: null }
    state.results.group_members = { data: [{ group_id: 'g-worship' }], error: null }
    const result = await listGroups({ churchId: CHURCH, canSeeMembers: false })
    expect(result.assignedMemberIds).toBeNull()
  })

  it('returns distinct member ids, so somebody in two groups is counted once', async () => {
    state.results.groups = { data: groupRows(), error: null }
    state.results.group_members = {
      data: [
        ...assignmentRows(),
        { group_id: 'g-thu', member_id: 'm1', members: { first_name: 'Juan', last_name: 'Cruz', member_of: CHURCH } },
      ],
      error: null,
    }

    const result = await listGroups({ churchId: CHURCH, canSeeMembers: true })
    expect(result.assignments).toBe(4)
    expect(result.assignedMemberIds.size).toBe(3)
  })

  // A failed assignments query is not a failed load: the grid is still true,
  // it just has no numbers on it.
  it('still lists the groups when the assignment query fails', async () => {
    state.results.groups = { data: groupRows(), error: null }
    state.results.group_members = { data: null, error: { message: 'permission denied' } }

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

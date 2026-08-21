import { describe, it, expect, vi, beforeEach } from 'vitest'

// One chainable stub standing in for the PostgREST builder. Every filter method
// returns `this`, and `select` resolves — matching the real builder, where
// execution is deferred until the object is awaited.
const state = vi.hoisted(() => ({ result: { data: [], error: null }, calls: [] }))

// Chainable AND thenable, like the real PostgrestFilterBuilder: every method
// returns `this`, and the request only resolves when the object is awaited.
// Getting this wrong in the stub hides the very laziness `write` depends on.
const builder = vi.hoisted(() => ({
  insert: vi.fn(function (payload) { state.calls.push(['insert', payload]); return this }),
  update: vi.fn(function (payload) { state.calls.push(['update', payload]); return this }),
  eq: vi.fn(function (col, val) { state.calls.push(['eq', col, val]); return this }),
  is: vi.fn(function (col, val) { state.calls.push(['is', col, val]); return this }),
  or: vi.fn(function (filter) { state.calls.push(['or', filter]); return this }),
  order: vi.fn(function (col, options) { state.calls.push(['order', col, options]); return this }),
  range: vi.fn(function (from, to) { state.calls.push(['range', from, to]); return this }),
  select: vi.fn(function (columns, options) { state.calls.push(['select', columns, options]); return this }),
  then(onFulfilled, onRejected) {
    return Promise.resolve(state.result).then(onFulfilled, onRejected)
  },
}))

vi.mock('../../../src/lib/supabase', () => ({
  supabase: {
    from: vi.fn((table) => { state.calls.push(['from', table]); return builder }),
    rpc: vi.fn((name, args) => {
      state.calls.push(['rpc', name, args])
      return Promise.resolve(state.result)
    }),
  },
}))

const {
  listDirectory,
  listRecords,
  create,
  update,
  archive,
  MEMBER_COLUMNS,
  MEMBER_MESSAGES,
  MEMBER_PAGE_SIZE,
  DIRECTORY_LIMIT,
} = await import('../../../src/lib/data/members')

const CHURCH = 'church-1'

function resolvesTo(result) {
  state.result = result
}

function calledWith(method) {
  return state.calls.filter((c) => c[0] === method)
}

beforeEach(() => {
  state.result = { data: [], error: null }
  state.calls = []
  vi.clearAllMocks()
})

describe('listDirectory', () => {
  it('reads through the directory_search RPC, not the members table', async () => {
    resolvesTo({ data: [], error: null })
    await listDirectory(CHURCH)
    expect(calledWith('rpc')[0][1]).toBe('directory_search')
    expect(calledWith('rpc')[0][2].p_church_id).toBe(CHURCH)
    expect(calledWith('from')).toHaveLength(0)
  })

  // The directory shows the WHOLE roll now (0030): p_limit null means "no limit",
  // so the 200-row cap that hid members past the 200th — and reported the capped
  // page as the total — is gone.
  it('sends p_limit null so the full roll comes back uncapped', async () => {
    resolvesTo({ data: [], error: null })
    await listDirectory(CHURCH)
    expect(calledWith('rpc')[0][2].p_limit).toBe(DIRECTORY_LIMIT)
    expect(DIRECTORY_LIMIT).toBe(null)
  })

  it('never reports capped with the default (unlimited) read', async () => {
    resolvesTo({
      data: Array.from({ length: 500 }, (_, i) => ({ member_id: `m${i}` })),
      error: null,
    })
    expect((await listDirectory(CHURCH)).capped).toBe(false)
  })

  it('reports capped only when a caller passes an explicit bound it hits', async () => {
    resolvesTo({
      data: Array.from({ length: 10 }, (_, i) => ({ member_id: `m${i}` })),
      error: null,
    })
    expect((await listDirectory(CHURCH, { limit: 10 })).capped).toBe(true)
    expect((await listDirectory(CHURCH, { limit: 50 })).capped).toBe(false)
  })

  it('passes a sanitized search term through the RPC parameter', async () => {
    resolvesTo({ data: [], error: null })
    await listDirectory(CHURCH, { query: '  Dela%Cruz  ' })
    // The % is stripped: directory_search wraps p_query in its own %…% and a
    // stray one inside would widen the match rather than narrow it.
    expect(calledWith('rpc')[0][2].p_query).toBe('Dela Cruz')
  })

  it('sends no query at all for a term too short to be one', async () => {
    resolvesTo({ data: [], error: null })
    await listDirectory(CHURCH, { query: 'a' })
    expect(calledWith('rpc')[0][2].p_query).toBe(null)
  })

  it('flattens the RPC shape into member rows, including the 0028 safe fields', async () => {
    resolvesTo({
      data: [{
        member_id: 'm1', first_name: 'Juan', middle_name: 'D', last_name: 'Cruz',
        gender: 'Male', ministries: null, small_groups: ['Youth'],
        is_one_to_one_completed: true, is_turning_point_completed: false,
        is_baptized: true, has_submitted_membership_form: false,
      }],
      error: null,
    })
    const result = await listDirectory(CHURCH)
    expect(result.ok).toBe(true)
    expect(result.rows).toEqual([
      {
        id: 'm1', first_name: 'Juan', middle_name: 'D', last_name: 'Cruz', gender: 'Male',
        ministries: [], small_groups: ['Youth'],
        // Synthesised so the members table's Groups column renders unchanged.
        group_members: [{ groups: { name: 'Youth', type: 'Small Group' } }],
        is_one_to_one_completed: true, is_turning_point_completed: false,
        is_baptized: true, has_submitted_membership_form: false,
      },
    ])
  })

  it('defaults the added fields when the RPC omits them, and coerces journey flags to booleans', async () => {
    resolvesTo({
      data: [{ member_id: 'm1', first_name: 'Ana', last_name: 'Reyes', ministries: ['Choir'], small_groups: null }],
      error: null,
    })
    const row = (await listDirectory(CHURCH)).rows[0]
    expect(row.middle_name).toBe(null)
    expect(row.gender).toBe(null)
    expect(row.is_baptized).toBe(false)
    expect(row.group_members).toEqual([{ groups: { name: 'Choir', type: 'Ministry' } }])
  })

  it('fails without a church rather than querying for every church', async () => {
    const result = await listDirectory(null)
    expect(result.ok).toBe(false)
    expect(result.message).toBe(MEMBER_MESSAGES.noChurch)
    expect(state.calls).toHaveLength(0)
  })

  it('does not surface raw error text', async () => {
    resolvesTo({ data: null, error: { message: 'permission denied for table members' } })
    const result = await listDirectory(CHURCH)
    expect(result.ok).toBe(false)
    expect(result.message).toBe(MEMBER_MESSAGES.loadFailed)
    expect(result.cause).toEqual({ message: 'permission denied for table members' })
  })
})

describe('listRecords', () => {
  it('refuses without the capability, and does not query at all', async () => {
    const result = await listRecords({ churchId: CHURCH, canSeeDetail: false })
    expect(result.ok).toBe(false)
    expect(result.message).toBe(MEMBER_MESSAGES.notPermitted)
    expect(result.rows).toEqual([])
    expect(state.calls).toHaveLength(0)
  })

  it('refuses before checking the church, so a missing capability is never reported as a missing church', async () => {
    const result = await listRecords({ churchId: null, canSeeDetail: false })
    expect(result.message).toBe(MEMBER_MESSAGES.notPermitted)
  })

  // The rule this module exists to hold: 0010_members_select_allow_archived
  // stopped RLS hiding archived rows, so every read must filter them.
  it('always filters archived rows', async () => {
    resolvesTo({ data: [], error: null })
    await listRecords({ churchId: CHURCH, canSeeDetail: true })
    expect(calledWith('is')).toContainEqual(['is', 'archived_at', null])
  })

  it('scopes to the active church explicitly, since RLS returns every church to a SuperAdmin', async () => {
    resolvesTo({ data: [], error: null })
    await listRecords({ churchId: CHURCH, canSeeDetail: true })
    expect(calledWith('eq')).toContainEqual(['eq', 'member_of', CHURCH])
  })

  it('enumerates columns rather than selecting *', async () => {
    resolvesTo({ data: [], error: null })
    await listRecords({ churchId: CHURCH, canSeeDetail: true })
    const columns = calledWith('select')[0][1]
    // Starts with the explicit projection, then appends the group embed the
    // members table's Groups column needs. `toBe` was right while the select
    // was nothing but MEMBER_COLUMNS; the rule being defended is that the
    // projection is enumerated and excludes what must never be fetched, not
    // that nothing may ever be embedded alongside it.
    expect(columns.startsWith(MEMBER_COLUMNS)).toBe(true)
    // Two flat embeds since 0026, replacing the nested
    // `group_members(groups(...))`. The nested form is what PostgREST could not
    // resolve once those two names became union views — it answered PGRST200 —
    // which is why the split reached the application at all. Asserted as an
    // absence too, so nobody reintroduces the shape that cannot work.
    expect(columns).toContain('ministry_members(ministries(')
    expect(columns).toContain('small_group_members(small_groups(')
    expect(columns).not.toContain('group_members(groups(')
    expect(columns).not.toContain('*')
    expect(columns).not.toContain('archived_reason')
  })

  // The two embeds are folded back into one `group_members: [{ groups }]` list
  // so the members table and its Groups column never learn that storage changed.
  it('folds both embeds into the single group list the table renders', async () => {
    resolvesTo({
      data: [{
        id: 'm1',
        first_name: 'Juan',
        last_name: 'Cruz',
        ministry_members: [{ ministries: { id: 'g1', name: 'Worship Team' } }],
        small_group_members: [{ small_groups: { id: 'g2', name: 'Thursday Group' } }],
      }],
      error: null,
    })

    const result = await listRecords({ churchId: CHURCH, canSeeDetail: true })
    expect(result.rows[0].group_members).toEqual([
      { groups: { id: 'g1', name: 'Worship Team', type: 'Ministry' } },
      { groups: { id: 'g2', name: 'Thursday Group', type: 'Small Group' } },
    ])
    // The storage-shaped keys do not survive, so nothing downstream can start
    // depending on them.
    expect(result.rows[0].ministry_members).toBeUndefined()
    expect(result.rows[0].small_group_members).toBeUndefined()
  })

  it('gives a member in no group an empty list rather than undefined', async () => {
    resolvesTo({ data: [{ id: 'm1', first_name: 'Ana', last_name: 'Reyes' }], error: null })
    const result = await listRecords({ churchId: CHURCH, canSeeDetail: true })
    expect(result.rows[0].group_members).toEqual([])
  })
})

describe('listRecords — pagination, ordering and search', () => {
  it('asks for exactly one page', async () => {
    resolvesTo({ data: [], error: null, count: 137 })
    await listRecords({ churchId: CHURCH, canSeeDetail: true, page: 3 })
    expect(calledWith('range')).toContainEqual(['range', 100, 149])
  })

  it('defaults to the documented page size of 50', async () => {
    resolvesTo({ data: [], error: null, count: 0 })
    await listRecords({ churchId: CHURCH, canSeeDetail: true })
    expect(MEMBER_PAGE_SIZE).toBe(50)
    expect(calledWith('range')).toContainEqual(['range', 0, 49])
  })

  // The bug this prevents: listRecords had NO .order() at all, so ordering was
  // whatever Postgres returned. Harmless while the whole list was in the
  // browser; the moment .range() arrives, range over an unordered query can
  // repeat rows on one page and skip them on the next.
  it('orders by the sort column AND by id, so pages cannot overlap or skip', async () => {
    resolvesTo({ data: [], error: null, count: 0 })
    await listRecords({ churchId: CHURCH, canSeeDetail: true })

    const orders = calledWith('order')
    expect(orders[0]).toEqual(['order', 'last_name', { ascending: true }])
    // The tiebreaker is what stops shared surnames shuffling across a page
    // boundary between one request and the next.
    expect(orders[1]).toEqual(['order', 'id', { ascending: true }])
  })

  it('carries the direction to the sort column but never to the tiebreaker', async () => {
    resolvesTo({ data: [], error: null, count: 0 })
    await listRecords({
      churchId: CHURCH,
      canSeeDetail: true,
      sortKey: 'first_name',
      sortDirection: 'descending',
    })

    const orders = calledWith('order')
    expect(orders[0]).toEqual(['order', 'first_name', { ascending: false }])
    expect(orders[1]).toEqual(['order', 'id', { ascending: true }])
  })

  // A column name goes into the query as an identifier, so it is never taken
  // from the caller unchecked — the same reason searchFilters.js exists.
  it('falls back to last_name for any column outside the allowlist', async () => {
    resolvesTo({ data: [], error: null, count: 0 })
    await listRecords({ churchId: CHURCH, canSeeDetail: true, sortKey: 'address' })
    expect(calledWith('order')[0]).toEqual(['order', 'last_name', { ascending: true }])
  })

  it('returns the total, so the caller can build a pager without a second query', async () => {
    resolvesTo({ data: [{ id: 'm1' }], error: null, count: 137 })
    const result = await listRecords({ churchId: CHURCH, canSeeDetail: true })
    expect(result.total).toBe(137)
  })

  it('asks for the count on the same request as the rows', async () => {
    resolvesTo({ data: [], error: null, count: 0 })
    await listRecords({ churchId: CHURCH, canSeeDetail: true })
    expect(calledWith('select')[0][2]).toEqual({ count: 'exact' })
  })

  it('searches through buildMemberNameOrFilter, never by interpolating the term', async () => {
    resolvesTo({ data: [], error: null, count: 0 })
    await listRecords({ churchId: CHURCH, canSeeDetail: true, search: 'Dela' })

    const filter = calledWith('or')[0][1]
    expect(filter).toBe('first_name.ilike.%dela%,last_name.ilike.%dela%')
  })

  it('neutralises a PostgREST filter breakout in the search term', async () => {
    resolvesTo({ data: [], error: null, count: 0 })
    await listRecords({
      churchId: CHURCH,
      canSeeDetail: true,
      search: 'Jane),or(member_of.not.is.null)',
    })

    const filter = calledWith('or')[0][1]
    expect(filter).not.toContain('),')
    expect(filter).not.toContain('(')
  })

  it('does not filter at all on a term too short to mean anything', async () => {
    resolvesTo({ data: [], error: null, count: 0 })
    await listRecords({ churchId: CHURCH, canSeeDetail: true, search: 'a' })
    expect(calledWith('or')).toHaveLength(0)
  })

  it('still filters archived rows when a search is running', async () => {
    resolvesTo({ data: [], error: null, count: 0 })
    await listRecords({ churchId: CHURCH, canSeeDetail: true, search: 'Dela' })
    expect(calledWith('is')).toContainEqual(['is', 'archived_at', null])
  })

  it('reports a total of zero rather than null when the count is missing', async () => {
    resolvesTo({ data: [], error: null, count: null })
    const result = await listRecords({ churchId: CHURCH, canSeeDetail: true })
    expect(result.total).toBe(0)
  })
})

describe('create', () => {
  it('forces member_of to the active church', async () => {
    resolvesTo({ data: [{ id: 'm1' }], error: null })
    await create({ payload: { first_name: 'Juan', member_of: 'other-church' }, churchId: CHURCH })
    expect(calledWith('insert')[0][1].member_of).toBe(CHURCH)
  })

  it('fails without a church', async () => {
    const result = await create({ payload: {}, churchId: null })
    expect(result.ok).toBe(false)
    expect(state.calls).toHaveLength(0)
  })

  it('returns the created row', async () => {
    resolvesTo({ data: [{ id: 'm1', first_name: 'Juan' }], error: null })
    const result = await create({ payload: { first_name: 'Juan' }, churchId: CHURCH })
    expect(result.ok).toBe(true)
    expect(result.rows[0]).toEqual({ id: 'm1', first_name: 'Juan' })
  })
})

describe('update', () => {
  it('targets the row by id', async () => {
    resolvesTo({ data: [{ id: 'm1' }], error: null })
    await update({ id: 'm1', payload: { first_name: 'Juana' } })
    expect(calledWith('eq')).toContainEqual(['eq', 'id', 'm1'])
  })

  it('reports an RLS-filtered update as blocked rather than as success', async () => {
    resolvesTo({ data: [], error: null })
    const result = await update({ id: 'm1', payload: {} })
    expect(result.ok).toBe(false)
    expect(result.message).toBe(MEMBER_MESSAGES.updateBlocked)
    expect(result.rows).toEqual([])
  })
})

describe('archive', () => {
  it('sets archived_at and the trimmed reason', async () => {
    resolvesTo({ data: [{ id: 'm1' }], error: null })
    await archive({ id: 'm1', reason: '  moved away  ' })
    const payload = calledWith('update')[0][1]
    expect(payload.archived_reason).toBe('moved away')
    expect(typeof payload.archived_at).toBe('string')
  })

  it('stores a null reason when none was given', async () => {
    resolvesTo({ data: [{ id: 'm1' }], error: null })
    await archive({ id: 'm1', reason: '   ' })
    expect(calledWith('update')[0][1].archived_reason).toBeNull()
    await archive({ id: 'm1' })
    expect(calledWith('update')[1][1].archived_reason).toBeNull()
  })

  // The live defect. The old call issued this UPDATE with no .select(), so a
  // refused archive returned { error: null, data: null } and the view showed
  // "Member archived successfully." then removed the row locally.
  it('reports an archive that RLS refused as a failure, not as success', async () => {
    resolvesTo({ data: [], error: null })
    const result = await archive({ id: 'm1', reason: 'x' })
    expect(result.ok).toBe(false)
    expect(result.message).toBe(MEMBER_MESSAGES.archiveBlocked)
  })

  it('asks only for the id back — an archive does not need the PII columns', async () => {
    resolvesTo({ data: [{ id: 'm1' }], error: null })
    await archive({ id: 'm1' })
    expect(calledWith('select')[0][1]).toBe('id')
  })
})

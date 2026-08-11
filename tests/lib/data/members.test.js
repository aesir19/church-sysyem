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
  select: vi.fn(function (columns) { state.calls.push(['select', columns]); return this }),
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
    expect(calledWith('rpc')[0]).toEqual(['rpc', 'directory_search', { p_church_id: CHURCH }])
    expect(calledWith('from')).toHaveLength(0)
  })

  it('flattens the RPC shape into member rows', async () => {
    resolvesTo({
      data: [{ member_id: 'm1', first_name: 'Juan', last_name: 'Cruz', ministries: null, small_groups: ['Youth'] }],
      error: null,
    })
    const result = await listDirectory(CHURCH)
    expect(result.ok).toBe(true)
    expect(result.rows).toEqual([
      { id: 'm1', first_name: 'Juan', last_name: 'Cruz', ministries: [], small_groups: ['Youth'] },
    ])
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
    expect(columns).toBe(MEMBER_COLUMNS)
    expect(columns).not.toContain('*')
    expect(columns).not.toContain('archived_reason')
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

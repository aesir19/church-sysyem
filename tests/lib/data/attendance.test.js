import { describe, it, expect, vi, beforeEach } from 'vitest'

// Each from() returns its own chainable, and each request resolves to whatever
// the queue hands it — one per service id, in order.
const state = vi.hoisted(() => ({ queue: [], calls: [] }))

function makeBuilder() {
  return {
    select: vi.fn(function (columns, options) { state.calls.push(['select', columns, options]); return this }),
    eq: vi.fn(function (col, val) { state.calls.push(['eq', col, val]); return this }),
    then(onFulfilled, onRejected) {
      const result = state.queue.shift() ?? { count: 0, error: null }
      return Promise.resolve(result).then(onFulfilled, onRejected)
    },
  }
}

vi.mock('../../../src/lib/supabase', () => ({
  supabase: {
    from: vi.fn((table) => { state.calls.push(['from', table]); return makeBuilder() }),
  },
}))

const { countAttendanceByService } = await import('../../../src/lib/data/attendance')

function calledWith(method) {
  return state.calls.filter((c) => c[0] === method)
}

beforeEach(() => {
  state.queue = []
  state.calls = []
  vi.clearAllMocks()
})

describe('countAttendanceByService', () => {
  it('returns a count per service', async () => {
    state.queue = [{ count: 128, error: null }, { count: 115, error: null }]
    const { counts, failed } = await countAttendanceByService({ serviceIds: ['s1', 's2'] })

    expect(counts.get('s1')).toBe(128)
    expect(counts.get('s2')).toBe(115)
    expect(failed).toEqual([])
  })

  // The whole point of this module. A select that pulls the rows back to count
  // them moves ~1,300 uuids per page load; a head request moves none.
  it('counts by header only — it never fetches attendance rows', async () => {
    state.queue = [{ count: 5, error: null }]
    await countAttendanceByService({ serviceIds: ['s1'] })

    expect(calledWith('select')[0].slice(1)).toEqual(['id', { count: 'exact', head: true }])
  })

  it('asks one scoped question per service', async () => {
    state.queue = [{ count: 1, error: null }, { count: 2, error: null }, { count: 3, error: null }]
    await countAttendanceByService({ serviceIds: ['s1', 's2', 's3'] })

    expect(calledWith('from')).toHaveLength(3)
    expect(calledWith('eq').map((c) => c[2])).toEqual(['s1', 's2', 's3'])
    expect(calledWith('eq').every((c) => c[1] === 'service_id')).toBe(true)
  })

  // A bar drawn at zero says nobody came. Leaving the id out lets the chart say
  // it does not know.
  it('leaves a failed count out of the map rather than recording zero', async () => {
    state.queue = [{ count: null, error: { message: 'permission denied' } }, { count: 115, error: null }]
    const { counts, failed } = await countAttendanceByService({ serviceIds: ['s1', 's2'] })

    expect(counts.has('s1')).toBe(false)
    expect(counts.get('s2')).toBe(115)
    expect(failed).toEqual(['s1'])
  })

  it('treats a missing count with no error as a failure too', async () => {
    state.queue = [{ count: null, error: null }]
    const { counts, failed } = await countAttendanceByService({ serviceIds: ['s1'] })
    expect(counts.size).toBe(0)
    expect(failed).toEqual(['s1'])
  })

  it('keeps a real zero', async () => {
    state.queue = [{ count: 0, error: null }]
    const { counts, failed } = await countAttendanceByService({ serviceIds: ['s1'] })
    expect(counts.get('s1')).toBe(0)
    expect(failed).toEqual([])
  })

  it('issues no request at all for an empty list', async () => {
    const { counts, failed } = await countAttendanceByService({ serviceIds: [] })
    expect(counts.size).toBe(0)
    expect(failed).toEqual([])
    expect(state.calls).toHaveLength(0)

    await countAttendanceByService({ serviceIds: null })
    expect(state.calls).toHaveLength(0)
  })

  it('skips empty ids rather than counting the whole table', async () => {
    state.queue = [{ count: 4, error: null }]
    await countAttendanceByService({ serviceIds: ['', null, 's1', undefined] })
    expect(calledWith('from')).toHaveLength(1)
    expect(calledWith('eq')[0][2]).toBe('s1')
  })
})

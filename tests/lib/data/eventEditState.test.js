import { beforeEach, describe, expect, it, vi } from 'vitest'

// Moving a single date (#105): the app asks the database whether a date is past, how much
// attendance it carries, and whether it is locked — never the device clock. The closeout counts
// only the CURRENT check-in service, never one filed as history after a move.

const state = vi.hoisted(() => ({ rpc: { data: null, error: null }, rpcCalls: [], results: {}, calls: [] }))

function builder(table) {
  const record = (name, ...args) => state.calls.push({ table, name, args })
  const chain = {
    select: vi.fn((...a) => { record('select', ...a); return chain }),
    eq: vi.fn((...a) => { record('eq', ...a); return chain }),
    is: vi.fn((...a) => { record('is', ...a); return chain }),
    order: vi.fn((...a) => { record('order', ...a); return chain }),
    limit: vi.fn((...a) => { record('limit', ...a); return chain }),
    maybeSingle: vi.fn(() => { record('maybeSingle'); return chain }),
    then(resolve, reject) {
      return Promise.resolve(state.results[table] || { data: null, error: null }).then(resolve, reject)
    },
  }
  return chain
}

vi.mock('../../../src/lib/supabase', () => ({
  supabase: {
    from: vi.fn((table) => builder(table)),
    rpc: vi.fn(async (name, args) => { state.rpcCalls.push({ name, args }); return state.rpc }),
  },
}))

const { getEditState } = await import('../../../src/lib/data/events')
const { getOccurrenceRow } = await import('../../../src/lib/data/eventSeries')
const { ensureEventService } = await import('../../../src/lib/data/eventCloseout')

beforeEach(() => {
  state.rpc = { data: null, error: null }
  state.rpcCalls = []
  state.results = {}
  state.calls = []
})

describe('getEditState', () => {
  it('asks the database about a saved event and maps its answer', async () => {
    state.rpc = { data: { is_past: true, current_attendance: 4, total_attendance: 12, locked: true }, error: null }
    const res = await getEditState({ eventId: 'ev1' })
    expect(state.rpcCalls).toEqual([{ name: 'event_edit_state', args: { p_event_id: 'ev1', p_starts_at: null } }])
    expect(res).toEqual({ ok: true, isPast: true, currentAttendance: 4, totalAttendance: 12, locked: true, message: '' })
  })

  it('asks about an unsaved repeat date by its start time', async () => {
    state.rpc = { data: { is_past: false, current_attendance: 0, total_attendance: 0, locked: false }, error: null }
    await getEditState({ startsAt: '2026-10-11T00:00:00.000Z' })
    expect(state.rpcCalls[0].args).toEqual({ p_event_id: null, p_starts_at: '2026-10-11T00:00:00.000Z' })
  })

  it('fails closed: an unanswered question is not an unlocked date', async () => {
    state.rpc = { data: null, error: { message: 'SECRET' } }
    const res = await getEditState({ eventId: 'ev1' })
    expect(res.ok).toBe(false)
    expect(res.message).not.toMatch(/SECRET/)
  })
})

describe('getOccurrenceRow', () => {
  it('finds the saved row for one date of a series', async () => {
    state.results.events = { data: { id: 'ex1', starts_at: '2026-10-11T00:00:00Z' }, error: null }
    const res = await getOccurrenceRow({ seriesId: 's1', occurrenceDate: '2026-10-11' })
    expect(res).toEqual({ ok: true, event: { id: 'ex1', starts_at: '2026-10-11T00:00:00Z' } })
    expect(state.calls).toContainEqual({ table: 'events', name: 'eq', args: ['series_id', 's1'] })
    expect(state.calls).toContainEqual({ table: 'events', name: 'eq', args: ['occurrence_date', '2026-10-11'] })
  })

  it('reports a failed read instead of "no saved row"', async () => {
    state.results.events = { data: null, error: { message: 'boom' } }
    const res = await getOccurrenceRow({ seriesId: 's1', occurrenceDate: '2026-10-11' })
    expect(res.ok).toBe(false)
  })
})

describe('ensureEventService', () => {
  it('only reuses a current check-in service, never one filed as history', async () => {
    state.results.services = { data: { id: 'svc1' }, error: null }
    await ensureEventService({ event: { id: 'ev1', church_id: 'c1', starts_at: '2026-10-11T00:00:00Z', title: 'X' } })
    expect(state.calls).toContainEqual({ table: 'services', name: 'is', args: ['history_at', null] })
  })
})

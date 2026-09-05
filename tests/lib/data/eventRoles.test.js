import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ calls: [], events: [], fills: {} }))

function eventBuilder() {
  const record = (name, ...args) => state.calls.push({ name, args })
  const builder = {
    select: vi.fn(function (columns) { record('select', columns); return this }),
    eq: vi.fn(function (column, value) { record('eq', column, value); return this }),
    in: vi.fn(function (column, values) { record('in', column, values); return this }),
    gte: vi.fn(function (column, value) { record('gte', column, value); return this }),
    lt: vi.fn(function (column, value) { record('lt', column, value); return this }),
    order: vi.fn(function (column, options) { record('order', column, options); return this }),
    then(onFulfilled, onRejected) {
      return Promise.resolve({ data: state.events, error: null }).then(onFulfilled, onRejected)
    },
  }
  return builder
}

vi.mock('../../../src/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => eventBuilder()),
    rpc: vi.fn((name, args) => Promise.resolve({
      data: name === 'event_role_fill' ? (state.fills[args.p_event_id] || []) : [],
      error: null,
    })),
  },
}))

const { listUnderstaffedEvents } = await import('../../../src/lib/data/eventRoles')

function call(name) { return state.calls.find((entry) => entry.name === name) }

beforeEach(() => {
  state.calls = []
  state.events = [{ id: 'event-1', title: 'Outreach', starts_at: '2026-09-20T08:00:00Z', status: 'published' }]
  state.fills = {
    'event-1': [{ role_id: 'role-1', count_required: 4, filled: 2 }],
  }
})

describe('listUnderstaffedEvents', () => {
  it('keeps the calendar default to published events within seven days', async () => {
    await listUnderstaffedEvents({ churchId: 'church-1', now: new Date('2026-09-05T00:00:00Z') })

    expect(call('in').args).toEqual(['status', ['published']])
    expect(call('lt').args).toEqual(['starts_at', '2026-09-12T00:00:00.000Z'])
  })

  it('supports the overview worklist across every future draft and published event', async () => {
    const result = await listUnderstaffedEvents({
      churchId: 'church-1',
      withinDays: null,
      includeDrafts: true,
      now: new Date('2026-09-05T00:00:00Z'),
    })

    expect(call('in').args).toEqual(['status', ['draft', 'published']])
    expect(call('lt')).toBeUndefined()
    expect(result).toEqual([{
      ...state.events[0],
      needed: 4,
      filled: 2,
      gap: 2,
    }])
  })
})

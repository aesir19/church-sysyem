import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ calls: [], rows: [], error: null }))

vi.mock('../../../src/lib/supabase', () => ({
  supabase: {
    rpc: vi.fn((name, args) => {
      state.calls.push({ name, args })
      return Promise.resolve({ data: state.rows, error: state.error })
    }),
  },
}))

const { listUnderstaffedEvents } = await import('../../../src/lib/data/eventRoles')

beforeEach(() => {
  state.calls = []
  state.rows = [{
    id: 'event-1',
    title: 'Outreach',
    starts_at: '2026-09-20T08:00:00Z',
    status: 'published',
    needed: 4,
    filled: 2,
    gap: 2,
  }]
  state.error = null
})

describe('listUnderstaffedEvents', () => {
  it('keeps the calendar default to published events within seven days', async () => {
    const result = await listUnderstaffedEvents({
      churchId: 'church-1',
      now: new Date('2026-09-05T00:00:00Z'),
    })

    expect(state.calls).toEqual([{
      name: 'list_understaffed_events',
      args: {
        p_church_id: 'church-1',
        p_from: '2026-09-05T00:00:00.000Z',
        p_to: '2026-09-12T00:00:00.000Z',
        p_include_drafts: false,
      },
    }])
    expect(result).toEqual({ ok: true, items: state.rows })
  })

  it('supports the overview worklist across every future draft and published event', async () => {
    const result = await listUnderstaffedEvents({
      churchId: 'church-1',
      withinDays: null,
      includeDrafts: true,
      now: new Date('2026-09-05T00:00:00Z'),
    })

    expect(state.calls[0].args).toMatchObject({
      p_to: null,
      p_include_drafts: true,
    })
    expect(result).toEqual({ ok: true, items: state.rows })
  })

  it('distinguishes a failed read from an empty worklist', async () => {
    state.error = { message: 'denied' }

    await expect(listUnderstaffedEvents({ churchId: 'church-1' }))
      .resolves.toEqual({ ok: false, items: [] })
  })
})

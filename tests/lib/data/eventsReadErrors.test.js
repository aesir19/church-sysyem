import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ results: {} }))

function builder(table) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    gte: vi.fn(() => chain),
    lt: vi.fn(() => chain),
    is: vi.fn(() => chain),
    then(resolve, reject) {
      return Promise.resolve(state.results[table] || { data: [], error: null }).then(resolve, reject)
    },
  }
  return chain
}

vi.mock('../../../src/lib/supabase', () => ({
  supabase: { from: vi.fn((table) => builder(table)) },
}))

const { findEventByDateTitle, getEventLinks } = await import('../../../src/lib/data/events')

beforeEach(() => {
  state.results = {
    events: { data: [], error: null },
    expenses: { data: [], error: null },
    collections: { data: [], error: null },
  }
})

describe('event detail read outcomes', () => {
  it('keeps a failed event read distinct from a successful no-row result', async () => {
    state.results.events = { data: null, error: { message: 'private backend detail' } }
    const failed = await findEventByDateTitle({
      churchId: 'church-1', date: '2026-09-13', titleSlug: 'sunday-service',
    })
    expect(failed).toEqual({
      ok: false, event: null, message: 'Could not load this event. Please try again.',
    })

    state.results.events = { data: [], error: null }
    const missing = await findEventByDateTitle({
      churchId: 'church-1', date: '2026-09-13', titleSlug: 'sunday-service',
    })
    expect(missing).toEqual({ ok: true, event: null })
  })

  it('does not turn a linked-record read failure into an empty result', async () => {
    state.results.expenses = { data: null, error: { message: 'private backend detail' } }
    const result = await getEventLinks('event-1')
    expect(result).toEqual({
      ok: false,
      links: { expenses: [], collections: [] },
      message: 'Could not load this event. Please try again.',
    })
  })
})

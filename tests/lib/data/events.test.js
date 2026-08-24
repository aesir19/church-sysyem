import { describe, it, expect, vi, beforeEach } from 'vitest'

// A recording builder so the write-path tests can inspect the row handed to insert() and
// the outcome write() derives. The pure expand* tests below never touch it.
const state = vi.hoisted(() => ({ inserted: null, selectResult: { data: [{ id: 'e1' }], error: null } }))

function builder() {
  const b = {
    insert: vi.fn((row) => { state.inserted = row; return b }),
    update: vi.fn(() => b),
    eq: vi.fn(() => b),
    // write() calls .select(columns) last and awaits it.
    select: vi.fn(() => Promise.resolve(state.selectResult)),
  }
  return b
}

vi.mock('../../../src/lib/supabase', () => ({
  supabase: { from: vi.fn(() => builder()), rpc: vi.fn(() => Promise.resolve({ data: [], error: null })) },
}))

const { expandWeeklySchedules, expandBirthdays, createEvent } = await import('../../../src/lib/data/events')

beforeEach(() => { state.inserted = null; state.selectResult = { data: [{ id: 'e1' }], error: null } })

describe('createEvent — draft vs publish', () => {
  const payload = { church_id: 'c1', title: 'Outreach', kind: 'outreach', starts_at: '2026-08-22T07:00:00Z' }

  it('a draft carries status draft and no publish time', async () => {
    await createEvent(payload)
    expect(state.inserted.status).toBe('draft')
    expect(state.inserted.published_at).toBe(null)
  })

  it('publishing stamps status published AND published_at — the 0032 CHECK needs both', async () => {
    await createEvent(payload, { publish: true })
    expect(state.inserted.status).toBe('published')
    expect(state.inserted.published_at).toBeTruthy()
    expect(() => new Date(state.inserted.published_at).toISOString()).not.toThrow()
  })

  it('reports a refused insert (zero rows) as not-ok rather than a silent success', async () => {
    state.selectResult = { data: [], error: null } // RLS filtered the write out
    const res = await createEvent(payload, { publish: true })
    expect(res.ok).toBe(false)
    expect(res.rows).toEqual([])
  })
})

describe('expandWeeklySchedules', () => {
  // A weekly Sunday (weekday 0) service across a two-week window.
  const schedules = [{ id: 's1', label: 'Sunday Service', weekday: 0, starts_at: '09:00:00' }]

  it('emits one occurrence per matching weekday inside the window', () => {
    const out = expandWeeklySchedules(schedules, new Date(2026, 7, 1), new Date(2026, 7, 15))
    // Sundays in [1 Aug, 15 Aug): 2 Aug and 9 Aug.
    expect(out.map((o) => o.starts_at.slice(0, 10))).toEqual(['2026-08-02', '2026-08-09'])
  })

  it('places the occurrence at the schedule’s time of day and marks it a service', () => {
    const [first] = expandWeeklySchedules(schedules, new Date(2026, 7, 1), new Date(2026, 7, 8))
    const d = new Date(first.starts_at)
    expect(d.getHours()).toBe(9)
    expect(d.getMinutes()).toBe(0)
    expect(first.isService).toBe(true)
    expect(first.title).toBe('Sunday Service')
    expect(first.kind).toBe('service')
  })

  it('excludes the upper bound (half-open window)', () => {
    // 9 Aug is a Sunday; a window ending exactly at 9 Aug must not include it.
    const out = expandWeeklySchedules(schedules, new Date(2026, 7, 3), new Date(2026, 7, 9))
    expect(out).toHaveLength(0)
  })
})

describe('expandBirthdays', () => {
  // The RPC hands { id, name, month (1-12), day } — deliberately no year. The helper must
  // work from that and never reintroduce an age.
  const people = [
    { id: 'm1', name: 'Juan Dela Cruz', month: 8, day: 5 },
    { id: 'm2', name: 'Maria Santos', month: 12, day: 1 },
  ]

  it('places a birthday on its month and day within the window', () => {
    const out = expandBirthdays(people, new Date(2026, 7, 1), new Date(2026, 7, 31))
    expect(out).toHaveLength(1)
    // Read the placed day the way the grid does (local), not off the raw UTC slice.
    const d = new Date(out[0].starts_at)
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2026, 8, 5])
    expect(out[0].title).toBe('Juan Dela Cruz')
    expect(out[0].isBirthday).toBe(true)
  })

  it('uses the window year, and no birth year is present to leak', () => {
    const out = expandBirthdays(people, new Date(2026, 7, 1), new Date(2026, 7, 31))
    expect(new Date(out[0].starts_at).getFullYear()).toBe(2026)
    // The input never carried a year, so there is nothing to expose.
    expect(JSON.stringify(out[0])).not.toMatch(/19\d\d/)
  })

  it('spans multiple years when the window does', () => {
    const out = expandBirthdays(people, new Date(2025, 11, 1), new Date(2027, 0, 1))
    const marias = out
      .filter((o) => o.title === 'Maria Santos')
      .map((o) => { const d = new Date(o.starts_at); return [d.getFullYear(), d.getMonth() + 1, d.getDate()] })
    expect(marias).toEqual([[2025, 12, 1], [2026, 12, 1]])
  })
})

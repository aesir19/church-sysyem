import { describe, it, expect, vi, beforeEach } from 'vitest'

// One chainable builder per from(), recording every call so a test can assert the ORDER and
// the filters of a multi-step write (delete-series is three statements that must run in the
// right order against the NO ACTION foreign key). Results are keyed by table. The same builder
// serves both direct awaits (`await supabase.from().update().eq()`) and the write() seam
// (which appends `.select(columns)` then awaits) — both resolve through `then`.
const state = vi.hoisted(() => ({ results: {}, calls: [], rpcResult: { data: null, error: null } }))

function makeBuilder(table) {
  const record = (name, ...args) => state.calls.push({ table, name, args })
  const b = {
    select: vi.fn(function (c) { record('select', c); return this }),
    insert: vi.fn(function (row) { record('insert', row); return this }),
    update: vi.fn(function (row) { record('update', row); return this }),
    upsert: vi.fn(function (row, opts) { record('upsert', row, opts); return this }),
    delete: vi.fn(function () { record('delete'); return this }),
    eq: vi.fn(function (col, val) { record('eq', col, val); return this }),
    neq: vi.fn(function (col, val) { record('neq', col, val); return this }),
    is: vi.fn(function (col, val) { record('is', col, val); return this }),
    not: vi.fn(function (col, op, val) { record('not', col, op, val); return this }),
    gte: vi.fn(function (col, val) { record('gte', col, val); return this }),
    lt: vi.fn(function (col, val) { record('lt', col, val); return this }),
    order: vi.fn(function (col, opts) { record('order', col, opts); return this }),
    then(onFulfilled, onRejected) {
      const result = state.results[table] ?? { data: [{ id: 'row' }], error: null }
      return Promise.resolve(result).then(onFulfilled, onRejected)
    },
  }
  return b
}

vi.mock('../../../src/lib/supabase', () => ({
  supabase: {
    from: vi.fn((table) => { state.calls.push({ table, name: 'from' }); return makeBuilder(table) }),
    rpc: vi.fn(async (name, args) => { state.calls.push({ table: 'rpc', name, args }); return state.rpcResult }),
  },
}))

const { deleteSeries, previewDeleteSeries, listSeries, splitSeries, skipOccurrence, countFutureExceptions, toSeries } =
  await import('../../../src/lib/data/eventSeries')

const seriesRow = {
  id: 'ser1', church_id: 'c1', title: 'Sunday Service', kind: 'service', status: 'published',
  cadence: 'weekly', interval_n: 1, anchor: null, weekday: 0, week_of_month: null, day_of_month: null,
  weekday2: null, week_of_month2: null, day_of_month2: null,
  time_start: '09:00:00', time_end: '10:30:00', starts_on: '2026-01-04', ends_on: null, count_n: null,
}

function calls(table, name) { return state.calls.filter((c) => c.table === table && c.name === name) }

beforeEach(() => {
  state.calls = []
  state.rpcResult = { data: null, error: null }
  state.results = {
    event_series: { data: [{ id: 'new-ser' }], error: null },
    events: { data: [{ id: 'ev1' }], error: null },
  }
})

describe('deleteSeries — one database call, never several', () => {
  it('asks the database to delete the series and reports what it kept and removed', async () => {
    state.rpcResult = { data: { already_deleted: false, kept: 2, removed: 5 }, error: null }
    const res = await deleteSeries({ seriesId: 'ser1' })

    expect(res).toMatchObject({ ok: true, kept: 2, removed: 5, alreadyDeleted: false })
    expect(calls('rpc', 'delete_event_series')).toHaveLength(1)
    expect(calls('rpc', 'delete_event_series')[0].args).toEqual({ p_series: 'ser1' })
    // The browser no longer touches the tables itself — that was the half-deleted-series bug.
    expect(calls('events', 'update')).toHaveLength(0)
    expect(calls('events', 'delete')).toHaveLength(0)
    expect(calls('event_series', 'delete')).toHaveLength(0)
  })

  it('treats a repeat call as success so a lost reply can simply be retried', async () => {
    state.rpcResult = { data: { already_deleted: true, kept: 0, removed: 0 }, error: null }
    const res = await deleteSeries({ seriesId: 'ser1' })
    expect(res).toMatchObject({ ok: true, alreadyDeleted: true })
  })

  it('reports a generic failure and no backend detail when the database refuses', async () => {
    state.rpcResult = { data: null, error: { message: 'SECRET detail', code: '42501' } }
    const res = await deleteSeries({ seriesId: 'ser1' })
    expect(res.ok).toBe(false)
    expect(res.message).toBe('That repeating event could not be deleted.')
    expect(JSON.stringify(res.message)).not.toMatch(/SECRET/)
  })

  it('does nothing without a series id', async () => {
    const res = await deleteSeries({})
    expect(res.ok).toBe(false)
    expect(calls('rpc', 'delete_event_series')).toHaveLength(0)
  })
})

describe('previewDeleteSeries — the numbers in the confirm dialog', () => {
  it('returns how many upcoming dates would be kept and removed', async () => {
    state.rpcResult = { data: { kept: 3, removed: 4 }, error: null }
    const res = await previewDeleteSeries({ seriesId: 'ser1' })
    expect(res).toEqual({ ok: true, kept: 3, removed: 4, message: '' })
    expect(calls('rpc', 'preview_delete_event_series')[0].args).toEqual({ p_series: 'ser1' })
  })

  it('reports a failure instead of showing a made-up zero', async () => {
    state.rpcResult = { data: null, error: { message: 'boom' } }
    const res = await previewDeleteSeries({ seriesId: 'ser1' })
    expect(res.ok).toBe(false)
  })
})

describe('listSeries — deleted series are gone from the Repeating tab', () => {
  it('only asks for series that are not deleted', async () => {
    state.results.event_series = { data: [], error: null }
    await listSeries({ churchId: 'c1' })
    expect(calls('event_series', 'is').some((c) => c.args[0] === 'deleted_at' && c.args[1] === null)).toBe(true)
  })
})

describe('toSeries', () => {
  it('carries whether the series was deleted', () => {
    expect(toSeries({ ...seriesRow, deleted_at: '2026-10-05T00:00:00Z' }).deletedAt).toBe('2026-10-05T00:00:00Z')
    expect(toSeries(seriesRow).deletedAt).toBeNull()
  })
})

describe('splitSeries — "apply to the ones after this too"', () => {
  const base = {
    oldSeriesId: 'ser1', churchId: 'c1', fromDate: '2026-09-06',
    newSeriesPayload: { church_id: 'c1', title: 'Sunday Service', kind: 'service', status: 'published',
      cadence: 'weekly', interval_n: 1, weekday: 0, time_start: '08:00', starts_on: '2026-09-06' },
  }

  it('ends the old series the day BEFORE the split and starts a new one on the split date', async () => {
    await splitSeries(base)
    const [endOld] = calls('event_series', 'update')
    expect(endOld.args[0].ends_on).toBe('2026-09-05') // the day before 6 Sep
    const [createNew] = calls('event_series', 'insert')
    expect(createNew.args[0].starts_on).toBe('2026-09-06')
  })

  it('by default re-points future exceptions to the new series (keeps their own values)', async () => {
    await splitSeries({ ...base, overwriteExceptions: false })
    // An events UPDATE re-pointing series_id, filtered to occurrence_date >= the split date.
    const repoint = calls('events', 'update').find((c) => c.args[0].series_id === 'new-ser')
    expect(repoint).toBeTruthy()
    expect(calls('events', 'delete').length).toBe(0)
  })

  it('overwriteExceptions deletes the future exceptions so the new rule governs them', async () => {
    await splitSeries({ ...base, overwriteExceptions: true })
    expect(calls('events', 'delete').length).toBe(1)
    expect(calls('events', 'update').length).toBe(0)
  })
})

describe('skipOccurrence — cancel one date', () => {
  it('upserts a cancelled exception row on the (series, date) slot', async () => {
    await skipOccurrence({ series: toSeries(seriesRow), occurrenceDate: '2026-08-16', reason: 'Typhoon' })
    const [up] = calls('events', 'upsert')
    expect(up.args[0].status).toBe('cancelled')
    expect(up.args[0].series_id).toBe('ser1')
    expect(up.args[0].occurrence_date).toBe('2026-08-16')
    expect(up.args[0].cancel_reason).toBe('Typhoon')
    expect(up.args[1]).toEqual({ onConflict: 'series_id,occurrence_date' })
  })
})

describe('countFutureExceptions — the "specially adjusted" count that drives the split prompt', () => {
  it('excludes cancelled dates — a skipped week is not a hand-edit', async () => {
    await countFutureExceptions({ seriesId: 'ser1', fromDate: '2026-09-06' })
    // The query filters to this series, from the split date, and NOT cancelled.
    expect(calls('events', 'eq').some((c) => c.args[0] === 'series_id' && c.args[1] === 'ser1')).toBe(true)
    expect(calls('events', 'gte').some((c) => c.args[0] === 'occurrence_date' && c.args[1] === '2026-09-06')).toBe(true)
    expect(calls('events', 'neq').some((c) => c.args[0] === 'status' && c.args[1] === 'cancelled')).toBe(true)
  })
})

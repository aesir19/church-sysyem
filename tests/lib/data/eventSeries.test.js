import { describe, it, expect, vi, beforeEach } from 'vitest'

// One chainable builder per from(), recording every call so a test can assert the ORDER and
// the filters of a multi-step write (delete-series is three statements that must run in the
// right order against the NO ACTION foreign key). Results are keyed by table. The same builder
// serves both direct awaits (`await supabase.from().update().eq()`) and the write() seam
// (which appends `.select(columns)` then awaits) — both resolve through `then`.
const state = vi.hoisted(() => ({ results: {}, calls: [] }))

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
  supabase: { from: vi.fn((table) => { state.calls.push({ table, name: 'from' }); return makeBuilder(table) }) },
}))

const { deleteSeries, splitSeries, skipOccurrence, countFutureExceptions, toSeries } =
  await import('../../../src/lib/data/eventSeries')

const seriesRow = {
  id: 'ser1', church_id: 'c1', title: 'Sunday Service', kind: 'service', status: 'published',
  cadence: 'weekly', interval_n: 1, anchor: null, weekday: 0, week_of_month: null, day_of_month: null,
  weekday2: null, week_of_month2: null, day_of_month2: null,
  time_start: '09:00:00', time_end: '10:30:00', starts_on: '2026-01-04', ends_on: null, count_n: null,
}

function calls(table, name) { return state.calls.filter((c) => c.table === table && c.name === name) }
function indexOf(pred) { return state.calls.findIndex(pred) }

beforeEach(() => {
  state.calls = []
  state.results = {
    event_series: { data: [{ id: 'new-ser' }], error: null },
    events: { data: [{ id: 'ev1' }], error: null },
  }
})

describe('deleteSeries — keep the past, drop the future', () => {
  it('detaches past occurrences, deletes future ones, THEN deletes the series (FK order)', async () => {
    const res = await deleteSeries({ seriesId: 'ser1', today: new Date('2026-08-25T00:00:00') })
    expect(res.ok).toBe(true)

    // Detach: an UPDATE clearing series_id/occurrence_date on rows before today.
    const [detach] = calls('events', 'update')
    expect(detach.args[0]).toEqual({ series_id: null, occurrence_date: null })
    expect(calls('events', 'lt').some((c) => c.args[0] === 'occurrence_date' && c.args[1] === '2026-08-25')).toBe(true)

    // Delete future: a DELETE on rows from today onward.
    expect(calls('events', 'delete').length).toBe(1)
    expect(calls('events', 'gte').some((c) => c.args[0] === 'occurrence_date' && c.args[1] === '2026-08-25')).toBe(true)

    // Order: the events update (detach) and events delete both precede the series delete.
    const seriesDeleteAt = indexOf((c) => c.table === 'event_series' && c.name === 'delete')
    const eventsDeleteAt = indexOf((c) => c.table === 'events' && c.name === 'delete')
    const eventsUpdateAt = indexOf((c) => c.table === 'events' && c.name === 'update')
    expect(eventsUpdateAt).toBeLessThan(seriesDeleteAt)
    expect(eventsDeleteAt).toBeLessThan(seriesDeleteAt)
  })

  it('stops and does not delete the series if detaching the past fails', async () => {
    state.results.events = { data: null, error: { message: 'boom' } }
    const res = await deleteSeries({ seriesId: 'ser1', today: new Date('2026-08-25T00:00:00') })
    expect(res.ok).toBe(false)
    expect(calls('event_series', 'delete').length).toBe(0)
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

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
    or: vi.fn(function (expr) { record('or', expr); return this }),
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

const {
  deleteSeries, previewDeleteSeries, listSeries, splitSeries, skipOccurrence, toSeries,
  listPlannedDates, mapPlannedDates, firstNewDate, previousDateBefore,
} = await import('../../../src/lib/data/eventSeries')

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

describe('splitSeries — "this date and the ones after it", one database call', () => {
  const base = {
    oldSeriesId: 'ser1', fromDate: '2026-09-06', key: 'key-1',
    newSeriesPayload: { title: 'Sunday Service', kind: 'service', status: 'published',
      cadence: 'weekly', interval_n: 1, weekday: 6, time_start: '09:00' },
  }

  it('asks the database to split, with the one-time key, and touches no table itself', async () => {
    state.rpcResult = { data: { already_done: false, new_series_id: 'new-ser', moved: 0, standalone: 0 }, error: null }
    const res = await splitSeries(base)

    expect(res).toMatchObject({ ok: true, newSeriesId: 'new-ser', alreadyDone: false, moved: 0, standalone: 0 })
    expect(calls('rpc', 'split_event_series')[0].args).toEqual({
      p_series: 'ser1', p_from: '2026-09-06', p_new: base.newSeriesPayload, p_moves: null, p_key: 'key-1',
    })
    // The three separate browser writes were the half-split bug.
    expect(calls('event_series', 'update')).toHaveLength(0)
    expect(calls('event_series', 'insert')).toHaveLength(0)
    expect(calls('events', 'update')).toHaveLength(0)
    expect(calls('events', 'delete')).toHaveLength(0)
  })

  it('passes the planned-date moves when the owner chose to move them', async () => {
    state.rpcResult = { data: { already_done: false, new_series_id: 'new-ser', moved: 1, standalone: 1 }, error: null }
    const moves = [{ event_id: 'e1', to_date: '2026-09-19' }, { event_id: 'e2', to_date: null }]
    const res = await splitSeries({ ...base, moves })
    expect(calls('rpc', 'split_event_series')[0].args.p_moves).toEqual(moves)
    expect(res).toMatchObject({ moved: 1, standalone: 1 })
  })

  it('treats a repeat with the same key as success', async () => {
    state.rpcResult = { data: { already_done: true, new_series_id: 'new-ser' }, error: null }
    expect(await splitSeries(base)).toMatchObject({ ok: true, alreadyDone: true, newSeriesId: 'new-ser' })
  })

  it('shows the database\'s own plain-words refusal, and nothing else from a backend error', async () => {
    state.rpcResult = { data: null, error: { code: 'P0001', message: 'That date has already happened, so it can only be changed on its own.' } }
    expect((await splitSeries(base)).message).toBe('That date has already happened, so it can only be changed on its own.')

    state.rpcResult = { data: null, error: { code: '42501', message: 'SECRET detail' } }
    const res = await splitSeries(base)
    expect(res.ok).toBe(false)
    expect(res.message).toBe('That repeating event could not be saved.')
  })

  it('refuses without a key, so a retry can never split twice', async () => {
    const res = await splitSeries({ ...base, key: undefined })
    expect(res.ok).toBe(false)
    expect(calls('rpc', 'split_event_series')).toHaveLength(0)
  })
})

describe('listPlannedDates — the saved later dates a split could move', () => {
  it('reads this series from the split date on, upcoming only, cancelled included', async () => {
    state.results.events = { data: [{ id: 'e1', occurrence_date: '2026-09-13', status: 'cancelled' }], error: null }
    const res = await listPlannedDates({ seriesId: 'ser1', fromDate: '2026-09-06' })

    expect(res).toMatchObject({ ok: true, dates: [{ id: 'e1' }] })
    expect(calls('events', 'eq').some((c) => c.args[0] === 'series_id' && c.args[1] === 'ser1')).toBe(true)
    expect(calls('events', 'gte').some((c) => c.args[0] === 'occurrence_date' && c.args[1] === '2026-09-06')).toBe(true)
    expect(calls('events', 'or')[0].args[0]).toMatch(/^starts_at\.is\.null,starts_at\.gt\./)
    expect(calls('events', 'neq')).toHaveLength(0)
  })

  it('reports a failed read instead of "none planned"', async () => {
    state.results.events = { data: null, error: { message: 'boom' } }
    expect((await listPlannedDates({ seriesId: 'ser1', fromDate: '2026-09-06' })).ok).toBe(false)
  })
})

describe('mapPlannedDates — each planned date to the new schedule\'s date in the same week', () => {
  const saturdays = { cadence: 'weekly', intervalN: 1, weekday: 6, timeStart: '09:00', startsOn: '2026-01-01' }

  it('moves a Sunday to the Saturday of the same Sunday-first week', () => {
    expect(mapPlannedDates({ rule: saturdays, fromDate: '2026-09-06', planned: [{ id: 'e1', occurrence_date: '2026-09-13' }] }))
      .toEqual([{ event_id: 'e1', to_date: '2026-09-19' }])
  })

  it('keeps a date where it is when the new schedule has no date that week', () => {
    const monthly = { cadence: 'monthly', intervalN: 1, anchor: 'date', dayOfMonth: 1, timeStart: '09:00', startsOn: '2026-01-01' }
    expect(mapPlannedDates({ rule: monthly, fromDate: '2026-09-06', planned: [{ id: 'e1', occurrence_date: '2026-09-13' }] }))
      .toEqual([{ event_id: 'e1', to_date: null }])
  })

  it('never moves a date to before the split', () => {
    // Split from Tue 8 Sep to Mondays: that week's Monday (7 Sep) is before the split, so the
    // planned Tuesday has nowhere to go and stays put.
    const mondays = { ...saturdays, weekday: 1 }
    expect(mapPlannedDates({ rule: mondays, fromDate: '2026-09-08', planned: [{ id: 'e1', occurrence_date: '2026-09-08' }] }))
      .toEqual([{ event_id: 'e1', to_date: null }])
  })

  it('skips a new date already taken by the date being changed', () => {
    expect(mapPlannedDates({
      rule: saturdays, fromDate: '2026-09-06', planned: [{ id: 'e1', occurrence_date: '2026-09-13' }], taken: ['2026-09-19'],
    })).toEqual([{ event_id: 'e1', to_date: null }])
  })

  it('gives two planned dates in one week one new date, and keeps the other where it is', () => {
    const planned = [{ id: 'late', occurrence_date: '2026-09-17' }, { id: 'early', occurrence_date: '2026-09-13' }]
    expect(mapPlannedDates({ rule: saturdays, fromDate: '2026-09-06', planned })).toEqual([
      { event_id: 'early', to_date: '2026-09-19' },
      { event_id: 'late', to_date: null },
    ])
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

describe('firstNewDate — where the new schedule first lands', () => {
  const tuesdays = { cadence: 'weekly', intervalN: 1, weekday: 2, timeStart: '09:00', startsOn: '2026-01-01' }

  it('is the new schedule\'s first date on or after the split', () => {
    expect(firstNewDate({ rule: tuesdays, fromDate: '2026-10-11' })).toBe('2026-10-13')
    expect(firstNewDate({ rule: tuesdays, fromDate: '2026-10-13' })).toBe('2026-10-13')
  })

  it('is null when the schedule ends before it lands', () => {
    expect(firstNewDate({ rule: { ...tuesdays, endsOn: '2026-10-12' }, fromDate: '2026-10-11' })).toBeNull()
  })
})

describe('previousDateBefore — the guard against dates swapping order', () => {
  const sundays = { cadence: 'weekly', intervalN: 1, weekday: 0, timeStart: '08:00', startsOn: '2026-01-04' }

  it('finds an old date from the new date up to (not including) the date being changed', () => {
    expect(previousDateBefore({ series: sundays, newDate: '2026-10-03', occurrenceDate: '2026-10-11' })).toBe('2026-10-04')
  })

  it('is null when nothing sits in between', () => {
    expect(previousDateBefore({ series: sundays, newDate: '2026-10-10', occurrenceDate: '2026-10-11' })).toBeNull()
  })
})

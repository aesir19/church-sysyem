import { describe, it, expect, vi, beforeEach } from 'vitest'

// Leaders' Group meetings — the data module (docs/specs/d-group-leader-view.md, Phase 2;
// mockups 13g–13i). The database decides who may do what (0056); these tests pin down
// what the module writes and how it reads, with the database mocked.

const state = vi.hoisted(() => ({ results: {}, calls: [], rpcResult: { data: null, error: null } }))

function makeBuilder (table) {
  const record = (name, ...args) => state.calls.push({ table, name, args })
  const chain = ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'is', 'not', 'in', 'gte', 'lt', 'order', 'or', 'maybeSingle']
  const b = {}
  for (const name of chain) b[name] = vi.fn(function (...args) { record(name, ...args); return this })
  b.then = (onFulfilled, onRejected) => {
    const r = state.results[table]
    const result = typeof r === 'function' ? r(state.calls.filter(c => c.table === table)) : (r ?? { data: [{ id: 'row' }], error: null })
    return Promise.resolve(result).then(onFulfilled, onRejected)
  }
  return b
}

vi.mock('../../../src/lib/supabase', () => ({
  supabase: {
    from: vi.fn((table) => { state.calls.push({ table, name: 'from' }); return makeBuilder(table) }),
    rpc: vi.fn(async (name, args) => { state.calls.push({ table: 'rpc', name, args }); return state.rpcResult })
  }
}))

const {
  myLedGroupIds, meetingFromCalendarItem, meetingActions, groupNamesFor, meetingRule, repeatSummary, formSummary, cardMeetings, pastLabel, editMeeting, changeFromHere, createGroupMeeting, listGroupMeetings, meetingMenu, cancelMeeting, moveMeeting, deleteMeeting
} = await import('../../../src/lib/data/groupMeetings')

const calls = (table, name) => state.calls.filter(c => c.table === table && c.name === name)

beforeEach(() => {
  state.calls = []
  state.rpcResult = { data: null, error: null }
  state.results = {}
})

// Thursday 6 August 2026, 19:30–21:00 Manila — mockup 13h.
const FORM = {
  churchId: 'c1', groupId: 'g4', title: 'Weekly D-Group night', date: '2026-08-06',
  startTime: '19:30', endTime: '21:00', location: "Ana's home, Mabolo", notes: 'Bring your Bible.'
}

describe('meetingRule — the form\'s Repeat choice as a series rule', () => {
  it('has no rule for a one-off meeting', () => {
    expect(meetingRule({ ...FORM, repeat: 'none' })).toBeNull()
  })

  it('repeats weekly on the first meeting\'s weekday, ending after N or never', () => {
    expect(meetingRule({ ...FORM, repeat: 'weekly', count: 8 })).toMatchObject({
      cadence: 'weekly', intervalN: 1, weekday: 4, startsOn: '2026-08-06', timeStart: '19:30', timeEnd: '21:00', countN: 8
    })
    expect(meetingRule({ ...FORM, repeat: 'weekly', count: null }).countN).toBeNull()
  })

  it('repeats every 2 weeks from the first meeting', () => {
    expect(meetingRule({ ...FORM, repeat: 'fortnightly', count: 8 })).toMatchObject({ cadence: 'weekly', intervalN: 2, weekday: 4 })
  })

  it('repeats monthly on the same weekday, and a fifth one becomes "the last"', () => {
    expect(meetingRule({ ...FORM, repeat: 'monthly', count: 8 })).toMatchObject({
      cadence: 'monthly', intervalN: 1, anchor: 'weekday', weekday: 4, weekOfMonth: 1
    })
    // Thursday 29 Oct 2026 is the fifth Thursday; most months have none.
    expect(meetingRule({ ...FORM, date: '2026-10-29', repeat: 'monthly', count: 8 }).weekOfMonth).toBe(-1)
  })
})

describe('the repeat wording on a row (13g) and in the form (13h)', () => {
  const rule = (repeat, count = 8, date = '2026-08-06') => meetingRule({ ...FORM, date, repeat, count })

  it('says how a meeting repeats, and how many there are', () => {
    expect(repeatSummary(rule('weekly'))).toBe('Repeats every Thursday · 8 meetings')
    expect(repeatSummary(rule('weekly', null))).toBe('Repeats every Thursday')
    expect(repeatSummary(rule('fortnightly'))).toBe('Repeats every 2 weeks on Thursday · 8 meetings')
    expect(repeatSummary(rule('monthly'))).toBe('Repeats on the first Thursday of every month · 8 meetings')
    expect(repeatSummary(rule('monthly', null, '2026-10-29'))).toBe('Repeats on the last Thursday of every month')
  })

  it('tells the form when the last meeting falls', () => {
    expect(formSummary(rule('weekly'))).toBe('Every Thursday · ends after 8 meetings (24 Sep)')
    expect(formSummary(rule('fortnightly', 3))).toBe('Every 2 weeks on Thursday · ends after 3 meetings (3 Sep)')
    expect(formSummary(rule('weekly', null))).toBe('Every Thursday · no end date')
    expect(formSummary(null)).toBe('')
  })
})

describe('createGroupMeeting', () => {
  it('writes a one-off as a live Group meeting of the chosen group, and nothing else', async () => {
    const r = await createGroupMeeting({ ...FORM, repeat: 'none' })
    expect(r.ok).toBe(true)
    const [insert] = calls('events', 'insert')
    expect(insert.args[0]).toEqual({
      church_id: 'c1',
      small_group_id: 'g4',
      kind: 'group_meeting',
      title: 'Weekly D-Group night',
      starts_at: '2026-08-06T11:30:00.000Z',
      ends_at: '2026-08-06T13:00:00.000Z',
      location: "Ana's home, Mabolo",
      description: 'Bring your Bible.',
      status: 'published',
      published_at: expect.any(String)
    })
    expect(calls('event_series', 'insert')).toHaveLength(0)
  })

  it('writes a repeating meeting as a live series of the chosen group', async () => {
    const r = await createGroupMeeting({ ...FORM, repeat: 'weekly', count: 8 })
    expect(r.ok).toBe(true)
    const [insert] = calls('event_series', 'insert')
    expect(insert.args[0]).toMatchObject({
      church_id: 'c1', small_group_id: 'g4', kind: 'group_meeting', title: 'Weekly D-Group night',
      location: "Ana's home, Mabolo", description: 'Bring your Bible.', status: 'published',
      cadence: 'weekly', interval_n: 1, weekday: 4, time_start: '19:30', time_end: '21:00',
      starts_on: '2026-08-06', count_n: 8
    })
    expect(calls('events', 'insert')).toHaveLength(0)
  })

  it('refuses an incomplete form without writing anything', async () => {
    for (const missing of ['groupId', 'title', 'date', 'startTime']) {
      const r = await createGroupMeeting({ ...FORM, repeat: 'none', [missing]: '' })
      expect(r.ok).toBe(false)
    }
    expect(state.calls).toHaveLength(0)
  })

  it('refuses an end before the start', async () => {
    const r = await createGroupMeeting({ ...FORM, repeat: 'none', endTime: '19:00' })
    expect(r).toMatchObject({ ok: false, message: 'The meeting must end after it starts.' })
    expect(state.calls).toHaveLength(0)
  })

  it('reports a refused write as a failure, never success', async () => {
    state.results.events = { data: [], error: null }
    const r = await createGroupMeeting({ ...FORM, repeat: 'none' })
    expect(r.ok).toBe(false)
  })
})

// Wednesday 12 Aug 2026, 10:00 Manila.
const NOW = new Date('2026-08-12T02:00:00Z')

const seriesRow = {
  id: 'ser1', church_id: 'c1', small_group_id: 'g4', title: 'Weekly D-Group night', kind: 'group_meeting', status: 'published',
  location: "Ana's home", description: null, run_by: null, projected_budget: null,
  cadence: 'weekly', interval_n: 1, anchor: null, weekday: 4, week_of_month: null, day_of_month: null,
  weekday2: null, week_of_month2: null, day_of_month2: null,
  time_start: '19:30:00', time_end: '21:00:00', starts_on: '2026-07-30', ends_on: null, count_n: 8, deleted_at: null
}
const oneOff = {
  id: 'ev1', church_id: 'c1', small_group_id: 'g4', title: 'Fellowship dinner', kind: 'group_meeting', status: 'published',
  starts_at: '2026-08-15T10:00:00Z', ends_at: null, location: "Felix's home", description: null, series_id: null, occurrence_date: null
}

describe('listGroupMeetings', () => {
  it('reads only the given groups\' meetings, from 14 days back, one-offs and repeating dates together', async () => {
    state.results.events = { data: [oneOff], error: null }
    state.results.event_series = { data: [seriesRow], error: null }
    const r = await listGroupMeetings({ groupIds: ['g4'], now: NOW })

    expect(r.ok).toBe(true)
    for (const table of ['events', 'event_series']) {
      expect(calls(table, 'in')[0].args).toEqual(['small_group_id', ['g4']])
      // The group has to come back with the row, or a one-off meeting names no group.
      expect(calls(table, 'select')[0].args[0]).toMatch(/\bsmall_group_id\b/)
    }
    // 30 Jul is 13 days back (in), the series' dates run weekly from there; the one-off sits between.
    // Worked-out dates come from the repeat engine, which works in the device's local time
    // (the app's users are in Manila); compare in local time so this holds on any machine.
    const local = (m, d) => new Date(2026, m - 1, d, 19, 30).toISOString()
    const dates = r.meetings.slice(0, 4).map(m => [m.title, m.startsAt])
    expect(dates).toEqual([
      ['Weekly D-Group night', local(7, 30)],
      ['Weekly D-Group night', local(8, 6)],
      ['Weekly D-Group night', local(8, 13)],
      ['Fellowship dinner', '2026-08-15T10:00:00Z']
    ])
    expect(r.meetings.every(m => m.groupId === 'g4')).toBe(true)
    const repeating = r.meetings.find(m => m.seriesId)
    expect(repeating).toMatchObject({ seriesId: 'ser1', occurrenceDate: '2026-07-30', repeatText: expect.stringMatching(/Thursday/), countN: 8 })
  })

  it('lets a saved date override its slot', async () => {
    const moved = { ...oneOff, id: 'ex1', title: 'Weekly D-Group night', series_id: 'ser1', occurrence_date: '2026-08-13', starts_at: '2026-08-14T11:30:00Z' }
    state.results.events = { data: [moved], error: null }
    state.results.event_series = { data: [seriesRow], error: null }
    const r = await listGroupMeetings({ groupIds: ['g4'], now: NOW })
    const aug = r.meetings.filter(m => m.occurrenceDate === '2026-08-13')
    expect(aug).toHaveLength(1)
    expect(aug[0]).toMatchObject({ id: 'ex1', startsAt: '2026-08-14T11:30:00Z' })
  })

  it('answers no groups with no meetings and no read', async () => {
    expect(await listGroupMeetings({ groupIds: [], now: NOW })).toMatchObject({ ok: true, meetings: [] })
    expect(state.calls).toHaveLength(0)
  })

  it('fails loudly rather than showing an empty list', async () => {
    state.results.event_series = { data: null, error: { message: 'boom' } }
    const r = await listGroupMeetings({ groupIds: ['g4'], now: NOW })
    expect(r).toMatchObject({ ok: false, meetings: [], message: 'Group meetings could not be loaded. Please try again.' })
  })
})

describe('meetingMenu — the ⋯ menu (13i)', () => {
  const upcoming = { startsAt: '2026-08-13T11:30:00Z', status: 'published', seriesId: 'ser1' }
  it('offers every action before a repeating meeting', () => {
    expect(meetingMenu(upcoming, NOW)).toEqual({
      edit: true, move: true, changeFromHere: true, cancel: true, delete: true, deleteNote: null
    })
  })
  it('has no "from here on" for a one-off', () => {
    expect(meetingMenu({ ...upcoming, seriesId: null }, NOW).changeFromHere).toBe(false)
  })
  it('only cancels once it has happened', () => {
    expect(meetingMenu({ ...upcoming, startsAt: '2026-08-06T11:30:00Z' }, NOW)).toEqual({
      edit: false, move: false, changeFromHere: false, cancel: true, delete: false,
      deleteNote: 'Not available after the meeting date'
    })
  })
  it('does not cancel twice', () => {
    expect(meetingMenu({ ...upcoming, status: 'cancelled' }, NOW).cancel).toBe(false)
  })
})

describe('cancel, move and delete pick the right path', () => {
  const series = { id: 'ser1', church_id: 'c1', title: 'Weekly D-Group night', kind: 'group_meeting', timeStart: '19:30', timeEnd: '21:00' }
  const worked = { id: 'series-ser1-2026-08-13', seriesId: 'ser1', series, occurrenceDate: '2026-08-13', startsAt: '2026-08-13T11:30:00.000Z' }
  const single = { id: 'ev1', seriesId: null, startsAt: '2026-08-15T10:00:00Z' }

  it('cancels a one-off by status, and a repeating date by a cancelled saved date', async () => {
    await cancelMeeting(single, 'Rain')
    expect(calls('events', 'update')[0].args[0]).toMatchObject({ status: 'cancelled', cancel_reason: 'Rain' })
    await cancelMeeting(worked, 'Rain')
    expect(calls('events', 'upsert')[0].args[0]).toMatchObject({
      series_id: 'ser1', occurrence_date: '2026-08-13', status: 'cancelled', cancel_reason: 'Rain', kind: 'group_meeting'
    })
  })

  it('moves a one-off in place, and a repeating date as a saved date on its original slot', async () => {
    await moveMeeting(single, { date: '2026-08-16', startTime: '18:00', endTime: '20:00' })
    expect(calls('events', 'update')[0].args[0]).toMatchObject({
      starts_at: '2026-08-16T10:00:00.000Z', ends_at: '2026-08-16T12:00:00.000Z'
    })
    await moveMeeting(worked, { date: '2026-08-14', startTime: '19:30', endTime: '21:00' })
    expect(calls('events', 'upsert')[0].args[0]).toMatchObject({
      series_id: 'ser1', occurrence_date: '2026-08-13', starts_at: '2026-08-14T11:30:00.000Z', status: 'published'
    })
  })

  it('deletes a one-off outright', async () => {
    const r = await deleteMeeting(single, 'this')
    expect(r.ok).toBe(true)
    expect(calls('events', 'delete')).toHaveLength(1)
  })

  it('deletes one repeating date as a cancelled saved date, the rest by ending or deleting the series', async () => {
    await deleteMeeting(worked, 'this')
    expect(calls('events', 'upsert')[0].args[0]).toMatchObject({ occurrence_date: '2026-08-13', status: 'cancelled' })

    await deleteMeeting(worked, 'following')
    expect(calls('event_series', 'update')[0].args[0]).toMatchObject({ ends_on: '2026-08-12' })

    state.rpcResult = { data: { already_deleted: false, kept: 0, removed: 3 }, error: null }
    const r = await deleteMeeting(worked, 'series')
    expect(r.ok).toBe(true)
    expect(calls('rpc', 'delete_event_series')[0].args).toEqual({ p_series: 'ser1' })
  })
})

describe('cardMeetings — what the Group meetings card lists (13g)', () => {
  // Monday 3 Aug 2026, 10:00 Manila.
  const now = new Date('2026-08-03T02:00:00Z')
  const m = (id, startsAt, seriesId = null) => ({ id, startsAt, seriesId, status: 'published' })

  it('shows each repeating meeting once, at its next date, then one-offs in date order, then the recent past newest first', () => {
    const list = [
      m('s-jul23', '2026-07-23T11:30:00Z', 'ser1'), m('s-jul30', '2026-07-30T11:30:00Z', 'ser1'),
      m('s-aug6', '2026-08-06T11:30:00Z', 'ser1'), m('s-aug13', '2026-08-13T11:30:00Z', 'ser1'),
      m('dinner', '2026-08-15T10:00:00Z'), m('picnic', '2026-08-29T02:00:00Z')
    ]
    expect(cardMeetings(list, now).map(x => x.id)).toEqual(['s-aug6', 'dinner', 'picnic', 's-jul30', 's-jul23'])
  })
})

describe('pastLabel — how a past meeting reads', () => {
  const now = new Date('2026-08-03T02:00:00Z') // Monday
  it('names the week and whether it was held', () => {
    expect(pastLabel({ startsAt: '2026-07-30T11:30:00Z', status: 'published' }, now)).toBe('Last week · held')
    expect(pastLabel({ startsAt: '2026-07-23T11:30:00Z', status: 'published' }, now)).toBe('2 weeks ago · held')
    expect(pastLabel({ startsAt: '2026-07-30T11:30:00Z', status: 'cancelled' }, now)).toBe('Last week · cancelled')
    // Wednesday 5 Aug: Monday's meeting was this week.
    expect(pastLabel({ startsAt: '2026-08-03T11:30:00Z', status: 'published' }, new Date('2026-08-05T02:00:00Z'))).toBe('Earlier this week · held')
  })
})

describe('editMeeting and changeFromHere', () => {
  const series = { id: 'ser1', church_id: 'c1', title: 'Weekly D-Group night', kind: 'group_meeting', timeStart: '19:30', timeEnd: '21:00', cadence: 'weekly', intervalN: 1, weekday: 4, countN: 8 }
  const worked = { id: 'series-ser1-2026-08-13', seriesId: 'ser1', series, occurrenceDate: '2026-08-13', startsAt: '2026-08-13T11:30:00.000Z' }
  const single = { id: 'ev1', seriesId: null }
  const edits = { title: 'Night', date: '2026-08-13', startTime: '19:00', endTime: '20:30', location: "Carla's home", notes: '' }

  it('edits a one-off in place, and one repeating date as a saved date', async () => {
    await editMeeting(single, edits)
    expect(calls('events', 'update')[0].args[0]).toMatchObject({
      title: 'Night', starts_at: '2026-08-13T11:00:00.000Z', ends_at: '2026-08-13T12:30:00.000Z', location: "Carla's home", description: null
    })
    await editMeeting(worked, edits)
    expect(calls('events', 'upsert')[0].args[0]).toMatchObject({
      series_id: 'ser1', occurrence_date: '2026-08-13', title: 'Night', kind: 'group_meeting', location: "Carla's home", status: 'published'
    })
  })

  it('changes every date from here on through the split, keeping it a live Group meeting', async () => {
    state.rpcResult = { data: { already_done: false, new_series_id: 'ser2', moved: 0, standalone: 0 }, error: null }
    const r = await changeFromHere(worked, { ...edits, repeat: 'weekly', count: 8 }, 'key-1')
    expect(r.ok).toBe(true)
    const [call] = calls('rpc', 'split_event_series')
    expect(call.args).toMatchObject({ p_series: 'ser1', p_occurrence: '2026-08-13', p_starts: '2026-08-13', p_key: 'key-1', p_moves: null })
    expect(call.args.p_new).toMatchObject({
      title: 'Night', kind: 'group_meeting', status: 'published', location: "Carla's home",
      cadence: 'weekly', weekday: 4, time_start: '19:00', time_end: '20:30', count_n: 8
    })
  })
})

describe('on the Calendar (step 4)', () => {
  it('reads which groups the person leads', async () => {
    state.rpcResult = { data: ['g4', 'g9'], error: null }
    expect(await myLedGroupIds()).toEqual({ ok: true, ids: ['g4', 'g9'] })
    state.rpcResult = { data: null, error: { message: 'boom' } }
    expect(await myLedGroupIds()).toEqual({ ok: false, ids: [] })
  })

  it('turns a one-off Calendar item into a meeting without another read', async () => {
    const item = { ...oneOff, description: 'Bring food', cancel_reason: null }
    const r = await meetingFromCalendarItem(item)
    expect(r).toMatchObject({ ok: true, meeting: { id: 'ev1', groupId: 'g4', seriesId: null, startsAt: '2026-08-15T10:00:00Z', notes: 'Bring food' } })
    expect(state.calls).toHaveLength(0)
  })

  it('fetches the series for a repeating date, so its actions know the rule', async () => {
    state.results.event_series = { data: seriesRow, error: null }
    const item = { id: 'series-ser1-2026-08-13', seriesId: 'ser1', occurrence_date: '2026-08-13', title: 'Weekly D-Group night', kind: 'group_meeting', status: 'published', starts_at: '2026-08-13T11:30:00.000Z', ends_at: null, location: "Ana's home" }
    const r = await meetingFromCalendarItem(item)
    expect(calls('event_series', 'eq')[0].args).toEqual(['id', 'ser1'])
    expect(r.ok).toBe(true)
    expect(r.meeting).toMatchObject({ seriesId: 'ser1', occurrenceDate: '2026-08-13', groupId: 'g4', series: { id: 'ser1', timeStart: '19:30', countN: 8 } })
  })

  it('fails rather than offering actions it could not prepare', async () => {
    state.results.event_series = { data: null, error: { message: 'boom' } }
    const r = await meetingFromCalendarItem({ id: 'series-ser1-2026-08-13', seriesId: 'ser1', occurrence_date: '2026-08-13', starts_at: '2026-08-13T11:30:00.000Z' })
    expect(r.ok).toBe(false)
  })
})

describe('meetingActions — the ⋯ menu as a list both the card and the Calendar draw', () => {
  const now = new Date('2026-08-12T02:00:00Z')
  it('lists every action before a repeating meeting, delete last and set apart', () => {
    const a = meetingActions({ startsAt: '2026-08-13T11:30:00Z', status: 'published', seriesId: 'ser1' }, now)
    expect(a.map(x => x.label)).toEqual(['Edit…', 'Move this meeting…', 'Change from here on…', 'Cancel meeting', 'Delete…'])
    expect(a.at(-1)).toMatchObject({ kind: 'delete', danger: true, disabled: false, dividerBefore: true })
  })
  it('offers cancel and an unavailable delete once it has happened', () => {
    const a = meetingActions({ startsAt: '2026-08-06T11:30:00Z', status: 'published', seriesId: 'ser1' }, now)
    expect(a).toEqual([
      { kind: 'cancel', label: 'Cancel meeting', danger: false, disabled: false, note: null, dividerBefore: false },
      { kind: 'delete', label: 'Delete', danger: false, disabled: true, note: 'Not available after the meeting date', dividerBefore: false }
    ])
  })
})

describe('groupNamesFor', () => {
  it("maps the church's D-Groups by id", async () => {
    state.results.small_groups = { data: [{ id: 'g4', name: 'D-Group 4' }], error: null }
    expect(await groupNamesFor('c1')).toEqual({ g4: 'D-Group 4' })
    expect(calls('small_groups', 'eq')[0].args).toEqual(['church_id', 'c1'])
  })
  it('answers nothing, rather than failing the Calendar, when it cannot read them', async () => {
    state.results.small_groups = { data: null, error: { message: 'x' } }
    expect(await groupNamesFor('c1')).toEqual({})
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({ result: { data: null, error: null }, calls: [] }))

vi.mock('../../../src/lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(async (name, args) => { state.calls.push([name, args]); return state.result })
  }
}))

const { fetchDGroupDashboard, summarizeDGroup } = await import('../../../src/lib/data/dGroup')

beforeEach(() => {
  state.result = { data: null, error: null }
  state.calls = []
})

const s = (id, date) => ({ id, church_id: 'c1', label: 'Sunday Service', service_date: date })
const SERVICES = [s('s1', '2026-07-12'), s('s2', '2026-07-19'), s('s3', '2026-07-26'), s('s4', '2026-08-02')]
const att = (...statuses) => statuses.map((status, i) => ({ service_id: `s${i + 1}`, status }))
const P = 'present'
const M = 'missed'
const N = 'not_in_group'

function member (id, overrides = {}) {
  return {
    member_id: id,
    group_id: 'g4',
    name: `Member ${id}`,
    joined_at: null,
    birth_month: 1,
    birth_day: 1,
    is_baptized: false,
    is_one_to_one_completed: false,
    is_turning_point_completed: false,
    attendance: att(P, P, P, P),
    served_recent: 0,
    serving_this_week: [],
    ...overrides
  }
}

const GROUPS = [
  { id: 'g4', name: 'D-Group 4', church_id: 'c1', started_at: null },
  { id: 'g9', name: 'D-Group 9', church_id: 'c1', started_at: null }
]

// Monday 3 Aug 2026, 10:00 Manila.
const NOW = new Date('2026-08-03T02:00:00Z')

describe('fetchDGroupDashboard', () => {
  it('reads the leader dashboard in one call and maps it to the screen shape', async () => {
    state.result = {
      data: { groups: [GROUPS[0]], services: SERVICES, members: [member('m1', { served_recent: 3 })] },
      error: null
    }
    const r = await fetchDGroupDashboard()

    expect(state.calls).toEqual([['d_group_dashboard', undefined]])
    expect(r.ok).toBe(true)
    expect(r.groups).toEqual([{ id: 'g4', name: 'D-Group 4', startedAt: null }])
    expect(r.services.map(x => x.serviceDate)).toEqual(['2026-07-12', '2026-07-19', '2026-07-26', '2026-08-02'])
    expect(r.members[0]).toMatchObject({ id: 'm1', groupId: 'g4', name: 'Member m1', servedRecent: 3 })
    // Each mark carries its own service, so nothing depends on two lists lining up.
    expect(r.members[0].attendance).toEqual(['s1', 's2', 's3', 's4'].map(serviceId => ({ serviceId, status: P })))
  })

  it('reports "leads nothing" as an empty, permitted result, not a failure', async () => {
    state.result = { data: { groups: [], services: [], members: [] }, error: null }
    const r = await fetchDGroupDashboard()
    expect(r).toMatchObject({ ok: true, permitted: true, groups: [], members: [] })
  })

  it('fails with a safe message and keeps the cause', async () => {
    const cause = { code: 'PT403', message: 'account_disabled' }
    state.result = { data: null, error: cause }
    const r = await fetchDGroupDashboard()
    expect(r.ok).toBe(false)
    expect(r.permitted).toBe(false)
    expect(r.message).toBe('Your D-Group could not be loaded. Please try again.')
    expect(r.cause).toBe(cause)
    expect(r.groups).toEqual([])
  })
})

async function load (members, groups = [GROUPS[0]]) {
  state.result = { data: { groups, services: SERVICES, members }, error: null }
  return fetchDGroupDashboard()
}

describe('summarizeDGroup', () => {
  it('counts last Sunday out of the members who were in the group, and names who was not there', async () => {
    const d = await load([
      member('a'), member('b', { attendance: att(P, P, P, M) }), member('c', { attendance: att(N, N, N, N) })
    ])
    const v = summarizeDGroup(d, { now: NOW })
    expect(v.lastSunday).toEqual({ present: 1, of: 2, date: '2026-08-02', notThere: ['Member b'] })
  })

  it('flags members who missed 2 of the last 4 since joining, most recent absence first', async () => {
    const d = await load([
      member('older', { attendance: att(M, M, P, P) }),
      member('recent', { attendance: att(P, P, M, M) }),
      member('once', { attendance: att(P, M, P, P) }),
      // Joined two weeks ago and missed one: never flagged for services before joining.
      member('newcomer', { attendance: att(N, N, M, P) })
    ])
    const v = summarizeDGroup(d, { now: NOW })
    expect(v.checkOn).toEqual([
      { id: 'recent', name: 'Member recent', groupName: 'D-Group 4', missedDates: ['2026-07-26', '2026-08-02'] },
      { id: 'older', name: 'Member older', groupName: 'D-Group 4', missedDates: ['2026-07-12', '2026-07-19'] }
    ])
  })

  it('lists this week’s birthdays and serving, and joins from the last 30 days', async () => {
    const d = await load([
      member('bday', { birth_month: 8, birth_day: 4 }),
      member('lastweek', { birth_month: 8, birth_day: 2 }),
      member('server', { serving_this_week: [{ role: 'Ushering', event_title: 'Sunday Service', starts_at: '2026-08-09T01:00:00Z' }] }),
      member('joined', { joined_at: '2026-07-20T03:00:00Z' }),
      member('longago', { joined_at: '2026-06-01T03:00:00Z' })
    ])
    const v = summarizeDGroup(d, { now: NOW })
    expect(v.week).toEqual({ from: '2026-08-03', to: '2026-08-09' })
    expect(v.thisWeek).toEqual([
      { kind: 'birthday', id: 'bday', name: 'Member bday', groupName: 'D-Group 4', date: '2026-08-04' },
      { kind: 'serving', id: 'server', name: 'Member server', groupName: 'D-Group 4', role: 'Ushering', date: '2026-08-09T01:00:00Z' },
      { kind: 'joined', id: 'joined', name: 'Member joined', groupName: 'D-Group 4', date: '2026-07-20T03:00:00Z' }
    ])
  })

  it('finds a birthday in a week that crosses the new year', async () => {
    const d = await load([member('ny', { birth_month: 1, birth_day: 2 })])
    // Wednesday 30 Dec 2026, Manila.
    const v = summarizeDGroup(d, { now: new Date('2026-12-30T02:00:00Z') })
    expect(v.thisWeek).toEqual([{ kind: 'birthday', id: 'ny', name: 'Member ny', groupName: 'D-Group 4', date: '2027-01-02' }])
  })

  it('totals discipleship progress', async () => {
    const d = await load([
      member('a', { is_baptized: true, is_one_to_one_completed: true }),
      member('b', { is_baptized: true, is_turning_point_completed: true }),
      member('c')
    ])
    expect(summarizeDGroup(d, { now: NOW }).progress).toEqual({ total: 3, baptized: 2, oneToOne: 1, turningPoint: 1 })
  })

  it('narrows everything to one group when filtered, and combines groups otherwise', async () => {
    const d = await load([member('a'), member('b', { group_id: 'g9', is_baptized: true })], GROUPS)
    const all = summarizeDGroup(d, { now: NOW })
    expect(all.rows.map(r => r.id)).toEqual(['a', 'b'])
    expect(all.rows[1].groupName).toBe('D-Group 9')

    const one = summarizeDGroup(d, { now: NOW, groupId: 'g9' })
    expect(one.rows.map(r => r.id)).toEqual(['b'])
    expect(one.progress).toEqual({ total: 1, baptized: 1, oneToOne: 0, turningPoint: 0 })
  })

  it('treats a member who sits in two led groups as one person everywhere', async () => {
    const serving = [{ role: 'Ushering', event_title: 'Sunday Service', starts_at: '2026-08-09T01:00:00Z' }]
    const d = await load([
      // Joined D-Group 9 recently; has been in D-Group 4 for years. The longer
      // membership decides attendance, so the two misses count.
      member('a', { attendance: att(P, P, M, M), serving_this_week: serving }),
      member('a', { group_id: 'g9', joined_at: '2026-07-28T03:00:00Z', attendance: att(N, N, N, M), serving_this_week: serving })
    ], GROUPS)
    const v = summarizeDGroup(d, { now: NOW })
    expect(v.progress.total).toBe(1)
    expect(v.lastSunday.of).toBe(1)
    expect(v.checkOn).toEqual([{ id: 'a', name: 'Member a', groupName: 'D-Group 4 and D-Group 9', missedDates: ['2026-07-26', '2026-08-02'] }])
    expect(v.thisWeek.filter(i => i.kind === 'serving')).toHaveLength(1)
    expect(v.thisWeek.filter(i => i.kind === 'joined')).toEqual([
      { kind: 'joined', id: 'a', name: 'Member a', groupName: 'D-Group 9', date: '2026-07-28T03:00:00Z' }
    ])
    // The rows still list each membership, each naming its own group.
    expect(v.rows.map(r => r.groupName)).toEqual(['D-Group 4', 'D-Group 9'])
  })

  it('marks members who joined in the last 30 days, once, for every section to share', async () => {
    const d = await load([
      member('new', { joined_at: '2026-07-20T03:00:00Z' }),
      member('old', { joined_at: '2026-06-01T03:00:00Z' }),
      member('unknown')
    ])
    const v = summarizeDGroup(d, { now: NOW })
    expect(v.rows.map(r => [r.id, r.isNewJoiner])).toEqual([['new', true], ['old', false], ['unknown', false]])
  })

  it('lists only serving still to come this week', async () => {
    const at = iso => ({ role: 'Ushering', event_title: 'Service', starts_at: iso })
    const d = await load([member('a', { serving_this_week: [at('2026-08-03T11:00:00Z'), at('2026-08-05T11:00:00Z'), at('2026-08-09T01:00:00Z')] })])
    // Wednesday 5 Aug, 10:00 Manila: Monday's has passed; Wednesday evening's is today.
    const v = summarizeDGroup(d, { now: new Date('2026-08-05T02:00:00Z') })
    expect(v.thisWeek.map(i => i.date)).toEqual(['2026-08-05T11:00:00Z', '2026-08-09T01:00:00Z'])
  })

  it('flags attendance as stale when the newest recorded service is over two weeks old', async () => {
    const d = await load([member('a')])
    // Newest service 2 Aug. Sunday 16 Aug is exactly two weeks on: still current.
    expect(summarizeDGroup(d, { now: new Date('2026-08-16T02:00:00Z') }).staleSince).toBeNull()
    expect(summarizeDGroup(d, { now: new Date('2026-08-17T02:00:00Z') }).staleSince).toBe('2026-08-02')
    expect(summarizeDGroup(d, { now: NOW }).staleSince).toBeNull()
  })

  it('names the next Sunday in Manila, today when today is Sunday', async () => {
    const d = await load([member('a')])
    expect(summarizeDGroup(d, { now: NOW }).nextSunday).toBe('2026-08-09')
    // Saturday 8 Aug, 23:30 Manila is still Saturday there, whatever the device says.
    expect(summarizeDGroup(d, { now: new Date('2026-08-08T15:30:00Z') }).nextSunday).toBe('2026-08-09')
    expect(summarizeDGroup(d, { now: new Date('2026-08-09T00:30:00Z') }).nextSunday).toBe('2026-08-09')
  })

  it('has no last Sunday when the group has no Sunday service yet', async () => {
    state.result = { data: { groups: [GROUPS[0]], services: [], members: [member('a', { attendance: [] })] }, error: null }
    const v = summarizeDGroup(await fetchDGroupDashboard(), { now: NOW })
    expect(v.lastSunday).toBeNull()
    expect(v.checkOn).toEqual([])
  })
})

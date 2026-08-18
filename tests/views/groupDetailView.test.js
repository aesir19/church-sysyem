// What the group page shows a given caller. Issue #76.
//
// These assert on RENDERED OUTPUT rather than on which query ran — lib/data/group.js is
// covered separately, and the failures worth guarding here are both about honesty:
// showing a zero that actually means "you may not see this", and showing a figure on a
// surface that has no data behind it.
//
// THE MEETING SURFACES WERE REMOVED, and a suite guards their absence: no Soon badge, no
// "Meetings" card, no Record-meeting button, and — still — no read of service attendance
// standing in for group meetings. The tests fail the moment any of them reappears.

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

const state = vi.hoisted(() => ({
  group: null,
  roster: { ok: true, rows: [], count: 0, detail: 'full', message: '' },
  leader: { ok: true, leader: null },
  caps: {},
  ledGroupIds: [],
  churches: null,
  calls: []
}))

// The view pulls in the dialogs, which import the client directly. Nothing here reaches
// it — every read is mocked below — but the module throws on import without env vars.
vi.mock('../../src/lib/supabase', () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ is: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) }) }) }
}))

vi.mock('../../src/lib/data/group', async () => {
  const actual = await vi.importActual('../../src/lib/data/group')
  return {
    ...actual,
    fetchGroupBySlug: vi.fn(async () => {
      state.calls.push('fetchGroupBySlug')
      return { ok: true, message: '', group: state.group, cause: null }
    }),
    fetchRoster: vi.fn(async () => {
      state.calls.push('fetchRoster')
      return { cause: null, ...state.roster }
    }),
    fetchLeader: vi.fn(async () => {
      state.calls.push('fetchLeader')
      return { message: '', cause: null, ...state.leader }
    }),
    fetchMyLedGroupIds: vi.fn(async () => {
      state.calls.push('fetchMyLedGroupIds')
      return { ok: true, ids: state.ledGroupIds ?? [], cause: null }
    })
  }
})

vi.mock('../../src/composables/useActiveChurch', () => ({
  useActiveChurch: () => ({
    activeChurchId: { value: 'church-1' },
    activeChurchName: { value: 'Cogon' },
    // `churches` is [] for a single-church user; `homeChurch` is what the view must
    // resolve the URL segment against for them. state.churches lets a test empty it.
    churches: { value: state.churches ?? [{ id: 'church-1', name: 'Cogon' }] },
    homeChurch: { value: { id: 'church-1', name: 'Cogon' } },
    ensureLoaded: async () => {},
    setActiveChurch: () => {}
  })
}))

vi.mock('../../src/composables/useCurrentRole', () => ({
  useCurrentRole: () => ({
    canSeeMemberDetail: { value: state.caps.canSeeMemberDetail ?? true },
    canManageSmallGroups: { value: state.caps.canManageSmallGroups ?? true },
    isSmallGroupLeader: { value: state.caps.isSmallGroupLeader ?? false },
    isSuperAdmin: { value: state.caps.isSuperAdmin ?? true },
    isHeadPastor: { value: state.caps.isHeadPastor ?? false },
    isPastor: { value: state.caps.isPastor ?? false },
    canRecordJourney: { value: state.caps.canRecordJourney ?? false },
    canManageGroupMembers: () => state.caps.canManageGroupMembers ?? true
  })
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { church: 'cogon', group: 'thursday-group' } }),
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  RouterLink: { props: ['to'], setup: (_p, { slots }) => () => h('a', slots.default?.()) }
}))

const GroupDetailView = (await import('../../src/views/GroupDetailView.vue')).default

const MINISTRY = { id: 'g1', name: 'Worship Team', type: 'Ministry', church_id: null, ministry_key: null }
const SMALL_GROUP = { id: 'g2', name: 'Thursday Group', type: 'Small Group', church_id: 'church-1', ministry_key: null }

function member (over = {}) {
  return {
    membershipId: `m-${over.memberId || '1'}`,
    memberId: over.memberId || '1',
    firstName: 'Juan', lastName: 'Cruz', name: 'Juan Cruz',
    age: 30, joined: '2021-06-02',
    isBaptized: true, isOneToOneCompleted: false, isTurningPointCompleted: false,
    ...over
  }
}

/**
 * Render the page with its data already loaded.
 *
 * The view fetches from onMounted (a browser) and onServerPrefetch (here), so a server
 * render awaits the same load() the browser runs and returns the resolved page rather
 * than its loading state. That is what lets these assert on real markup without a DOM.
 */
async function renderLoaded () {
  return renderToString(createSSRApp({ render: () => h(GroupDetailView) }))
}

const render = renderLoaded

beforeEach(() => {
  state.group = SMALL_GROUP
  state.roster = { ok: true, rows: [], count: 0, detail: 'full', message: '' }
  state.leader = { ok: true, leader: null }
  state.caps = {}
  state.ledGroupIds = []
  state.churches = null
  state.calls = []
  vi.clearAllMocks()
})

describe('the page renders without raising', () => {
  it('renders for a small group', async () => {
    const html = await render()
    expect(typeof html).toBe('string')
  })

  it('asks for the group, its roster and its leader', async () => {
    await renderLoaded()
    expect(state.calls).toContain('fetchGroupBySlug')
  })
})

describe('the group-meeting surfaces are removed, not merely emptied', () => {
  // The page once carried Soon placeholders for group meetings — two summary tiles, a
  // roster column, a Record-meeting button and a Meetings card. They were removed rather
  // than left standing as empty promises. Nothing should render a Soon badge, and nothing
  // should promise meetings.
  // Comments are stripped first: SSR renders HTML comments into the output, and the
  // design notes in this view legitimately discuss the removed "Soon" surfaces. What is
  // being guarded is what the page SHOWS, not what its source documents.
  const visible = html => html.replace(/<!--[\s\S]*?-->/g, '')

  it('renders no Soon surface at all', async () => {
    state.roster = { ok: true, rows: [member()], count: 1, detail: 'full', message: '' }
    const html = visible(await renderLoaded())

    expect(html).not.toMatch(/soon-block/)
    expect(html.toLowerCase()).not.toContain('soon')
  })

  it('does not mention group meetings anywhere', async () => {
    state.roster = { ok: true, rows: [member()], count: 1, detail: 'full', message: '' }
    const html = visible(await renderLoaded())

    expect(html.toLowerCase()).not.toContain('meeting')
    expect(html).not.toContain('Record meeting')
  })

  it('never asks the data layer for attendance', async () => {
    await renderLoaded()
    // The guard against someone wiring a meetings surface to `attendance` later: service
    // attendance answers a different question from group attendance.
    expect(state.calls.join(',')).not.toMatch(/attendance/i)
  })
})

describe('the leader line', () => {
  it('names the leader of a small group', async () => {
    state.leader = { ok: true, leader: { accountId: 'a1', memberId: '1', name: 'Anna Escuadro' } }
    const html = await renderLoaded()
    expect(html).toContain('Led by Anna Escuadro')
  })

  it('says plainly when a small group has none', async () => {
    const html = await renderLoaded()
    expect(html).toContain('No leader assigned')
  })

  // A failed lookup used to render as "No leader assigned" — a confident false
  // statement about the group. It took the PostgREST contract suite to notice.
  it('does not claim there is no leader when the lookup failed', async () => {
    state.leader = { ok: false, leader: null }
    const html = await renderLoaded()
    expect(html).not.toContain('No leader assigned')
    expect(html).toContain('Leader could not be loaded')
  })

  it('shows no leader line at all for a ministry', async () => {
    state.group = MINISTRY
    const html = await renderLoaded()
    expect(html).not.toContain('No leader assigned')
    expect(html).not.toContain('Led by')
  })
})

describe('the roster marks the leader', () => {
  // No small group on staging has a leader, so this is the only place the marked row is
  // exercised. The leader is stored account-side and the roster is member-side; the row
  // is matched on member id, and getting that wrong marks nobody or marks everybody.
  it('marks the leader’s row and leaves the rest as members', async () => {
    state.leader = { ok: true, leader: { accountId: 'a1', memberId: '2', name: 'Anna Escuadro' } }
    state.roster = {
      ok: true,
      rows: [member({ memberId: '1', name: 'Juan Cruz' }), member({ memberId: '2', name: 'Anna Escuadro' })],
      count: 2, detail: 'full', message: ''
    }
    const html = await renderLoaded()

    // Exactly one row is marked — not zero (matched on the wrong id) and not every row
    // (matched on nothing). Counted on the badge's closing tag so the header's own
    // "Small group" badge and the "Members" tile label cannot be mistaken for a match.
    expect((html.match(/Leader</g) || []).length).toBe(1)
    expect((html.match(/Member</g) || []).length).toBe(1)
  })

  it('marks nobody when the group has no leader', async () => {
    state.roster = { ok: true, rows: [member({ memberId: '1' })], count: 1, detail: 'full', message: '' }
    const html = await renderLoaded()
    expect(html).not.toMatch(/>\s*Leader\s*</)
  })
})

describe('what a caller without member detail sees', () => {
  // Story 20: names, not a bare count and not an empty table. They see who is in the
  // group — the names — without any of the detail behind them.
  it('shows the roster names rather than an empty table or a bare count', async () => {
    state.caps = { canSeeMemberDetail: false }
    state.roster = {
      ok: true,
      rows: [member({ memberId: '1', name: 'Juan Cruz', age: null, joined: null })],
      count: 1, detail: 'names', message: ''
    }
    const html = await renderLoaded()

    expect(html).toContain('Juan Cruz')
    expect(html).not.toContain('You do not have permission to see who they are')
    expect(html).not.toContain('Nobody is in this group yet')
  })

  // "0% are baptized" and "you may not count them" are different statements: the journey
  // panel is hidden for a names-only caller rather than rendered as zeroes.
  it('hides the journey panel rather than showing zeroes', async () => {
    state.caps = { canSeeMemberDetail: false }
    state.roster = {
      ok: true,
      rows: [member({ memberId: '1', age: null, joined: null })],
      count: 7, detail: 'names', message: ''
    }
    const html = await renderLoaded()
    expect(html).not.toContain('Journey across the group')
  })

  // 0028: a small-group leader viewing a group THEY lead may record the one-to-one and
  // turning-point milestones inline. The chips appear only when the caller leads this
  // very group — set_member_journey() is the real gate, but a control that would bounce
  // is not offered.
  it('offers the journey toggles to a leader of THIS group', async () => {
    state.caps = { canSeeMemberDetail: false, isSmallGroupLeader: true, canRecordJourney: true, isSuperAdmin: false, canManageSmallGroups: false, canManageGroupMembers: false }
    state.ledGroupIds = ['g2'] // SMALL_GROUP.id
    state.roster = {
      ok: true,
      rows: [member({ memberId: '1', name: 'Juan Cruz', age: null, joined: null })],
      count: 1, detail: 'names', message: ''
    }
    const html = await renderLoaded()
    expect(state.calls).toContain('fetchMyLedGroupIds')
    expect(html).toContain('One-to-one')
    expect(html).toContain('Turning Point')
  })

  it('withholds the journey toggles on a group the caller does NOT lead', async () => {
    state.caps = { canSeeMemberDetail: false, isSmallGroupLeader: true, canRecordJourney: true, isSuperAdmin: false, canManageSmallGroups: false, canManageGroupMembers: false }
    state.ledGroupIds = ['some-other-group']
    state.roster = {
      ok: true,
      rows: [member({ memberId: '1', name: 'Juan Cruz', age: null, joined: null })],
      count: 1, detail: 'names', message: ''
    }
    const html = await renderLoaded()
    expect(html).not.toContain('One-to-one')
    expect(html).not.toContain('Turning Point')
  })

  // No click-through to member detail for a names-only roster (story 21/22): the row is
  // a name, not a link into the person.
  it('does not make the roster rows links into member detail', async () => {
    state.caps = { canSeeMemberDetail: false }
    state.roster = {
      ok: true,
      rows: [member({ memberId: '1', name: 'Juan Cruz', age: null, joined: null })],
      count: 1, detail: 'names', message: ''
    }
    const html = await renderLoaded()
    expect(html).not.toContain('is-clickable')
  })
})

describe('church resolution from the URL', () => {
  // Regression: a single-church user has `churches: []` (that list only drives the
  // cross-church selector), so resolving the URL's church segment against it alone
  // matched nothing and rendered "Group not found" for every single-church user.
  // The view must fall back to their home church.
  it('resolves the group for a single-church user (churches empty, homeChurch set)', async () => {
    state.churches = [] // single-church user
    state.group = SMALL_GROUP
    const html = await renderLoaded()
    expect(html).not.toContain('Group not found')
    expect(html).toContain('Thursday Group')
  })
})

describe('roster states are distinguishable', () => {
  it('an empty group does not look like a failed load', async () => {
    const html = await renderLoaded()
    expect(html).toContain('Nobody is in this group yet')
  })

  it('a failed roster says so instead of reporting no members', async () => {
    state.roster = { ok: false, rows: [], count: 0, detail: 'full', message: 'Could not load the members of this group.' }
    const html = await renderLoaded()

    expect(html).toContain('Could not load the members of this group.')
    expect(html).not.toContain('Nobody is in this group yet')
  })

  it('a group that resolves to nothing renders not-found', async () => {
    state.group = null
    const html = await renderLoaded()
    expect(html).toContain('Group not found')
  })
})

describe('management controls follow capability', () => {
  it('offers add and edit to a permitted caller', async () => {
    const html = await renderLoaded()
    expect(html).toContain('Add members')
    expect(html).toContain('Edit group')
  })

  // Absent rather than disabled: an action bar should offer only what will work.
  it('hides them from a caller who may not manage this group', async () => {
    state.caps = { canManageGroupMembers: false, canManageSmallGroups: false }
    const html = await renderLoaded()
    expect(html).not.toContain('Add members')
    expect(html).not.toContain('Edit group')
  })

  // The Finance carve-out: Pastor-only, and the page must respect it too.
  it('hides add for the Finance ministry when the caller may not manage it', async () => {
    state.group = { ...MINISTRY, name: 'Finance Team', ministry_key: 'finance' }
    state.caps = { canManageGroupMembers: false }
    const html = await renderLoaded()
    expect(html).not.toContain('Add members')
  })
})

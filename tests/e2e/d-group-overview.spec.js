import { test, expect } from '@playwright/test'
import { authedGoto, CHURCH, SUPERADMIN_PERMS } from './support/scenario.js'

// The D-Group leader view on the Overview (docs/specs/d-group-leader-view.md, Phase 1;
// mockups 13a–13f2). Fixtures mirror mockup 13's sample group so the two can be held
// side by side. The clock is fixed to Monday 3 August 2026, 10:00 Manila — the week
// the mockups show. The database scoping is proven in tests/db/d-group-dashboard.

test.use({ timezoneId: 'Asia/Manila' })

const perms = over => ({ ...SUPERADMIN_PERMS, role: 'member', is_super_admin: false, ...over })
const LEADER = perms({ is_small_group_leader: true })
const PASTOR_LEADER = perms({ is_small_group_leader: true, is_pastor: true })

const SERVICES = ['2026-07-12', '2026-07-19', '2026-07-26', '2026-08-02']
  .map((date, i) => ({ id: `s${i + 1}`, church_id: CHURCH.id, label: 'Sunday Service', service_date: date }))

const P = 'present'
const M = 'missed'
const N = 'not_in_group'

function member (name, statuses, over = {}) {
  return {
    member_id: `m-${name.split(' ')[0].toLowerCase()}`,
    group_id: 'g4',
    name,
    joined_at: null,
    birth_month: 3,
    birth_day: 15,
    is_baptized: false,
    is_one_to_one_completed: false,
    is_turning_point_completed: false,
    attendance: statuses.map((status, i) => ({ service_id: `s${i + 1}`, status })),
    served_recent: 0,
    serving_this_week: [],
    ...over
  }
}

const ALL = { is_baptized: true, is_one_to_one_completed: true, is_turning_point_completed: true }
const BO = { is_baptized: true, is_one_to_one_completed: true }
const SUNDAY_9 = '2026-08-09T01:00:00Z'

const GROUP_4 = { id: 'g4', name: 'D-Group 4 · Young professionals', church_id: CHURCH.id, started_at: null }
const MEMBERS_4 = [
  member('Ana Reyes', [P, P, P, P], { ...ALL, served_recent: 6, birth_month: 8, birth_day: 4 }),
  member('Ben Cruz', [P, P, P, M], { ...BO, served_recent: 2 }),
  member('Carla Lim', [P, P, P, P], { ...ALL, served_recent: 8, serving_this_week: [{ role: 'Worship team', event_title: 'Sunday Service', starts_at: SUNDAY_9 }] }),
  member('Dan Uy', [P, P, M, M], { is_one_to_one_completed: true }),
  member('Ella Santos', [P, P, P, P], { ...ALL, served_recent: 3 }),
  member('Felix Go', [P, M, P, P], { ...BO, served_recent: 5, serving_this_week: [{ role: 'Ushering', event_title: 'Sunday Service', starts_at: SUNDAY_9 }] }),
  member('Gina Tan', [M, M, P, P], { is_one_to_one_completed: true, served_recent: 1 }),
  member('Hector Ramos', [P, M, P, M], { is_baptized: true, served_recent: 1 }),
  member('Iris Bautista', [N, N, P, P], { joined_at: '2026-07-20T03:00:00Z' })
]

const GROUP_9 = { id: 'g9', name: 'D-Group 9 · Couples', church_id: CHURCH.id, started_at: null }
const MEMBERS_9 = [
  member('Joel Navarro', [P, P, P, P], { ...ALL, group_id: 'g9', served_recent: 4 }),
  member('Mae Navarro', [P, P, P, P], { ...BO, group_id: 'g9', served_recent: 4, birth_month: 8, birth_day: 6 }),
  member('Tom Ong', [P, P, P, M], { is_baptized: true, group_id: 'g9', served_recent: 1 })
]

const CHURCH_EVENTS = [
  { id: 'e-prayer', church_id: CHURCH.id, title: 'Prayer meeting', kind: 'special_service', status: 'published', starts_at: '2026-08-05T11:00:00Z', series_id: null },
  { id: 'e-outreach', church_id: CHURCH.id, title: 'Outreach — Cogon', kind: 'outreach', status: 'published', starts_at: '2026-08-07T07:00:00Z', series_id: null },
  { id: 'e-draft', church_id: CHURCH.id, title: 'Unannounced planning draft', kind: 'administrative', status: 'draft', starts_at: '2026-08-06T07:00:00Z', series_id: null }
]
const SCHEDULES = [{ id: 'sched-sun', label: 'Sunday Service', weekday: 0, starts_at: '09:00:00', ends_at: '12:00:00' }]

async function gotoOverview (page, { permissions = LEADER, dashboard }) {
  await page.clock.setFixedTime(new Date('2026-08-03T02:00:00Z'))
  await authedGoto(page, '/dashboard/overview', {
    rpc: {
      get_my_permissions: permissions,
      d_group_dashboard: dashboard,
      list_calendar_schedules: SCHEDULES,
      overview_member_stats: { active: 120, archived: 3, joined_this_month: 4, no_one_to_one: 1, not_baptized: 2, in_no_group: 3 },
      overview_recent_services: []
    },
    // The mock does not evaluate filters; the calendar's second events read asks for
    // series exceptions only, which none of these are.
    tables: { events: ({ url }) => String(url).includes('series_id=not.is.null') ? [] : CHURCH_EVENTS, event_series: [] }
  })
}

// The dashboard scrolls inside its own panel, so a full-page shot stops at the window
// edge; stretch the window to the content first. For the owner's side-by-side review.
async function shot (page, name) {
  const size = page.viewportSize()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: size.width, height: 2600 })
  // The cards rise in one after another; let the last one land.
  await page.waitForTimeout(1000)
  await page.screenshot({ path: test.info().outputPath(`${name}.png`) })
  await page.setViewportSize(size)
}

const ONE_GROUP = { groups: [GROUP_4], services: SERVICES, members: MEMBERS_4 }

test.describe('D-Group leader Overview', () => {
  test('a plain leader lands on their D-Group with no switch (13a)', async ({ page }) => {
    await gotoOverview(page, { dashboard: ONE_GROUP })

    await expect(page.getByRole('heading', { name: 'D-Group 4 · Young professionals' })).toBeVisible()
    await expect(page.getByText('9 members · you lead this group')).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Church' })).toHaveCount(0)

    await expect(page.locator('.big')).toHaveText('6 of 9')
    await expect(page.getByText("at the last recorded service · 2 Aug")).toBeVisible()

    const checkOn = page.locator('.check__list li')
    await expect(checkOn).toHaveText([
      /Dan Uy\s*Missed Sunday service 26 Jul and 2 Aug/,
      /Hector Ramos\s*Missed Sunday service 19 Jul and 2 Aug/,
      /Gina Tan\s*Missed Sunday service 12 Jul and 19 Jul/
    ])

    const week = page.locator('.week li')
    await expect(week).toHaveText([/birthday\s*Ana Reyes\s*Tue 4 Aug/i, /serving\s*Carla · Worship team\s*Sun/i, /serving\s*Felix · Ushering\s*Sun/i, /joined\s*Iris Bautista\s*20 Jul/i])

    await expect(page.getByText('7 of 9', { exact: true })).toBeVisible()
    await expect(page.locator('.member')).toHaveCount(9)
    await expect(page.locator('.church__list li')).toHaveText([/Wed 5\s*Prayer meeting · 7:00 PM/i, /Fri 7\s*Outreach — Cogon · 3:00 PM/i, /Sun 9\s*Sunday Service · 9:00 AM/i])
    await expect(page.getByText('Unannounced planning draft')).toHaveCount(0)
    await shot(page, '13a-desktop')

    await page.setViewportSize({ width: 390, height: 844 })
    await shot(page, '13b-phone')
  })

  test('a member row opens the group page', async ({ page }) => {
    await gotoOverview(page, { dashboard: ONE_GROUP })
    await page.locator('.member', { hasText: 'Ana Reyes' }).click()
    await expect(page).toHaveURL(/\/dashboard\/groups\/cogon\/d-group-4/)
  })

  test('a leader with an elevated role opens on Church and the device remembers My D-Group (13c, 13d)', async ({ page }) => {
    await gotoOverview(page, { permissions: PASTOR_LEADER, dashboard: ONE_GROUP })
    await expect(page.getByRole('tab', { name: 'Church' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('heading', { name: 'Next 7 days' })).toBeVisible()
    await shot(page, '13c-switch-church')

    await page.getByRole('tab', { name: 'My D-Group' }).click()
    await expect(page.getByRole('heading', { name: 'D-Group 4 · Young professionals' })).toBeVisible()
    await shot(page, '13d-switch-dgroup')

    await page.reload()
    await expect(page.getByRole('tab', { name: 'My D-Group' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('heading', { name: 'D-Group 4 · Young professionals' })).toBeVisible()
  })

  test('a two-group leader sees both combined, and the filter narrows to one (13e)', async ({ page }) => {
    await gotoOverview(page, { dashboard: { groups: [GROUP_4, GROUP_9], services: SERVICES, members: [...MEMBERS_4, ...MEMBERS_9] } })
    await expect(page.getByText('12 members across 2 groups')).toBeVisible()
    await expect(page.getByRole('tab', { name: 'All groups · 12' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('.check__list li').first()).toContainText('Dan Uy · D-Group 4 · Young professionals')
    await shot(page, '13e-multi')

    await page.getByRole('tab', { name: /D-Group 9 · Couples · 3/ }).click()
    await expect(page.getByRole('heading', { name: 'D-Group 9 · Couples' })).toBeVisible()
    await expect(page.locator('.member')).toHaveCount(3)
    await expect(page.locator('.big')).toHaveText('2 of 3')
  })

  test('a group with no members explains itself and still shows the church (13f1)', async ({ page }) => {
    await gotoOverview(page, { dashboard: { groups: [{ ...GROUP_4, name: 'D-Group 12 · New believers' }], services: SERVICES, members: [] } })
    await expect(page.getByText('No members in this group yet')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Open group page' })).toBeVisible()
    await expect(page.locator('.church__list li')).toHaveCount(3)
    await shot(page, '13f1-no-members')
  })

  test('a new group with no Sunday since it started says when the first count comes (13f2)', async ({ page }) => {
    const joined = d => ({ joined_at: d, attendance: SERVICES.map(s => ({ service_id: s.id, status: N })) })
    await gotoOverview(page, {
      dashboard: {
        groups: [{ ...GROUP_4, id: 'g12', name: 'D-Group 12 · New believers', started_at: '2026-08-01T02:00:00Z' }],
        services: SERVICES,
        members: [
          member('Paolo Lim', [], { group_id: 'g12', ...joined('2026-08-01T03:00:00Z') }),
          member('Rhea Sy', [], { group_id: 'g12', ...joined('2026-08-01T04:00:00Z'), birth_month: 8, birth_day: 7 }),
          member('Jun Abella', [], { group_id: 'g12', ...joined('2026-08-02T03:00:00Z'), is_baptized: true }),
          member('Kim Dela Cruz', [], { group_id: 'g12', ...joined('2026-08-02T04:00:00Z') })
        ]
      }
    })
    await expect(page.getByText('4 members · started 1 August')).toBeVisible()
    await expect(page.getByText('The first count shows after Sunday, 9 August.')).toBeVisible()
    await expect(page.getByText('Nobody yet — this needs at least two Sunday services after a member joins.')).toBeVisible()
    await expect(page.locator('.week li')).toHaveText([/birthday\s*Rhea Sy/i, /joined\s*Paolo Lim and Rhea Sy\s*1 Aug/i, /joined\s*Jun Abella and Kim Dela Cruz\s*2 Aug/i])
    await shot(page, '13f2-no-history')
  })

  test('a failed read says so instead of showing an empty group', async ({ page }) => {
    await gotoOverview(page, { dashboard: ONE_GROUP })
    // Registered after the mock, so it wins.
    await page.route('**/rest/v1/rpc/d_group_dashboard', route => route.fulfill({ status: 500, json: { message: 'boom' } }))
    await page.reload()
    await expect(page.getByText('Your D-Group could not be loaded. Please try again.')).toBeVisible()
    await expect(page.getByText('No members in this group yet')).toHaveCount(0)
  })
})

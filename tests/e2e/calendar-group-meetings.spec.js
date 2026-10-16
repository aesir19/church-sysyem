import { test, expect } from '@playwright/test'
import { authedGoto, CHURCH, SUPERADMIN_PERMS } from './support/scenario.js'

// Group meetings on the members' Calendar and in the Events composer
// (docs/specs/d-group-leader-view.md, Phase 2, step 4). WHO sees a meeting is the
// database's call (0056, tests/db/d-group-meetings); here the mock hands each person the
// rows the database would. The clock is Monday 3 August 2026, 10:00 Manila; the month
// grid is August 2026.

test.use({ timezoneId: 'Asia/Manila' })

const perms = over => ({ ...SUPERADMIN_PERMS, role: 'member', is_super_admin: false, ...over })
const LEADER = perms({ is_small_group_leader: true })
const MEMBER = perms({})

const SERIES = {
  id: 'ser1', church_id: CHURCH.id, small_group_id: 'g4', title: 'Weekly D-Group night', kind: 'group_meeting', status: 'published',
  location: "Ana's home, Mabolo", description: null, run_by: null, projected_budget: null,
  cadence: 'weekly', interval_n: 1, anchor: null, weekday: 4, week_of_month: null, day_of_month: null,
  weekday2: null, week_of_month2: null, day_of_month2: null,
  time_start: '19:30:00', time_end: '21:00:00', starts_on: '2026-07-30', ends_on: null, count_n: 8,
  created_at: '2026-07-20T00:00:00Z', created_by: null, updated_at: null, published_at: '2026-07-20T00:00:00Z', deleted_at: null
}

async function gotoCalendar (page, { permissions, ledGroups = [], writes = [] }) {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.clock.setFixedTime(new Date('2026-08-03T02:00:00Z'))
  await authedGoto(page, '/dashboard/calendar', {
    rpc: {
      get_my_permissions: permissions,
      my_led_group_ids: ledGroups,
      list_calendar_schedules: [],
      list_calendar_birthdays: []
    },
    tables: {
      events: [],
      event_series: [SERIES],
      small_groups: [{ id: 'g4', name: 'D-Group 4 · Young professionals', church_id: CHURCH.id }]
    },
    onWrite: ({ table, method, body }) => {
      writes.push({ table, method, body })
      return [{ id: 'written', ...(Array.isArray(body) ? body[0] : body) }]
    }
  })
}

// The Weekly D-Group night on a given day of August.
async function openAug (page, day) {
  const cell = page.locator('.cal__cell:not(.is-out)').nth(day - 1)
  await cell.locator('.cal__ev', { hasText: 'Weekly D-Group night' }).click()
  const peek = page.getByRole('dialog', { name: 'Weekly D-Group night' })
  await expect(peek).toBeVisible()
  return peek
}

async function shot (page, name) {
  await page.screenshot({ path: test.info().outputPath(`${name}.png`) })
}

test.describe('Group meetings on the Calendar', () => {
  test('a group member sees which group it is, and is not asked to serve', async ({ page }) => {
    await gotoCalendar(page, { permissions: MEMBER })
    const peek = await openAug(page, 13)
    await expect(peek).toContainText('D-Group 4 · Young professionals')
    await expect(peek).toContainText("Ana's home, Mabolo")
    await expect(peek.getByRole('button', { name: 'I can serve' })).toHaveCount(0)
    await expect(peek.getByRole('button', { name: 'Edit…' })).toHaveCount(0)
    await shot(page, 'calendar-member-peek')
  })

  test('a leader of the group can change a later date from the Calendar', async ({ page }) => {
    const writes = []
    await gotoCalendar(page, { permissions: LEADER, ledGroups: ['g4'], writes })
    const peek = await openAug(page, 13)
    await expect(peek.getByRole('button')).toContainText(['Edit…', 'Move this meeting…', 'Change from here on…', 'Cancel meeting', 'Delete…'])
    await shot(page, 'calendar-leader-peek')

    await peek.getByRole('button', { name: 'Cancel meeting' }).click()
    const dialog = page.getByRole('dialog', { name: 'Cancel this meeting?' })
    await dialog.getByLabel('Reason').fill('Fiesta')
    await dialog.getByRole('button', { name: 'Cancel meeting' }).click()
    await expect(dialog).toBeHidden()
    expect(writes.find(w => w.table === 'events').body).toMatchObject({
      series_id: 'ser1', occurrence_date: '2026-08-13', status: 'cancelled', cancel_reason: 'Fiesta'
    })
  })

  test('a past date offers only cancel', async ({ page }) => {
    await gotoCalendar(page, { permissions: LEADER, ledGroups: ['g4'] })
    // Thu 30 Jul, in the grid's leading days. Match the day number, not "7:30".
    const cell = page.locator('.cal__cell.is-out').filter({ has: page.locator('.cal__num', { hasText: /^30$/ }) })
    await cell.locator('.cal__ev', { hasText: 'Weekly D-Group night' }).click()
    const peek = page.getByRole('dialog', { name: 'Weekly D-Group night' })
    await expect(peek.getByRole('button', { name: 'Cancel meeting' })).toBeVisible()
    await expect(peek.getByRole('button', { name: /Delete/ })).toBeDisabled()
    await expect(peek).toContainText('Not available after the meeting date')
    await expect(peek.getByRole('button', { name: 'Edit…' })).toHaveCount(0)
  })

  test('a leader of another group gets no actions on this one', async ({ page }) => {
    await gotoCalendar(page, { permissions: LEADER, ledGroups: ['g9'] })
    const peek = await openAug(page, 13)
    await expect(peek.getByRole('button', { name: 'Cancel meeting' })).toHaveCount(0)
  })

  test('the Events team keeps "Go to event" and does not get the leader\'s short menu (C1)', async ({ page }) => {
    await gotoCalendar(page, { permissions: SUPERADMIN_PERMS })
    const peek = await openAug(page, 13)
    await expect(peek.getByRole('button', { name: 'Go to event' })).toBeVisible()
    await expect(peek.getByRole('button', { name: 'Cancel meeting' })).toHaveCount(0)
  })
})

test.describe('The Events composer', () => {
  test('no longer offers Group meeting for a new event', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await authedGoto(page, '/dashboard/events/new', { rpc: { list_calendar_schedules: [] }, tables: { event_rooms: [], events: [], event_series: [] } })
    const kind = page.getByLabel('Kind')
    await expect(kind).toBeVisible()
    await expect(kind.locator('option')).toHaveText(['Service', 'Special service', 'Outreach', 'Administrative'])
  })
})

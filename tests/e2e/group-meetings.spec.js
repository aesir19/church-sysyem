import { test, expect } from '@playwright/test'
import { authedGoto, CHURCH, SUPERADMIN_PERMS } from './support/scenario.js'

// Leaders' Group meetings on the D-Group view (docs/specs/d-group-leader-view.md, Phase 2;
// mockups 13g, 13h, 13i). Fixtures mirror 13g: a weekly D-Group night from Thu 30 Jul
// (8 meetings) and a one-off fellowship dinner on Sat 15 Aug. The clock is Monday
// 3 August 2026, 10:00 Manila. Who may do what is proven in tests/db/d-group-meetings.

test.use({ timezoneId: 'Asia/Manila' })

const LEADER = { ...SUPERADMIN_PERMS, role: 'member', is_super_admin: false, is_small_group_leader: true }
const G4 = { id: 'g4', name: 'D-Group 4 · Young professionals', church_id: CHURCH.id, started_at: null }
const G9 = { id: 'g9', name: 'D-Group 9 · Couples', church_id: CHURCH.id, started_at: null }

const member = (id, name, groupId = 'g4') => ({
  member_id: id, group_id: groupId, name, joined_at: null, birth_month: 3, birth_day: 15,
  is_baptized: false, is_one_to_one_completed: false, is_turning_point_completed: false,
  attendance: [], served_recent: 0, serving_this_week: []
})
const dashboard = (groups = [G4]) => ({
  groups, services: [], members: [member('m-ana', 'Ana Reyes'), ...(groups.length > 1 ? [member('m-joel', 'Joel Navarro', 'g9')] : [])]
})

const SERIES = {
  id: 'ser1', church_id: CHURCH.id, small_group_id: 'g4', title: 'Weekly D-Group night', kind: 'group_meeting', status: 'published',
  location: "Ana's home, Mabolo", description: null, run_by: null, projected_budget: null,
  cadence: 'weekly', interval_n: 1, anchor: null, weekday: 4, week_of_month: null, day_of_month: null,
  weekday2: null, week_of_month2: null, day_of_month2: null,
  time_start: '19:30:00', time_end: '21:00:00', starts_on: '2026-07-30', ends_on: null, count_n: 8,
  created_at: '2026-07-20T00:00:00Z', created_by: null, updated_at: null, published_at: '2026-07-20T00:00:00Z', deleted_at: null
}
const DINNER = {
  id: 'ev-dinner', church_id: CHURCH.id, small_group_id: 'g4', title: 'Fellowship dinner', kind: 'group_meeting', status: 'published',
  starts_at: '2026-08-15T10:00:00Z', ends_at: null, location: "Felix's home, Talamban", description: null,
  series_id: null, occurrence_date: null, cancel_reason: null
}

async function gotoView (page, { groups = [G4], series = [SERIES], events = [DINNER], writes = [], rpcCalls = [] } = {}) {
  // Cards rise in on load; screenshots and menus want them settled.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.clock.setFixedTime(new Date('2026-08-03T02:00:00Z'))
  await authedGoto(page, '/dashboard/overview', {
    rpc: {
      get_my_permissions: LEADER,
      d_group_dashboard: dashboard(groups),
      list_calendar_schedules: [],
      delete_event_series: ({ body }) => { rpcCalls.push(['delete_event_series', body]); return { already_deleted: false, kept: 0, removed: 5 } },
      preview_delete_event_series: { kept: 0, removed: 5 },
      split_event_series: ({ body }) => { rpcCalls.push(['split_event_series', body]); return { already_done: false, new_series_id: 'ser2', moved: 0, standalone: 0 } }
    },
    tables: {
      // The calendar's church read and the meetings read both hit these; filters aren't
      // evaluated by the mock, so a group-filtered read gets the group rows.
      events: ({ url }) => String(url).includes('small_group_id=in') ? events : [],
      event_series: ({ url }) => String(url).includes('small_group_id=in') ? series : []
    },
    onWrite: ({ table, method, body, url }) => {
      writes.push({ table, method, body, url: String(url) })
      if (method === 'DELETE') return [{ id: 'deleted' }]
      return [{ id: 'written', ...(Array.isArray(body) ? body[0] : body) }]
    }
  })
  await expect(page.getByRole('heading', { name: 'Group meetings' })).toBeVisible()
}

const card = page => page.locator('.meetings')
const row = (page, text) => card(page).locator('.meeting', { hasText: text })

// An open menu closes when the window resizes, so menus are shot as they stand.
async function shotAsIs (page, name) {
  await page.screenshot({ path: test.info().outputPath(`${name}.png`) })
}

async function shot (page, name) {
  const size = page.viewportSize()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: size.width, height: 1600 })
  await page.waitForTimeout(800)
  await page.screenshot({ path: test.info().outputPath(`${name}.png`) })
  await page.setViewportSize(size)
}

test.describe('Group meetings', () => {
  test('lists the next date of each meeting and the recent past (13g)', async ({ page }) => {
    await gotoView(page)
    await expect(page.getByRole('button', { name: '+ Group meeting' })).toBeVisible()
    await expect(card(page)).toContainText("Seen only by this group's members and leaders, the Events team and Super Admin.")

    const rows = card(page).locator('.meeting')
    await expect(rows).toHaveCount(3)
    await expect(rows.nth(0)).toContainText(/THU\s*6\s*Weekly D-Group night\s*7:30 PM · Ana's home, Mabolo\s*Repeats every Thursday · 8 meetings/i)
    await expect(rows.nth(1)).toContainText(/SAT\s*15\s*Fellowship dinner\s*6:00 PM · Felix's home, Talamban\s*One-off/i)
    await expect(rows.nth(2)).toContainText(/THU\s*30\s*Weekly D-Group night\s*Last week · held\s*Past — can be cancelled, not deleted/i)
    await shot(page, '13g-meetings')
  })

  test('creates a one-off meeting for the group (13h)', async ({ page }) => {
    const writes = []
    await gotoView(page, { writes })
    await page.getByRole('button', { name: '+ Group meeting' }).click()
    const dialog = page.getByRole('dialog', { name: 'New group meeting' })
    await expect(dialog).toContainText('Goes live right away. Only this group sees it on the Calendar.')
    await dialog.getByLabel('Title').fill('Prayer night')
    await dialog.getByLabel('Date').fill('2026-08-07')
    await dialog.getByLabel('Starts').fill('19:00')
    await dialog.getByLabel('Ends').fill('20:30')
    await dialog.getByLabel('Location').fill("Ben's home")
    await expect(dialog.getByLabel('Group')).toHaveValue('g4')
    await dialog.getByRole('button', { name: 'Create meeting' }).click()

    await expect(dialog).toBeHidden()
    const insert = writes.find(w => w.table === 'events' && w.method === 'POST')
    expect(insert.body).toMatchObject({
      church_id: CHURCH.id, small_group_id: 'g4', kind: 'group_meeting', title: 'Prayer night',
      starts_at: '2026-08-07T11:00:00.000Z', ends_at: '2026-08-07T12:30:00.000Z', location: "Ben's home", status: 'published'
    })
  })

  test('creates a weekly meeting that ends after 8, or never (13h, S1)', async ({ page }) => {
    const writes = []
    await gotoView(page, { writes })
    await page.getByRole('button', { name: '+ Group meeting' }).click()
    const dialog = page.getByRole('dialog', { name: 'New group meeting' })
    await dialog.getByLabel('Title').fill('Weekly D-Group night')
    await dialog.getByLabel('Date').fill('2026-08-06')
    await dialog.getByLabel('Starts').fill('19:30')
    await dialog.getByLabel('Ends').fill('21:00')
    await dialog.getByRole('radio', { name: 'Weekly' }).click()
    await expect(dialog).toContainText('Every Thursday · ends after 8 meetings (24 Sep)')
    await expect(dialog.getByRole('button', { name: 'Create 8 meetings' })).toBeVisible()
    await shot(page, '13h-form')

    await dialog.getByRole('radio', { name: 'Never' }).click()
    await expect(dialog).toContainText('Every Thursday · no end date')
    await dialog.getByRole('button', { name: 'Create meetings' }).click()
    await expect(dialog).toBeHidden()
    const insert = writes.find(w => w.table === 'event_series' && w.method === 'POST')
    expect(insert.body).toMatchObject({ small_group_id: 'g4', kind: 'group_meeting', cadence: 'weekly', weekday: 4, count_n: null })
  })

  test('refuses an end before the start, without saving', async ({ page }) => {
    const writes = []
    await gotoView(page, { writes })
    await page.getByRole('button', { name: '+ Group meeting' }).click()
    const dialog = page.getByRole('dialog', { name: 'New group meeting' })
    await dialog.getByLabel('Title').fill('x')
    await dialog.getByLabel('Date').fill('2026-08-07')
    await dialog.getByLabel('Starts').fill('19:00')
    await dialog.getByLabel('Ends').fill('18:00')
    await dialog.getByRole('button', { name: 'Create meeting' }).click()
    await expect(dialog).toContainText('The meeting must end after it starts.')
    expect(writes).toHaveLength(0)
  })

  test('lists only the groups the leader leads, and names each meeting\'s group when there are two', async ({ page }) => {
    await gotoView(page, { groups: [G4, G9] })
    await expect(row(page, 'Fellowship dinner')).toContainText('D-Group 4 · Young professionals')
    await page.getByRole('button', { name: '+ Group meeting' }).click()
    const options = page.getByRole('dialog').getByLabel('Group').locator('option')
    await expect(options).toHaveText(['D-Group 4 · Young professionals', 'D-Group 9 · Couples'])
  })

  test('offers every action before a repeating meeting, and only cancel after (13i)', async ({ page }) => {
    await gotoView(page)
    await row(page, 'Repeats every Thursday').getByRole('button', { name: 'Meeting actions' }).click()
    await expect(page.getByRole('menuitem')).toHaveText(['Edit…', 'Move this meeting…', 'Change from here on…', 'Cancel meeting', 'Delete…'])
    await shotAsIs(page, '13i-menu-upcoming')
    await page.keyboard.press('Escape')

    await row(page, 'Past — can be cancelled').getByRole('button', { name: 'Meeting actions' }).click()
    const items = page.getByRole('menuitem').filter({ visible: true })
    await expect(items).toHaveText([/Cancel meeting/, /Delete\s*Not available after the meeting date/])
    await expect(items.nth(1)).toBeDisabled()
    await shotAsIs(page, '13i-menu-past')
  })

  test('cancels one date of a repeating meeting with a reason (S3)', async ({ page }) => {
    const writes = []
    await gotoView(page, { writes })
    await row(page, 'Repeats every Thursday').getByRole('button', { name: 'Meeting actions' }).click()
    await page.getByRole('menuitem', { name: 'Cancel meeting' }).click()
    const dialog = page.getByRole('dialog', { name: 'Cancel this meeting?' })
    await dialog.getByLabel('Reason').fill('Typhoon signal 2')
    await dialog.getByRole('button', { name: 'Cancel meeting' }).click()
    await expect(dialog).toBeHidden()
    const upsert = writes.find(w => w.table === 'events')
    expect(upsert.body).toMatchObject({ series_id: 'ser1', occurrence_date: '2026-08-06', status: 'cancelled', cancel_reason: 'Typhoon signal 2' })
  })

  test('moves one date of a repeating meeting', async ({ page }) => {
    const writes = []
    await gotoView(page, { writes })
    await row(page, 'Repeats every Thursday').getByRole('button', { name: 'Meeting actions' }).click()
    await page.getByRole('menuitem', { name: 'Move this meeting…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Move this meeting' })
    await dialog.getByLabel('Date').fill('2026-08-07')
    await dialog.getByRole('button', { name: 'Move meeting' }).click()
    await expect(dialog).toBeHidden()
    const upsert = writes.find(w => w.table === 'events')
    expect(upsert.body).toMatchObject({ series_id: 'ser1', occurrence_date: '2026-08-06', starts_at: '2026-08-07T11:30:00.000Z', status: 'published' })
  })

  test('deletes a whole repeating meeting after asking which dates', async ({ page }) => {
    const rpcCalls = []
    await gotoView(page, { rpcCalls })
    await row(page, 'Repeats every Thursday').getByRole('button', { name: 'Meeting actions' }).click()
    await page.getByRole('menuitem', { name: 'Delete…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Delete this meeting?' })
    await expect(dialog.getByRole('radio')).toHaveCount(3)
    await dialog.getByRole('radio', { name: 'The whole series' }).click()
    await dialog.getByRole('button', { name: 'Delete' }).click()
    await expect(dialog).toBeHidden()
    expect(rpcCalls).toEqual([['delete_event_series', { p_series: 'ser1' }]])
  })

  test('deletes a one-off without asking about dates', async ({ page }) => {
    const writes = []
    await gotoView(page, { writes })
    await row(page, 'Fellowship dinner').getByRole('button', { name: 'Meeting actions' }).click()
    await page.getByRole('menuitem', { name: 'Delete…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Delete this meeting?' })
    await expect(dialog.getByRole('radio')).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Delete' }).click()
    await expect(dialog).toBeHidden()
    expect(writes.find(w => w.method === 'DELETE' && w.table === 'events').url).toContain('id=eq.ev-dinner')
  })

  test('edits one date, or every date from here on', async ({ page }) => {
    const writes = []
    const rpcCalls = []
    await gotoView(page, { writes, rpcCalls })
    await row(page, 'Repeats every Thursday').getByRole('button', { name: 'Meeting actions' }).click()
    await page.getByRole('menuitem', { name: 'Edit…' }).click()
    let dialog = page.getByRole('dialog', { name: 'Edit this meeting' })
    await expect(dialog.getByLabel('Title')).toHaveValue('Weekly D-Group night')
    await dialog.getByLabel('Location').fill("Carla's home")
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toBeHidden()
    expect(writes.find(w => w.table === 'events').body).toMatchObject({ series_id: 'ser1', occurrence_date: '2026-08-06', location: "Carla's home" })

    await row(page, 'Repeats every Thursday').getByRole('button', { name: 'Meeting actions' }).click()
    await page.getByRole('menuitem', { name: 'Change from here on…' }).click()
    dialog = page.getByRole('dialog', { name: 'Change from here on' })
    await dialog.getByLabel('Location').fill("Carla's home")
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toBeHidden()
    expect(rpcCalls[0][0]).toBe('split_event_series')
    expect(rpcCalls[0][1]).toMatchObject({ p_series: 'ser1', p_occurrence: '2026-08-06', p_starts: '2026-08-06' })
    expect(rpcCalls[0][1].p_new).toMatchObject({ location: "Carla's home", kind: 'group_meeting', status: 'published' })
  })

  test('sits right after This week on a phone (S4)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await gotoView(page)
    // Where it shows on screen, not where it sits in the page source.
    const top = async name => (await page.getByRole('heading', { name, exact: true }).boundingBox()).y
    const headings = ['This week', 'Group meetings', 'Discipleship progress']
    const ys = []
    for (const h of headings) ys.push(await top(h))
    expect(ys).toEqual([...ys].sort((a, b) => a - b))
    await shot(page, '13g-phone')
  })
})

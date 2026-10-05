import { test, expect } from '@playwright/test'
import { baseRpc, CHURCH, SUPERADMIN_USER } from './support/scenario.js'
import { installSupabaseMock } from './support/mockSupabase.js'
import { seedSession } from './support/session.js'

// Changing one date of a repeating event (#105). Whether a date is past, how much attendance it
// carries, and whether it is locked come from the database (event_edit_state) — mocked here.

const series = {
  id: 'series-1', church_id: CHURCH.id, title: 'Sunday Service', kind: 'service', status: 'published',
  location: 'Main Hall', description: null, run_by: null, projected_budget: null,
  cadence: 'weekly', interval_n: 1, anchor: null, weekday: 0,
  week_of_month: null, day_of_month: null, weekday2: null, week_of_month2: null, day_of_month2: null,
  time_start: '08:00:00', time_end: '10:00:00', starts_on: '2026-01-04', ends_on: null,
  count_n: null, created_at: '2026-01-01T00:00:00Z', created_by: null,
  updated_at: null, published_at: '2026-01-01T00:00:00Z', deleted_at: null,
}

// A saved row for 27 Sep (the date has attendance, so it was saved).
const savedDate = {
  id: 'ex-1', church_id: CHURCH.id, title: 'Sunday Service', kind: 'service', status: 'published',
  starts_at: '2026-09-27T00:00:00Z', ends_at: '2026-09-27T02:00:00Z', location: 'Main Hall',
  description: null, run_by: null, projected_budget: null, cancel_reason: null,
  series_id: 'series-1', occurrence_date: '2026-09-27',
}

async function open (page, { state, events = [savedDate], writes = [] }) {
  await seedSession(page, SUPERADMIN_USER)
  await installSupabaseMock(page, {
    user: SUPERADMIN_USER,
    rpc: { ...baseRpc(), event_edit_state: state },
    tables: { events, event_series: [series], expenses: [], collections: [] },
    onWrite: ({ method, body }) => { writes.push({ method, body }); return Array.isArray(body) ? body : [body] },
  })
}

test('a past date with 11 or more records is locked', async ({ page }) => {
  await open(page, { state: { is_past: true, current_attendance: 11, total_attendance: 11, locked: true } })
  await page.goto('/dashboard/events/new?series=series-1&date=2026-09-27')

  await expect(page.getByText(/has 11 or more attendance records, so it can.t be changed/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save this change' })).toBeDisabled()
})

test('a past date that is not locked can be changed on its own only', async ({ page }) => {
  await open(page, { state: { is_past: true, current_attendance: 4, total_attendance: 4, locked: false } })
  await page.goto('/dashboard/events/new?series=series-1&date=2026-09-27')

  await expect(page.getByText(/You can still change this date on its own/)).toBeVisible()
  await expect(page.getByText('This change is for…')).toHaveCount(0)
  await expect(page.getByText('This affects one date of a repeating event.', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save this change' })).toBeEnabled()
})

test('moving a date with attendance to another day asks first, then saves', async ({ page }) => {
  const writes = []
  await open(page, { state: { is_past: true, current_attendance: 4, total_attendance: 4, locked: false }, writes })
  await page.goto('/dashboard/events/new?series=series-1&date=2026-09-27')
  await expect(page.getByRole('button', { name: 'Save this change' })).toBeEnabled()

  await page.getByLabel('Starts on').fill('2026-09-28')
  await page.getByRole('button', { name: 'Save this change' }).click()

  await expect(page.getByText('Move this date to another day?')).toBeVisible()
  await expect(page.getByText(/kept as history for the old date/)).toBeVisible()
  expect(writes).toHaveLength(0)

  await page.getByRole('button', { name: 'Move it' }).click()
  await expect(page.getByText('This date updated')).toBeVisible()
  expect(writes.length).toBeGreaterThan(0)
})

test('a time-only change on the same day saves without the attendance warning', async ({ page }) => {
  const writes = []
  await open(page, { state: { is_past: true, current_attendance: 4, total_attendance: 4, locked: false }, writes })
  await page.goto('/dashboard/events/new?series=series-1&date=2026-09-27')
  await expect(page.getByRole('button', { name: 'Save this change' })).toBeEnabled()

  await page.getByLabel('Starts', { exact: true }).fill('09:00')
  await page.getByRole('button', { name: 'Save this change' }).click()

  await expect(page.getByText('This date updated')).toBeVisible()
  await expect(page.getByText('Move this date to another day?')).toHaveCount(0)
})

test('the detail menu: an upcoming date can be changed or cancelled, a past one only changed', async ({ page }) => {
  let past = false
  await open(page, {
    events: [],
    state: () => ({ is_past: past, current_attendance: 0, total_attendance: 0, locked: false }),
  })
  await page.goto('/dashboard/events/cogon/2026-10-11-sunday-service')
  await expect(page.getByRole('heading', { name: 'Sunday Service', level: 1 })).toBeVisible()
  await page.getByRole('button', { name: /more|actions/i }).first().click()
  await expect(page.getByText('Change this date')).toBeVisible()
  await expect(page.getByText('Cancel this date')).toBeVisible()

  past = true
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Sunday Service', level: 1 })).toBeVisible()
  await page.getByRole('button', { name: /more|actions/i }).first().click()
  await expect(page.getByText('Change this date')).toBeVisible()
  await expect(page.getByText('Cancel this date')).toHaveCount(0)
})

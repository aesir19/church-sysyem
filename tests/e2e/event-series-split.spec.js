import { test, expect } from '@playwright/test'
import { baseRpc, CHURCH, SUPERADMIN_USER } from './support/scenario.js'
import { installSupabaseMock } from './support/mockSupabase.js'
import { seedSession } from './support/session.js'

// "This date and the ones after it" (#103 bug 2, #105): one database call (split_event_series,
// mocked here) with a one-time key. The date being changed lands on exactly the day picked (the
// database moves it). The OTHER planned dates — listed by the database (preview_split_event_series)
// — stay as they are unless the quiet "Also move already-planned future dates" box is ticked,
// which asks first.

const series = {
  id: 'series-1', church_id: CHURCH.id, title: 'Sunday Service', kind: 'service', status: 'published',
  location: 'Main Hall', description: null, run_by: null, projected_budget: null,
  cadence: 'weekly', interval_n: 1, anchor: null, weekday: 0,
  week_of_month: null, day_of_month: null, weekday2: null, week_of_month2: null, day_of_month2: null,
  time_start: '08:00:00', time_end: '10:00:00', starts_on: '2026-01-04', ends_on: null,
  count_n: null, created_at: '2026-01-01T00:00:00Z', created_by: null,
  updated_at: null, published_at: '2026-01-01T00:00:00Z', deleted_at: null,
}

// Two saved later dates: a hand-edited Sunday and a cancelled one.
const planned = [
  { id: 'ex-1', occurrence_date: '2026-10-18', actual_date: '2026-10-18', status: 'published' },
  { id: 'ex-2', occurrence_date: '2026-10-25', actual_date: '2026-10-25', status: 'cancelled' },
]

async function open (page, { seriesRow = series, plannedRows = planned, slotRow = null, split = () => ({ already_done: false, new_series_id: 'series-2', moved: 0, standalone: 0 }) } = {}) {
  const calls = []
  await seedSession(page, SUPERADMIN_USER)
  await installSupabaseMock(page, {
    user: SUPERADMIN_USER,
    rpc: {
      ...baseRpc(),
      event_edit_state: { is_past: false, current_attendance: 0, total_attendance: 0, locked: false },
      split_event_series: (ctx) => { calls.push(ctx.body); return split(calls.length) },
      // The database lists the planned dates — including the date being changed, if saved.
      preview_split_event_series: slotRow
        ? [{ id: slotRow.id, occurrence_date: '2026-10-11', actual_date: '2026-10-11', status: 'published' }, ...plannedRows]
        : plannedRows,
    },
    tables: {
      // The one-date read asks for its slot.
      events: slotRow ? [slotRow] : [],
      event_series: [seriesRow], expenses: [], collections: [],
    },
  })
  await page.goto('/dashboard/events/new?series=series-1&date=2026-10-11')
  await expect(page.getByRole('button', { name: 'Save this change' })).toBeEnabled()
  return calls
}

const chooseAfter = (page) => page.getByText('This date and the ones after it.').click()
const moveBox = (page) => page.getByLabel(/Also move already-planned future dates/)

test('with no planned dates the option is hidden and the split is one call', async ({ page }) => {
  const calls = await open(page, { plannedRows: [] })
  await chooseAfter(page)
  await expect(moveBox(page)).toHaveCount(0)

  await page.getByRole('button', { name: 'Save this change' }).click()
  await expect(page.getByText('This date and the ones after were updated')).toBeVisible()
  expect(calls).toHaveLength(1)
  expect(calls[0]).toMatchObject({ p_series: 'series-1', p_occurrence: '2026-10-11', p_starts: '2026-10-11', p_moves: null })
  expect(calls[0].p_key).toMatch(/^[0-9a-f-]{36}$/)
})

test('planned dates stay as they are unless the box is ticked', async ({ page }) => {
  const calls = await open(page)
  await chooseAfter(page)
  await expect(moveBox(page)).toBeVisible()
  await expect(moveBox(page)).not.toBeChecked()
  await expect(page.getByText(/2 later dates have already been planned, changed or cancelled/)).toBeVisible()

  await page.getByRole('button', { name: 'Save this change' }).click()
  await expect(page.getByText('This date and the ones after were updated')).toBeVisible()
  await expect(page.getByText('Move the planned dates too?')).toHaveCount(0)
  expect(calls[0].p_moves).toBeNull()
})

test('ticking the box asks first, then moves each to the new day in the same week', async ({ page }) => {
  const calls = await open(page)
  // Sundays become Tuesdays from this date.
  await page.getByLabel('Starts on').fill('2026-10-13')
  await chooseAfter(page)
  await moveBox(page).check()
  await expect(moveBox(page)).toBeChecked()

  await page.getByRole('button', { name: 'Save this change' }).click()
  await expect(page.getByText('Move the planned dates too?')).toBeVisible()
  await expect(page.getByText(/Cancelled dates stay cancelled/)).toBeVisible()
  expect(calls).toHaveLength(0)

  await page.getByRole('button', { name: 'Move them' }).click()
  await expect(page.getByText('This date and the ones after were updated')).toBeVisible()
  expect(calls[0]).toMatchObject({ p_occurrence: '2026-10-11', p_starts: '2026-10-13' })
  expect(calls[0].p_moves).toEqual([
    { event_id: 'ex-1', to_date: '2026-10-20' },
    { event_id: 'ex-2', to_date: '2026-10-27' },
  ])
})

test('a retry after a failed save uses the same one-time key', async ({ page }) => {
  const calls = await open(page, {
    plannedRows: [],
    split: (n) => (n === 1 ? null : { already_done: true, new_series_id: 'series-2' }),
  })
  await chooseAfter(page)
  await page.getByRole('button', { name: 'Save this change' }).click()
  await expect(page.getByText('That repeating event could not be saved.')).toBeVisible()

  await page.getByRole('button', { name: 'Save this change' }).click()
  await expect(page.getByText('This date and the ones after were updated')).toBeVisible()
  expect(calls).toHaveLength(2)
  expect(calls[1].p_key).toBe(calls[0].p_key)
})

test('a deleted repeating event cannot be changed from a typed address', async ({ page }) => {
  await seedSession(page, SUPERADMIN_USER)
  await installSupabaseMock(page, {
    user: SUPERADMIN_USER,
    rpc: { ...baseRpc(), event_edit_state: { is_past: false, current_attendance: 0, total_attendance: 0, locked: false } },
    tables: { events: [], event_series: [{ ...series, deleted_at: '2026-10-01T00:00:00Z' }], expenses: [], collections: [] },
  })
  await page.goto('/dashboard/events/new?series=series-1')
  await expect(page.getByText('This repeating event was deleted and can’t be changed.')).toBeVisible()
  await expect(page.getByRole('button', { name: /Save changes/ })).toBeDisabled()
})

// The date being changed already has a saved row (it was edited before).
const savedSlot = {
  id: 'ex-0', church_id: CHURCH.id, title: 'Sunday Service (old)', kind: 'service', status: 'published',
  starts_at: '2026-10-11T00:00:00Z', ends_at: '2026-10-11T02:00:00Z', location: 'Main Hall',
  description: null, run_by: null, projected_budget: null, cancel_reason: null,
  series_id: 'series-1', occurrence_date: '2026-10-11',
}

test('the date being changed is not counted among the planned dates the box would move', async ({ page }) => {
  const calls = await open(page, { slotRow: savedSlot })
  await page.getByLabel('Starts on').fill('2026-10-13')
  await chooseAfter(page)
  await expect(page.getByText(/2 later dates have already been planned/)).toBeVisible()

  await page.getByRole('button', { name: 'Save this change' }).click()
  await expect(page.getByText('This date and the ones after were updated')).toBeVisible()
  // The database moves the date being changed itself; the browser sends only its new day.
  expect(calls[0]).toMatchObject({ p_occurrence: '2026-10-11', p_starts: '2026-10-13', p_moves: null })
})

test('the new day is exactly the one picked — earlier, or later in the gap before the next date', async ({ page }) => {
  const calls = await open(page, { plannedRows: [] })
  await page.getByLabel('Starts on').fill('2026-10-10')
  await chooseAfter(page)
  await page.getByRole('button', { name: 'Save this change' }).click()
  await expect(page.getByText('This date and the ones after were updated')).toBeVisible()
  expect(calls[0]).toMatchObject({ p_occurrence: '2026-10-11', p_starts: '2026-10-10' })

  const later = await open(page, { plannedRows: [] })
  await page.getByLabel('Starts on').fill('2026-10-17')
  await chooseAfter(page)
  await page.getByRole('button', { name: 'Save this change' }).click()
  await expect(page.getByText('This date and the ones after were updated')).toBeVisible()
  expect(later[0]).toMatchObject({ p_occurrence: '2026-10-11', p_starts: '2026-10-17' })
})

test('moving the date later past the next date is refused', async ({ page }) => {
  const calls = await open(page, { plannedRows: [] })
  await page.getByLabel('Starts on').fill('2026-10-19')
  await chooseAfter(page)
  await page.getByRole('button', { name: 'Save this change' }).click()

  await expect(page.getByText(/can.t be on or after the next date \(18 October\)/)).toBeVisible()
  expect(calls).toHaveLength(0)
})

test('a "repeat 10 times" schedule split at its 6th date gets only the 5 left', async ({ page }) => {
  // Ten Sundays from 6 Sep: 6, 13, 20, 27 Sep and 4 Oct come before 11 Oct.
  const calls = await open(page, { plannedRows: [], seriesRow: { ...series, starts_on: '2026-09-06', count_n: 10 } })
  await chooseAfter(page)
  await page.getByRole('button', { name: 'Save this change' }).click()
  await expect(page.getByText('This date and the ones after were updated')).toBeVisible()
  expect(calls[0].p_new.count_n).toBe(5)
})

test('changing the form after a failed save uses a fresh key', async ({ page }) => {
  const calls = await open(page, { plannedRows: [], split: (n) => (n === 1 ? null : { already_done: false, new_series_id: 'series-2' }) })
  await chooseAfter(page)
  await page.getByRole('button', { name: 'Save this change' }).click()
  await expect(page.getByText('That repeating event could not be saved.')).toBeVisible()

  await page.getByLabel('Starts', { exact: true }).fill('09:00')
  await page.getByRole('button', { name: 'Save this change' }).click()
  await expect(page.getByText('This date and the ones after were updated')).toBeVisible()
  expect(calls[1].p_key).not.toBe(calls[0].p_key)
})

test('moving the date back past the previous date is refused', async ({ page }) => {
  const calls = await open(page, { plannedRows: [] })
  await page.getByLabel('Starts on').fill('2026-10-03')
  await chooseAfter(page)
  await page.getByRole('button', { name: 'Save this change' }).click()

  await expect(page.getByText(/can.t be on or before the previous date \(4 October\)/)).toBeVisible()
  expect(calls).toHaveLength(0)
})

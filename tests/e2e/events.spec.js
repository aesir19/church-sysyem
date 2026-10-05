import { test, expect } from '@playwright/test'
import { authedGoto, baseRpc, CHURCH, SUPERADMIN_USER } from './support/scenario.js'
import { installSupabaseMock } from './support/mockSupabase.js'
import { seedSession } from './support/session.js'

const row = (id, title, status, startsAt) => ({
  id,
  church_id: CHURCH.id,
  title,
  kind: 'outreach',
  status,
  starts_at: startsAt,
  ends_at: null,
  location: null,
  description: null,
  run_by: null,
  projected_budget: null,
  cancel_reason: null,
  series_id: null,
  occurrence_date: null,
})

test('a late tab response cannot replace the selected tab', async ({ page }) => {
  const upcoming = row('upcoming-1', 'Upcoming outreach', 'published', '2099-09-10T09:00:00Z')
  const past = row('past-1', 'Past outreach', 'published', '2020-01-01T09:00:00Z')
  const draft = row('draft-1', 'Draft outreach', 'draft', '2099-09-12T09:00:00Z')

  await authedGoto(page, '/dashboard/events', {
    tables: {
      events: async ({ url }) => {
        const status = url.searchParams.get('status') || ''
        const startsAt = url.searchParams.get('starts_at') || ''
        if (status.startsWith('eq.draft')) return [draft]
        if (startsAt.startsWith('lt.')) {
          await new Promise((resolve) => setTimeout(resolve, 500))
          return [past]
        }
        return [upcoming]
      },
    },
  })

  await expect(page.getByText('Upcoming outreach')).toBeVisible()
  await page.getByRole('tab', { name: 'Past' }).click()
  await page.getByRole('tab', { name: 'Drafts' }).click()

  await expect(page.getByText('Draft outreach')).toBeVisible()
  await page.waitForTimeout(600)
  await expect(page.getByText('Draft outreach')).toBeVisible()
  await expect(page.getByText('Past outreach')).toHaveCount(0)
  await expect(page.getByRole('tab', { name: 'Drafts' })).toHaveAttribute('aria-selected', 'true')
})

test('only a successful no-row result can use virtual fallback or not-found', async ({ page }) => {
  const sundaySeries = {
    id: 'series-1', church_id: CHURCH.id, title: 'Sunday Service', kind: 'service', status: 'published',
    location: 'Main Hall', description: null, run_by: null, projected_budget: null,
    cadence: 'weekly', interval_n: 1, anchor: null, weekday: 0,
    week_of_month: null, day_of_month: null, weekday2: null, week_of_month2: null, day_of_month2: null,
    time_start: '08:00:00', time_end: '10:00:00', starts_on: '2026-01-04', ends_on: null,
    count_n: null, created_at: '2026-01-01T00:00:00Z', created_by: null,
    updated_at: null, published_at: '2026-01-01T00:00:00Z',
  }
  await seedSession(page, SUPERADMIN_USER)
  await installSupabaseMock(page, {
    user: SUPERADMIN_USER,
    rpc: baseRpc(),
    tables: { events: [], event_series: [sundaySeries] },
  })
  await page.goto('/dashboard/events/cogon/2026-09-13-sunday-service')
  await expect(page.getByRole('heading', { name: 'Sunday Service', level: 1 })).toBeVisible()
  await expect(page.getByText(/This is one date of a repeating event/)).toBeVisible()

  await page.goto('/dashboard/events/cogon/2026-09-13-missing-event')
  await expect(page.getByText('That event could not be found.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0)
})

test('a failed event read shows Retry and recovers', async ({ page }) => {
  const event = row('event-1', 'Recoverable outreach', 'published', '2026-09-13T09:00:00Z')
  let attempts = 0

  await seedSession(page, SUPERADMIN_USER)
  await installSupabaseMock(page, {
    user: SUPERADMIN_USER,
    rpc: baseRpc(),
    tables: { events: [event], expenses: [], collections: [] },
    readErrors: {
      events: () => (++attempts === 1 ? 'Temporary event failure' : null),
    },
  })
  await page.goto('/dashboard/events/cogon/2026-09-13-recoverable-outreach')

  await expect(page.getByText('Could not load this event. Please try again.')).toBeVisible()
  await page.getByRole('button', { name: 'Retry' }).click()
  await expect(page.getByRole('heading', { name: 'Recoverable outreach', level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0)
})

test('failed series and linked-record reads are visible page errors', async ({ page }) => {
  const occurrence = {
    ...row('event-2', 'Series outreach', 'published', '2026-09-13T09:00:00Z'),
    series_id: 'series-2',
    occurrence_date: '2026-09-13',
  }

  await seedSession(page, SUPERADMIN_USER)
  await installSupabaseMock(page, {
    user: SUPERADMIN_USER,
    rpc: baseRpc(),
    tables: { events: [occurrence], event_series: [], expenses: [], collections: [] },
    readErrors: { event_series: 'Temporary series failure' },
  })
  await page.goto('/dashboard/events/cogon/2026-09-13-series-outreach')
  await expect(page.getByText('Could not load the repeating events. Please try again.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible()

  await page.unroute('**/rest/v1/**')
  await installSupabaseMock(page, {
    user: SUPERADMIN_USER,
    rpc: baseRpc(),
    tables: { events: [{ ...occurrence, series_id: null, occurrence_date: null }], expenses: [], collections: [] },
    readErrors: { expenses: 'Temporary linked-record failure' },
  })
  await page.reload()
  await expect(page.getByText('Could not load this event. Please try again.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible()
})

test('deleting a repeating event is one call and says what is kept', async ({ page }) => {
  const sundaySeries = {
    id: 'series-9', church_id: CHURCH.id, title: 'Sunday Service', kind: 'service', status: 'published',
    location: 'Main Hall', description: null, run_by: null, projected_budget: null,
    cadence: 'weekly', interval_n: 1, anchor: null, weekday: 0,
    week_of_month: null, day_of_month: null, weekday2: null, week_of_month2: null, day_of_month2: null,
    time_start: '08:00:00', time_end: '10:00:00', starts_on: '2026-01-04', ends_on: null,
    count_n: null, created_at: '2026-01-01T00:00:00Z', created_by: null,
    updated_at: null, published_at: '2026-01-01T00:00:00Z', deleted_at: null,
  }
  const calls = []
  await seedSession(page, SUPERADMIN_USER)
  await installSupabaseMock(page, {
    user: SUPERADMIN_USER,
    rpc: {
      ...baseRpc(),
      preview_delete_event_series: ({ body }) => { calls.push(['preview', body]); return { kept: 2, removed: 5 } },
      delete_event_series: ({ body }) => { calls.push(['delete', body]); return { already_deleted: false, kept: 2, removed: 5 } },
    },
    tables: { events: [], event_series: [sundaySeries], expenses: [], collections: [] },
  })
  await page.goto('/dashboard/events/cogon/2026-10-11-sunday-service')
  await expect(page.getByRole('heading', { name: 'Sunday Service', level: 1 })).toBeVisible()

  await page.getByRole('button', { name: /more|actions/i }).first().click()
  await page.getByText('Delete the whole series').click()

  await expect(page.getByText('Past dates stay on the calendar.').last()).toBeVisible()
  await expect(page.getByText(/2.*upcoming dates/)).toBeVisible()
  await expect(page.getByText(/will be kept as separate events/)).toBeVisible()

  const confirm = page.getByRole('button', { name: 'Delete the series' })
  await expect(confirm).toBeDisabled()
  await page.getByPlaceholder('Sunday Service').fill('Sunday Service')
  await confirm.click()

  await expect(page.getByText('Repeating event deleted')).toBeVisible()
  expect(calls.filter(([kind]) => kind === 'delete')).toEqual([['delete', { p_series: 'series-9' }]])
})

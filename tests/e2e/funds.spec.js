import { test, expect } from '@playwright/test'
import { authedGoto, CHURCH } from './support/scenario.js'

// Church funds — the one screen that computes rather than records. No writes, so
// the coverage is the report rendering and its two interactions: the collapsible
// breakdowns and the month stepper.

const TODAY = new Date().toISOString().slice(0, 10)

const SERVICE_TOTALS = [
  { service_date: '2026-07-06', tithes: 1000, offering: 500, expenses: 200, from_church: CHURCH.id },
]

const COLLECTIONS = [
  { id: 'c-1', from: 'm-ferdi', amount: 1000, is_tithes: true, collectedOn: TODAY, members: { first_name: 'Ferdinand', last_name: 'Aguilar' } },
  { id: 'c-2', from: null, amount: 300, is_tithes: false, collectedOn: TODAY, members: null },
]

const EXPENSES = [{ spent_on: TODAY, description: 'Electricity', amount: 200 }]

async function gotoFunds(page) {
  await authedGoto(page, '/dashboard/funds', {
    tables: {
      collectives_service_totals: SERVICE_TOTALS,
      collections: COLLECTIONS,
      expenses: EXPENSES,
    },
  })
  await expect(page.getByRole('heading', { name: 'Church funds', exact: true })).toBeVisible()
}

test.describe('Church funds', () => {
  test.beforeEach(async ({ page }) => {
    await gotoFunds(page)
  })

  test('renders the report with KPIs and contributors', async ({ page }) => {
    await expect(page.getByText('Closing balance')).toBeVisible()
    await expect(page.getByText('Total funds').first()).toBeVisible()
    // Contributor identity is finance-staff detail (canWriteFinance) — SuperAdmin sees it.
    await expect(page.getByRole('rowheader', { name: 'Ferdinand Aguilar' })).toBeVisible()
  })

  test('collapses the weekly breakdown', async ({ page }) => {
    const toggle = page.locator('button[aria-controls="weekly-breakdown-content"]')
    await expect(toggle).toHaveText(/Collapse/)
    await toggle.click()
    await expect(toggle).toHaveText(/Expand/)
    await expect(page.locator('#weekly-breakdown-content')).toBeHidden()
  })

  test('the month stepper changes the report month', async ({ page }) => {
    const label = page.locator('.fun__month-label')
    const before = (await label.textContent())?.trim()
    await page.getByRole('button', { name: 'Previous month' }).click()
    await expect(label).not.toHaveText(before)
  })
})

import { test, expect } from '@playwright/test'
import { authedGoto } from './support/scenario.js'

// Expenses — record-only by design (0009 grants INSERT but no UPDATE/DELETE, so
// there is no row dialog). Covers the form write and the description chips that
// reuse prior wording.

const TODAY = new Date().toISOString().slice(0, 10)
const NOW_ISO = new Date().toISOString()

const EXPENSES = [
  { id: 'e-1', spent_on: TODAY, description: 'Electricity', amount: 2000, notes: 'Meralco', created_at: NOW_ISO },
]

async function gotoExpenses(page) {
  await authedGoto(page, '/dashboard/expenses', {
    tables: {
      expenses: EXPENSES,
      collections: [{ amount: 5000 }],
    },
  })
  await expect(page.getByRole('heading', { name: 'Record expense' })).toBeVisible()
}

test.describe('Expenses', () => {
  test.beforeEach(async ({ page }) => {
    await gotoExpenses(page)
  })

  test('renders the form and the month entries', async ({ page }) => {
    await expect(page.getByText('Spent this month')).toBeVisible()
    await expect(page.locator('.exp__desc', { hasText: 'Electricity' })).toBeVisible()
  })

  test('records an expense', async ({ page }) => {
    await page.getByRole('spinbutton', { name: 'Amount' }).fill('1500')
    await page.getByRole('textbox', { name: 'Description' }).fill('Snacks')
    await page.getByRole('button', { name: 'Save expense' }).click()

    await expect(page.getByText('Expense recorded.')).toBeVisible()
    await expect(page.locator('.exp__desc', { hasText: 'Snacks' })).toBeVisible()
  })

  test('reuses a prior description via a chip', async ({ page }) => {
    // The chip is a button; clicking it fills the free-text Description field.
    await page.getByRole('button', { name: 'Electricity' }).click()
    await expect(page.getByRole('textbox', { name: 'Description' })).toHaveValue('Electricity')
  })
})

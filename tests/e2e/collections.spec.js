import { test, expect } from '@playwright/test'
import { authedGoto } from './support/scenario.js'

// Collections — the contribution form (the screen's only write), the inline
// member autocomplete, and the entry-detail correct/delete dialog. canWriteFinance
// gates the route; SuperAdmin has it.

const TODAY = new Date().toISOString().slice(0, 10)
const NOW_ISO = new Date().toISOString()

const DIRECTORY = [
  { member_id: 'm-ferdi', first_name: 'Ferdinand', last_name: 'Aguilar' },
  { member_id: 'm-maria', first_name: 'Maria', last_name: 'Abad' },
]

// One editable entry (created just now → inside the 3-hour correction window),
// dated today so it falls in the current month the screen opens on.
const COLLECTIONS = [
  {
    id: 'c-1', from: 'm-ferdi', amount: 1000, is_tithes: true,
    collectedOn: TODAY, created_at: NOW_ISO,
    members: { first_name: 'Ferdinand', middle_name: null, last_name: 'Aguilar' },
  },
]

async function gotoCollections(page) {
  await authedGoto(page, '/dashboard/finance/collections', {
    rpc: { directory_search: DIRECTORY },
    tables: { collections: COLLECTIONS },
  })
  await expect(page.getByRole('heading', { name: 'New contribution' })).toBeVisible()
}

test.describe('Collections', () => {
  test.beforeEach(async ({ page }) => {
    await gotoCollections(page)
  })

  test('renders the form and the month summary', async ({ page }) => {
    await expect(page.getByText('Recorded this month')).toBeVisible()
    await expect(page.getByRole('button', { name: /Ferdinand Aguilar/ })).toBeVisible()
  })

  test('records an anonymous contribution', async ({ page }) => {
    await page.getByRole('spinbutton', { name: 'Amount' }).fill('500')
    await page.getByRole('checkbox', { name: /Anonymous/ }).check()
    await page.getByRole('button', { name: 'Save contribution' }).click()

    await expect(page.getByText('Contribution recorded.')).toBeVisible()
  })

  test('records a contribution for a member via the autocomplete', async ({ page }) => {
    await page.getByRole('spinbutton', { name: 'Amount' }).fill('750')
    await page.locator('#contribution-member').fill('Maria')
    await page.locator('#contribution-member-option-0').click()
    await expect(page.locator('.mac__note')).toHaveText(/Selected: Maria Abad/)
    await page.getByRole('button', { name: 'Save contribution' }).click()

    await expect(page.getByText('Contribution recorded.')).toBeVisible()
  })

  test('opens an entry and deletes it', async ({ page }) => {
    await page.getByRole('button', { name: /Ferdinand Aguilar/ }).click()
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await page.getByRole('button', { name: 'Delete entry' }).click()

    await expect(page.getByText('Entry deleted.')).toBeVisible()
    await expect(page.getByRole('button', { name: /Ferdinand Aguilar/ })).toHaveCount(0)
  })
})

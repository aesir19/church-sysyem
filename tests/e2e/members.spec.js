import { test, expect } from '@playwright/test'
import { authedGoto, CHURCH } from './support/scenario.js'

// Members — the roll, its PII detail rail, and the add/archive dialogs. The
// detail rail is this screen's core interaction: a row click fills a 360px panel
// (canSeeMemberDetail), which only a wide viewport renders — Desktop Chrome is
// 1280px, above the 1180px breakpoint, so the rail is in play here.

const MEMBERS = [
  {
    id: 'm-1', first_name: 'Cora', middle_name: null, last_name: 'Aquino',
    birthdate: '1990-05-05', gender: 'Female', address: 'Blk 1 Lot 2, Cogon',
    contact_number: '09171234567', email: null, date_joined: '2024-01-01',
    member_of: CHURCH.id, marital_status: 'Single', wedding_anniversarry: null,
    facebook_link: null, is_one_to_one_completed: true,
    is_turning_point_completed: false, is_baptized: true,
    has_submitted_membership_form: true,
  },
  {
    id: 'm-2', first_name: 'Ben', middle_name: null, last_name: 'Santos',
    birthdate: '1985-09-12', gender: 'Male', address: 'Purok 3, Cogon',
    contact_number: '09179876543', email: null, date_joined: '2023-06-01',
    member_of: CHURCH.id, marital_status: 'Married', wedding_anniversarry: '2010-02-14',
    facebook_link: null, is_one_to_one_completed: false,
    is_turning_point_completed: false, is_baptized: false,
    has_submitted_membership_form: false,
  },
]

// A roster row's visible name, scoped past the Avatar's sr-only copy.
function memberRow(page, name) {
  return page.locator('.tbl__row', { hasText: name })
}

async function gotoMembers(page) {
  await authedGoto(page, '/dashboard/members', {
    tables: { members: MEMBERS },
  })
  await expect(page.locator('.who__name', { hasText: 'Cora Aquino' })).toBeVisible()
}

test.describe('Members', () => {
  test.beforeEach(async ({ page }) => {
    await gotoMembers(page)
  })

  test('renders the roll', async ({ page }) => {
    await expect(page.locator('.who__name', { hasText: 'Cora Aquino' })).toBeVisible()
    await expect(page.locator('.who__name', { hasText: 'Ben Santos' })).toBeVisible()
  })

  test('selecting a member opens the detail rail with their record', async ({ page }) => {
    await memberRow(page, 'Cora Aquino').click()
    // The address only appears in the detail panel, not in the table row.
    await expect(page.getByText('Blk 1 Lot 2, Cogon')).toBeVisible()
  })

  test('adds a member', async ({ page }) => {
    await page.getByRole('button', { name: '+ Add member' }).click()
    await expect(page.getByRole('heading', { name: 'Add member' })).toBeVisible()

    // The five required (NOT NULL) fields, all on the default Personal tab.
    await page.getByRole('textbox', { name: 'Last name' }).fill('Dizon')
    await page.getByRole('textbox', { name: 'First name' }).fill('Nina')
    await page.getByLabel('Birthdate').fill('1995-03-03')
    await page.getByLabel('Gender').selectOption('Female')
    await page.getByLabel('Marital status').selectOption('Single')
    await page.getByRole('button', { name: 'Save member' }).click()

    await expect(page.getByText('Member added.')).toBeVisible()
  })

  test('archives a member', async ({ page }) => {
    await memberRow(page, 'Cora Aquino').click()
    await page.getByRole('button', { name: 'Archive', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Archive Cora Aquino?' })).toBeVisible()

    await page.getByRole('button', { name: 'Archive member' }).click()

    await expect(page.getByText('Member archived.')).toBeVisible()
    await expect(memberRow(page, 'Cora Aquino')).toHaveCount(0)
  })
})

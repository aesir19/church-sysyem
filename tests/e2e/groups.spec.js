import { test, expect } from '@playwright/test'
import { authedGoto, CHURCH } from './support/scenario.js'

// Groups — the card wall, the type filter, the create dialog, and click-through
// to a group's page. listGroups fans out over four tables (ministries +
// small_groups, and their two membership tables); the mock answers each.

const MINISTRIES = [{ id: 'min-1', name: 'Youth Ministry', ministry_key: 'youth' }]
const SMALL_GROUPS = [{ id: 'sg-1', name: 'Thursday Group', church_id: CHURCH.id }]

const MINISTRY_MEMBERS = [
  { ministry_id: 'min-1', member_id: 'm-1', members: { first_name: 'Cora', last_name: 'Aquino', member_of: CHURCH.id } },
]
const SMALL_GROUP_MEMBERS = [
  { small_group_id: 'sg-1', member_id: 'm-2', members: { first_name: 'Ben', last_name: 'Santos', member_of: CHURCH.id } },
]

async function gotoGroups(page) {
  await authedGoto(page, '/dashboard/groups', {
    tables: {
      ministries: MINISTRIES,
      small_groups: SMALL_GROUPS,
      ministry_members: MINISTRY_MEMBERS,
      small_group_members: SMALL_GROUP_MEMBERS,
      members: [{ id: 'm-1' }, { id: 'm-2' }, { id: 'm-3' }],
    },
  })
  await expect(page.getByRole('button', { name: /Youth Ministry/ })).toBeVisible()
}

test.describe('Groups', () => {
  test.beforeEach(async ({ page }) => {
    await gotoGroups(page)
  })

  test('renders ministry and small-group cards', async ({ page }) => {
    await expect(page.getByRole('button', { name: /Youth Ministry/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Thursday Group/ })).toBeVisible()
  })

  test('the type filter narrows to small groups', async ({ page }) => {
    await page.getByRole('button', { name: 'Small groups' }).click()
    await expect(page.getByRole('button', { name: /Thursday Group/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Youth Ministry/ })).toHaveCount(0)
  })

  test('creates a small group', async ({ page }) => {
    await page.getByRole('button', { name: '+ New small group' }).click()
    await expect(page.getByRole('heading', { name: 'New small group' })).toBeVisible()

    await page.getByRole('textbox', { name: 'Group name' }).fill('Friday Group')
    await page.getByRole('button', { name: 'Create group' }).click()

    await expect(page.getByText('Small group created.')).toBeVisible()
    await expect(page.getByRole('button', { name: /Friday Group/ })).toBeVisible()
  })

  test('a card opens the group page', async ({ page }) => {
    await page.getByRole('button', { name: /Thursday Group/ }).click()
    await expect(page).toHaveURL(/\/dashboard\/groups\/cogon\/thursday-group/)
  })
})

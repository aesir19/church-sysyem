import { test, expect } from '@playwright/test'
import { authedGoto, CHURCH, SUPERADMIN_PERMS } from './support/scenario.js'

// Per-role visibility — the RBAC rework (ADR-0016/0017). Each test overrides
// get_my_permissions to a narrower role and asserts what that role actually sees:
// the safe directory instead of PII, a nav shorn of out-of-scope items, a
// "no access yet" state for a scopeless account, and the small-group leader's
// journey toggles. The mock is the enforcement stand-in here; RLS is proven
// separately against staging.

// A permissions row for a given role, off the SuperAdmin template so every flag
// is present and only the named ones are true.
function perms(over) {
  return { ...SUPERADMIN_PERMS, role: 'member', is_super_admin: false, ...over }
}

const WELCOME = perms({ is_welcome: true })
const FINANCE = perms({ is_finance: true })
const LEADER = perms({ is_small_group_leader: true })
const SCOPELESS = perms({ role: 'unassigned' })

// directory_search rows carry the safe set only (0028): names, gender, group
// membership and the four journey flags — never birthdate/address/contact.
const DIRECTORY = [
  {
    member_id: 'm-1', first_name: 'Cora', middle_name: 'D', last_name: 'Aquino',
    gender: 'Female', ministries: ['Ushering Ministry'], small_groups: [],
    is_one_to_one_completed: true, is_turning_point_completed: false,
    is_baptized: true, has_submitted_membership_form: false,
  },
  {
    member_id: 'm-2', first_name: 'Ben', middle_name: null, last_name: 'Santos',
    gender: 'Male', ministries: [], small_groups: ['Thursday Group'],
    is_one_to_one_completed: false, is_turning_point_completed: false,
    is_baptized: false, has_submitted_membership_form: false,
  },
]

function navLabel(page, label) {
  return page.locator('.side__label', { hasText: label })
}

test.describe('Members directory mode (a role without member detail)', () => {
  test.beforeEach(async ({ page }) => {
    await authedGoto(page, '/dashboard/members', {
      rpc: { get_my_permissions: WELCOME, directory_search: DIRECTORY },
    })
    await expect(page.locator('.who__name', { hasText: 'Aquino' })).toBeVisible()
  })

  test('shows names, gender and journey — but no PII and no Age column', async ({ page }) => {
    // Name and gender (a safe field) render; gender rides the subline in place of
    // the contact number that full mode would show.
    await expect(page.locator('.who__name', { hasText: 'Aquino' })).toBeVisible()
    await expect(page.getByText('Female').first()).toBeVisible()
    // Journey is visible to this role now.
    await expect(page.locator('.tbl__row').first().locator('[class*="journey"], [class*="track"]')).toBeVisible()
    // The PII column (Age, derived from birthdate) is gone, and there is no
    // permission-refused message.
    await expect(page.getByRole('columnheader', { name: 'Age' })).toHaveCount(0)
    await expect(page.getByText('You do not have permission to view member details.')).toHaveCount(0)
  })
})

test.describe('Nav hides out-of-scope items, per role', () => {
  test('Welcome Team sees Attendance but not the finance items', async ({ page }) => {
    await authedGoto(page, '/dashboard/members', {
      rpc: { get_my_permissions: WELCOME, directory_search: DIRECTORY },
    })
    await expect(navLabel(page, 'Attendance')).toBeVisible()
    await expect(navLabel(page, 'Collections')).toHaveCount(0)
    await expect(navLabel(page, 'Expenses')).toHaveCount(0)
    await expect(navLabel(page, 'Funds')).toHaveCount(0)
  })

  test('Finance sees the finance items but not Attendance', async ({ page }) => {
    await authedGoto(page, '/dashboard/members', {
      rpc: { get_my_permissions: FINANCE, directory_search: DIRECTORY },
    })
    await expect(navLabel(page, 'Collections')).toBeVisible()
    await expect(navLabel(page, 'Funds')).toBeVisible()
    await expect(navLabel(page, 'Attendance')).toHaveCount(0)
  })
})

test.describe('Scopeless account', () => {
  test('gets a "no access yet" state on Members, never the directory', async ({ page }) => {
    await authedGoto(page, '/dashboard/members', {
      // A scopeless account should never even reach directory_search; if it did,
      // returning rows here would prove the app queried when it must not.
      rpc: { get_my_permissions: SCOPELESS, directory_search: DIRECTORY },
    })
    await expect(page.getByText('No access yet')).toBeVisible()
    await expect(page.locator('.who__name')).toHaveCount(0)
    // Finance and Attendance are both out of scope, so both are hidden.
    await expect(navLabel(page, 'Attendance')).toHaveCount(0)
    await expect(navLabel(page, 'Funds')).toHaveCount(0)
  })
})

test.describe('Small-group leader journey toggles', () => {
  test('a leader of the group sees the one-to-one / turning-point toggles', async ({ page }) => {
    await authedGoto(page, '/dashboard/groups/cogon/thursday-group', {
      rpc: {
        get_my_permissions: LEADER,
        // The roster comes through the directory for a non-detail caller; both
        // members belong to Thursday Group so both appear on its roster.
        directory_search: DIRECTORY.map((d) => ({ ...d, small_groups: ['Thursday Group'] })),
        my_led_group_ids: ['sg-1'],
        get_small_group_leader: [],
      },
      tables: {
        ministries: [],
        small_groups: [{ id: 'sg-1', name: 'Thursday Group', church_id: CHURCH.id }],
      },
    })

    await expect(page.getByRole('heading', { name: 'Thursday Group' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Journey' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'One-to-one' }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Turning Point' }).first()).toBeVisible()
  })
})

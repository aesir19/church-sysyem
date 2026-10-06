import { test, expect } from '@playwright/test'
import { authedGoto, CHURCH, SUPERADMIN_PERMS } from './support/scenario.js'

const ANA = {
  id: '09120000-0000-4000-8000-000000000001', first_name: 'Ana', last_name: 'Lucero', member_of: CHURCH.id,
  birthdate: '1992-08-03', date_joined: '2019-01-14', address: 'Example address', contact_number: '09170000000',
  archived_at: '2026-09-12T02:14:00Z', archived_reason: 'Moved away for work.', archived_by: 'Grace Example',
  account_id: 'account-ana', account_email: 'ana@example.test', disabled_at: '2026-09-12T02:14:00Z',
  assignments: [{ key: 'role:member', label: 'Member', kind: 'Role' }, { key: 'ministry:youth', label: 'Youth Ministry', kind: 'Ministry' }, { key: 'group:cell4', label: 'Cell 4 · Tuesday', kind: 'Small group' }],
}

test('opens a searchable read-only archive from Settings', async ({ page }) => {
  await authedGoto(page, '/dashboard/settings/archived-members', {
    rpc: {
      list_archived_members: ({ body }) => ({ rows: !body.p_query || 'ana'.includes(body.p_query.toLowerCase()) ? [ANA] : [], total: 1, archived_count: 1, awaiting_count: 0 }),
      archived_member_detail: ANA,
    },
  })
  await expect(page.getByRole('heading', { name: 'Archived members', exact: true })).toBeVisible()
  await page.getByRole('button', { name: /View Ana Lucero/ }).click()
  await expect(page.getByText('Example address', { exact: true })).toBeVisible()
  if (process.env.CAPTURE_ARCHIVE_PREVIEW) await page.screenshot({ path: process.env.CAPTURE_ARCHIVE_PREVIEW, fullPage: true })
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0)
  await page.getByRole('searchbox', { name: 'Search archived members' }).fill('nobody')
  await expect(page.getByText('No members match your search.')).toBeVisible()
})

test('Church Leader can read archived records without restore or access controls', async ({ page }) => {
  await authedGoto(page, '/dashboard/settings/archived-members', {
    rpc: {
      get_my_permissions: { ...SUPERADMIN_PERMS, role: 'church_leader', is_super_admin: false, is_church_leader: true },
      list_archived_members: { rows: [ANA], total: 1, archived_count: 1, awaiting_count: 0 },
      archived_member_detail: ANA,
    },
  })
  await page.getByRole('button', { name: /View Ana Lucero/ }).click()
  await expect(page.getByText('Example address', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Awaiting access/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Restore Ana' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Re-enable access' })).toHaveCount(0)
})

test('restores one member with a reason and keeps sign-in disabled', async ({ page }) => {
  let restored = false
  await authedGoto(page, '/dashboard/settings/archived-members', {
    rpc: {
      list_archived_members: () => ({ rows: restored ? [] : [ANA], total: restored ? 0 : 1, archived_count: restored ? 0 : 1, awaiting_count: restored ? 1 : 0 }),
      archived_member_detail: ANA,
      restore_archived_member: () => { restored = true; return { id: ANA.id } },
    },
  })
  await page.getByRole('button', { name: /View Ana Lucero/ }).click()
  await page.getByRole('button', { name: 'Restore Ana' }).click()
  await expect(page.getByRole('heading', { name: 'Restore Ana Lucero?' })).toBeVisible()
  await expect(page.getByText(/Sign-in stays disabled/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Restore member' })).toBeDisabled()
  await page.getByRole('textbox', { name: 'Reason for restoring' }).fill('Returned to the church')
  await page.getByRole('button', { name: 'Restore member' }).click()
  await expect(page.getByText('No archived members in this church.')).toBeVisible()
})

test('SuperAdmin confirms retained assignments before re-enabling access', async ({ page }) => {
  const mark = { ...ANA, archived_at: null, restored_at: '2026-09-30T03:00:00Z', restored_reason: 'Returned', restored_by: 'Jun Example' }
  let enabled = false
  await authedGoto(page, '/dashboard/settings/archived-members', {
    rpc: {
      list_archived_members: ({ body }) => ({ rows: body.p_awaiting && !enabled ? [mark] : [], total: body.p_awaiting && !enabled ? 1 : 0, archived_count: 0, awaiting_count: enabled ? 0 : 1 }),
      archived_member_detail: mark,
      enable_archived_account: () => { enabled = true; return { id: ANA.id } },
    },
  })
  await page.getByRole('button', { name: /Awaiting access/ }).click()
  await page.getByRole('button', { name: /View Ana Lucero/ }).click()
  await expect(page.getByRole('button', { name: 'Re-enable access' })).toBeDisabled()
  await page.getByRole('checkbox', { name: /Member.*Role/ }).check()
  await page.getByRole('checkbox', { name: /Youth Ministry/ }).check()
  await page.getByRole('checkbox', { name: /Cell 4/ }).check()
  await page.getByRole('button', { name: 'Re-enable access' }).click()
  await expect(page.getByText('No restored accounts are awaiting access.')).toBeVisible()
})

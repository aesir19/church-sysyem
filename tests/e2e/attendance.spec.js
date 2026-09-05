import { test, expect } from '@playwright/test'
import { authedGoto } from './support/scenario.js'

// End-to-end coverage for the Attendance screen — and the pattern every other
// module's suite copies: authedGoto seeds a signed-in session and mocks the
// Supabase calls this screen makes, then we drive the real UI in a real browser.
//
// The first test is a regression lock for the bug that started this suite: a
// guest's "Link to member" dialog whose member dropdown could not be clicked,
// because the listbox is teleported to <body> and Reka's dialog had disabled
// pointer events there. Only a real browser catches it — see playwright.config.js.

const NOW_ISO = new Date().toISOString()

// A live service: the window opened half an hour ago and closes in an hour, so
// the screen treats it as running (this is what surfaces "Close check-in now").
const SERVICE = {
  id: 'svc-1',
  label: 'Sunday Service',
  service_date: new Date().toISOString().slice(0, 10),
  opens_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
  closes_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  schedule_id: null,
}

// One guest row (linkable), one member row with its embed present, and one member
// row whose members(...) embed came back NULL — the shape RLS produces for a caller
// without member detail (Welcome Team). That last row's name must be resolved from
// the directory, not rendered as "Unknown".
const ROSTER = [
  { id: 'att-guest-1', member_id: null, guest_name: 'Ulysses Urbno', guest_contact: null, source: 'staff', created_at: NOW_ISO, members: null },
  { id: 'att-member-1', member_id: 'm-cora', guest_name: null, guest_contact: null, source: 'staff', created_at: NOW_ISO, members: { first_name: 'Cora', middle_name: null, last_name: 'Scribe' } },
  { id: 'att-member-2', member_id: 'm-maria', guest_name: null, guest_contact: null, source: 'staff', created_at: NOW_ISO, members: null },
]

// The member picker source (directory_search, not the members table — a Welcome
// Team member cannot read `members` under RLS).
const DIRECTORY = [
  { member_id: 'm-ferdi', first_name: 'Ferdinand', last_name: 'Aguilar' },
  { member_id: 'm-maria', first_name: 'Maria', last_name: 'Abad' },
  { member_id: 'm-cora', first_name: 'Cora', last_name: 'Scribe' },
]

// Mutations, shaped so `write()` (src/lib/data/write.js) sees at least one row
// back and the view repaints from a realistic record.
function onWrite({ table, method, body }) {
  if (table === 'attendance' && method === 'PATCH') {
    // Guest → member link. Return the guest row now carrying the chosen member.
    const member = DIRECTORY.find((d) => d.member_id === body.member_id)
    return [{
      id: 'att-guest-1',
      member_id: body.member_id,
      guest_name: null,
      guest_contact: null,
      source: 'staff',
      created_at: NOW_ISO,
      members: member ? { first_name: member.first_name, middle_name: null, last_name: member.last_name } : null,
    }]
  }
  if (table === 'attendance' && method === 'POST') {
    // Staff recording an attendee.
    return [{
      id: `att-new-${Date.now()}`,
      member_id: body.member_id ?? null,
      guest_name: body.guest_name ?? null,
      guest_contact: body.guest_contact ?? null,
      source: 'staff',
      created_at: new Date().toISOString(),
      members: null,
    }]
  }
  if (method === 'DELETE') return [{ id: 'deleted' }]
  return [{ id: 'written', ...body }]
}

// A roster row's visible name. Scoped to `.att__name` because every row also
// carries an Avatar with an sr-only copy of the name, so a bare getByText(name)
// is a strict-mode clash.
function rosterName(page, name) {
  return page.locator('.att__name', { hasText: name })
}

async function gotoAttendance(page) {
  await authedGoto(page, '/dashboard/attendance', {
    rpc: {
      get_checkin_link: [{ token: 'e2e-checkin-token' }],
      ensure_open_service: null,
      directory_search: DIRECTORY,
      close_service_now: null,
    },
    tables: {
      services: [SERVICE],
      service_schedules: [],
      attendance: ROSTER,
    },
    onWrite,
  })
  // The roster having painted is the signal that context + roster both loaded.
  // The full suite starts six Vite/browser workers together, so first paint can
  // exceed Playwright's 5-second assertion default on a contended machine.
  await expect(rosterName(page, 'Ulysses Urbno')).toBeVisible({ timeout: 15_000 })
}

test.describe('Attendance', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAttendance(page)
  })

  test('guest link — the member dropdown is selectable and the dialog stays open (regression)', async ({ page }) => {
    // Open the link dialog for the guest row.
    await page.getByRole('button', { name: 'Link to member' }).first().click()
    const dialogTitle = page.getByRole('heading', { name: 'Link to a member' })
    await expect(dialogTitle).toBeVisible()

    // Type, then CLICK an option in the teleported listbox. Before the fix this
    // click either did nothing (body pointer-events: none) or dismissed the
    // whole dialog (treated as an outside click).
    await page.locator('#link-member').fill('Ferdi')
    await page.locator('#link-member-option-0').click()

    // The click registered as a selection...
    await expect(page.getByRole('dialog').locator('.mac__note')).toHaveText(/Selected: Ferdinand Aguilar/)
    // ...and the dialog is still open. This is the assertion that pins the bug.
    await expect(dialogTitle).toBeVisible()
  })

  test('linking a guest to a member updates the roster row to Member', async ({ page }) => {
    await page.getByRole('button', { name: 'Link to member' }).first().click()
    await page.locator('#link-member').fill('Ferdi')
    await page.locator('#link-member-option-0').click()
    await page.getByRole('button', { name: 'Link', exact: true }).click()

    // Dialog closes, the guest name is gone from the roster, the member is in.
    await expect(page.getByRole('heading', { name: 'Link to a member' })).toBeHidden()
    await expect(page.getByText('Linked to Ferdinand Aguilar.')).toBeVisible()
    await expect(rosterName(page, 'Ferdinand Aguilar')).toBeVisible()
    await expect(rosterName(page, 'Ulysses Urbno')).toHaveCount(0)
  })

  test('records a first-time guest from staff entry', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Record attendance' })).toBeVisible()
    await expect(page.getByRole('button', { name: '+ Record attendee' })).toHaveCount(0)

    await page.getByRole('button', { name: 'First-time guest' }).click()
    await page.getByLabel('Guest name').fill('Bella Guest')
    await page.getByRole('button', { name: 'Mark present' }).click()

    await expect(page.getByText('Attendance recorded.')).toBeVisible()
    await expect(page.getByText('Bella Guest marked present. Ready for the next person.')).toBeVisible()
    await expect(page.getByLabel('Guest name')).toBeFocused()
    await expect(page.getByLabel('Guest name')).toHaveValue('')
    await expect(rosterName(page, 'Bella Guest')).toBeVisible()
  })

  test('records members continuously without reopening a dialog', async ({ page }) => {
    const memberSearch = page.getByRole('combobox', { name: 'Search member' })
    await memberSearch.fill('Ferdi')
    await page.locator('#record-attendee-member-option-0').click()
    await page.getByRole('button', { name: 'Mark present' }).click()

    await expect(page.getByText('Ferdinand Aguilar marked present. Ready for the next person.')).toBeVisible()
    await expect(memberSearch).toBeFocused()
    await expect(memberSearch).toHaveValue('')
    await expect(rosterName(page, 'Ferdinand Aguilar')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Record attendance' })).toBeVisible()
  })

  test('puts the inline recorder before attendance analytics on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })

    const recorder = page.getByRole('heading', { name: 'Record attendance' })
    const liveSummary = page.getByText('Live now', { exact: true })
    await expect(recorder).toBeVisible()
    await expect(liveSummary).toBeVisible()

    const recorderBox = await recorder.boundingBox()
    const liveBox = await liveSummary.boundingBox()
    expect(recorderBox.y).toBeLessThan(liveBox.y)
  })

  // Regression for the Welcome-Team "Unknown" bug: a member attendee whose
  // members(...) embed RLS blanked must be named from the directory the picker
  // already loaded, not rendered as "Unknown".
  test('resolves a member attendee name from the directory when the embed is blank', async ({ page }) => {
    await expect(rosterName(page, 'Maria Abad')).toBeVisible()
    await expect(page.locator('.att__name', { hasText: 'Unknown' })).toHaveCount(0)
  })

  test('shows the check-in QR', async ({ page }) => {
    await page.getByRole('button', { name: 'Show QR' }).click()
    await expect(page.getByRole('heading', { name: /check-in/i })).toBeVisible()
  })

  test('closes check-in now', async ({ page }) => {
    await page.getByRole('button', { name: 'Close check-in now' }).click()
    await expect(page.getByText('Check-in closed.')).toBeVisible()
  })
})

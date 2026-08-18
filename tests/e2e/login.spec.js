import { test, expect } from '@playwright/test'
import { installSupabaseMock } from './support/mockSupabase.js'
import { SUPERADMIN_USER, baseRpc } from './support/scenario.js'

// The one flow that starts signed OUT: driving the real login form against a
// mocked GoTrue. Every other spec seeds a session and skips this; this proves
// the sign-in UI itself works end to end.

test.describe('Login', () => {
  test('signs in and lands on the dashboard', async ({ page }) => {
    // No seeded session — start at the login screen. The token endpoint (mocked)
    // returns a session for any credentials, and the router's post-login gates
    // (account link, role) are answered by the base context.
    await installSupabaseMock(page, { user: SUPERADMIN_USER, rpc: baseRpc() })
    await page.goto('/login')

    await page.getByRole('textbox', { name: 'Email address' }).fill('sam@example.test')
    await page.getByRole('textbox', { name: 'Password' }).fill('correct-horse')
    await page.getByRole('button', { name: 'Sign in' }).click()

    await expect(page).toHaveURL(/\/dashboard/)
    // The dashboard shell rendered — the nav is only present once past the guard.
    await expect(page.getByRole('link', { name: 'Overview' })).toBeVisible()
  })

  test('shows an error and stays on /login when sign-in fails', async ({ page }) => {
    // Override just the token endpoint to reject, the way GoTrue answers a bad
    // password (400 with an error body). The form must classify it, not echo it.
    await installSupabaseMock(page, { user: SUPERADMIN_USER, rpc: baseRpc() })
    await page.route('**/auth/v1/token**', (route) =>
      route.fulfill({ status: 400, json: { error: 'invalid_grant', error_description: 'Invalid login credentials' } })
    )
    await page.goto('/login')

    await page.getByRole('textbox', { name: 'Email address' }).fill('sam@example.test')
    await page.getByRole('textbox', { name: 'Password' }).fill('wrong')
    await page.getByRole('button', { name: 'Sign in' }).click()

    // The classified message (authErrors.js), never the raw GoTrue string — the
    // form must not become a "does this account exist" oracle.
    await expect(page.getByText('That email and password do not match.')).toBeVisible()
    await expect(page).toHaveURL(/\/login/)
  })
})

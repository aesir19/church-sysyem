import { test, expect } from '@playwright/test'
import { installSupabaseMock } from './support/mockSupabase.js'
import { seedSession, SUPERADMIN_USER } from './support/session.js'

const recoveryHash = '#access_token=e2e-recovery-token&refresh_token=e2e-refresh-token&expires_in=3600&token_type=bearer&type=recovery'

test('requests a reset from login without disclosing whether the email exists', async ({ page }) => {
  await installSupabaseMock(page)
  const requests = []
  await page.route('**/auth/v1/recover**', route => {
    requests.push({ url: new URL(route.request().url()), body: route.request().postDataJSON() })
    return route.fulfill({ json: {} })
  })
  await page.goto('/login')
  await page.getByRole('link', { name: 'Forgot password?' }).click()
  await expect(page.getByRole('heading', { name: 'Forgot password?' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Email address' }).fill('unknown@example.test')
  await page.getByRole('button', { name: 'Send reset link', exact: true }).click()
  await expect(page.getByText('If an account exists for that email, we’ve sent a password reset link.')).toBeVisible()
  expect(requests).toHaveLength(1)
  expect(requests[0].body.email).toBe('unknown@example.test')
  expect(requests[0].url.searchParams.get('redirect_to')).toBe('http://localhost:5199/reset-password')
  await expect(page.getByRole('button', { name: /Send again/ })).toBeDisabled()
  await page.getByRole('link', { name: 'Back to sign in' }).click()
  await expect(page).toHaveURL(/\/login$/)
})

test('retries a failed global sign-out without updating the password again', async ({ page }) => {
  await installSupabaseMock(page, { user: SUPERADMIN_USER })
  let updates = 0
  let logouts = 0
  await page.route('**/auth/v1/user', route => {
    if (route.request().method() === 'PUT') updates++
    return route.fulfill({ json: SUPERADMIN_USER })
  })
  await page.route('**/auth/v1/logout**', route => {
    logouts++
    return logouts === 1
      ? route.fulfill({ status: 500, json: { message: 'private provider detail' } })
      : route.fulfill({ status: 204, body: '' })
  })
  await page.goto(`/reset-password${recoveryHash}`)
  await page.getByRole('textbox', { name: 'New password', exact: true }).fill('new-password-123')
  await page.getByRole('textbox', { name: 'Confirm password' }).fill('new-password-123')
  await page.getByRole('button', { name: 'Reset password', exact: true }).click()
  await expect(page.getByText('Your password was saved, but we could not sign out your sessions. Retry sign out to finish.')).toBeVisible()
  await expect(page).toHaveURL(/\/reset-password$/)
  await expect(page.getByRole('textbox', { name: 'New password', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Retry sign out' }).click()
  await expect(page).toHaveURL(/\/login$/)
  expect(updates).toBe(1)
  expect(logouts).toBe(2)
})

test('refuses to retry global sign-out against a different account', async ({ page }) => {
  await installSupabaseMock(page, { user: SUPERADMIN_USER })
  let currentUser = SUPERADMIN_USER
  let logouts = 0
  await page.route('**/auth/v1/user', route => route.fulfill({ json: currentUser }))
  await page.route('**/auth/v1/logout**', route => {
    logouts++
    return route.fulfill({ status: 500, json: { message: 'temporary failure' } })
  })
  await page.goto(`/reset-password${recoveryHash}`)
  await page.getByRole('textbox', { name: 'New password', exact: true }).fill('new-password-123')
  await page.getByRole('textbox', { name: 'Confirm password' }).fill('new-password-123')
  await page.getByRole('button', { name: 'Reset password', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Retry sign out' })).toBeVisible()
  currentUser = { ...SUPERADMIN_USER, id: '00000000-0000-4000-8000-000000000002', email: 'other@example.test' }
  await page.getByRole('button', { name: 'Retry sign out' }).click()
  await expect(page.getByText('Your password was saved, but your session changed. Open a new reset link for the same account to finish signing out its sessions.')).toBeVisible()
  expect(logouts).toBe(1)
  await expect(page.getByRole('link', { name: 'Request a new link' })).toBeVisible()
})

for (const suffix of ['', '#error=access_denied&error_code=otp_expired&error_description=private-provider-detail', '?error=access_denied&error_code=otp_expired']) {
  test(`refuses an ordinary session on the reset page with ${suffix ? `an expired link (${suffix[0]})` : 'no recovery link'}`, async ({ page }) => {
    await seedSession(page)
    await installSupabaseMock(page, { user: SUPERADMIN_USER })
    await page.goto(`/reset-password${suffix}`)
    await expect(page.getByText('This reset link is invalid or has expired. Request a new link to continue.')).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'New password', exact: true })).toHaveCount(0)
    await expect(page).toHaveURL(/\/reset-password$/)
    await page.getByRole('link', { name: 'Request a new link' }).click()
    await expect(page.getByRole('heading', { name: 'Forgot password?' })).toBeVisible()
  })
}

test('does not use an existing session when the incoming recovery token is rejected', async ({ page }) => {
  await seedSession(page)
  await installSupabaseMock(page, { user: SUPERADMIN_USER })
  await page.route('**/auth/v1/user', route => {
    return route.request().headers().authorization === 'Bearer e2e-recovery-token'
      ? route.fulfill({ status: 403, json: { code: 'bad_jwt', message: 'invalid token' } })
      : route.fulfill({ json: SUPERADMIN_USER })
  })
  await page.goto(`/reset-password${recoveryHash}`)
  await expect(page.getByText('This reset link is invalid or has expired. Request a new link to continue.')).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'New password', exact: true })).toHaveCount(0)
  await expect(page).toHaveURL(/\/reset-password$/)
})

test('keeps password validation and permits retry after a rejected password', async ({ page }) => {
  await installSupabaseMock(page, { user: SUPERADMIN_USER })
  let updates = 0
  await page.route('**/auth/v1/user', route => {
    if (route.request().method() !== 'PUT') return route.fulfill({ json: SUPERADMIN_USER })
    updates++
    return updates === 1
      ? route.fulfill({ status: 422, headers: { 'x-supabase-api-version': '2024-01-01', 'access-control-expose-headers': 'X-Supabase-Api-Version' }, json: { code: 'same_password', message: 'private detail' } })
      : route.fulfill({ json: SUPERADMIN_USER })
  })
  await page.goto(`/reset-password${recoveryHash}`)
  const password = page.getByRole('textbox', { name: 'New password', exact: true })
  const confirmation = page.getByRole('textbox', { name: 'Confirm password' })
  const submit = page.getByRole('button', { name: 'Reset password', exact: true })
  await password.fill('short')
  await confirmation.fill('short')
  await submit.click()
  expect(await password.evaluate(input => input.validity.tooShort)).toBe(true)
  await password.fill('old-password')
  await confirmation.fill('different-password')
  await submit.click()
  await expect(page.getByText('Passwords do not match.', { exact: true })).toBeVisible()
  expect(updates).toBe(0)
  await confirmation.fill('old-password')
  await submit.click()
  await expect(page.getByText('Choose a password different from your current password.')).toBeVisible()
  await password.fill('new-password')
  await confirmation.fill('new-password')
  await submit.click()
  await expect(page).toHaveURL(/\/login$/)
  expect(updates).toBe(2)
})

test('shows safe request errors and enforces the resend cooldown after throttling', async ({ page }) => {
  await installSupabaseMock(page)
  await page.route('**/auth/v1/recover**', route => route.fulfill({
    status: 429, json: { code: 'over_email_send_rate_limit', message: 'private provider detail' }
  }))
  await page.goto('/forgot-password')
  await page.getByRole('textbox', { name: 'Email address' }).fill('sam@example.test')
  await page.getByRole('button', { name: 'Send reset link', exact: true }).click()
  await expect(page.getByText('Too many requests. Wait a minute and try again.')).toBeVisible()
  await expect(page.getByText('private provider detail')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Send again/ })).toBeDisabled()
})

test('preserves invitation password setup', async ({ page }) => {
  await installSupabaseMock(page, { user: SUPERADMIN_USER })
  await page.goto(`/set-password${recoveryHash.replace('type=recovery', 'type=invite')}`)
  await expect(page.getByRole('heading', { name: 'Set your password' })).toBeVisible()
  await page.getByRole('textbox', { name: 'New password', exact: true }).fill('invited-password')
  await page.getByRole('textbox', { name: 'Confirm password' }).fill('invited-password')
  await page.getByRole('button', { name: 'Save and continue' }).click()
  await expect(page.getByText('Password set. Taking you to sign in…')).toBeVisible()
  await expect(page).toHaveURL(/\/login$/)
})

test('sets a new password from a recovery link, signs out globally, and returns to login', async ({ page }) => {
  await installSupabaseMock(page, { user: SUPERADMIN_USER })
  let savedPassword = ''
  let logoutScope = ''
  await page.route('**/auth/v1/user', route => {
    if (route.request().method() === 'PUT') savedPassword = route.request().postDataJSON().password
    return route.fulfill({ json: SUPERADMIN_USER })
  })
  await page.route('**/auth/v1/logout**', route => {
    logoutScope = new URL(route.request().url()).searchParams.get('scope')
    return route.fulfill({ status: 204, body: '' })
  })
  await page.goto(`/reset-password${recoveryHash}`)
  await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible()
  // A reload after the SDK consumes the link must preserve this tab's flow.
  await expect(page).toHaveURL(/\/reset-password$/)
  await page.reload()
  await page.getByRole('textbox', { name: 'New password', exact: true }).fill('new-password-123')
  await page.getByRole('textbox', { name: 'Confirm password' }).fill('new-password-123')
  await page.getByRole('button', { name: 'Reset password', exact: true }).click()
  await expect(page.getByText('Password reset. Taking you to sign in…')).toBeVisible()
  await expect(page).toHaveURL(/\/login$/)
  expect(savedPassword).toBe('new-password-123')
  expect(logoutScope).toBe('global')
  await page.goto('/reset-password')
  await expect(page.getByText('This reset link is invalid or has expired. Request a new link to continue.')).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'New password', exact: true })).toHaveCount(0)
})

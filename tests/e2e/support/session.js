// Makes an E2E page start already signed in, without a login round-trip.
//
// supabase-js keeps its session in localStorage under a key derived from the
// project URL: `sb-${firstHostnameLabel}-auth-token` (see src/lib/supabase.js
// and @supabase/supabase-js SupabaseClient). .env.test points VITE_SUPABASE_URL
// at https://test.supabase.co, so the label — and therefore the key — is fixed
// to `sb-test-auth-token`. Writing a session there before any app code runs is
// what getSession() reads back on boot.
//
// The token is a made-up string, and that is fine: mockSupabase.js answers the
// GoTrue endpoints, so it is never validated against a real server. The one
// thing that matters is `expires_at` being comfortably in the future, so the
// client does not try to refresh at startup.

export const STORAGE_KEY = 'sb-test-auth-token'

// A SuperAdmin. Matches the shape of a real staging user closely enough for the
// role/church resolution (useCurrentRole, useActiveChurch) to run; the actual
// permissions come from the mocked get_my_permissions RPC, not from here.
export const SUPERADMIN_USER = {
  id: '00000000-0000-4000-8000-000000000001',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'sam@example.test',
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: { full_name: 'Sam Superadmin' },
  created_at: '2024-01-01T00:00:00.000Z',
}

/**
 * A GoTrue session envelope. Shared by the seed below and by the token endpoint
 * in mockSupabase.js, so a seeded session and a fresh sign-in look identical.
 */
export function buildSession(user = SUPERADMIN_USER) {
  return {
    access_token: 'e2e-fake-access-token',
    token_type: 'bearer',
    expires_in: 3600,
    // One year out — long past any run, so no refresh fires mid-test.
    expires_at: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365,
    refresh_token: 'e2e-fake-refresh-token',
    user,
  }
}

/**
 * Seed a signed-in session into the page before it loads. Runs as an init
 * script so localStorage is populated before the Supabase client constructs.
 */
export async function seedSession(page, user = SUPERADMIN_USER) {
  const payload = { key: STORAGE_KEY, value: JSON.stringify(buildSession(user)) }
  await page.addInitScript((arg) => {
    window.localStorage.setItem(arg.key, arg.value)
  }, payload)
}

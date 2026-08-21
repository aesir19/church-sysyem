import { defineConfig, devices } from '@playwright/test'

// Headless, real-browser E2E for the dashboard's interactive flows.
//
// This is the layer the unit suite structurally cannot reach. Those tests run in
// `environment: 'node'` and render components with SSR `renderToString` — static
// markup, no layout, no pointer-events, no teleport, no real click hit-testing.
// The class of bug that motivated this suite (a listbox teleported to <body>,
// unclickable because Reka's dialog sets `body { pointer-events: none }`) is
// invisible to SSR and to jsdom alike; only a real browser driving the running
// app exercises it.
//
// It stays inside CLAUDE.md rule 1 ($0/month) and rule 2 (no PII) because it
// touches no network and no database: tests/e2e/support/mockSupabase.js answers
// every Supabase call from in-memory fixtures. The dev server runs under
// `--mode test` on a dedicated port with a committed placeholder .env.test, so a
// run never needs a secret and never depends on a staging server being up.
const PORT = 5199
const BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  // A stray `test.only` must fail the CI run rather than silently skip the rest.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list']],
  use: {
    baseURL: BASE_URL,
    headless: true,
    // A trace is kept only when a test fails on retry — cheap to store, and the
    // fastest way to see what a headless failure actually did.
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev:test',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})

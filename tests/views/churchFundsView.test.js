// Smoke + authorization coverage for the report view's setup path.
//
// The pure pipeline is covered by tests/utils/collectivesSource.test.js; what that
// cannot catch is the view failing before it ever calls those functions — a stale
// import, or a `let` read from the immediate watch before its declaration is
// initialised. Rendering the component is the cheapest thing that does.
//
// It ALSO guards the issue-#57 boundary at the view seam: the raw giving rows (which
// carry contributor identity) must be fetched ONLY when the caller may see identity,
// and the Contributors section must render only then. The database enforces this too
// (0031), but this test stops a refactor from quietly re-widening the client read.

import { describe, expect, it, vi } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'

const SERVICE_TOTALS = [
  { service_date: '2026-04-05', tithes: 1000, offering: 0, expenses: 100 },
]

const MONTH_COLLECTIONS = [
  {
    id: 1,
    from: '11111111-1111-1111-1111-111111111111',
    amount: 1000,
    is_tithes: true,
    collectedOn: '2026-05-03',
    members: { first_name: 'Mary', last_name: 'Lago' },
  },
  {
    id: 2,
    from: null,
    amount: 500,
    is_tithes: true,
    collectedOn: '2026-05-03',
    members: null,
  },
]

const MONTH_EXPENSES = [{ spent_on: '2026-05-03', description: 'Kuryente', amount: '250.00' }]

// Mutable session the mock reads. Tests set it before rendering to act as a given
// role. `perm` is the get_my_permissions() row (null = unauthenticated / unlinked).
const session = { user: null, perm: null }

// A thenable query builder: every PostgREST modifier returns `this`, and the chain
// resolves to whatever the table was registered with.
function queryBuilder(rows) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    gte: () => builder,
    lt: () => builder,
    order: () => builder,
    then: (resolve) => Promise.resolve({ data: rows, error: null }).then(resolve),
  }
  return builder
}

const tablesRead = []

vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: session.user } }) },
    // useCurrentRole reads role/ministry flags through this RPC.
    rpc: (name) => ({
      maybeSingle: () =>
        Promise.resolve({ data: name === 'get_my_permissions' ? session.perm : null, error: null }),
      then: (resolve) => Promise.resolve({ data: null, error: null }).then(resolve),
    }),
    from: (table) => {
      tablesRead.push(table)
      const rows = {
        collectives_service_totals: SERVICE_TOTALS,
        collections: MONTH_COLLECTIONS,
        expenses: MONTH_EXPENSES,
      }[table]
      if (rows === undefined) throw new Error(`unexpected table read: ${table}`)
      return queryBuilder(rows)
    },
  },
}))

const FINANCE_PERM = {
  role: 'member',
  is_super_admin: false,
  is_head_pastor: false,
  is_pastor: false,
  is_church_leader: false,
  is_finance: true,
  is_secretariat: false,
  is_welcome: false,
  is_small_group_leader: false,
}

// Render as a given role. When a permission row is supplied we pre-resolve the role
// cache BEFORE the view's synchronous setup runs, so canSeeContributorIdentity is
// already known at first paint (SSR does not process the post-setup async resolve).
async function render({ user = null, perm = null } = {}) {
  session.user = user
  session.perm = perm
  tablesRead.length = 0

  const { clearCurrentRole, useCurrentRole } = await import('../../src/composables/useCurrentRole')
  clearCurrentRole()
  if (user) await useCurrentRole().loadPermissions(true)

  const { default: ChurchFundsView } = await import('../../src/views/ChurchFundsView.vue')

  const app = createSSRApp(ChurchFundsView)
  // Vue funnels watcher and lifecycle failures into this handler rather than
  // rejecting the render, so without collecting them an exception inside loadMonth()
  // would leave the report permanently blank and the test green.
  const errors = []
  app.config.errorHandler = (err) => { errors.push(err) }

  const html = await renderToString(app)
  // Let the mocked queries settle so a rejection surfaces here rather than as an
  // unhandled rejection after the test has finished.
  await new Promise((resolve) => setTimeout(resolve, 0))

  return { html, errors }
}

// A GENEROUS TIMEOUT, AND WHY. Each test server-renders a whole view and waits for
// its mocked queries to settle. That is well under a second alone, but vitest runs
// files in parallel and the render competes for CPU, so under a full run it
// intermittently crossed the 5s default. The work is bounded; the deadline was wrong.
describe('ChurchFundsView', { timeout: 20000 }, () => {
  it('runs setup and its month load without raising', async () => {
    const { errors } = await render()
    expect(errors).toEqual([])
  })

  it('never fetches the identity-bearing giving rows for a caller without identity rights', async () => {
    // The security guarantee at the client seam (issue #57): a viewer — here an
    // unauthenticated / unlinked session — reads expenses for the by-description
    // breakdown, but NEVER `collections`, whose rows carry `from`. The month's
    // figures come from the names-free collectives_service_totals view instead.
    const { errors } = await render()

    expect(errors).toEqual([])
    expect(tablesRead).toContain('expenses')
    expect(tablesRead).not.toContain('collections')
  })

  it('fetches the giving rows for a finance caller who may see identity', async () => {
    const { errors } = await render({ user: { id: 'finance-user' }, perm: FINANCE_PERM })

    expect(errors).toEqual([])
    expect(tablesRead).toContain('collections')
    expect(tablesRead).toContain('expenses')
  })

  it('renders as the Funds Report tab with no preview banner', async () => {
    const { html } = await render()

    // The title, month stepper and Print button moved to FinanceView's shared header
    // (9 - Finance.dc.html); the Report tab renders only its report body now, so the
    // "Previous month" control and the "Collectives report" subtitle live in the shell.
    expect(html).not.toContain('Previous month')
    // The fixture-era banner is gone; nothing should advertise sample data.
    expect(html).not.toContain('Preview mode')
    expect(html).not.toContain('sample')
  })

  it('shows a loading state instead of a false "no collectives" message', async () => {
    // Data arrives after the first paint, so the empty state must not win the race —
    // otherwise every month navigation flashes "No collectives recorded".
    const { html } = await render()

    expect(html).toContain('Loading')
    expect(html).toContain('role="status"')
    expect(html).not.toContain('No collectives recorded')
  })
})

// Note: the `collectives_service_totals` fetch runs in onMounted, which SSR does not
// invoke, so it is not exercised here. openingBalanceForMonth() is covered directly
// in tests/utils/collectivesSource.test.js.

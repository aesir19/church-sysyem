// Smoke coverage for the report view's setup path.
//
// The pure pipeline is covered by tests/utils/collectivesSource.test.js; what
// that cannot catch is the view failing before it ever calls those functions —
// a stale import, or a `let` read from the immediate watch before its
// declaration is initialised. Neither shows up in `npm run build`. Rendering the
// component is the cheapest thing that does.

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

// A thenable query builder: every PostgREST modifier returns `this`, and the
// chain resolves to whatever the table was registered with.
function queryBuilder(rows) {
  const builder = {
    select: () => builder,
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
    auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
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

async function render() {
  tablesRead.length = 0
  const { default: ChurchFundsView } = await import('../../src/views/ChurchFundsView.vue')

  const app = createSSRApp(ChurchFundsView)
  // Vue funnels watcher and lifecycle failures into this handler rather than
  // rejecting the render, so without collecting them an exception inside
  // loadMonth() would leave the report permanently blank and the test green.
  const errors = []
  app.config.errorHandler = (err) => { errors.push(err) }

  const html = await renderToString(app)
  // Let the mocked queries settle so a rejection surfaces here rather than as an
  // unhandled rejection after the test has finished.
  await new Promise((resolve) => setTimeout(resolve, 0))

  return { html, errors }
}

// A GENEROUS TIMEOUT, AND WHY. Each test here server-renders a whole view and then
// waits for its mocked queries to settle. That is comfortably under a second on its own,
// but vitest runs files in parallel and the render competes with every other worker for
// the CPU — so under a full `npm test` it intermittently crossed the 5s default and
// failed as a timeout rather than an assertion. The work is bounded; the deadline was
// the wrong one. Raised here rather than globally, so a genuine hang elsewhere still
// fails fast.
describe('ChurchFundsView', { timeout: 20000 }, () => {
  it('runs setup and its month load without raising', async () => {
    const { errors } = await render()
    expect(errors).toEqual([])
  })

  it('queries live collections for the month', async () => {
    // The point of the change: before this, the view read `expenses` and took
    // every contribution line from a hardcoded fixture.
    const { errors } = await render()

    expect(errors).toEqual([])
    expect(tablesRead).toContain('collections')
    expect(tablesRead).toContain('expenses')
  })

  it('renders the month navigator and no preview banner', async () => {
    const { html } = await render()

    // The header names the report and the stepper names the month. The wording
    // moved in the redesign ("Collectives Summary" under the stepper became a
    // subtitle beside the title); what must not move is that both are present.
    expect(html).toContain('Collectives report')
    expect(html).toContain('Previous month')
    // The fixture-era banner is gone; nothing should advertise sample data.
    expect(html).not.toContain('Preview mode')
    expect(html).not.toContain('sample')
  })

  it('shows a loading state instead of a false "no collectives" message', async () => {
    // Data arrives after the first paint, so the empty state must not win the
    // race — otherwise every month navigation flashes "No collectives recorded".
    const { html } = await render()

    // The loading state is skeleton shapes now, so the announcement it carries
    // is the aria-label — which is the only thing a screen reader gets, and the
    // reason the label exists rather than bare divs.
    expect(html).toContain('Loading')
    expect(html).toContain('role="status"')
    expect(html).not.toContain('No collectives recorded')
  })
})

// Note: the `collectives_service_totals` fetch runs in onMounted, which SSR does
// not invoke, so it is not exercised here. openingBalanceForMonth() is covered
// directly in tests/utils/collectivesSource.test.js.

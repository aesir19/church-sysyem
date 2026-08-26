// SSR smoke coverage for the Finance workspace shell.
//
// The gating logic itself is unit-tested in tests/utils/financeTabs.test.js; this
// asserts the wiring FinanceView puts around it — the "Finance" title, the three-way
// switch showing only the tabs a caller may open, and the Print button appearing on the
// Funds Report tab alone (the one finance tab that is a document). The three child views
// are stubbed so their Supabase imports never load: what is under test is the shell.

import { describe, expect, it, vi } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

// The active tab and caller are steerable so one file can render both classes of visitor.
const routeState = { value: { params: { tab: 'collections' }, path: '/dashboard/finance/collections' } }
const roleState = { caps: {}, permissions: { value: {} } }

vi.mock('vue-router', () => ({
  RouterLink: {
    props: ['to'],
    render() {
      // `to` is an object ({ name, params }); render the label so tab text is assertable.
      return h('a', { class: 'tab-link' }, this.$slots.default?.())
    },
  },
  useRoute: () => routeState.value,
  useRouter: () => ({ replace: () => {} }),
}))

vi.mock('../../src/composables/useCurrentRole', () => ({
  useCurrentRole: () => ({
    caps: { value: roleState.caps },
    permissions: roleState.permissions,
  }),
}))

vi.mock('../../src/composables/useActiveChurch', () => ({
  useActiveChurch: () => ({ ensureLoaded: () => {}, activeChurchId: { value: 'church-1' } }),
}))

// Stub the three tabs — their real Supabase wiring is irrelevant to the shell.
const stub = (name) => ({ name, render: () => h('div', name) })
vi.mock('../../src/views/CollectionsInputView.vue', () => ({ default: stub('collections-view') }))
vi.mock('../../src/views/ExpensesInputView.vue', () => ({ default: stub('expenses-view') }))
vi.mock('../../src/views/ChurchFundsView.vue', () => ({ default: stub('report-view') }))

const FinanceView = (await import('../../src/views/FinanceView.vue')).default

const WRITER = { canViewFinance: true, canWriteFinance: true }
const VIEWER = { canViewFinance: true, canWriteFinance: false }

async function render({ caps, tab }) {
  roleState.caps = caps
  roleState.permissions = { value: caps } // non-null = permissions resolved
  routeState.value = { params: { tab }, path: `/dashboard/finance/${tab}` }

  const app = createSSRApp(FinanceView)
  const errors = []
  app.config.errorHandler = (err) => errors.push(err)
  const html = await renderToString(app)
  return { html, errors }
}

describe('FinanceView', () => {
  it('titles the workspace "Finance" and shares one month stepper', async () => {
    const { html, errors } = await render({ caps: WRITER, tab: 'collections' })
    expect(errors).toEqual([])
    expect(html).toContain('Finance')
    expect(html).toContain('Previous month')
    expect(html).toContain('Next month')
  })

  it('shows all three tabs to a caller who can write finance', async () => {
    const { html } = await render({ caps: WRITER, tab: 'collections' })
    expect(html).toContain('Collections')
    expect(html).toContain('Expenses')
    expect(html).toContain('Funds Report')
    // On an entry tab, Print is not offered — only the Report is a document.
    expect(html).not.toContain('Print')
  })

  it('gives a view-only caller the report alone — no switcher, still Print', async () => {
    const { html } = await render({ caps: VIEWER, tab: 'report' })
    // One tab needs no switcher, so the Collections / Expenses labels never render.
    expect(html).not.toContain('Collections')
    expect(html).not.toContain('Expenses')
    // The report itself is mounted, and offers Print because it is a document.
    expect(html).toContain('report-view')
    expect(html).toContain('Print')
  })

  it('mounts the tab named by the URL', async () => {
    const onExpenses = await render({ caps: WRITER, tab: 'expenses' })
    expect(onExpenses.html).toContain('expenses-view')

    const onReport = await render({ caps: WRITER, tab: 'report' })
    expect(onReport.html).toContain('report-view')
  })
})

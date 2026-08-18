// SSR smoke coverage for the redesigned shell and auth chrome.
//
// Same constraints as tests/components/ui/primitives.test.js: no
// @vue/test-utils, no DOM, so these render through vue/server-renderer. What is
// asserted is the wiring that fails silently — a nav slot that links to a
// screen that does not exist, a permission-gated item that vanishes instead of
// explaining itself, an alert that announces at the wrong urgency.

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

// AppSidebar reaches useCurrentRole and useCurrentUser, both of which reach the
// Supabase client at import time. Nothing here needs a real one.
const permissions = { current: null }

vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: () => Promise.resolve({ data: { user: { email: 'grace.abad@udfc.org', user_metadata: {} } } }),
      onAuthStateChange: () => {},
      signOut: () => Promise.resolve({ error: null }),
    },
    rpc: () => ({
      maybeSingle: () => Promise.resolve({ data: permissions.current }),
      then: (resolve) => resolve({ data: [] }),
    }),
  },
}))

// AppSidebar imports RouterLink by name rather than resolving it globally, so a
// globally registered stub would never be reached. Replacing the module export
// is what actually substitutes it.
vi.mock('vue-router', () => ({
  RouterLink: {
    props: ['to'],
    render() {
      return h('a', { href: this.to, class: 'nav-item' }, this.$slots.default?.())
    },
  },
  useRoute: () => currentRoute.value,
  useRouter: () => ({ push: () => {} }),
}))

// Nav items are now HIDDEN, not locked, when the caller lacks the capability
// (ADR-0016). The real useCurrentRole resolves caps asynchronously from Supabase,
// which an SSR render cannot await — so the caps would always read empty and every
// gated item would vanish regardless. Mock it with a steerable caps object so a
// test can render both a full-capability nav and a restricted one.
const roleState = vi.hoisted(() => ({ caps: {}, role: 'super_admin' }))
const ALL_CAPS = {
  isSuperAdmin: true, isHeadPastor: false,
  canViewAttendance: true, canWriteFinance: true, canViewFinance: true,
}
vi.mock('../../src/composables/useCurrentRole', () => ({
  useCurrentRole: () => ({
    caps: { value: roleState.caps },
    role: { value: roleState.role },
    // useActiveChurch reads this to decide whether to show the church switcher.
    isCrossChurch: { value: !!(roleState.caps.isSuperAdmin || roleState.caps.isHeadPastor) },
  }),
}))

// AppTabBar decides which tab is current from the route, so the stub has to be
// steerable rather than fixed.
const currentRoute = { value: { fullPath: '/dashboard/overview', path: '/dashboard/overview' } }

const AppSidebar = (await import('../../src/components/AppSidebar.vue')).default
const AppTabBar = (await import('../../src/components/AppTabBar.vue')).default
const AuthShell = (await import('../../src/components/AuthShell.vue')).default
const Alert = (await import('../../src/components/ui/Alert.vue')).default
const Input = (await import('../../src/components/ui/Input.vue')).default

// Slots go through a wrapper render function rather than renderToString's
// second argument, which only reaches a root component's slots in some
// configurations and silently drops them otherwise.
async function render(component, props = {}, slots = null) {
  const app = createSSRApp({
    render: () => (slots ? h(component, props, slots) : h(component, props)),
  })
  const errors = []
  const warnings = []
  app.config.errorHandler = (err) => errors.push(err)
  app.config.warnHandler = (msg) => warnings.push(msg)
  const html = await renderToString(app)
  return { html, errors, warnings }
}

// SSR escapes the apostrophe, so the raw string never appears in the output.
const NAV_LABELS = [
  'Overview', 'Members', 'Groups', 'Attendance',
  'Collections', 'Expenses', 'Funds', 'Statistics', 'What&#39;s next',
]

beforeEach(() => {
  // Default to a full-capability caller, so the "everything is present" tests see the
  // complete nav. Restricted-caller tests narrow this themselves.
  roleState.caps = { ...ALL_CAPS }
  roleState.role = 'super_admin'
})

describe('AppSidebar', () => {
  it('renders the nav without error', async () => {
    const { errors, warnings } = await render(AppSidebar)
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
  })

  it('renders all nine nav items', async () => {
    const { html } = await render(AppSidebar)
    for (const label of NAV_LABELS) {
      expect(html, label).toContain(label)
    }
  })

  // THE RULE CHANGED, DELIBERATELY (ADR-0016). The shell now HIDES capability-gated
  // items from a caller who lacks the capability — the owner does not want users shown
  // navigation toward things that are not their job. No lock, no "request access", just
  // absence. The route still redirects for anyone who deep-links.
  it('hides capability-gated items from a caller who lacks them, with no lock', async () => {
    roleState.caps = {} // a scopeless caller: no gated capability
    const { html } = await render(AppSidebar)

    for (const label of ['Attendance', 'Collections', 'Expenses', 'Funds']) {
      expect(html, label).not.toContain(label)
    }
    // The ungated items are still there.
    for (const label of ['Overview', 'Members', 'Groups']) {
      expect(html, label).toContain(label)
    }
    expect(html).not.toContain('side__lock')
    expect(html).not.toContain('is-locked')
  })

  it('shows a gated item once the caller has its capability', async () => {
    roleState.caps = { canViewAttendance: true }
    const { html } = await render(AppSidebar)
    expect(html).toContain('Attendance')
    expect(html).not.toContain('Collections') // still lacks canWriteFinance
  })

  it('renders an unbuilt screen as a non-link badged Soon', async () => {
    const { html } = await render(AppSidebar)
    // Statistics has no route yet, so it must not be an anchor pointing nowhere.
    expect(html).not.toContain('href="/dashboard/statistics"')
    expect(html).toContain('Soon')
    expect(html).toContain('New')
  })

  it('links every built screen to a route that exists', async () => {
    const { html } = await render(AppSidebar)
    for (const path of [
      '/dashboard/overview', '/dashboard/members', '/dashboard/groups',
      '/dashboard/attendance', '/dashboard/collections', '/dashboard/expenses',
      '/dashboard/funds', '/dashboard/whats-next',
    ]) {
      expect(html, path).toContain(`href="${path}"`)
    }
  })
})

describe('AppTabBar', () => {
  it('renders five targets: four routes and More', async () => {
    const { html, errors, warnings } = await render(AppTabBar)

    expect(errors).toEqual([])
    expect(warnings).toEqual([])
    for (const label of ['Home', 'People', 'Check in', 'Funds', 'More']) {
      expect(html, label).toContain(label)
    }
  })

  // Same rule the sidebar now states (ADR-0016): out-of-scope tabs are hidden, not
  // locked. A caller lacking attendance and finance sees Home, People and More only.
  it('hides capability-gated tabs from a caller who lacks them', async () => {
    roleState.caps = {}
    const { html } = await render(AppTabBar)

    expect(html).toContain('Home')
    expect(html).toContain('People')
    expect(html).toContain('More')
    expect(html).not.toContain('Check in')
    expect(html).not.toContain('Funds')
    expect(html).not.toContain('is-locked')
    expect(html).not.toContain('tabs__lock')
  })

  it('points every tab at a route that exists', async () => {
    const { html } = await render(AppTabBar)
    for (const path of [
      '/dashboard/overview', '/dashboard/members',
      '/dashboard/attendance', '/dashboard/funds',
    ]) {
      expect(html, path).toContain(`href="${path}"`)
    }
  })

  // Groups, Collections, Expenses and What's next have no tab of their own. The
  // bar must still show where you are, or a phone user on Groups sees five dark
  // tabs and no answer to "where am I".
  it('marks More as current on a screen with no tab of its own', async () => {
    currentRoute.value = { fullPath: '/dashboard/groups', path: '/dashboard/groups' }
    const { html } = await render(AppTabBar)
    expect(html).toContain('is-current')

    currentRoute.value = { fullPath: '/dashboard/overview', path: '/dashboard/overview' }
    const onTabbed = await render(AppTabBar)
    expect(onTabbed.html).not.toContain('is-current')
  })

  it('marks More as current while the drawer is open', async () => {
    const { html } = await render(AppTabBar, { menuOpen: true })
    expect(html).toContain('is-current')
    expect(html).toContain('aria-expanded="true"')
  })
})

describe('AuthShell', () => {
  it('renders the mark, the heading and the slotted content', async () => {
    const { html, errors } = await render(
      AuthShell,
      { title: 'Welcome back', subtitle: 'Sign in to the UDFC dashboard.' },
      { default: () => h('p', 'form goes here') },
    )
    expect(errors).toEqual([])
    expect(html).toContain('Welcome back')
    expect(html).toContain('Sign in to the UDFC dashboard.')
    expect(html).toContain('form goes here')
    // The mark is inline SVG, never an <img> — there is no photography anywhere
    // in this app and nothing should start fetching one.
    expect(html).toContain('<svg')
    expect(html).not.toContain('<img')
  })

  it('renders the footnote slot when given one, and nothing when not', async () => {
    const withNote = await render(
      AuthShell,
      { title: 'x' },
      { footnote: () => 'Protected system for authorised church staff only.' },
    )
    expect(withNote.html).toContain('Protected system for authorised church staff only.')

    const without = await render(AuthShell, { title: 'x' })
    expect(without.html).not.toContain('auth__foot')
  })
})

describe('Alert', () => {
  // Urgency is chosen from the tone rather than hardcoded. Announcing a
  // "check-in is open" banner as assertively as an offline warning trains
  // people to ignore both.
  it('announces a failure assertively and a standing note politely', async () => {
    const danger = await render(Alert, { tone: 'danger' }, { default: () => 'You are offline.' })
    expect(danger.html).toContain('aria-live="assertive"')

    const neutral = await render(Alert, { tone: 'neutral' }, { default: () => 'View only.' })
    expect(neutral.html).toContain('aria-live="polite"')
  })

  it('renders every documented tone without a validator warning', async () => {
    for (const tone of ['neutral', 'live', 'warning', 'danger', 'success']) {
      const { warnings, errors } = await render(Alert, { tone }, { default: () => 'x' })
      expect(warnings, tone).toEqual([])
      expect(errors, tone).toEqual([])
    }
  })

  it('offers a dismiss control only when it is dismissible', async () => {
    const on = await render(Alert, { tone: 'success', dismissible: true }, { default: () => 'x' })
    expect(on.html).toContain('Dismiss')

    const off = await render(Alert, { tone: 'success' }, { default: () => 'x' })
    expect(off.html).not.toContain('alert__dismiss')
  })
})

describe('Input', () => {
  // Regression guard. The root of this component is a wrapper <div>, so with
  // Vue's default attribute fallthrough every undeclared attribute lands there
  // and silently does nothing — a password field with minlength="12" happily
  // accepts four characters, with no error and no warning.
  it('puts autocomplete and minlength on the control, not the wrapper', async () => {
    const { html } = await render(Input, {
      label: 'New password',
      type: 'password',
      autocomplete: 'new-password',
      minlength: 12,
    })

    const input = html.slice(html.indexOf('<input'))
    expect(input).toContain('autocomplete="new-password"')
    expect(input).toContain('minlength="12"')

    const wrapper = html.slice(0, html.indexOf('<input'))
    expect(wrapper).not.toContain('minlength=')
  })
})

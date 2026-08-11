// SSR smoke coverage for the Phase 1 shell and auth chrome.
//
// Same constraints as tests/components/ui/primitives.test.js: no
// @vue/test-utils, no DOM, so these render through vue/server-renderer. What is
// asserted is the wiring that fails silently — a nav slot that links to a
// screen that does not exist, an icon injected as markup, a footer note that
// cannot be overridden.

import { describe, expect, it, vi } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

// AppSidebar reaches useCurrentRole, which reaches the Supabase client at
// import time. Nothing here needs a real one.
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: () => Promise.resolve({ data: { user: null } }),
      onAuthStateChange: () => {},
      signOut: () => Promise.resolve({ error: null }),
    },
    rpc: () => Promise.resolve({ data: null, maybeSingle: () => ({ data: null }) }),
  },
}))

const AppSidebar = (await import('../../src/components/AppSidebar.vue')).default
const AuthShell = (await import('../../src/components/AuthShell.vue')).default
const Alert = (await import('../../src/components/ui/Alert.vue')).default
const Input = (await import('../../src/components/ui/Input.vue')).default

/** `router-link` is not registered outside a real router. */
const ROUTER_LINK_STUB = {
  props: ['to'],
  render() {
    return h('a', { href: this.to, class: 'nav-item' }, this.$slots.default?.())
  },
}

async function render(component, props = {}, slots = {}) {
  const app = createSSRApp(component, props)
  app.component('RouterLink', ROUTER_LINK_STUB)
  const errors = []
  const warnings = []
  app.config.errorHandler = (err) => errors.push(err)
  app.config.warnHandler = (msg) => warnings.push(msg)
  const html = await renderToString(app, slots)
  return { html, errors, warnings }
}

describe('AppSidebar', () => {
  it('renders the nav without error', async () => {
    const { errors, warnings } = await render(AppSidebar, { userName: 'Grace' })
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
  })

  it('greets the signed-in user, and says User when the name has not arrived', async () => {
    expect((await render(AppSidebar, { userName: 'Grace' })).html).toContain('Hello, Grace!')
    expect((await render(AppSidebar)).html).toContain('Hello, User!')
  })

  // The point of the migration. Every icon used to be a string of SVG markup
  // interpolated with v-html — the latent sink SECURITY.md §4.1 flags. If a
  // future edit reintroduces one, the glyph renders identically and only this
  // fails.
  it('draws its icons as real <path> elements, never through v-html', async () => {
    const { html } = await render(AppSidebar)
    expect(html).toContain('<path')
    expect(html).toContain('<svg')
    // The old strings carried their own width/height attributes on the svg,
    // which Icon.vue binds instead. A literal `<svg xmlns=` inside a `<span>`
    // is what v-html output looked like.
    expect(html).not.toMatch(/<span[^>]*class="nav-icon"[^>]*><svg/)
  })

  // Amendment 17: the IA ships whole so the sidebar stops churning, but a slot
  // with no screen behind it must not be activatable. `aria-disabled` on an
  // <a href> still lets a keyboard user follow it; a disabled <button> does not.
  it('renders the unbuilt screens as disabled buttons badged Soon, not as links', async () => {
    const { html } = await render(AppSidebar)

    // The apostrophe arrives HTML-escaped, as it should.
    for (const label of ['Overview', 'Statistics', 'What&#39;s next']) {
      expect(html, label).toContain(label)
    }
    expect(html).toContain('Soon')
    expect(html).not.toContain('href="/dashboard/overview"')
    expect(html).not.toContain('href="/dashboard/statistics"')
    expect(html).not.toContain('href="/dashboard/whats-next"')

    const soonButtons = html.match(/nav-item-soon/g) ?? []
    expect(soonButtons.length).toBe(3)
  })

  // Presentation only — RLS is the enforcement (ADR-0001). With no session the
  // capability flags are all false, which is the case that must not leak a
  // finance or attendance link.
  it('hides capability-gated items from a caller with no permissions', async () => {
    const { html } = await render(AppSidebar)

    expect(html).toContain('Members')
    expect(html).toContain('Groups')
    expect(html).not.toContain('Attendance')
    expect(html).not.toContain('Collections')
    expect(html).not.toContain('Expenses')
  })

  it('labels the theme toggle with the action it performs', async () => {
    const { html } = await render(AppSidebar)
    // Not "Theme" or an unlabelled sun: the control has to say what pressing
    // it does, since the icon alone is ambiguous about which state it shows.
    expect(html).toContain('Switch to dark theme')
  })
})

describe('AuthShell', () => {
  it('renders the mark, the heading and the standing footer note', async () => {
    const { html, errors, warnings } = await render(AuthShell, { title: 'UDFC Dashboard' })
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
    expect(html).toContain('UDFC Dashboard')
    expect(html).toContain('United Door of Faith Church')
    expect(html).toContain('Protected system for authorized church staff only.')
  })

  it('lets a page replace the footer note', async () => {
    const host = {
      render: () =>
        h(AuthShell, { title: '404' }, { footer: () => h('p', 'United Door of Faith Church') }),
    }
    const { html } = await render(host)
    expect(html).not.toContain('Protected system')
  })

  it('carries no hardcoded hex, so the whole family follows the theme', async () => {
    const { html } = await render(AuthShell, { title: 'Set Your Password' })
    expect(html).not.toMatch(/#[0-9a-f]{6}/i)
  })
})

describe('Alert', () => {
  it('announces an error assertively and a standing note not at all', async () => {
    const asError = {
      render: () => h(Alert, { tone: 'error' }, { default: () => 'Invalid login credentials' }),
    }
    const { html, warnings } = await render(asError)
    expect(warnings).toEqual([])
    expect(html).toContain('role="alert"')
    expect(html).toContain('Invalid login credentials')

    // A permanent informational block that interrupts the screen reader every
    // time the page renders is worse than one that waits to be read.
    const asInfo = { render: () => h(Alert, { tone: 'info' }, { default: () => 'Waiting.' }) }
    expect((await render(asInfo)).html).not.toContain('role="alert"')
  })

  it('renders every documented tone with its own icon', async () => {
    for (const tone of ['info', 'success', 'warning', 'error']) {
      const host = { render: () => h(Alert, { tone }, { default: () => 'x' }) }
      const { html, warnings } = await render(host)
      expect(warnings, tone).toEqual([])
      expect(html, tone).toContain(`alert-${tone}`)
      expect(html, tone).toContain('<path')
    }
  })
})

describe('Input attribute passthrough', () => {
  // Regression. The wrapper is a <div>, so without `inheritAttrs: false` every
  // unnamed attribute landed on IT: `autocomplete="current-password"` on a
  // div is ignored silently, and the password manager simply stops filling
  // the form. Nothing about the rendered page looks wrong.
  it('puts autocomplete and minlength on the control, not the wrapper', async () => {
    const host = {
      render: () =>
        h(Input, {
          label: 'Password',
          type: 'password',
          autocomplete: 'current-password',
          minlength: '8',
        }),
    }
    const { html } = await render(host)

    // `<input\s`, not `<input`: SSR renders the SFC's comments into the markup
    // and one of them names `<input>` in prose.
    const control = html.match(/<input\s[^>]*>/)?.[0]
    expect(control).toBeTruthy()
    expect(control).toContain('autocomplete="current-password"')
    expect(control).toContain('minlength="8"')
    expect(html).not.toMatch(/<div[^>]*autocomplete=/)
  })
})

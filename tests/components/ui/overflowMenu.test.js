// OverflowMenu — the ⋯ action menu that collapses a page's secondary actions
// (5 - Action Bar System). Same SSR approach as primitives.test.js: no jsdom and
// no @vue/test-utils, so the open/close INTERACTION (Escape, outside click, focus
// restore) is the same hand-rolled pattern SettingsMenu already ships and is not
// re-tested here. What IS asserted is the closed-state contract, because one part
// of it is the whole reason the component exists:
//
//   the menu appears ONLY when it has something to hold.
//
// A page with no page-level secondary actions (Members, a ministry a caller
// cannot edit) must render no ⋯ at all — an empty menu is the failure the audit
// set out to remove, not a smaller version of the same clutter.

import { describe, expect, it } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'

import OverflowMenu from '../../../src/components/ui/OverflowMenu.vue'

async function render(props = {}) {
  const app = createSSRApp(OverflowMenu, props)
  const errors = []
  const warnings = []
  app.config.errorHandler = (err) => errors.push(err)
  app.config.warnHandler = (msg) => warnings.push(msg)
  const html = await renderToString(app)
  return { html, errors, warnings }
}

const noop = () => {}

describe('OverflowMenu', () => {
  it('renders nothing at all when it has no items', async () => {
    const { html, errors, warnings } = await render({ items: [] })
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
    // No trigger, no menu wiring — the corner is genuinely empty, not a ⋯ that
    // opens onto nothing.
    expect(html).not.toContain('om__trigger')
    expect(html).not.toContain('aria-haspopup')
  })

  it('defaults to no items, so a caller that passes none also renders nothing', async () => {
    const { html, warnings } = await render({})
    expect(warnings).toEqual([])
    expect(html).not.toContain('om__trigger')
  })

  it('renders a labelled menu trigger when it has items', async () => {
    const { html, errors, warnings } = await render({
      items: [
        { key: 'edit', label: 'Edit group', onSelect: noop },
        { key: 'delete', label: 'Delete', onSelect: noop, danger: true },
      ],
    })
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
    expect(html).toContain('om__trigger')
    // Icon-only trigger, so it must carry its own accessible name and announce
    // that it opens a menu.
    expect(html).toContain('aria-haspopup="menu"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toMatch(/aria-label="[^"]+"/)
    // The dots glyph is three <circle>s (iconPaths.dots), never a <path>.
    expect(html).toContain('<circle')
  })

  it('renders its items into the DOM even while closed, so gating stays observable', async () => {
    // v-show, not v-if: a caller can assert that the actions a capability grants
    // are present (and those it withholds are absent) without opening the menu.
    const { html } = await render({
      items: [
        { key: 'edit', label: 'Edit group', onSelect: noop },
        { key: 'delete', label: 'Delete', onSelect: noop, danger: true, dividerBefore: true },
      ],
    })
    expect(html).toContain('Edit group')
    expect(html).toContain('Delete')
    expect(html).toContain('role="menuitem"')
    // The destructive item carries its own class so it can be styled apart.
    expect(html).toContain('om__item--danger')
    expect(html).toContain('om__rule')
  })

  it('takes a custom trigger label for its accessible name', async () => {
    const { html } = await render({
      label: 'Group actions',
      items: [{ key: 'edit', label: 'Edit group', onSelect: noop }],
    })
    expect(html).toContain('aria-label="Group actions"')
  })
})

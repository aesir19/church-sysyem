// Modal is the one ui/ component wrapping the new runtime dependency
// (reka-ui, ADR-0011), so it gets its own file.
//
// WHAT CANNOT BE TESTED HERE, AND WHY THAT IS NOT A GAP TO FIX WITH A MOCK.
// Reka UI's DialogPortal renders NOTHING during server-side rendering — it has
// no DOM to portal into — so an open dialog's markup is simply not reachable
// from `vue/server-renderer`. With vitest.config.js on `environment: 'node'`
// there is no DOM at all. Asserting on the dialog's rendered title or close
// button is therefore impossible here, and faking it would test the fake.
//
// So this file tests the two things that ARE real and that would actually
// break: that the named imports Modal depends on still exist in the installed
// reka-ui, and that the component mounts clean. A primitive renamed between
// versions is the concrete failure mode — it ships a dialog that renders as an
// empty portal, which no build step catches. The focus trap, Escape and
// return-focus behaviour is Reka UI's own tested responsibility.
//
// This is a known tooling gap: adding
// @vue/test-utils + happy-dom would close it, is dev-only, and is worth an
// explicit ask before doing it.

import { describe, expect, it } from 'vitest'
import { createSSRApp, h, ref } from 'vue'
import { renderToString } from 'vue/server-renderer'
import * as reka from 'reka-ui'
import { DialogContent, DialogDescription, DialogRoot } from 'reka-ui'
import Modal from '../../../src/components/ui/Modal.vue'

/** Exactly the primitives Modal.vue imports. */
const REQUIRED_PRIMITIVES = [
  'DialogRoot',
  'DialogPortal',
  'DialogOverlay',
  'DialogContent',
  'DialogTitle',
  'DialogDescription',
  'DialogClose',
]

async function renderModal(props, open = true) {
  const isOpen = ref(open)
  const host = {
    render() {
      return h(
        Modal,
        { ...props, open: isOpen.value, 'onUpdate:open': (value) => (isOpen.value = value) },
        { default: () => 'Body copy', footer: () => h('button', 'Confirm') },
      )
    },
  }

  const app = createSSRApp(host)
  const errors = []
  const warnings = []
  app.config.errorHandler = (err) => errors.push(err)
  // An import that resolved to undefined surfaces as a Vue warning, not an
  // exception — which is the whole reason this handler is here.
  app.config.warnHandler = (msg) => warnings.push(msg)

  const context = {}
  const html = await renderToString(app, context)
  const teleported = Object.values(context.teleports ?? {}).join('')

  return { html: html + teleported, errors, warnings }
}

describe('reka-ui Dialog surface', () => {
  // Radix Vue was renamed to Reka UI in 2024 and the primitives were carried
  // across; this is what would catch the next such rename at `npm install`
  // time rather than in production.
  it('still exports every primitive Modal.vue imports', () => {
    for (const name of REQUIRED_PRIMITIVES) {
      expect(reka[name], `reka-ui no longer exports ${name}`).toBeTruthy()
    }
  })
})

// Modal cannot be rendered far enough under SSR to inspect this — its portal
// produces nothing. But the primitives CAN be rendered without the portal, and
// what actually matters is the library contract Modal is written against. This
// pins it.
//
// The bug: `:aria-describedby="undefined"` does not mean "leave it alone".
// Vue's mergeProps treats a key as PRESENT even when its value is undefined, so
// fallthrough attrs win over the child's internal default and the association
// Reka just made is deleted. A dialog with a visible description announced
// none of it — and Reka's own dev warning cannot catch this, because it only
// fires on a DANGLING aria-describedby, not a missing one.
describe('reka Dialog aria-describedby contract', () => {
  async function describedByFor(attrs) {
    const app = createSSRApp({
      render: () =>
        h(DialogRoot, { open: true }, () =>
          h(DialogContent, attrs, () => [h(DialogDescription, () => 'Cannot be undone.')]),
        ),
    })
    app.config.warnHandler = () => {}

    const html = await renderToString(app)
    return {
      describedBy: html.match(/aria-describedby="([^"]*)"/)?.[1],
      descriptionId: html.match(/id="(reka-dialog-description[^"]*)"/)?.[1],
    }
  }

  it('links the description when nothing overrides it — what Modal now does', async () => {
    const { describedBy, descriptionId } = await describedByFor({})
    expect(descriptionId).toBeTruthy()
    expect(describedBy).toBe(descriptionId)
  })

  it('DELETES the link when bound to undefined — the regression', async () => {
    const { describedBy, descriptionId } = await describedByFor({ 'aria-describedby': undefined })
    expect(descriptionId).toBeTruthy()
    expect(describedBy).toBeUndefined()
  })
})

describe('Modal', () => {

  it('mounts clean, with no unresolved component', async () => {
    const { errors, warnings } = await renderModal({ title: 'Delete Small Group' })
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
  })

  it('accepts both documented sizes and an optional description', async () => {
    for (const size of ['default', 'wide']) {
      const { errors, warnings } = await renderModal({
        title: 'Sized',
        size,
        description: 'This cannot be undone.',
      })
      expect(errors, size).toEqual([])
      expect(warnings, size).toEqual([])
    }
  })

  it('renders no body content while closed', async () => {
    const { html, errors } = await renderModal({ title: 'Closed' }, false)
    expect(errors).toEqual([])
    expect(html).not.toContain('Body copy')
  })

  it('requires a title, because a dialog with no accessible name is unusable', () => {
    expect(Modal.props.title.required).toBe(true)
  })

  it('leaves outside-click dismissal on by default and allows opting out', () => {
    // Escape is deliberately NOT covered by this prop: a dialog that cannot be
    // dismissed from the keyboard is the trap this component exists to remove.
    expect(Modal.props.closeOnOutsideClick.default).toBe(true)
  })
})

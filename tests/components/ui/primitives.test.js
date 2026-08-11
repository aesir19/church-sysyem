// SSR smoke coverage for the shared ui/ primitives.
//
// This project has no @vue/test-utils and no jsdom/happy-dom — vitest.config.js
// runs `environment: 'node'` — so these render through vue/server-renderer, the
// same approach tests/views/churchFundsView.test.js already takes. Genuine DOM
// interaction (does Escape close the modal, does Tab stay inside it) is Reka
// UI's own tested responsibility and is not re-tested here.
//
// What IS asserted is the accessibility wiring, because that is the class of
// bug this whole phase exists to fix and the class that fails silently: a
// missing `for`/`id` pair, an `aria-describedby` that points at nothing, an
// `aria-sort` that never reaches the <th>. All of those render a page that
// looks perfect and is unusable, and none of them show up in `npm run build`.

import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

import AppLogo from '../../../src/components/AppLogo.vue'
import Badge from '../../../src/components/ui/Badge.vue'
import Button from '../../../src/components/ui/Button.vue'
import Card from '../../../src/components/ui/Card.vue'
import Icon from '../../../src/components/ui/icons/Icon.vue'
import Input from '../../../src/components/ui/Input.vue'
import Spinner from '../../../src/components/ui/Spinner.vue'
import TableSortHeader from '../../../src/components/ui/TableSortHeader.vue'
import Toast from '../../../src/components/ui/Toast.vue'
import ToastHost from '../../../src/components/ui/ToastHost.vue'
import { ICON_NAMES } from '../../../src/components/ui/icons/iconPaths'

async function render(component, props = {}, slots = {}) {
  const app = createSSRApp(component, props)
  const errors = []
  app.config.errorHandler = (err) => errors.push(err)
  // Vue logs prop-validator failures as warnings rather than throwing, so a
  // bad `variant` would otherwise pass silently.
  const warnings = []
  app.config.warnHandler = (msg) => warnings.push(msg)

  const html = await renderToString(app, slots)
  return { html, errors, warnings }
}

/** Render with default slot content, which createSSRApp props alone cannot do. */
async function renderWithSlot(component, props, slotText) {
  const wrapper = {
    render() {
      return h(component, props, { default: () => slotText })
    },
  }
  return render(wrapper)
}

describe('Button', () => {
  it('renders its label and defaults to type=button', async () => {
    const { html, errors, warnings } = await renderWithSlot(Button, {}, 'Save')
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
    expect(html).toContain('Save')
    // A bare <button> inside a form submits it. Every hand-rolled call site in
    // this app has to remember type="button"; this default is why they no
    // longer have to.
    expect(html).toContain('type="button"')
  })

  it('marks a loading button busy and disabled', async () => {
    const { html } = await renderWithSlot(Button, { loading: true }, 'Saving')
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('disabled')
  })

  it('renders every documented variant without a validator warning', async () => {
    for (const variant of ['primary', 'secondary', 'tertiary', 'danger', 'ghost']) {
      const { warnings, html } = await renderWithSlot(Button, { variant }, 'x')
      expect(warnings, variant).toEqual([])
      expect(html).toContain(`btn-${variant}`)
    }
  })
})

describe('Input', () => {
  it('pairs the label to the control, so clicking the label focuses it', async () => {
    const { html, errors } = await render(Input, { label: 'Email Address' })
    expect(errors).toEqual([])

    const forAttr = html.match(/for="([^"]+)"/)?.[1]
    const idAttr = html.match(/id="([^"]+)"/)?.[1]
    expect(forAttr).toBeTruthy()
    expect(idAttr).toBe(forAttr)
  })

  it('points aria-describedby at the hint and the error that exist', async () => {
    const { html } = await render(Input, {
      label: 'Amount',
      hint: 'Pesos only.',
      error: 'Enter an amount greater than zero.',
    })

    const described = html.match(/aria-describedby="([^"]+)"/)?.[1]
    expect(described).toBeTruthy()

    // Every id it names must actually be in the document. A dangling reference
    // is the specific failure that reads fine and announces nothing.
    for (const id of described.split(' ')) {
      expect(html, `dangling aria-describedby target: ${id}`).toContain(`id="${id}"`)
    }
    expect(described.split(' ')).toHaveLength(2)
  })

  it('omits aria-describedby entirely when there is nothing to describe', async () => {
    const { html } = await render(Input, { label: 'Email' })
    expect(html).not.toContain('aria-describedby')
  })

  it('flags an errored control as invalid and announces the message', async () => {
    const { html } = await render(Input, { label: 'Amount', error: 'Required.' })
    expect(html).toContain('aria-invalid="true"')
    expect(html).toContain('role="alert"')
  })

  // Regression. This was built with a single `<component :is="as">`, which made
  // the compiler emit the COMPONENT v-model protocol — a `modelValue` prop —
  // because it cannot know statically that `as` resolves to an element. The
  // field rendered empty however full the model was, and typing updated
  // nothing. It looked completely correct until someone loaded the page.
  it('binds the model to the control rather than a stray modelvalue attribute', async () => {
    for (const as of ['input', 'textarea', 'select']) {
      const { html } = await render(Input, { label: 'Amount', as, modelValue: 'Juan' })
      // Matching the ATTRIBUTE, not the bare word: SSR renders comments into
      // the markup, and the comment in Input.vue explaining this very bug
      // names `modelValue` in prose.
      expect(html, as).not.toMatch(/\smodelvalue=/i)
    }
  })

  it('renders the current value into a text control', async () => {
    const { html } = await render(Input, { label: 'Amount', modelValue: 'Juan' })
    expect(html).toContain('value="Juan"')
  })

  it('gives two instances on one page distinct ids', async () => {
    const two = {
      render: () => h('div', [h(Input, { label: 'One' }), h(Input, { label: 'Two' })]),
    }
    const { html } = await render(two)
    const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1])
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('TableSortHeader', () => {
  it('puts aria-sort on the th and the handler on a real button', async () => {
    const { html, errors } = await renderWithSlot(
      TableSortHeader,
      { sortKey: 'last_name', ariaSort: 'ascending' },
      'Last Name',
    )
    expect(errors).toEqual([])
    expect(html).toContain('aria-sort="ascending"')
    // The entire point of D11's second sub-fix: a <th> is not focusable or
    // activatable, so the action has to live on a button inside it.
    expect(html).toContain('<button')
    expect(html).toContain('Last Name')
  })

  it('reports an unsorted column as none rather than omitting the attribute', async () => {
    const { html } = await renderWithSlot(TableSortHeader, { sortKey: 'age' }, 'Age')
    expect(html).toContain('aria-sort="none"')
  })
})

describe('Icon', () => {
  it('renders a path for every name in the set', async () => {
    for (const name of ICON_NAMES) {
      const { html, errors } = await render(Icon, { name })
      expect(errors, name).toEqual([])
      expect(html, name).toContain('<path')
    }
  })

  it('renders nothing rather than throwing for an unknown name', async () => {
    const { html, errors } = await render(Icon, { name: 'no-such-icon' })
    expect(errors).toEqual([])
    expect(html).not.toContain('<path')
  })

  it('is decorative unless given a title', async () => {
    const { html } = await render(Icon, { name: 'x' })
    expect(html).toContain('aria-hidden="true"')

    const titled = await render(Icon, { name: 'x', title: 'Close' })
    expect(titled.html).toContain('role="img"')
    expect(titled.html).toContain('Close')
    expect(titled.html).not.toContain('aria-hidden')
  })
})

describe('Toast', () => {
  it('renders the message and a dismiss control', async () => {
    const { html, errors } = await render(Toast, { message: 'Member saved.', type: 'success' })
    expect(errors).toEqual([])
    expect(html).toContain('Member saved.')
    expect(html).toContain('aria-label="Dismiss"')
  })
})

describe('ToastHost', () => {
  it('declares the live region up front, while empty', async () => {
    const { html, errors } = await render(ToastHost)
    expect(errors).toEqual([])
    // A live region inserted at the same moment as its first message is often
    // not announced at all — assistive tech has to already be watching it.
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('role="status"')
  })
})

describe('Card / Badge / Spinner / AppLogo', () => {
  it('render without error', async () => {
    for (const [name, component, props] of [
      ['Card', Card, {}],
      ['Badge', Badge, { variant: 'success' }],
      ['Spinner', Spinner, {}],
      ['AppLogo', AppLogo, {}],
    ]) {
      const { errors, warnings } = await renderWithSlot(component, props, 'content')
      expect(errors, name).toEqual([])
      expect(warnings, name).toEqual([])
    }
  })

  it('keeps a bare Spinner decorative and labels one that stands alone', async () => {
    expect((await render(Spinner)).html).toContain('aria-hidden="true"')

    const labelled = await render(Spinner, { label: 'Loading members' })
    expect(labelled.html).toContain('role="status"')
    expect(labelled.html).toContain('Loading members')
  })

  it('draws the logo from currentColor, not a welded-in hex', async () => {
    const { html } = await render(AppLogo)
    // The three copies this replaces all hardcoded #1a56db, which is exactly
    // what stops a mark following the theme into dark mode.
    expect(html).not.toContain('#1a56db')
    expect(html).toContain('currentColor')
  })
})

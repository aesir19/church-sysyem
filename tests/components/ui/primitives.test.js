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
import Toggle from '../../../src/components/ui/Toggle.vue'
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

  // The redesign's variant set. `tertiary` is gone and `dangerQuiet` and
  // `onDark` are new: the mockups put a destructive action BESIDE a safe one in
  // the edit-member and unsaved-changes footers, which needs a quieter
  // destructive style than the solid one, and the bulk bar and undo toast sit on
  // the dark panel where secondary and ghost both disappear.
  it('renders every documented variant without a validator warning', async () => {
    for (const variant of ['primary', 'secondary', 'danger', 'dangerQuiet', 'ghost', 'onDark']) {
      const { warnings, html } = await renderWithSlot(Button, { variant }, 'x')
      expect(warnings, variant).toEqual([])
      expect(html).toContain(`btn--${variant}`)
    }
  })

  // A variant outside the set must be refused by the validator rather than
  // silently rendering an unstyled button.
  it('warns on a variant that is not in the set', async () => {
    const { warnings } = await renderWithSlot(Button, { variant: 'tertiary' }, 'x')
    expect(warnings.length).toBeGreaterThan(0)
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

  // `as` renders the element it names. Until this was asserted the test above
  // passed vacuously: with inheritAttrs off, an unknown `as` simply landed in
  // $attrs and was painted onto the <input> as a dead attribute, so a caller
  // asking for a select silently got a text box.
  it('renders the element named by `as`', async () => {
    const cases = { input: '<input', textarea: '<textarea', select: '<select' }
    for (const [as, tag] of Object.entries(cases)) {
      const { html, errors } = await render(Input, { label: 'Field', as })
      expect(errors, as).toEqual([])
      expect(html, as).toContain(tag)
      // And ONLY that one — a stray second control would take focus and submit
      // an empty value alongside the real one.
      for (const [otherAs, otherTag] of Object.entries(cases)) {
        if (otherAs !== as) expect(html, `${as} also rendered ${otherAs}`).not.toContain(otherTag)
      }
    }
  })

  it('warns on an `as` outside the set rather than rendering something arbitrary', async () => {
    const { warnings } = await render(Input, { label: 'Field', as: 'div' })
    expect(warnings.length).toBeGreaterThan(0)
  })

  it('keeps the label paired to the control whatever `as` renders', async () => {
    for (const as of ['input', 'textarea', 'select']) {
      const { html } = await render(Input, { label: 'Reason', as })
      const forAttr = html.match(/for="([^"]+)"/)?.[1]
      expect(forAttr, as).toBeTruthy()
      expect(html, as).toContain(`id="${forAttr}"`)
    }
  })

  it('puts the options given to a select inside the select', async () => {
    const wrapper = {
      render: () => h(Input, { label: 'Gender', as: 'select', modelValue: 'Female' }, {
        default: () => [h('option', { value: 'Male' }, 'Male'), h('option', { value: 'Female' }, 'Female')],
      }),
    }
    const { html } = await render(wrapper)
    const select = html.slice(html.indexOf('<select'), html.indexOf('</select>'))
    expect(select).toContain('Male')
    expect(select).toContain('Female')
    // v-model, not :value. SSR renders neither a `value` attribute nor a
    // `selected` option for a v-model select — the selection is made by
    // vModelSelect's mounted hook — so the assertion that matters here is the
    // NEGATIVE one: a `value` attribute on a <select> does nothing at all in
    // HTML, and its presence would mean the binding had been changed back to
    // `:value`, where the selection depends on Vue's mount ordering and an
    // edited member's gender can silently reset to the first option.
    expect(select).not.toMatch(/<select[^>]*\svalue=/)
  })

  it('renders a textarea value as content, which is the only place a textarea keeps it', async () => {
    const { html } = await render(Input, { label: 'Reason', as: 'textarea', modelValue: 'Moved away' })
    expect(html).toContain('Moved away')
    // Never as an attribute: <textarea value="x"> renders an EMPTY box.
    expect(html).not.toMatch(/<textarea[^>]*\svalue=/)
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
  // Geometry, not specifically <path>. The icons are lifted verbatim from the
  // design handoff's own markup, and several are drawn entirely without one:
  // `overview` is four <rect>s, `statistics` is three <line>s, `dots` is three
  // <circle>s. Asserting <path> would fail those for being faithful.
  it('renders geometry for every name in the set', async () => {
    for (const name of ICON_NAMES) {
      const { html, errors } = await render(Icon, { name })
      expect(errors, name).toEqual([])
      expect(html, name).toMatch(/<(path|rect|circle|line|polyline)\b/)
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
  // The payload is now an object rather than a bare string: the mockups' toasts
  // carry a title, an optional second line, and an optional single action
  // (Retry / Undo / View).
  it('renders the title, the body and a dismiss control', async () => {
    const { html, errors } = await render(Toast, {
      toast: { id: 1, title: 'Member saved.', body: 'Ramon Villanueva is on the roll.', type: 'success' },
    })
    expect(errors).toEqual([])
    expect(html).toContain('Member saved.')
    expect(html).toContain('Ramon Villanueva is on the roll.')
    expect(html).toContain('aria-label="Dismiss notification"')
  })

  it('renders the action when one is given, and none when it is not', async () => {
    const withAction = await render(Toast, {
      toast: { id: 1, title: 'Could not save.', type: 'error', action: { label: 'Retry' } },
    })
    expect(withAction.html).toContain('Retry')

    const without = await render(Toast, { toast: { id: 2, title: 'Saved.', type: 'success' } })
    expect(without.html).not.toContain('toast__action')
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

describe('Toggle', () => {
  // role="switch" announces on/off; a checkbox announces checked/unchecked and
  // a bare <button> announces nothing about its state at all. These control
  // whether somebody is recorded as baptized — the state has to be readable
  // without seeing the knob.
  it('is a switch that reports its state', async () => {
    const on = await renderWithSlot(Toggle, { modelValue: true }, 'Baptized')
    expect(on.errors).toEqual([])
    expect(on.html).toContain('role="switch"')
    expect(on.html).toContain('aria-checked="true"')
    expect(on.html).toContain('Baptized')

    const off = await renderWithSlot(Toggle, { modelValue: false }, 'Baptized')
    expect(off.html).toContain('aria-checked="false"')
  })

  // Never omitted when false. An absent aria-checked reads as "not a switch",
  // which is a different thing from "a switch that is off".
  it('states aria-checked in both directions rather than omitting it', async () => {
    const off = await renderWithSlot(Toggle, { modelValue: false }, 'x')
    expect(off.html).toMatch(/aria-checked="(true|false)"/)
  })

  it('is a button, so it is reachable and activatable from a keyboard', async () => {
    const { html } = await renderWithSlot(Toggle, {}, 'x')
    expect(html).toContain('<button')
    // Inside a form, a bare <button> submits it.
    expect(html).toContain('type="button"')
  })

  it('renders the band variant without changing what it is', async () => {
    const { html, warnings } = await renderWithSlot(Toggle, { band: true, modelValue: true }, 'Start the journey')
    expect(warnings).toEqual([])
    expect(html).toContain('tgl--band')
    expect(html).toContain('role="switch"')
  })

  it('disables rather than silently ignoring a click', async () => {
    const { html } = await renderWithSlot(Toggle, { disabled: true }, 'x')
    expect(html).toContain('disabled')
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

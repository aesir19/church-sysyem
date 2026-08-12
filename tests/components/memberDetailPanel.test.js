// The rendered half of the facebook_link link rules.
//
// tests/utils/memberLink.test.js proves the validator decides correctly. This
// proves the component ACTS on that decision — condition 3 (the link carries
// `target="_blank"` and `rel="noopener noreferrer"`) and condition 4 (a value
// that fails validation renders as plain text, never as a broken or silently
// stripped link). Those two live in markup, so only rendering catches them.
//
// SSR is enough here: this component has no dialog, no portal and no
// interaction — it is a presentation of a row. The tooling gap this project
// has (no @vue/test-utils, no DOM environment) does not bite.

import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import MemberDetailPanel from '../../src/components/MemberDetailPanel.vue'

const MEMBER = {
  id: 'm1',
  first_name: 'Juan',
  middle_name: 'Reyes',
  last_name: 'Dela Cruz',
  birthdate: '1990-03-04',
  gender: 'Male',
  marital_status: 'Single',
  address: '12 Mabini St',
  contact_number: '09170000000',
  email: 'juan@example.com',
  date_joined: '2020-01-05',
  facebook_link: null,
  is_baptized: true,
  is_one_to_one_completed: false,
  is_turning_point_completed: false,
}

async function render(member, churchName = 'Cabuyao') {
  const app = createSSRApp({
    render: () => h(MemberDetailPanel, { member, churchName }),
  })
  const warnings = []
  app.config.warnHandler = (msg) => warnings.push(msg)
  return { html: await renderToString(app), warnings }
}

/**
 * Just the Facebook key/value row.
 *
 * These assertions used to search the WHOLE panel for `href=`, which worked
 * only because the old panel linked nothing else. The redesigned panel makes
 * the phone a `tel:` link and the email a `mailto:` one, so a document-wide
 * search now says "there is a link" no matter what the facebook rule did. The
 * intent of the test is unchanged — it is the blast radius that was wrong.
 */
function facebookRow(html) {
  const start = html.indexOf('>Facebook<')
  if (start === -1) return ''
  const end = html.indexOf('</div>', start)
  return html.slice(start, end === -1 ? undefined : end)
}

describe('MemberDetailPanel', () => {
  it('renders the record without warnings', async () => {
    const { html, warnings } = await render(MEMBER)
    expect(warnings).toEqual([])
    // The redesign abbreviates the middle name to an initial — the mockups
    // render "Grace L Abad" and "Marites S. Cordero", never the full middle
    // name. The whole value is still on the record and still editable; this is
    // presentation only.
    expect(html).toContain('Juan R. Dela Cruz')
    expect(html).toContain('Cabuyao')
  })

  it('shows the em-dash placeholder for a field that legitimately has no value', async () => {
    const { html } = await render({ ...MEMBER, address: null })
    expect(html).toContain('—')
  })

  it('hides the wedding anniversary row unless the member is married', async () => {
    const single = await render(MEMBER)
    expect(single.html).not.toContain('Wedding anniversary')

    const married = await render({
      ...MEMBER,
      marital_status: 'Married',
      wedding_anniversarry: '2015-06-06',
    })
    expect(married.html).toContain('Wedding anniversary')
  })
})

describe('facebook_link rendering — conditions 3 and 4', () => {
  it('renders an allowlisted https link as an anchor with both rel tokens', async () => {
    const { html } = await render({ ...MEMBER, facebook_link: 'https://facebook.com/juan' })

    expect(html).toContain('href="https://facebook.com/juan"')
    expect(html).toContain('target="_blank"')
    // noreferrer alone would be enough in a current browser; noopener is what
    // keeps an older one from handing the new tab a live window.opener.
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('renders a disallowed host as plain text, still showing the value', async () => {
    const evil = 'https://facebook.com.evil.example/juan'
    const { html } = await render({ ...MEMBER, facebook_link: evil })

    expect(facebookRow(html)).not.toContain('<a ')
    expect(facebookRow(html)).not.toContain('href=')
    // Condition 4: shown, not silently dropped. Hiding bad data is how it
    // survives in the column.
    expect(html).toContain('evil.example')
  })

  it('never renders a javascript: value as a link', async () => {
    const { html } = await render({ ...MEMBER, facebook_link: 'javascript:alert(1)' })
    expect(facebookRow(html)).not.toContain('href=')
  })

  it('renders http:// as plain text — the scheme check is not decoration', async () => {
    const { html } = await render({ ...MEMBER, facebook_link: 'http://facebook.com/juan' })
    expect(facebookRow(html)).not.toContain('href=')
  })

  it('falls back to the placeholder when there is no link at all', async () => {
    const { html } = await render({ ...MEMBER, facebook_link: null })
    expect(facebookRow(html)).not.toContain('href=')
    expect(html).toContain('Facebook')
  })
})

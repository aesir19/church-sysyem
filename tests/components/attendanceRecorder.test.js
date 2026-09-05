import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

vi.mock('../../src/lib/supabase', () => ({
  supabase: { from: vi.fn() }
}))

vi.mock('../../src/composables/useToast', () => ({
  showToast: vi.fn()
}))

import AttendanceRecorder from '../../src/components/attendance/AttendanceRecorder.vue'

const props = {
  serviceId: 'service-1',
  serviceLabel: 'Sunday Service',
  serviceDate: '5 September 2026',
  recorded: 12,
  churchId: 'church-1',
  members: [
    { id: 'member-1', first_name: 'Maria', middle_name: null, last_name: 'Santos' }
  ]
}

async function renderRecorder () {
  return renderToString(createSSRApp({
    render: () => h(AttendanceRecorder, props)
  }))
}

describe('AttendanceRecorder', () => {
  beforeEach(() => vi.clearAllMocks())

  it('presents continuous attendance entry inline with the selected service context', async () => {
    const html = await renderRecorder()

    expect(html).toContain('<section')
    expect(html).not.toContain('role="dialog"')
    expect(html).toContain('Record attendance')
    expect(html).toContain('Sunday Service · 5 September 2026 · 12 recorded')
    expect(html).toContain('Search member')
    expect(html).toContain('First-time guest')
    expect(html).toContain('Mark present')
    expect(html).toContain('After saving, the field clears and stays ready for the next person.')
  })
})

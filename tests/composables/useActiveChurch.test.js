import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const state = vi.hoisted(() => ({
  homeCalls: 0,
  permissionCalls: 0,
  failFirstHome: false,
  failFirstPermissions: false,
}))

vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    auth: { onAuthStateChange: vi.fn() },
    rpc: vi.fn((name) => {
      if (name === 'get_my_church') {
        state.homeCalls += 1
        const failed = state.failFirstHome && state.homeCalls === 1
        return { maybeSingle: () => Promise.resolve(failed
          ? { data: null, error: { message: 'private backend detail' } }
          : { data: { id: 'church-1', name: 'Cogon' }, error: null }) }
      }
      return Promise.resolve({ data: [], error: null })
    }),
  },
}))

vi.mock('../../src/composables/useCurrentRole', () => ({
  useCurrentRole: () => ({
    isCrossChurch: ref(false),
    loadPermissions: vi.fn(() => {
      state.permissionCalls += 1
      return Promise.resolve(state.failFirstPermissions && state.permissionCalls === 1 ? null : { role: 'member' })
    }),
  }),
}))

const { clearActiveChurch, useActiveChurch } = await import('../../src/composables/useActiveChurch')

beforeEach(() => {
  clearActiveChurch()
  state.homeCalls = 0
  state.permissionCalls = 0
  state.failFirstHome = false
  state.failFirstPermissions = false
})

describe('useActiveChurch retry', () => {
  it('does not cache a failed lookup and succeeds on the next call', async () => {
    state.failFirstHome = true
    const church = useActiveChurch()

    expect(await church.ensureLoaded()).toBe(null)
    expect(church.loading.value).toBe(false)
    expect(church.loadError.value).toBe('Could not load your church. Please try again.')

    expect(await church.ensureLoaded()).toBe('church-1')
    expect(state.homeCalls).toBe(2)
    expect(church.loading.value).toBe(false)
    expect(church.loadError.value).toBe('')
  })

  it('does not cache a failed permissions lookup as a loaded church', async () => {
    state.failFirstPermissions = true
    const church = useActiveChurch()

    expect(await church.ensureLoaded()).toBe(null)
    expect(state.homeCalls).toBe(0)
    expect(church.loadError.value).toBe('Could not load your church. Please try again.')

    expect(await church.ensureLoaded()).toBe('church-1')
    expect(state.permissionCalls).toBe(2)
    expect(state.homeCalls).toBe(1)
  })
})

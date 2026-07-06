import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  session: null,
  linked: false,
  role: 'unassigned',
  hash: '',
  guard: null,
  afterGuard: null,
  authStateChangeHandler: null,
}))

const routerMock = vi.hoisted(() => ({
  beforeEach: vi.fn((cb) => {
    state.guard = cb
  }),
  afterEach: vi.fn((cb) => {
    state.afterGuard = cb
  }),
  push: vi.fn(),
}))

const supabaseMock = vi.hoisted(() => ({
  auth: {
    getSession: vi.fn(async () => ({ data: { session: state.session } })),
    onAuthStateChange: vi.fn((cb) => {
      state.authStateChangeHandler = cb
    }),
  },
  from: vi.fn(() => ({
    select: vi.fn((columns) => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn(async () => {
          if (!state.linked) return { data: null }
          if (columns === 'role') return { data: { role: state.role } }
          return { data: { id: 'user-1' } }
        }),
      })),
    })),
  })),
}))

vi.mock('vue-router', () => ({
  createWebHistory: vi.fn(() => ({})),
  createRouter: vi.fn(() => routerMock),
}))

vi.mock('../../src/lib/supabase', () => ({
  supabase: supabaseMock,
}))

function setWindowHash(hash) {
  state.hash = hash
  globalThis.window = {
    location: { hash },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }
}

async function loadRouter() {
  vi.resetModules()
  state.guard = null
  state.afterGuard = null
  state.authStateChangeHandler = null
  setWindowHash(state.hash)
  await import('../../src/router/index.js')
}

describe('router auth guards', () => {
  beforeEach(() => {
    state.session = null
    state.linked = false
    state.role = 'unassigned'
    state.hash = ''
    vi.clearAllMocks()
  })

  it('redirects unauthenticated users away from protected routes', async () => {
    await loadRouter()

    const next = vi.fn()
    await state.guard({ path: '/dashboard/members', meta: { requiresAuth: true } }, {}, next)

    expect(next).toHaveBeenCalledWith('/login')
  })

  it('redirects authenticated user from login to dashboard', async () => {
    state.session = { user: { id: 'user-1' } }
    state.linked = true
    await loadRouter()

    const next = vi.fn()
    await state.guard({ path: '/login', meta: {} }, {}, next)

    expect(next).toHaveBeenCalledWith('/dashboard')
  })

  it('forces set-password route when invite hash is present', async () => {
    state.session = { user: { id: 'user-1' } }
    state.linked = true
    state.hash = '#access_token=abc&type=invite'
    await loadRouter()

    const next = vi.fn()
    await state.guard({ path: '/login', meta: {} }, {}, next)

    expect(next).toHaveBeenCalledWith('/set-password')
  })

  it('sends unlinked authenticated users to account-pending', async () => {
    state.session = { user: { id: 'user-1' } }
    state.linked = false
    await loadRouter()

    const next = vi.fn()
    await state.guard({ path: '/dashboard/funds', meta: { requiresAuth: true } }, {}, next)

    expect(next).toHaveBeenCalledWith('/account-pending')
  })

  it('redirects account-pending users to dashboard once linked', async () => {
    state.session = { user: { id: 'user-1' } }
    state.linked = true
    await loadRouter()

    const next = vi.fn()
    await state.guard({ path: '/account-pending', meta: { requiresAuth: true } }, {}, next)

    expect(next).toHaveBeenCalledWith('/dashboard')
  })

  it('handles password recovery auth event and marks flow pending', async () => {
    state.session = { user: { id: 'user-1' } }
    state.linked = true
    await loadRouter()

    state.authStateChangeHandler('PASSWORD_RECOVERY')
    expect(routerMock.push).toHaveBeenCalledWith('/set-password')

    const next = vi.fn()
    await state.guard({ path: '/dashboard/members', meta: { requiresAuth: true } }, {}, next)
    expect(next).toHaveBeenCalledWith('/set-password')
  })

  it('clears pending password flag after leaving set-password route', async () => {
    state.session = { user: { id: 'user-1' } }
    state.linked = true
    state.hash = '#type=invite'
    await loadRouter()

    const firstNext = vi.fn()
    await state.guard({ path: '/login', meta: {} }, {}, firstNext)
    expect(firstNext).toHaveBeenCalledWith('/set-password')

    state.afterGuard({ path: '/dashboard' })

    const secondNext = vi.fn()
    await state.guard({ path: '/login', meta: {} }, {}, secondNext)
    expect(secondNext).toHaveBeenCalledWith('/dashboard')
  })

  it('redirects non-finance users away from collections route', async () => {
    state.session = { user: { id: 'user-1' } }
    state.linked = true
    state.role = 'unassigned'
    await loadRouter()

    const next = vi.fn()
    await state.guard(
      { path: '/dashboard/funds/collections', meta: { requiresAuth: true, requiresFinance: true } },
      {},
      next
    )

    expect(next).toHaveBeenCalledWith('/dashboard/funds/reports')
  })

  it('redirects non-finance users away from expenses route', async () => {
    state.session = { user: { id: 'user-1' } }
    state.linked = true
    state.role = 'unassigned'
    await loadRouter()

    const next = vi.fn()
    await state.guard(
      { path: '/dashboard/funds/expenses', meta: { requiresAuth: true, requiresFinance: true } },
      {},
      next
    )

    expect(next).toHaveBeenCalledWith('/dashboard/funds/reports')
  })

  it('allows finance-role users to access collections route', async () => {
    state.session = { user: { id: 'user-1' } }
    state.linked = true
    state.role = 'finance'
    await loadRouter()

    const next = vi.fn()
    await state.guard(
      { path: '/dashboard/funds/collections', meta: { requiresAuth: true, requiresFinance: true } },
      {},
      next
    )

    expect(next).toHaveBeenCalledWith()
  })

  it('allows finance-role users to access expenses route', async () => {
    state.session = { user: { id: 'user-1' } }
    state.linked = true
    state.role = 'finance'
    await loadRouter()

    const next = vi.fn()
    await state.guard(
      { path: '/dashboard/funds/expenses', meta: { requiresAuth: true, requiresFinance: true } },
      {},
      next
    )

    expect(next).toHaveBeenCalledWith()
  })
})

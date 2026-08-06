import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  session: null,
  linked: false,
  // Row returned by the get_my_permissions() RPC (null = no capabilities).
  permissions: null,
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
  // isAccountLinked() reads user_accounts.
  from: vi.fn(() => {
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      maybeSingle: vi.fn(async () =>
        state.linked ? { data: { id: 'user-1', member_id: 'member-1' } } : { data: null }
      ),
    }
    return chain
  }),
  // fetchCapabilities() reads the get_my_permissions() RPC.
  rpc: vi.fn(() => ({
    maybeSingle: vi.fn(async () => ({ data: state.permissions })),
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
    state.permissions = null
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

  it('lets an anonymous visitor reach the public check-in page', async () => {
    // /checkin carries no meta.requiresAuth. If it ever gains one, or the guard
    // stops short-circuiting on it, every attendee scanning the QR is bounced to
    // a login page they have no account for.
    state.session = null
    await loadRouter()

    const next = vi.fn()
    await state.guard({ path: '/checkin', meta: {} }, {}, next)

    expect(next).toHaveBeenCalledWith()
  })

  it('does not query the database when serving the public check-in page', async () => {
    // The public page is opened by people with no account, on church wifi, all
    // at once. It must not cost a session lookup or a user_accounts round-trip.
    state.session = null
    await loadRouter()
    supabaseMock.auth.getSession.mockClear()
    supabaseMock.from.mockClear()

    await state.guard({ path: '/checkin', meta: {} }, {}, vi.fn())

    expect(supabaseMock.auth.getSession).not.toHaveBeenCalled()
    expect(supabaseMock.from).not.toHaveBeenCalled()
  })

  it('keeps a signed-in staff member on the check-in page rather than redirecting to the dashboard', async () => {
    // A volunteer scanning the QR on their own phone is an ordinary case, and
    // the signed-in redirect must not hijack it.
    state.session = { user: { id: 'user-1' } }
    state.linked = true
    await loadRouter()

    const next = vi.fn()
    await state.guard({ path: '/checkin', meta: {} }, {}, next)

    expect(next).toHaveBeenCalledWith()
  })

  it('lets an unmatched path fall through to the catch-all rather than redirecting', async () => {
    // The NotFound route has no meta, so the guard's final next() serves it.
    // Before the catch-all existed this rendered a blank page (D13).
    state.session = null
    await loadRouter()

    const next = vi.fn()
    await state.guard({ path: '/checkin/typo', meta: {} }, {}, next)

    expect(next).toHaveBeenCalledWith()
  })

  it('redirects users without canWriteFinance away from collections route', async () => {
    state.session = { user: { id: 'user-1' } }
    state.linked = true
    state.permissions = null // no capabilities
    await loadRouter()

    const next = vi.fn()
    await state.guard(
      { path: '/dashboard/funds/collections', meta: { requiresAuth: true, requiresCapability: 'canWriteFinance' } },
      {},
      next
    )

    // Members is the always-reachable fallback for a missing capability.
    expect(next).toHaveBeenCalledWith('/dashboard/members')
  })

  it('redirects users without canWriteFinance away from expenses route', async () => {
    state.session = { user: { id: 'user-1' } }
    state.linked = true
    state.permissions = null
    await loadRouter()

    const next = vi.fn()
    await state.guard(
      { path: '/dashboard/funds/expenses', meta: { requiresAuth: true, requiresCapability: 'canWriteFinance' } },
      {},
      next
    )

    expect(next).toHaveBeenCalledWith('/dashboard/members')
  })

  it('allows Finance ministry members onto the collections route', async () => {
    state.session = { user: { id: 'user-1' } }
    state.linked = true
    state.permissions = { role: 'member', is_finance: true }
    await loadRouter()

    const next = vi.fn()
    await state.guard(
      { path: '/dashboard/funds/collections', meta: { requiresAuth: true, requiresCapability: 'canWriteFinance' } },
      {},
      next
    )

    expect(next).toHaveBeenCalledWith()
  })

  it('redirects a Pastor (see-only) away from the collections write route', async () => {
    // Pastor can VIEW finance but not write it — the ministry is required.
    state.session = { user: { id: 'user-1' } }
    state.linked = true
    state.permissions = { role: 'pastor', is_pastor: true }
    await loadRouter()

    const next = vi.fn()
    await state.guard(
      { path: '/dashboard/funds/collections', meta: { requiresAuth: true, requiresCapability: 'canWriteFinance' } },
      {},
      next
    )

    expect(next).toHaveBeenCalledWith('/dashboard/members')
  })

  it('redirects a user without canViewAttendance away from the attendance route', async () => {
    state.session = { user: { id: 'user-1' } }
    state.linked = true
    state.permissions = { role: 'member', is_secretariat: true } // no attendance view
    await loadRouter()

    const next = vi.fn()
    await state.guard(
      { path: '/dashboard/attendance', meta: { requiresAuth: true, requiresCapability: 'canViewAttendance' } },
      {},
      next
    )

    expect(next).toHaveBeenCalledWith('/dashboard/members')
  })

  it('allows a Welcome Team member onto the attendance route', async () => {
    state.session = { user: { id: 'user-1' } }
    state.linked = true
    state.permissions = { role: 'member', is_welcome: true }
    await loadRouter()

    const next = vi.fn()
    await state.guard(
      { path: '/dashboard/attendance', meta: { requiresAuth: true, requiresCapability: 'canViewAttendance' } },
      {},
      next
    )

    expect(next).toHaveBeenCalledWith()
  })
})

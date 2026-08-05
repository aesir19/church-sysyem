import { createRouter, createWebHistory } from 'vue-router'
import { supabase } from '../lib/supabase'

// Every route is lazy-loaded. This closes docs/DEFECTS.md D9 — previously every
// view was imported eagerly into one 404 KB chunk — but it is load-bearing for
// more than bundle hygiene now: /checkin is opened by attendees on their phones,
// on church wifi, with a cold cache, every service. Shipping them the staff
// dashboard would be the single largest use of the Netlify bandwidth budget in
// the app. Keep these as () => import(...) when adding routes.
const routes = [
  {
    path: '/',
    redirect: '/login'
  },
  {
    path: '/login',
    name: 'Login',
    component: () => import('../views/LoginView.vue')
  },
  {
    // PUBLIC AND UNAUTHENTICATED, deliberately. No `meta` at all, and the guard
    // short-circuits on it below. The check-in token travels in the URL fragment
    // (/checkin#t=...), which browsers never send to the server, so it stays out
    // of Netlify access logs and any Referer header. See
    // docs/decisions/0007-public-checkin-endpoint.md.
    path: '/checkin',
    name: 'Checkin',
    component: () => import('../views/CheckinView.vue')
  },
  {
    path: '/set-password',
    name: 'SetPassword',
    component: () => import('../views/SetPasswordView.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/account-pending',
    name: 'AccountPending',
    component: () => import('../views/AccountPendingView.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/dashboard',
    component: () => import('../layouts/DashboardLayout.vue'),
    meta: { requiresAuth: true },
    children: [
      { path: '', redirect: '/dashboard/members' },
      { path: 'members', name: 'Members', component: () => import('../views/DashboardView.vue') },
      { path: 'ministry', name: 'Ministry', component: () => import('../views/MinistrySmallGroupView.vue') },
      { path: 'attendance', name: 'Attendance', component: () => import('../views/AttendanceView.vue') },
      { path: 'funds', redirect: '/dashboard/funds/reports' },
      { path: 'funds/reports', name: 'ChurchFunds', component: () => import('../views/ChurchFundsView.vue') },
      { path: 'funds/collections', name: 'Collections', component: () => import('../views/CollectionsInputView.vue'), meta: { requiresFinance: true } },
      { path: 'funds/expenses', name: 'Expenses', component: () => import('../views/ExpensesInputView.vue'), meta: { requiresFinance: true } }
    ]
  },
  {
    // Catch-all. Closes docs/DEFECTS.md D13: an unmatched path used to render a
    // blank white page. That stopped being cosmetic the moment check-in URLs
    // started being printed on posters, where a mistyped or retired link is the
    // most likely way anyone reaches an unknown path.
    path: '/:pathMatch(.*)*',
    name: 'NotFound',
    component: () => import('../views/NotFoundView.vue')
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

// Detect invite or recovery tokens in the URL hash before routing
let pendingPasswordSet = false

function detectInviteToken() {
  const hash = window.location.hash
  if (hash.includes('type=invite') || hash.includes('type=recovery')) {
    pendingPasswordSet = true
  }
}

detectInviteToken()

// Listen for auth state changes from invite/recovery links
supabase.auth.onAuthStateChange((event) => {
  if (event === 'PASSWORD_RECOVERY') {
    pendingPasswordSet = true
    router.push('/set-password')
  }
})

// Check if the authenticated user has a linked user_accounts row
async function isAccountLinked(userId) {
  const { data } = await supabase
    .from('user_accounts')
    .select('id')
    .eq('id', userId)
    .maybeSingle()
  return !!data
}

// Check if the authenticated user is in the 'Finance Team' group
async function hasFinanceRole(userId) {
  const { data: account } = await supabase
    .from('user_accounts')
    .select('member_id')
    .eq('id', userId)
    .maybeSingle()
  if (!account?.member_id) return false
  const { data: membership } = await supabase
    .from('group_members')
    .select('id, groups!inner(name)')
    .eq('member_id', account.member_id)
    .eq('groups.name', 'Finance Team')
    .maybeSingle()
  return !!membership
}

router.beforeEach(async (to, from, next) => {
  // /checkin is reached by people who have no account at all. Short-circuit
  // before getSession() so the public page never costs an auth round-trip, and
  // so a staff member who scans the QR on their own phone is not bounced to the
  // dashboard by the signed-in redirect below.
  if (to.path === '/checkin') {
    next()
    return
  }

  const { data: { session } } = await supabase.auth.getSession()

  if (to.meta.requiresAuth && !session) {
    next('/login')
    return
  }

  if (to.path === '/login' && session) {
    if (pendingPasswordSet) {
      next('/set-password')
    } else {
      next('/dashboard')
    }
    return
  }

  if (to.path === '/set-password' && session) {
    next()
    return
  }

  if (to.path === '/account-pending' && session) {
    // If account is now linked, send them to dashboard instead
    const linked = await isAccountLinked(session.user.id)
    if (linked) {
      next('/dashboard')
    } else {
      next()
    }
    return
  }

  if (to.path.startsWith('/dashboard') && session) {
    if (pendingPasswordSet) {
      next('/set-password')
      return
    }
    // Check if user has a linked account; if not, show pending page
    const linked = await isAccountLinked(session.user.id)
    if (!linked) {
      next('/account-pending')
      return
    }
    // Finance-only routes require 'finance' role
    if (to.meta.requiresFinance) {
      const allowed = await hasFinanceRole(session.user.id)
      if (!allowed) {
        next('/dashboard/funds/reports')
        return
      }
    }
    next()
    return
  }

  next()
})

// Clear the flag once user successfully navigates away from set-password
router.afterEach((to) => {
  if (to.path !== '/set-password' && pendingPasswordSet) {
    pendingPasswordSet = false
  }
})

export default router

import { createRouter, createWebHistory } from 'vue-router'
import { supabase } from '../lib/supabase'
import LoginView from '../views/LoginView.vue'
import SetPasswordView from '../views/SetPasswordView.vue'
import AccountPendingView from '../views/AccountPendingView.vue'
import DashboardLayout from '../layouts/DashboardLayout.vue'
import DashboardView from '../views/DashboardView.vue'
import MinistrySmallGroupView from '../views/MinistrySmallGroupView.vue'
import ReportsView from '../views/ReportsView.vue'
import ChurchFundsView from '../views/ChurchFundsView.vue'

const routes = [
  {
    path: '/',
    redirect: '/login'
  },
  {
    path: '/login',
    name: 'Login',
    component: LoginView
  },
  {
    path: '/set-password',
    name: 'SetPassword',
    component: SetPasswordView,
    meta: { requiresAuth: true }
  },
  {
    path: '/account-pending',
    name: 'AccountPending',
    component: AccountPendingView,
    meta: { requiresAuth: true }
  },
  {
    path: '/dashboard',
    component: DashboardLayout,
    meta: { requiresAuth: true },
    children: [
      { path: '', redirect: '/dashboard/members' },
      { path: 'members', name: 'Members', component: DashboardView },
      { path: 'ministry', name: 'Ministry', component: MinistrySmallGroupView },
      { path: 'reports', name: 'Reports', component: ReportsView },
      { path: 'funds', name: 'ChurchFunds', component: ChurchFundsView }
    ]
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

router.beforeEach(async (to, from, next) => {
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

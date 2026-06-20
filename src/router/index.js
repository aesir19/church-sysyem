import { createRouter, createWebHistory } from 'vue-router'
import { supabase } from '../lib/supabase'
import LoginView from '../views/LoginView.vue'
import SetPasswordView from '../views/SetPasswordView.vue'
import DashboardView from '../views/DashboardView.vue'

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
    path: '/dashboard',
    name: 'Dashboard',
    component: DashboardView,
    meta: { requiresAuth: true }
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

router.beforeEach(async (to, from, next) => {
  const { data: { session } } = await supabase.auth.getSession()

  if (to.meta.requiresAuth && !session) {
    next('/login')
  } else if (to.path === '/login' && session) {
    // If user arrived via invite, send to set-password instead of dashboard
    if (pendingPasswordSet) {
      next('/set-password')
    } else {
      next('/dashboard')
    }
  } else if (to.path === '/set-password' && session) {
    // Allow access; clear flag after navigation completes
    next()
  } else if (to.path === '/dashboard' && session && pendingPasswordSet) {
    // Prevent skipping password setup
    next('/set-password')
  } else {
    next()
  }
})

// Clear the flag once user successfully navigates away from set-password
router.afterEach((to) => {
  if (to.path !== '/set-password' && pendingPasswordSet) {
    pendingPasswordSet = false
  }
})

export default router

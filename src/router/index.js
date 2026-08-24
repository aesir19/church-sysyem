import { createRouter, createWebHistory } from 'vue-router'
import { supabase } from '../lib/supabase'
import { deriveCapabilities, routeAllowed } from '../utils/capabilities'

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
      { path: '', redirect: '/dashboard/overview' },

      // THE FLAT NINE. The design's information architecture puts Collections,
      // Expenses and Funds side by side as top-level siblings rather than
      // nesting the first two inside the third behind a tab bar, and calls the
      // groups screen "Groups" rather than "Ministry". IA is part of a design,
      // not a detail underneath it, so it moves with the rest of the redesign.
      //
      // Members and Groups carry no capability gate: baseline users may view the
      // directory and groups. What they cannot do (open PII detail, manage
      // members) is gated inside the views. requiresCapability names a boolean
      // key of the derived capabilities (src/utils/capabilities.js).
      { path: 'overview', name: 'Overview', component: () => import('../views/OverviewView.vue') },
      // `framed` hands the whole content frame to the view — no page padding
      // and no shell scroll — because this screen owns a second full-height
      // column (the member detail rail) that has to reach the top and bottom
      // edges and scroll independently of the table. A view that only stacks
      // blocks should never set it.
      { path: 'members', name: 'Members', component: () => import('../views/MembersView.vue'), meta: { framed: true } },
      { path: 'groups', name: 'Groups', component: () => import('../views/GroupsView.vue') },
      // NO requiresCapability, deliberately. Group visibility is decided by RLS, and a
      // group the caller cannot see returns no row — which the view renders as its
      // not-found state. That is the correct answer for a church that should not learn
      // another church's small groups exist, and a capability gate here would instead
      // announce "you are not allowed to see this one", which is more than they should
      // be told.
      // Named, not numbered: /dashboard/groups/cogon/thursday-group. The church segment
      // is not decoration — a small group's name is unique only within its church, so
      // two churches may both have a "Thursday Group" and the group name alone cannot
      // say which. It also describes what the page shows, since a ministry's roster is
      // church-scoped even though the ministry itself is global.
      //
      // The cost, accepted deliberately: renaming a group breaks its old links, which
      // land on the page's not-found state. The alternative was appending characters to
      // keep a stable id in the path, which reads as noise.
      {
        path: 'groups/:church/:group',
        name: 'GroupDetail',
        component: () => import('../views/GroupDetailView.vue')
      },
      // CALENDAR & EVENTS (Stage 1, issue thread on #86/#87).
      //
      // Calendar carries NO capability gate — it is the members' read of the church
      // year, open to everyone, and its SELECT policy (0032) already narrows a
      // non-privileged member to published events only. Gating it would hide the one
      // calendar screen every member is meant to have.
      //
      // Events is the management surface. requiresCapability: 'canViewEvents' bounces
      // a deep-linker who lacks it to /members (the safe always-reachable fallback),
      // and the nav hides the item for them — the hide-don't-lock rule (0016). The
      // composer and edit paths need the stronger canManageEvents: an oversight role
      // (Pastor / Church Leader / Head Pastor) may reach the list and a detail read,
      // but not the create/edit forms.
      { path: 'calendar', name: 'Calendar', component: () => import('../views/CalendarView.vue') },
      { path: 'events', name: 'Events', component: () => import('../views/EventsView.vue'), meta: { requiresCapability: 'canViewEvents' } },
      { path: 'events/new', name: 'EventNew', component: () => import('../views/EventComposerView.vue'), meta: { requiresCapability: 'canManageEvents' } },
      { path: 'events/:id', name: 'EventDetail', component: () => import('../views/EventDetailView.vue'), meta: { requiresCapability: 'canViewEvents' } },
      { path: 'events/:id/edit', name: 'EventEdit', component: () => import('../views/EventComposerView.vue'), meta: { requiresCapability: 'canManageEvents' } },

      { path: 'attendance', name: 'Attendance', component: () => import('../views/AttendanceView.vue'), meta: { requiresCapability: 'canViewAttendance' } },
      { path: 'collections', name: 'Collections', component: () => import('../views/CollectionsInputView.vue'), meta: { requiresCapability: 'canWriteFinance' } },
      { path: 'expenses', name: 'Expenses', component: () => import('../views/ExpensesInputView.vue'), meta: { requiresCapability: 'canWriteFinance' } },
      { path: 'funds', name: 'ChurchFunds', component: () => import('../views/ChurchFundsView.vue'), meta: { requiresCapability: 'canViewFinance' } },
      { path: 'whats-next', name: 'WhatsNext', component: () => import('../views/WhatsNextView.vue') },

      // THE SETTINGS AREA. Reached from the gear on the account card, not from the
      // nav — administration is not one of the flat nine.
      //
      // No `requiresCapability` on either, deliberately. The guard would bounce an
      // unauthorised visitor to the dashboard, which reads as the app losing the
      // page. These views render 4g's "not yours to open" instead, which is the
      // difference between a permission failure that explains itself and one that
      // looks like a bug. The database refuses regardless — list_accounts() and
      // list_church_accounts() return zero rows to anyone who should not have them.
      { path: 'settings/roles', name: 'SettingsRoles', component: () => import('../views/settings/RolesLinkingView.vue') },
      { path: 'settings/pastors', name: 'SettingsPastors', component: () => import('../views/settings/PastorAssignmentView.vue') },
      { path: 'settings', redirect: '/dashboard/settings/roles' },

      // The old paths, kept as redirects. Someone has these bookmarked, and a
      // dead bookmark is indistinguishable from a broken app.
      { path: 'ministry', redirect: '/dashboard/groups' },
      { path: 'funds/reports', redirect: '/dashboard/funds' },
      { path: 'funds/collections', redirect: '/dashboard/collections' },
      { path: 'funds/expenses', redirect: '/dashboard/expenses' }
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

// Resolve the caller's capabilities in one round-trip via the get_my_permissions()
// RPC (0017), then derive the capability booleans the same way the SPA and the RLS
// policies do. Replaces the old finance-only, name-based hasFinanceRole check.
async function fetchCapabilities() {
  const { data } = await supabase.rpc('get_my_permissions').maybeSingle()
  return deriveCapabilities(data)
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
    // Capability-gated routes (finance, attendance). Members is always reachable,
    // so it is the safe fallback for a user who lacks the required capability.
    if (to.meta.requiresCapability) {
      const caps = await fetchCapabilities()
      if (!routeAllowed(caps, to.meta)) {
        next('/dashboard/members')
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

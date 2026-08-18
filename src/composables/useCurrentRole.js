import { ref, computed } from 'vue'
import { supabase } from '../lib/supabase'
import { deriveCapabilities, canManageGroupMembers as canManageGroupMembersPure } from '../utils/capabilities'

// Single-round-trip role + ministry snapshot for the whole SPA, cached per session.
// Replaces useFinanceMember and the router's ad-hoc user_accounts/group_members
// lookups. UI gating only — Postgres RLS (0014-0017) is the real enforcement.
//
// Fixes the old useFinanceMember bug (DEFECTS D5): the module-level cache is now
// keyed to the auth user id and cleared on sign-out, so it cannot leak one user's
// role to the next session on the same page load.

const permissions = ref(null)
let currentUserId = null
let pending = null

const caps = computed(() => deriveCapabilities(permissions.value))

// Resolve permissions for the current session. Awaitable (used by the router) and
// also drives the reactive `permissions` ref that components read. Defensive so a
// partial Supabase mock in a view test cannot throw at import/setup time.
async function loadPermissions(force = false) {
  let uid
  try {
    const { data } = await supabase.auth.getUser()
    uid = data?.user?.id ?? null
  } catch {
    uid = null
  }

  if (uid !== currentUserId) {
    currentUserId = uid
    permissions.value = null
    pending = null
  }
  if (!uid) {
    permissions.value = null
    return null
  }
  if (!force && permissions.value !== null) return permissions.value
  if (!pending) {
    pending = Promise.resolve()
      .then(() => supabase.rpc('get_my_permissions').maybeSingle())
      .then(({ data }) => {
        permissions.value = data || null
        pending = null
        return permissions.value
      })
      .catch(() => {
        pending = null
        return null
      })
  }
  return pending
}

export function clearCurrentRole() {
  permissions.value = null
  currentUserId = null
  pending = null
}

// Invalidate the cache ONLY on a real sign-out. Supabase re-emits SIGNED_IN (and
// TOKEN_REFRESHED / USER_UPDATED) on token refresh and tab focus, which navigation
// can trigger — clearing on those made the role, and therefore the church selector,
// flicker off and reset mid-session. A new user signing in clears via the SIGNED_OUT
// that precedes it, and the next view mount reloads permissions for them.
// Guarded so a view test's partial auth mock cannot throw.
if (typeof supabase.auth?.onAuthStateChange === 'function') {
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') clearCurrentRole()
  })
}

export function useCurrentRole() {
  // Fire-and-forget; components react to the `permissions` ref as it resolves.
  loadPermissions()

  const c = (key) => computed(() => caps.value[key])

  return {
    permissions,
    caps,
    loadPermissions,
    // role flags
    role: computed(() => caps.value.role),
    isSuperAdmin: c('isSuperAdmin'),
    isHeadPastor: c('isHeadPastor'),
    isPastor: c('isPastor'),
    isChurchLeader: c('isChurchLeader'),
    isFinance: c('isFinance'),
    isSecretariat: c('isSecretariat'),
    isWelcome: c('isWelcome'),
    // Derived by capabilities.js since 0022 but never surfaced here until the group
    // page needed it: a Small Group Leader gets no click-through from a roster row to
    // member detail, so the restriction on their account holds there too.
    isSmallGroupLeader: c('isSmallGroupLeader'),
    // capabilities
    canSeeMemberDetail: c('canSeeMemberDetail'),
    canBrowseDirectory: c('canBrowseDirectory'),
    canRecordJourney: c('canRecordJourney'),
    canWriteMembers: c('canWriteMembers'),
    canViewFinance: c('canViewFinance'),
    canWriteFinance: c('canWriteFinance'),
    canViewAttendance: c('canViewAttendance'),
    canManageAttendance: c('canManageAttendance'),
    canManageSmallGroups: c('canManageSmallGroups'),
    isCrossChurch: c('isCrossChurch'),
    // group membership is group-specific (Finance = Pastor-only)
    canManageGroupMembers: (opts) => canManageGroupMembersPure(caps.value, opts),
  }
}

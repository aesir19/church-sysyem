// Capability derivation for the RBAC model. This is UI-gating logic ONLY — the
// Postgres RLS policies (migrations 0014-0017) are the enforcement. It mirrors the
// SQL capability composites in 0014 exactly; the two must not drift.
//
// Input is the row returned by the get_my_permissions() RPC (0017):
//   { role, is_super_admin, is_head_pastor, is_pastor, is_church_leader,
//     is_finance, is_secretariat, is_welcome }
// or null/undefined for an unresolved or unlinked user (everything fails closed).

export function deriveCapabilities(perm) {
  const p = perm || {}
  const isSuperAdmin = !!p.is_super_admin
  const isHeadPastor = !!p.is_head_pastor
  const isPastor = !!p.is_pastor
  const isChurchLeader = !!p.is_church_leader
  const isFinance = !!p.is_finance
  const isSecretariat = !!p.is_secretariat
  const isWelcome = !!p.is_welcome

  return {
    role: p.role ?? null,
    isSuperAdmin,
    isHeadPastor,
    isPastor,
    isChurchLeader,
    isFinance,
    isSecretariat,
    isWelcome,

    // VIEW capabilities. Head Pastor is deliberately NOT in canSeeMemberDetail —
    // it sees only the name/group directory, never member PII (matches 0014/0015).
    canSeeMemberDetail: isSuperAdmin || isPastor || isChurchLeader || isSecretariat,
    canViewFinance: isSuperAdmin || isHeadPastor || isPastor || isChurchLeader || isFinance,
    canViewAttendance: isSuperAdmin || isHeadPastor || isPastor || isChurchLeader || isWelcome,

    // WRITE capabilities — ministry-governed (+ SuperAdmin). Pastor is see-only.
    canWriteMembers: isSuperAdmin || isSecretariat,
    canWriteFinance: isSuperAdmin || isFinance,
    canManageAttendance: isSuperAdmin || isWelcome,
    canManageSmallGroups: isSuperAdmin || isChurchLeader,

    // SuperAdmin / Head Pastor act across all churches (church selector UI).
    isCrossChurch: isSuperAdmin || isHeadPastor,
  }
}

// Membership management is group-specific because the Finance ministry is
// Pastor-only. `isFinanceGroup` should be true when the target group is the global
// Finance ministry. Mirrors can_manage_group_members() in 0014.
export function canManageGroupMembers(caps, { isFinanceGroup = false } = {}) {
  if (!caps) return false
  if (caps.isSuperAdmin) return true
  if (isFinanceGroup) return caps.isPastor
  return caps.isChurchLeader
}

// Route-meta gate. A route may declare `meta.requiresCapability: '<capKey>'`
// (a boolean key of the derived capabilities). Returns whether the route is allowed.
export function routeAllowed(caps, meta) {
  if (!meta || !meta.requiresCapability) return true
  return !!(caps && caps[meta.requiresCapability])
}

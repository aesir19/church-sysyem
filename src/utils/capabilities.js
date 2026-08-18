// Capability derivation for the RBAC model. This is UI-gating logic ONLY — the
// Postgres RLS policies (migrations 0014-0017) are the enforcement. It mirrors the
// SQL capability composites in 0014 exactly; the two must not drift.
//
// Input is the row returned by the get_my_permissions() RPC (0017, extended by 0022):
//   { role, is_super_admin, is_head_pastor, is_pastor, is_church_leader,
//     is_finance, is_secretariat, is_welcome, is_small_group_leader }
// or null/undefined for an unresolved or unlinked user (everything fails closed).
//
// SMALL GROUP LEADER IS NOT A `role`. It comes from leading at least one small group
// (0022's small_group_leaders table), so someone's `role` stays 'member' while
// isSmallGroupLeader is true. Anything keying on the role string alone will miss it.

export function deriveCapabilities(perm) {
  const p = perm || {}
  const isSuperAdmin = !!p.is_super_admin
  const isHeadPastor = !!p.is_head_pastor
  const isPastor = !!p.is_pastor
  const isChurchLeader = !!p.is_church_leader
  const isFinance = !!p.is_finance
  const isSecretariat = !!p.is_secretariat
  const isWelcome = !!p.is_welcome
  const isSmallGroupLeader = !!p.is_small_group_leader

  return {
    role: p.role ?? null,
    isSuperAdmin,
    isHeadPastor,
    isPastor,
    isChurchLeader,
    isFinance,
    isSecretariat,
    isWelcome,
    isSmallGroupLeader,

    // VIEW capabilities. Head Pastor is deliberately NOT in canSeeMemberDetail —
    // it sees only the name/group directory, never member PII (matches 0014/0015).
    canSeeMemberDetail: isSuperAdmin || isPastor || isChurchLeader || isSecretariat,
    // The safe directory — names, gender, group membership and journey — is open to
    // every ASSIGNED role or ministry, but a scopeless account (plain member /
    // unassigned with no ministry and no group to lead) sees nothing. Mirrors
    // has_directory_access() (0028): the two must not drift. Gates the Members page
    // for those accounts into a "no access yet" state rather than the congregation.
    canBrowseDirectory:
      isSuperAdmin || isHeadPastor || isPastor || isChurchLeader ||
      isFinance || isSecretariat || isWelcome || isSmallGroupLeader,
    canViewFinance: isSuperAdmin || isHeadPastor || isPastor || isChurchLeader || isFinance,
    // The Small Group Leader's one and only widening (0022). The database grants
    // attendance church-wide; the screen narrows it to the groups they lead. Keeping
    // the narrowing app-side means the day that rule tightens, it tightens in SQL and
    // no UI changes.
    canViewAttendance: isSuperAdmin || isHeadPastor || isPastor || isChurchLeader || isWelcome || isSmallGroupLeader,

    // WRITE capabilities — ministry-governed (+ SuperAdmin). Pastor is see-only.
    canWriteMembers: isSuperAdmin || isSecretariat,
    // A small-group leader may record the one-to-one and turning-point milestones
    // (only) for members of a group they lead; SuperAdmin holds it too. The per-group
    // row scope and the two-column restriction live in set_member_journey() (0028) —
    // this flag only decides whether to render the roster toggles. Secretariat records
    // journey through the full member form (canWriteMembers), not this.
    canRecordJourney: isSuperAdmin || isSmallGroupLeader,
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

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
  const isEventsTeam = !!p.is_events_team

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
    isEventsTeam,

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
    // May the caller see WHO gave, not just the aggregate figures? Mirrors the SQL
    // predicate can_see_contributor_identity() (0031) exactly — same answer as
    // canWriteFinance today, but a distinct key so a future role change moves the
    // two independently. The Funds view gates the Contributors table on this, and
    // only these roles ever fetch the identity-bearing giving rows. UI-gating only;
    // the collections SELECT policy (0031) is the real enforcement.
    canSeeContributorIdentity: isSuperAdmin || isFinance,
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

    // CALENDAR & EVENTS (0032). Two deliberately distinct keys, mirroring the SQL
    // predicates can_view_events() / can_manage_events():
    //   canViewEvents gates the Events PAGE and its nav entry — the five roles that may
    //     see the planning phase (drafts included). It is view-only for the oversight
    //     three; only canManageEvents writes.
    //   canManageEvents gates every write button — Events Team (+ SuperAdmin).
    // The members' Calendar is open to everyone and carries no capability gate; the SELECT
    // policy shows non-privileged members published events only. UI-gating only; RLS (0032)
    // is the enforcement, and the two must not drift.
    canViewEvents: isSuperAdmin || isHeadPastor || isPastor || isChurchLeader || isEventsTeam,
    canManageEvents: isSuperAdmin || isEventsTeam,
    // Rooms are a per-church operational list owned by the Church Leader (+ SuperAdmin) —
    // Q4/#87. Events Team USES rooms (picks one) but does not manage the list. Mirrors
    // can_manage_rooms() (0035); RLS is the enforcement.
    canManageRooms: isSuperAdmin || isChurchLeader,

    // SuperAdmin / Head Pastor act across all churches (church selector UI).
    isCrossChurch: isSuperAdmin || isHeadPastor,
  }
}

// A human label for the person's effective role, for identity lines like the
// sidebar user card and the Overview "Your access" sentence.
//
// It is derived from the capability FLAGS, not the account `role` string. Welcome,
// Finance, Secretariat and Small Group Leader are ministry-derived (they leave
// `role` as 'member'/'unassigned' — see deriveCapabilities and the note above), so
// keying a label map on `role` alone mislabels every ministry member as "No role
// assigned". Senior account roles take precedence; a purely ministry account shows
// its ministries joined. Returns null when the account is genuinely scopeless, so
// the caller can choose its own empty-state wording.
const MINISTRY_LABELS = [
  ['isFinance', 'Finance'],
  ['isSecretariat', 'Secretariat'],
  ['isWelcome', 'Welcome Team'],
  ['isEventsTeam', 'Events Team'],
  ['isSmallGroupLeader', 'Small Group Leader'],
]

export function roleLabel(caps) {
  const c = caps || {}
  if (c.isSuperAdmin) return 'Super Admin'
  if (c.isHeadPastor) return 'Head Pastor'
  if (c.isPastor) return 'Pastor'
  if (c.isChurchLeader) return 'Church Leader'
  const ministries = MINISTRY_LABELS.filter(([flag]) => c[flag]).map(([, label]) => label)
  return ministries.length ? ministries.join(' · ') : null
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

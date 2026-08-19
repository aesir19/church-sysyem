import { describe, it, expect } from 'vitest'
import {
  deriveCapabilities,
  canManageGroupMembers,
  routeAllowed,
  roleLabel,
} from '../../src/utils/capabilities'

// Build a get_my_permissions() row. Pass the flags that are true.
function perm(role, flags = {}) {
  return {
    role,
    is_super_admin: false,
    is_head_pastor: false,
    is_pastor: false,
    is_church_leader: false,
    is_finance: false,
    is_secretariat: false,
    is_welcome: false,
    is_small_group_leader: false,
    ...flags,
  }
}

describe('deriveCapabilities', () => {
  it('fails closed for null / unresolved permissions', () => {
    const c = deriveCapabilities(null)
    expect(c.role).toBe(null)
    for (const key of [
      'canSeeMemberDetail', 'canWriteMembers', 'canViewFinance', 'canWriteFinance',
      'canViewAttendance', 'canManageAttendance', 'canManageSmallGroups', 'isCrossChurch',
      'isSmallGroupLeader', 'canBrowseDirectory', 'canRecordJourney',
    ]) {
      expect(c[key]).toBe(false)
    }
  })

  // 0028. The safe directory (names + gender + group + journey) is open to every
  // ASSIGNED role/ministry, but a scopeless account sees nothing — mirrors
  // has_directory_access() in SQL, and gates the Members page for such accounts.
  describe('canBrowseDirectory', () => {
    it('is granted to every assigned role and ministry', () => {
      expect(deriveCapabilities(perm('super_admin', { is_super_admin: true })).canBrowseDirectory).toBe(true)
      expect(deriveCapabilities(perm('head_pastor', { is_head_pastor: true })).canBrowseDirectory).toBe(true)
      expect(deriveCapabilities(perm('pastor', { is_pastor: true })).canBrowseDirectory).toBe(true)
      expect(deriveCapabilities(perm('church_leader', { is_church_leader: true })).canBrowseDirectory).toBe(true)
      expect(deriveCapabilities(perm('member', { is_finance: true })).canBrowseDirectory).toBe(true)
      expect(deriveCapabilities(perm('member', { is_secretariat: true })).canBrowseDirectory).toBe(true)
      expect(deriveCapabilities(perm('member', { is_welcome: true })).canBrowseDirectory).toBe(true)
      expect(deriveCapabilities(perm('member', { is_small_group_leader: true })).canBrowseDirectory).toBe(true)
    })

    it('is withheld from a scopeless member/unassigned account (fail closed)', () => {
      expect(deriveCapabilities(perm('member')).canBrowseDirectory).toBe(false)
      expect(deriveCapabilities(perm('unassigned')).canBrowseDirectory).toBe(false)
    })
  })

  // 0028. Small-group leaders may record the one-to-one and turning-point milestones
  // (only) for members of groups they lead; the per-group scope is enforced in SQL by
  // set_member_journey(). SuperAdmin also holds it. Nobody else gets it here —
  // Secretariat records journey through the full member form (canWriteMembers).
  describe('canRecordJourney', () => {
    it('is held by SuperAdmin and small-group leaders', () => {
      expect(deriveCapabilities(perm('super_admin', { is_super_admin: true })).canRecordJourney).toBe(true)
      expect(deriveCapabilities(perm('member', { is_small_group_leader: true })).canRecordJourney).toBe(true)
    })

    it('is withheld from everyone else, including Secretariat and Church Leader', () => {
      expect(deriveCapabilities(perm('member', { is_secretariat: true })).canRecordJourney).toBe(false)
      expect(deriveCapabilities(perm('church_leader', { is_church_leader: true })).canRecordJourney).toBe(false)
      expect(deriveCapabilities(perm('member', { is_welcome: true })).canRecordJourney).toBe(false)
      expect(deriveCapabilities(perm('head_pastor', { is_head_pastor: true })).canRecordJourney).toBe(false)
    })
  })

  // 0022. Leading a small group is not an account role — it comes from a row in
  // small_group_leaders — so `role` stays 'member' throughout this block. Anything that
  // keys on the role string alone will miss this user entirely.
  describe('Small Group Leader', () => {
    const leader = deriveCapabilities(perm('member', { is_small_group_leader: true }))

    it('is derived from leading a group, not from the account role', () => {
      expect(leader.role).toBe('member')
      expect(leader.isSmallGroupLeader).toBe(true)
    })

    it('gains attendance, which is its only widening', () => {
      expect(leader.canViewAttendance).toBe(true)
    })

    it('gets nothing to do with money — not the pages, not the totals', () => {
      expect(leader.canViewFinance).toBe(false)
      expect(leader.canWriteFinance).toBe(false)
    })

    it('cannot open a member record, manage attendance, or touch groups', () => {
      expect(leader.canSeeMemberDetail).toBe(false)
      expect(leader.canWriteMembers).toBe(false)
      expect(leader.canManageAttendance).toBe(false)
      expect(leader.canManageSmallGroups).toBe(false)
      expect(leader.isCrossChurch).toBe(false)
    })

    it('does not let a plain member reach attendance', () => {
      // The control for the test above: without the flag the same role gets nothing.
      expect(deriveCapabilities(perm('member')).canViewAttendance).toBe(false)
    })
  })

  it('SuperAdmin gets every capability and is cross-church', () => {
    const c = deriveCapabilities(perm('super_admin', { is_super_admin: true }))
    expect(c.canSeeMemberDetail).toBe(true)
    expect(c.canWriteMembers).toBe(true)
    expect(c.canViewFinance).toBe(true)
    expect(c.canWriteFinance).toBe(true)
    expect(c.canViewAttendance).toBe(true)
    expect(c.canManageAttendance).toBe(true)
    expect(c.canManageSmallGroups).toBe(true)
    expect(c.isCrossChurch).toBe(true)
  })

  it('Head Pastor views finance/attendance cross-church but NOT member PII and never writes', () => {
    const c = deriveCapabilities(perm('head_pastor', { is_head_pastor: true }))
    expect(c.canSeeMemberDetail).toBe(false) // the key exclusion
    expect(c.canViewFinance).toBe(true)
    expect(c.canViewAttendance).toBe(true)
    expect(c.isCrossChurch).toBe(true)
    expect(c.canWriteMembers).toBe(false)
    expect(c.canWriteFinance).toBe(false)
    expect(c.canManageAttendance).toBe(false)
    expect(c.canManageSmallGroups).toBe(false)
  })

  it('Pastor is see-only: sees detail/finance/attendance, writes nothing, own church', () => {
    const c = deriveCapabilities(perm('pastor', { is_pastor: true }))
    expect(c.canSeeMemberDetail).toBe(true)
    expect(c.canViewFinance).toBe(true)
    expect(c.canViewAttendance).toBe(true)
    expect(c.canWriteMembers).toBe(false)
    expect(c.canWriteFinance).toBe(false)
    expect(c.canManageAttendance).toBe(false)
    expect(c.canManageSmallGroups).toBe(false)
    expect(c.isCrossChurch).toBe(false)
  })

  it('Church Leader can manage small groups but not member/finance/attendance writes', () => {
    const c = deriveCapabilities(perm('church_leader', { is_church_leader: true }))
    expect(c.canSeeMemberDetail).toBe(true)
    expect(c.canManageSmallGroups).toBe(true)
    expect(c.canWriteMembers).toBe(false)
    expect(c.canWriteFinance).toBe(false)
    expect(c.canManageAttendance).toBe(false)
  })

  it('Secretariat ministry grants member detail + write, nothing else', () => {
    const c = deriveCapabilities(perm('member', { is_secretariat: true }))
    expect(c.canSeeMemberDetail).toBe(true)
    expect(c.canWriteMembers).toBe(true)
    expect(c.canViewFinance).toBe(false)
    expect(c.canViewAttendance).toBe(false)
  })

  it('Finance ministry grants finance view+write, not member detail', () => {
    const c = deriveCapabilities(perm('member', { is_finance: true }))
    expect(c.canViewFinance).toBe(true)
    expect(c.canWriteFinance).toBe(true)
    expect(c.canSeeMemberDetail).toBe(false)
    expect(c.canViewAttendance).toBe(false)
  })

  it('Welcome Team grants attendance view+manage, not finance', () => {
    const c = deriveCapabilities(perm('member', { is_welcome: true }))
    expect(c.canViewAttendance).toBe(true)
    expect(c.canManageAttendance).toBe(true)
    expect(c.canViewFinance).toBe(false)
  })

  it('account role and ministry compose (Pastor also in Finance can write finance)', () => {
    const c = deriveCapabilities(perm('pastor', { is_pastor: true, is_finance: true }))
    expect(c.canWriteFinance).toBe(true) // via the ministry, not the account role
    expect(c.canSeeMemberDetail).toBe(true) // via pastor
  })
})

describe('canManageGroupMembers (Finance = Pastor-only)', () => {
  const superAdmin = deriveCapabilities(perm('super_admin', { is_super_admin: true }))
  const leader = deriveCapabilities(perm('church_leader', { is_church_leader: true }))
  const pastor = deriveCapabilities(perm('pastor', { is_pastor: true }))
  const financeOnly = deriveCapabilities(perm('member', { is_finance: true }))

  it('SuperAdmin manages any group, finance or not', () => {
    expect(canManageGroupMembers(superAdmin, { isFinanceGroup: true })).toBe(true)
    expect(canManageGroupMembers(superAdmin, { isFinanceGroup: false })).toBe(true)
  })

  it('Church Leader manages non-finance groups but NOT the Finance ministry', () => {
    expect(canManageGroupMembers(leader, { isFinanceGroup: false })).toBe(true)
    expect(canManageGroupMembers(leader, { isFinanceGroup: true })).toBe(false)
  })

  it('Pastor manages ONLY the Finance ministry', () => {
    expect(canManageGroupMembers(pastor, { isFinanceGroup: true })).toBe(true)
    expect(canManageGroupMembers(pastor, { isFinanceGroup: false })).toBe(false)
  })

  it('a Finance ministry member with no account role cannot manage membership', () => {
    expect(canManageGroupMembers(financeOnly, { isFinanceGroup: true })).toBe(false)
    expect(canManageGroupMembers(financeOnly, { isFinanceGroup: false })).toBe(false)
  })

  it('null caps fail closed', () => {
    expect(canManageGroupMembers(null, { isFinanceGroup: false })).toBe(false)
  })
})

describe('roleLabel', () => {
  const label = (role, flags) => roleLabel(deriveCapabilities(perm(role, flags)))

  it('labels ministry roles even though their account role stays member/unassigned', () => {
    // The regression this fixes: a Welcome Team account has role 'member', so a
    // label keyed on the role string alone showed "No role assigned".
    expect(label('member', { is_welcome: true })).toBe('Welcome Team')
    expect(label('member', { is_finance: true })).toBe('Finance')
    expect(label('unassigned', { is_secretariat: true })).toBe('Secretariat')
    expect(label('member', { is_small_group_leader: true })).toBe('Small Group Leader')
  })

  it('labels the senior account roles', () => {
    expect(label('super_admin', { is_super_admin: true })).toBe('Super Admin')
    expect(label('head_pastor', { is_head_pastor: true })).toBe('Head Pastor')
    expect(label('pastor', { is_pastor: true })).toBe('Pastor')
    expect(label('church_leader', { is_church_leader: true })).toBe('Church Leader')
  })

  it('prefers the senior role and joins multiple ministries', () => {
    expect(label('church_leader', { is_church_leader: true, is_welcome: true })).toBe('Church Leader')
    expect(label('member', { is_finance: true, is_welcome: true })).toBe('Finance · Welcome Team')
  })

  it('returns null for a genuinely scopeless account (caller supplies empty-state text)', () => {
    expect(label('unassigned')).toBe(null)
    expect(roleLabel(null)).toBe(null)
  })
})

describe('routeAllowed', () => {
  const finance = deriveCapabilities(perm('member', { is_finance: true }))
  const baseline = deriveCapabilities(perm('unassigned'))

  it('allows routes with no meta or no requiresCapability', () => {
    expect(routeAllowed(baseline, undefined)).toBe(true)
    expect(routeAllowed(baseline, {})).toBe(true)
  })

  it('gates on the named capability key', () => {
    expect(routeAllowed(finance, { requiresCapability: 'canWriteFinance' })).toBe(true)
    expect(routeAllowed(baseline, { requiresCapability: 'canWriteFinance' })).toBe(false)
    expect(routeAllowed(baseline, { requiresCapability: 'canViewAttendance' })).toBe(false)
  })
})

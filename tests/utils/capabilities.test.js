import { describe, it, expect } from 'vitest'
import {
  deriveCapabilities,
  canManageGroupMembers,
  routeAllowed,
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
    ]) {
      expect(c[key]).toBe(false)
    }
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

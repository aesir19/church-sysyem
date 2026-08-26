import { describe, expect, it } from 'vitest'
import {
  FINANCE_TABS,
  visibleFinanceTabs,
  financeLandingTab,
  resolveFinanceTab,
} from '../../src/utils/financeTabs'

// Two callers stand in for the two classes the Finance item serves. A finance-staff
// caller (SuperAdmin or Finance ministry) can write; an oversight caller (Head Pastor
// / Pastor / Church Leader) can view but not write.
const WRITER = { canViewFinance: true, canWriteFinance: true }
const VIEWER = { canViewFinance: true, canWriteFinance: false }

describe('visibleFinanceTabs', () => {
  it('shows all three tabs to a caller who can write finance', () => {
    expect(visibleFinanceTabs(WRITER).map((t) => t.key)).toEqual([
      'collections',
      'expenses',
      'report',
    ])
  })

  it('shows only the report to a view-only caller', () => {
    expect(visibleFinanceTabs(VIEWER).map((t) => t.key)).toEqual(['report'])
  })

  it('fails closed for missing or empty capabilities', () => {
    expect(visibleFinanceTabs(null).map((t) => t.key)).toEqual(['report'])
    expect(visibleFinanceTabs({}).map((t) => t.key)).toEqual(['report'])
  })

  it('keeps the report ungated so it never carries a needs key', () => {
    const report = FINANCE_TABS.find((t) => t.key === 'report')
    expect(report.needs).toBeNull()
  })
})

describe('financeLandingTab', () => {
  it('lands a writer on Collections', () => {
    expect(financeLandingTab(WRITER)).toBe('collections')
  })

  it('lands a view-only caller on the report', () => {
    expect(financeLandingTab(VIEWER)).toBe('report')
    expect(financeLandingTab(null)).toBe('report')
  })
})

describe('resolveFinanceTab', () => {
  it('keeps a tab the caller may open', () => {
    expect(resolveFinanceTab('expenses', WRITER)).toBe('expenses')
    expect(resolveFinanceTab('report', VIEWER)).toBe('report')
  })

  it('redirects a view-only caller away from a write-only tab to the landing tab', () => {
    expect(resolveFinanceTab('collections', VIEWER)).toBe('report')
    expect(resolveFinanceTab('expenses', VIEWER)).toBe('report')
  })

  it('falls back to the landing tab for an unknown or empty key', () => {
    expect(resolveFinanceTab('nonsense', WRITER)).toBe('collections')
    expect(resolveFinanceTab(undefined, WRITER)).toBe('collections')
    expect(resolveFinanceTab('', VIEWER)).toBe('report')
  })
})

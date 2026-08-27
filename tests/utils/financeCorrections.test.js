import { describe, it, expect } from 'vitest'
import { buildUnits } from '../../src/utils/financeCorrections'
import { netSum, signedAmount, amountSign } from '../../src/utils/financeSign'

// Rows as buildUnits reads them: { id, kind, correctsId }, plus amount for netSum.
const entry = (id, amount, extra = {}) => ({ id, kind: 'entry', correctsId: null, amount, ...extra })
const reversal = (id, target, amount) => ({ id, kind: 'reversal', correctsId: target, amount })
const replacement = (id, target, amount) => ({ id, kind: 'entry', correctsId: target, amount })

describe('financeSign', () => {
  it('signs a reversal negative and an entry positive', () => {
    expect(amountSign({ kind: 'reversal' })).toBe(-1)
    expect(amountSign({ kind: 'entry' })).toBe(1)
    expect(amountSign({})).toBe(1)
    expect(signedAmount({ kind: 'reversal', amount: 500 })).toBe(-500)
  })

  it('nets a corrected chain to the live value', () => {
    // 5000 entered, reversed, replaced with 500 → net 500
    const rows = [entry('a', 5000), reversal('r', 'a', 5000), replacement('b', 'a', 500)]
    expect(netSum(rows)).toBe(500)
  })

  it('nets a voided entry to zero', () => {
    const rows = [entry('a', 5000), reversal('r', 'a', 5000)]
    expect(netSum(rows)).toBe(0)
  })
})

describe('buildUnits', () => {
  it('treats a plain entry as one live unit', () => {
    const units = buildUnits([entry('a', 100)])
    expect(units).toHaveLength(1)
    expect(units[0].live.id).toBe('a')
    expect(units[0].voided).toBe(false)
    expect(units[0].corrected).toBe(false)
  })

  it('collapses original + reversal + replacement into one corrected unit', () => {
    const rows = [entry('a', 5000), reversal('r', 'a', 5000), replacement('b', 'a', 500)]
    const units = buildUnits(rows)
    expect(units).toHaveLength(1)
    expect(units[0].corrected).toBe(true)
    expect(units[0].voided).toBe(false)
    expect(units[0].live.id).toBe('b')
    expect(units[0].live.amount).toBe(500)
    expect(units[0].history).toHaveLength(1)
    expect(units[0].history[0].reversal.id).toBe('r')
  })

  it('marks a reversed-without-replacement unit as voided', () => {
    const units = buildUnits([entry('a', 5000), reversal('r', 'a', 5000)])
    expect(units).toHaveLength(1)
    expect(units[0].voided).toBe(true)
    expect(units[0].live).toBeNull()
    expect(units[0].original.id).toBe('a')
  })

  it('walks a chain of two corrections to the final live row', () => {
    const rows = [
      entry('a', 5000),
      reversal('r1', 'a', 5000), replacement('b', 'a', 500),
      reversal('r2', 'b', 500), replacement('c', 'b', 550)
    ]
    const units = buildUnits(rows)
    expect(units).toHaveLength(1)
    expect(units[0].live.id).toBe('c')
    expect(units[0].live.amount).toBe(550)
    expect(units[0].history).toHaveLength(2)
  })

  it('surfaces an orphan replacement (parent moved to another month) as its own root', () => {
    // Only the replacement is present in this month's rows; its parent is elsewhere.
    const units = buildUnits([replacement('b', 'a', 500)])
    expect(units).toHaveLength(1)
    expect(units[0].live.id).toBe('b')
    expect(units[0].corrected).toBe(false)
  })

  it('does not double-list a replacement whose parent is in the same set', () => {
    const rows = [entry('a', 5000), reversal('r', 'a', 5000), replacement('b', 'a', 500)]
    const units = buildUnits(rows)
    expect(units.map((u) => u.rootId)).toEqual(['a'])
  })
})

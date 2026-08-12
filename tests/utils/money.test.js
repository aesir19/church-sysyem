import { describe, it, expect } from 'vitest'
import { formatPeso, formatPesoWhole, formatPesoShort, formatShare } from '../../src/utils/money'

describe('formatPeso', () => {
  it('renders pesos with centavos', () => {
    expect(formatPeso(2500)).toBe('₱2,500.00')
    expect(formatPeso(1750.5)).toBe('₱1,750.50')
  })

  // These are accounting figures. A total that silently rounds is a total
  // somebody will try to reconcile against a receipt.
  it('never drops the centavos', () => {
    expect(formatPeso(0.05)).toBe('₱0.05')
    expect(formatPeso(1000000)).toBe('₱1,000,000.00')
  })

  it('accepts the numeric strings PostgREST returns for numeric columns', () => {
    expect(formatPeso('2500.00')).toBe('₱2,500.00')
  })

  it('renders a missing amount as zero rather than as a blank', () => {
    expect(formatPeso(null)).toBe('₱0.00')
    expect(formatPeso(undefined)).toBe('₱0.00')
    expect(formatPeso('not a number')).toBe('₱0.00')
  })

  it('keeps a negative signed', () => {
    expect(formatPeso(-500)).toBe('-₱500.00')
  })
})

describe('formatPesoWhole', () => {
  it('drops the centavos for the summary tiles', () => {
    expect(formatPesoWhole(2500)).toBe('₱2,500')
    expect(formatPesoWhole(1750.5)).toBe('₱1,751')
  })
})

describe('formatPesoShort', () => {
  it('abbreviates thousands', () => {
    expect(formatPesoShort(60500)).toBe('₱60.5k')
    expect(formatPesoShort(1000)).toBe('₱1k')
  })

  it('drops a trailing .0 rather than printing ₱61.0k', () => {
    expect(formatPesoShort(61000)).toBe('₱61k')
  })

  it('leaves anything under a thousand alone', () => {
    expect(formatPesoShort(999)).toBe('₱999')
    expect(formatPesoShort(0)).toBe('₱0')
  })
})

describe('formatShare', () => {
  it('renders the share to one decimal', () => {
    expect(formatShare(42000, 60500)).toBe('69.4%')
  })

  // "0.0% of nothing" is a claim; a blank is the absence of one.
  it('says nothing when there is no whole', () => {
    expect(formatShare(100, 0)).toBe('')
    expect(formatShare(100, null)).toBe('')
  })

  it('reports a genuine zero share', () => {
    expect(formatShare(0, 500)).toBe('0.0%')
  })
})

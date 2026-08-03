import { describe, it, expect } from 'vitest'
import { interpretMutation, affectedRowCount } from '../../src/utils/mutationResult'

const BLOCKED = 'This entry can no longer be edited.'

describe('affectedRowCount', () => {
  it('counts array rows', () => {
    expect(affectedRowCount([{ id: 1 }, { id: 2 }])).toBe(2)
  })

  it('treats an empty array as zero', () => {
    expect(affectedRowCount([])).toBe(0)
  })

  it('treats a single object as one row', () => {
    expect(affectedRowCount({ id: 1 })).toBe(1)
  })

  it('treats null and undefined as zero so a missing .select() fails loudly', () => {
    expect(affectedRowCount(null)).toBe(0)
    expect(affectedRowCount(undefined)).toBe(0)
  })
})

describe('interpretMutation', () => {
  it('succeeds when rows were returned', () => {
    expect(interpretMutation({ data: [{ id: 1 }], error: null }, BLOCKED))
      .toEqual({ ok: true, message: '' })
  })

  it('reports the blocked message when RLS filtered the row out', () => {
    // The out-of-window case: PostgREST returns success with zero rows.
    expect(interpretMutation({ data: [], error: null }, BLOCKED))
      .toEqual({ ok: false, message: BLOCKED })
  })

  it('surfaces a real error message', () => {
    expect(interpretMutation({ data: null, error: { message: 'boom' } }, BLOCKED))
      .toEqual({ ok: false, message: 'boom' })
  })

  it('falls back to a generic message when an error carries none', () => {
    const result = interpretMutation({ data: null, error: {} }, BLOCKED)
    expect(result.ok).toBe(false)
    expect(result.message).toBe('Something went wrong. Please try again.')
  })

  it('prefers the error over the row count when both indicate failure', () => {
    expect(interpretMutation({ data: [], error: { message: 'boom' } }, BLOCKED))
      .toEqual({ ok: false, message: 'boom' })
  })

  it('treats a missing .select() as blocked rather than successful', () => {
    expect(interpretMutation({ data: null, error: null }, BLOCKED))
      .toEqual({ ok: false, message: BLOCKED })
  })

  it('tolerates a null result object', () => {
    expect(interpretMutation(null, BLOCKED)).toEqual({ ok: false, message: BLOCKED })
  })
})

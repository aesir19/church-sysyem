import { describe, it, expect, vi } from 'vitest'
import {
  write,
  classifyWriteError,
  affectedRowCount,
  DEFAULT_MESSAGES,
} from '../../../src/lib/data/write'

// A stand-in for a PostgREST builder: not awaited until `.select()` is called,
// which is the property this module depends on (verified against
// @supabase/postgrest-js 2.108.0 — `select()` lives on PostgrestTransformBuilder,
// mutates the URL and returns `this`; execution is deferred to `then()`).
function builderReturning(result) {
  return {
    select: vi.fn().mockResolvedValue(result),
  }
}

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

  it('treats null and undefined as zero so a write that returned nothing fails loudly', () => {
    expect(affectedRowCount(null)).toBe(0)
    expect(affectedRowCount(undefined)).toBe(0)
  })
})

describe('classifyWriteError', () => {
  it('classifies a bare 42501 as denied when there is no message to read', () => {
    expect(classifyWriteError({ code: '42501' })).toBe('denied')
  })

  // A missing GRANT is a deployment fault, not a permission decision. Telling the
  // user they lack permission would send them to the wrong person.
  it('does not treat a missing grant as denied, even though it is also 42501', () => {
    expect(classifyWriteError({ code: '42501', message: 'permission denied for table attendance' }))
      .toBe('failed')
  })

  // Verbatim from running the VERIFICATION.md §4.1 matrix against staging: the
  // WITH CHECK half of attendance_update_link_guest RAISES rather than filtering,
  // so this is what a cross-church link attempt actually produces. The USING half
  // filters to zero rows and never reaches here.
  it('classifies a WITH CHECK violation by message as denied', () => {
    expect(classifyWriteError({ message: 'new row violates row-level security policy for table "attendance"' }))
      .toBe('denied')
  })

  it('is case-insensitive about the message', () => {
    expect(classifyWriteError({ message: 'New Row Violates Row-Level Security Policy' })).toBe('denied')
  })

  it('does not claim unrelated failures as denied', () => {
    expect(classifyWriteError({})).toBe('failed')
    expect(classifyWriteError({ code: '23514', message: 'attendance_identity_check' })).toBe('failed')
  })

  it('classifies a unique violation as conflict', () => {
    expect(classifyWriteError({ code: '23505' })).toBe('conflict')
    expect(classifyWriteError({ message: 'duplicate key value violates unique constraint' }))
      .toBe('conflict')
  })

  it('classifies PGRST116 as blocked, since .single() on zero rows is a filtered row', () => {
    expect(classifyWriteError({ code: 'PGRST116' })).toBe('blocked')
  })

  it('falls through to failed for anything unrecognised', () => {
    expect(classifyWriteError({ code: '08006', message: 'connection failure' })).toBe('failed')
    expect(classifyWriteError(null)).toBe('failed')
  })

  it('reads details as well as message, which is where PostgREST puts constraint text', () => {
    expect(classifyWriteError({ details: 'Key (member_id, service_id)=(a, b) already exists.' }))
      .toBe('conflict')
  })
})

describe('write', () => {
  it('appends the requested columns to the builder', async () => {
    const builder = builderReturning({ data: [{ id: 1 }], error: null })
    await write(builder, { columns: 'id, name' })
    expect(builder.select).toHaveBeenCalledWith('id, name')
  })

  it('defaults the projection to * when no columns are given', async () => {
    const builder = builderReturning({ data: [{ id: 1 }], error: null })
    await write(builder)
    expect(builder.select).toHaveBeenCalledWith('*')
  })

  it('succeeds and returns rows when the write landed', async () => {
    const builder = builderReturning({ data: [{ id: 1 }], error: null })
    const result = await write(builder)
    expect(result.ok).toBe(true)
    expect(result.message).toBe('')
    expect(result.rows).toEqual([{ id: 1 }])
  })

  it('normalises a single returned object into a rows array', async () => {
    const builder = builderReturning({ data: { id: 1 }, error: null })
    const result = await write(builder)
    expect(result.rows).toEqual([{ id: 1 }])
  })

  // The defect this module exists to close: DashboardView.handleArchive issued
  // an update with no .select(), so an archive RLS refused was reported as
  // success and the row was dropped from the list locally.
  it('treats success-with-zero-rows as blocked, not as success', async () => {
    const builder = builderReturning({ data: [], error: null })
    const result = await write(builder)
    expect(result.ok).toBe(false)
    expect(result.message).toBe(DEFAULT_MESSAGES.blocked)
  })

  it('treats a null data payload as blocked rather than successful', async () => {
    const builder = builderReturning({ data: null, error: null })
    const result = await write(builder)
    expect(result.ok).toBe(false)
  })

  it('always returns an empty rows array when not ok, so a caller cannot patch state from a refused write', async () => {
    const cases = [
      { data: [], error: null },
      { data: null, error: { code: '42501' } },
      { data: [{ id: 1 }], error: { message: 'boom' } },
    ]
    for (const payload of cases) {
      const result = await write(builderReturning(payload))
      expect(result.ok).toBe(false)
      expect(result.rows).toEqual([])
    }
  })

  it('prefers the error over the row count when both indicate failure', async () => {
    const builder = builderReturning({ data: [], error: { code: '23505' } })
    const result = await write(builder)
    expect(result.message).toBe(DEFAULT_MESSAGES.conflict)
  })

  it('lets a call site override the message for a mode it understands', async () => {
    const builder = builderReturning({ data: [], error: null })
    const result = await write(builder, { messages: { blocked: 'This entry can no longer be edited.' } })
    expect(result.message).toBe('This entry can no longer be edited.')
  })

  it('keeps the defaults for modes the call site did not override', async () => {
    const builder = builderReturning({ data: null, error: { code: '42501' } })
    const result = await write(builder, { messages: { blocked: 'custom blocked' } })
    expect(result.message).toBe(DEFAULT_MESSAGES.denied)
  })

  // Constraint violations quote the offending row verbatim, which in this app
  // is member PII. src/utils/sentryScrub.js drops these rather than redacting
  // them; the screen must not receive them either.
  it('never returns raw Postgres text for display', async () => {
    const leaky = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "members_name_key"',
      details: 'Key (first_name, last_name)=(Juan, Dela Cruz) already exists.',
    }
    const result = await write(builderReturning({ data: null, error: leaky }))
    expect(result.message).toBe(DEFAULT_MESSAGES.conflict)
    expect(result.message).not.toContain('Juan')
    expect(result.message).not.toContain('members_name_key')
  })

  it('passes the original error through as cause for logging', async () => {
    const error = { code: '23505', message: 'duplicate key value' }
    const result = await write(builderReturning({ data: null, error }))
    expect(result.cause).toBe(error)
  })

  it('fails safely when handed an already-awaited result instead of a builder', async () => {
    const result = await write({ data: [{ id: 1 }], error: null })
    expect(result.ok).toBe(false)
    expect(result.message).toBe(DEFAULT_MESSAGES.failed)
  })

  it('fails safely when handed null', async () => {
    const result = await write(null)
    expect(result.ok).toBe(false)
  })

  it('catches a thrown network failure rather than propagating it into a view', async () => {
    const boom = new Error('Failed to fetch')
    const builder = { select: vi.fn().mockRejectedValue(boom) }
    const result = await write(builder)
    expect(result.ok).toBe(false)
    expect(result.message).toBe(DEFAULT_MESSAGES.failed)
    expect(result.cause).toBe(boom)
  })

  it('tolerates a builder that resolves to nothing at all', async () => {
    const builder = { select: vi.fn().mockResolvedValue(undefined) }
    const result = await write(builder)
    expect(result.ok).toBe(false)
  })
})

// The single seam every write in this app passes through.
//
// PostgREST does not reject a write that RLS forbids — it *filters* it. An
// UPDATE or DELETE whose USING clause excludes the target row comes back
// `{ error: null, data: [] }`, which is indistinguishable from success unless
// the caller both asked for `.select()` and then counted the rows. Nine of the
// nineteen write sites in this app did not, and three of those reported a
// refused write to the user as "saved".
//
// Making that safe by convention failed. So the obligation moves in here:
// callers hand over an un-awaited PostgREST builder, this module appends the
// `.select()`, and there is no way to receive an outcome without the row count
// having been checked.
//
// RLS fails in more than one way, and the difference is not cosmetic:
//
//   USING       filters. Excluded rows are invisible to the statement, so it
//               succeeds with zero rows. -> `blocked`
//   WITH CHECK  raises. A row that would violate it aborts with 42501.
//               -> `denied`
//
// See src/utils/attendanceLink.js, where this distinction was found the hard
// way by running the isolation matrix against staging.

import { isDatabaseError } from '../../utils/sentryScrub'

// Postgres/PostgREST codes this module classifies. Anything else falls through
// to the generic failure, which is the safe direction.
const UNIQUE_VIOLATION = '23505'
const INSUFFICIENT_PRIVILEGE = '42501'
// `.single()` on zero rows. Callers should not use `.single()` — this module
// owns cardinality — but a stray one must not read as an unexplained error.
const NO_ROWS_RETURNED = 'PGRST116'

// Shown when the call site offers nothing more specific. Every one of these is
// written for a church volunteer, not an engineer.
export const DEFAULT_MESSAGES = {
  blocked: 'That change was not allowed. It may have been edited already, or it may belong to another church.',
  denied: 'You do not have permission to make that change.',
  conflict: 'That record already exists.',
  failed: 'Something went wrong. Please try again.',
}

/**
 * Rows affected by a mutation, normalising the shapes `.select()` can return.
 * `null`/`undefined` counts as zero — a write that returned nothing must fail
 * loudly rather than be reported as a success.
 *
 * @param {unknown} data
 * @returns {number}
 */
export function affectedRowCount(data) {
  if (data == null) return 0
  if (Array.isArray(data)) return data.length
  return 1
}

/**
 * Rows as an array, whatever shape PostgREST returned.
 *
 * @param {unknown} data
 * @returns {unknown[]}
 */
function toRows(data) {
  if (data == null) return []
  return Array.isArray(data) ? data : [data]
}

/**
 * Which failure this is. Kept separate from message selection so the
 * classification can be tested without reference to any wording.
 *
 * @param {{ code?: string, message?: string, details?: string } | null} error
 * @returns {'denied' | 'conflict' | 'blocked' | 'failed'}
 */
export function classifyWriteError(error) {
  if (!error) return 'failed'

  const text = `${error.message || ''} ${error.details || ''}`

  if (/row-level security policy/i.test(text)) return 'denied'
  // The SQLSTATE alone only when there is no message to read. 42501 also covers a
  // plain missing GRANT, which is a deployment fault rather than a permission
  // decision, and telling a user they lack permission would send them to the
  // wrong person. That distinction was verified against staging with the
  // docs/security/VERIFICATION.md §4.1 isolation matrix; the cases are kept in
  // tests/lib/data/write.test.js.
  if (!error.message && error.code === INSUFFICIENT_PRIVILEGE) return 'denied'
  if (error.code === UNIQUE_VIOLATION || /duplicate key value|already exists/i.test(text)) {
    return 'conflict'
  }
  if (error.code === NO_ROWS_RETURNED) {
    return 'blocked'
  }
  return 'failed'
}

/**
 * Perform a write and interpret the outcome.
 *
 * The builder must NOT be awaited and must NOT carry its own `.select()`:
 * PostgREST's `select()` appends `Prefer: return=representation`, so a second
 * call duplicates that header. This module owns the projection.
 *
 *   const result = await write(
 *     supabase.from('members').update(payload).eq('id', id),
 *     { columns: MEMBER_COLUMNS, messages: { blocked: 'That member could not be updated.' } }
 *   )
 *   if (!result.ok) { formError.value = result.message; return }
 *
 * `rows` is always an array and is always empty when `ok` is false — so a call
 * site cannot patch its local list from a write the database refused. That is
 * the bug class this module exists to close, and it is enforced by shape rather
 * than by remembering.
 *
 * Raw Postgres text is never returned for display. Constraint violations quote
 * the offending row verbatim (`Key (first_name, last_name)=(Juan, Dela Cruz)
 * already exists`) — member PII, which is why src/utils/sentryScrub.js drops
 * these payloads rather than redacting them. The same text must not reach the
 * screen either. The original error is passed through as `cause` for logging.
 *
 * `columns` is REQUIRED. Defaulting it to `*` would put every write one
 * forgotten option away from selecting every column of a table — including the
 * seventeen PII columns on `members`, which CLAUDE.md makes a standing "Never".
 * A missing `columns` is a programming error, not a runtime condition, so it
 * throws rather than returning a result: it must fail on the first test run and
 * can never reach a user. Writes that need nothing back pass `'id'`.
 *
 * @param {{ select: (columns: string) => PromiseLike<{ data: unknown, error: unknown }> }} builder
 * @param {{ columns: string, messages?: Partial<typeof DEFAULT_MESSAGES> }} options
 * @returns {Promise<{ ok: boolean, message: string, rows: unknown[], cause: unknown }>}
 */
export async function write(builder, options = {}) {
  const { columns, messages = {} } = options
  if (typeof columns !== 'string' || columns.trim() === '') {
    throw new TypeError(
      'write(): `columns` is required. Pass the columns you render, or "id" if you need nothing back.'
    )
  }
  const say = (kind) => messages[kind] ?? DEFAULT_MESSAGES[kind]

  if (!builder || typeof builder.select !== 'function') {
    // An already-awaited result, or something else entirely. Failing here beats
    // reporting a write that never happened as successful.
    return { ok: false, message: say('failed'), rows: [], cause: null }
  }

  let result
  try {
    result = await builder.select(columns)
  } catch (thrown) {
    // Network failure, or the SDK throwing rather than returning. Neither is
    // safe to show verbatim.
    return { ok: false, message: say('failed'), rows: [], cause: thrown }
  }

  const { data, error } = result || {}

  if (error) {
    const kind = classifyWriteError(error)
    return { ok: false, message: say(kind), rows: [], cause: error }
  }

  // No error and no rows: RLS filtered the target out, or the caller forgot
  // that this module needs an un-awaited builder to attach `.select()` to.
  if (affectedRowCount(data) === 0) {
    return { ok: false, message: say('blocked'), rows: [], cause: null }
  }

  return { ok: true, message: '', rows: toRows(data), cause: null }
}

/**
 * The same interpretation, for a mutating RPC.
 *
 * An RPC is already a promise — there is no builder to attach `.select()` to, so
 * this takes the pending call directly. The important difference from `write`:
 * **an empty result is not a blocked write here.** A `void` function legitimately
 * returns null, so treating that as a refusal would report every successful call
 * as a failure. An RPC that RLS refuses raises instead, and lands in
 * `classifyWriteError` like any other error.
 *
 *   const result = await writeRpc(
 *     supabase.rpc('close_service_now', { p_service_id: id }),
 *     { messages: { denied: 'You cannot close that service.' } }
 *   )
 *
 * @param {PromiseLike<{ data: unknown, error: unknown }>} pending
 * @param {{ messages?: Partial<typeof DEFAULT_MESSAGES> }} [options]
 * @returns {Promise<{ ok: boolean, message: string, rows: unknown[], cause: unknown }>}
 */
export async function writeRpc(pending, options = {}) {
  const { messages = {} } = options
  const say = (kind) => messages[kind] ?? DEFAULT_MESSAGES[kind]

  let result
  try {
    result = await pending
  } catch (thrown) {
    return { ok: false, message: say('failed'), rows: [], cause: thrown }
  }

  const { data, error } = result || {}

  if (error) {
    return { ok: false, message: say(classifyWriteError(error)), rows: [], cause: error }
  }

  return { ok: true, message: '', rows: toRows(data), cause: null }
}

/**
 * True when this error's text may carry member data and must not be displayed.
 * Re-exported from the Sentry redaction policy so there is exactly one list of
 * database-error signatures in the codebase, not two that drift apart.
 */
export { isDatabaseError }

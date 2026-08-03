/**
 * Interpret a Supabase mutation result that used `.select()`.
 *
 * PostgREST applies RLS by filtering rows, not by raising an error. An UPDATE or
 * DELETE whose USING clause excludes the target row therefore returns success
 * with zero rows affected — `{ error: null, data: [] }`. Without `.select()` it
 * returns `{ error: null, data: null }`, which is indistinguishable from a real
 * success, so the UI would report that a blocked write had succeeded.
 *
 * This matters for `collections`: migration 0008_funds_write_policies moved the
 * 3-hour edit window into RLS, so an out-of-window edit is silently dropped by
 * the database rather than rejected. Always pair a mutation with `.select()` and
 * run the result through this helper.
 *
 * @param {{ data: unknown, error: { message?: string } | null }} result
 * @param {string} blockedMessage - shown when the write was blocked by a policy
 * @returns {{ ok: boolean, message: string }}
 */
export function interpretMutation(result, blockedMessage) {
  const { data, error } = result || {}

  if (error) {
    return { ok: false, message: error.message || 'Something went wrong. Please try again.' }
  }

  if (affectedRowCount(data) === 0) {
    return { ok: false, message: blockedMessage }
  }

  return { ok: true, message: '' }
}

/**
 * Rows affected by a mutation, normalising the shapes `.select()` can return.
 * `null`/`undefined` counts as zero — a caller that forgot `.select()` should
 * fail loudly rather than be reported as a success.
 *
 * @param {unknown} data
 * @returns {number}
 */
export function affectedRowCount(data) {
  if (data == null) return 0
  if (Array.isArray(data)) return data.length
  return 1
}

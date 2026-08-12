// Every read and write of member data goes through here.
//
// Two things this module exists to stop callers getting wrong:
//
// 1. ARCHIVED ROWS. Migration 0010_members_select_allow_archived deliberately
//    stopped RLS from hiding archived members, because a policy that hides them
//    makes archiving itself impossible. Filtering them is therefore the
//    application's job, at every single read. That was a rule in CLAUDE.md and
//    a comment at three call sites; it is now a property of the module.
//
// 2. PII. There are two ways to list members and they are not interchangeable.
//    `listDirectory` returns names and group membership via the directory_search
//    RPC — safe for everyone. `listRecords` returns seventeen columns including
//    birthdate, address and contact number, and is for callers holding
//    canSeeMemberDetail. Splitting them means the PII path has to be asked for
//    by name; a view can no longer arrive at it by flipping a boolean.
//
// RLS remains the enforcement boundary (ADR-0001) — the capability check here
// stops the app *asking* for data it has no business rendering, which is a
// different job from stopping the database returning it.

import { supabase } from '../supabase'
import { write } from './write'
import { rangeFor } from '../../utils/pagination'
import { buildMemberNameOrFilter, sanitizeMemberSearchTerm } from '../../utils/searchFilters'

/**
 * Client-side paging was rejected as theatre: the
 * unbounded query still runs, so egress is unchanged and the CLAUDE.md
 * threshold it is meant to answer stays breached.
 */
export const MEMBER_PAGE_SIZE = 50

/**
 * What `directory_search`'s `p_limit` is sent as. The function's own default is
 * 200 and this module used to leave it unsent — so a church over 200 members
 * showed baseline users and Head Pastors a truncated list with no indication it
 * was truncated. Sending it explicitly is what lets a caller say so.
 * Paginating that path properly needs a `p_offset` parameter on a SECURITY
 * DEFINER function, which is a migration and a security review, and is
 * deferred.
 */
export const DIRECTORY_LIMIT = 200

/**
 * The columns a caller may order by.
 *
 * A column name reaches the query as an IDENTIFIER, so it is never taken from
 * the caller unchecked — the same reason `searchFilters.js` exists for the
 * search term. Names only, deliberately: age is computed in the browser and
 * does not exist to order on.
 */
const SORTABLE_COLUMNS = Object.freeze(['last_name', 'first_name'])

// Explicit projection: select only what we render. This is the constant
// CLAUDE.md refers to — it used to live inside DashboardView.vue, where the
// other three member queries could not reach it.
export const MEMBER_COLUMNS = `
  id,
  first_name,
  last_name,
  middle_name,
  birthdate,
  gender,
  address,
  contact_number,
  email,
  date_joined,
  member_of,
  marital_status,
  wedding_anniversarry,
  facebook_link,
  is_one_to_one_completed,
  is_turning_point_completed,
  is_baptized
`

const MESSAGES = {
  loadFailed: 'Failed to load members. Please try again.',
  noChurch: 'Cannot determine your church. Please reload.',
  notPermitted: 'You do not have permission to view member details.',
  createBlocked: 'That member could not be created. They may belong to another church.',
  updateBlocked: 'That member could not be updated. They may have been archived already.',
  archiveBlocked: 'That member could not be archived. They may belong to another church, or have been archived already.',
}

const ok = (rows, extra = {}) => ({ ok: true, message: '', rows, cause: null, ...extra })
const fail = (message, cause = null, extra = {}) => ({ ok: false, message, rows: [], cause, ...extra })

/**
 * Names and group membership for everyone in a church. Safe for every role —
 * the directory_search RPC returns no PII, and the base members table returns
 * baseline callers nothing at all under RLS.
 *
 * Not paginated: the RPC takes a limit but no offset, and adding one is a
 * migration against a SECURITY DEFINER function that is the only thing standing
 * between baseline users and the `members` table. That is deferred; this caps
 * honestly instead — `capped` is how the caller knows to say so.
 *
 * @param {string} churchId
 * @param {{ query?: string, limit?: number }} [options]
 * @returns {Promise<{ ok: boolean, message: string, rows: object[], capped: boolean, limit: number, cause: unknown }>}
 */
export async function listDirectory(churchId, { query = '', limit = DIRECTORY_LIMIT } = {}) {
  if (!churchId) return fail(MESSAGES.noChurch, null, { capped: false, limit })

  // Sanitized even though it travels as an RPC parameter and cannot break out
  // of one: directory_search wraps p_query in its OWN `%…%`, so a stray `%`
  // inside the term widens the match instead of narrowing it. The length bound
  // comes along for free.
  const safe = sanitizeMemberSearchTerm(query)

  const { data, error } = await supabase.rpc('directory_search', {
    p_query: safe.length >= 2 ? safe : null,
    p_church_id: churchId,
    p_limit: limit,
  })
  if (error) return fail(MESSAGES.loadFailed, error, { capped: false, limit })

  const rows = (data || []).map((row) => ({
    id: row.member_id,
    first_name: row.first_name,
    last_name: row.last_name,
    ministries: row.ministries || [],
    small_groups: row.small_groups || [],
  }))

  return ok(rows, { capped: rows.length >= limit, limit })
}

/**
 * Full member records, PII included. Refuses rather than degrading when the
 * caller lacks the capability: silently returning the directory shape instead
 * would leave the caller rendering columns that are simply absent, which reads
 * as a bug rather than as a permission boundary.
 *
 * `canSeeDetail` is passed in rather than read from the role composable so this
 * stays testable without mounting anything.
 *
 * ONE PAGE, ONE ROUND TRIP. The `count: 'exact'` option rides along on the same
 * request as the rows, so the pager's total costs nothing extra — which is what
 * "one round-trip per intent" requires. The archived count the mockup also
 * shows would need a second query and is out.
 *
 * @param {{ churchId: string, canSeeDetail: boolean, page?: number, pageSize?: number,
 *   search?: string, sortKey?: string, sortDirection?: 'ascending'|'descending' }} params
 * @returns {Promise<{ ok: boolean, message: string, rows: object[], total: number, cause: unknown }>}
 */
export async function listRecords({
  churchId,
  canSeeDetail,
  page = 1,
  pageSize = MEMBER_PAGE_SIZE,
  search = '',
  sortKey = 'last_name',
  sortDirection = 'ascending',
}) {
  if (!canSeeDetail) return fail(MESSAGES.notPermitted, null, { total: 0 })
  if (!churchId) return fail(MESSAGES.noChurch, null, { total: 0 })

  const column = SORTABLE_COLUMNS.includes(sortKey) ? sortKey : 'last_name'
  const ascending = sortDirection !== 'descending'
  const { from, to } = rangeFor(page, pageSize)

  // Scoped to the active church explicitly: RLS returns every church to a
  // SuperAdmin, so without this their list would merge all of them.
  let query = supabase
    .from('members')
    .select(MEMBER_COLUMNS, { count: 'exact' })
    .eq('member_of', churchId)
    .is('archived_at', null)

  // The term is turned into a filter by searchFilters.js, which strips the
  // characters that would otherwise close PostgREST's `or(...)` and open a new
  // condition. Never interpolated here.
  const filter = buildMemberNameOrFilter(search)
  if (filter) query = query.or(filter)

  // Both orders matter. Without the first, `.range()` slices an unordered
  // result and can repeat a row on one page and skip it on the next; without
  // the `id` tiebreaker, shared surnames shuffle across a page boundary between
  // one request and the next. The tiebreaker is always ascending — it exists to
  // be stable, not to be meaningful.
  const { data, error, count } = await query
    .order(column, { ascending })
    .order('id', { ascending: true })
    .range(from, to)

  if (error) return fail(MESSAGES.loadFailed, error, { total: 0 })
  return ok(data || [], { total: count ?? 0 })
}

/**
 * @param {{ payload: object, churchId: string }} params
 */
export async function create({ payload, churchId }) {
  if (!churchId) return fail(MESSAGES.noChurch)

  return write(
    supabase.from('members').insert({ ...payload, member_of: churchId }),
    { columns: MEMBER_COLUMNS, messages: { blocked: MESSAGES.createBlocked } }
  )
}

/**
 * @param {{ id: string, payload: object }} params
 */
export async function update({ id, payload }) {
  return write(
    supabase.from('members').update(payload).eq('id', id),
    { columns: MEMBER_COLUMNS, messages: { blocked: MESSAGES.updateBlocked } }
  )
}

/**
 * Soft delete. Archiving is an UPDATE, and it used to be issued without
 * `.select()` — so an archive RLS refused came back { error: null, data: null }
 * and the view reported it as success, dropping the member from the list until
 * the next reload brought them back.
 *
 * @param {{ id: string, reason?: string }} params
 */
export async function archive({ id, reason }) {
  return write(
    supabase
      .from('members')
      .update({
        archived_at: new Date().toISOString(),
        archived_reason: reason?.trim() || null,
      })
      .eq('id', id),
    { columns: 'id', messages: { blocked: MESSAGES.archiveBlocked } }
  )
}

export const MEMBER_MESSAGES = MESSAGES

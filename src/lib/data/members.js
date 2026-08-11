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

const ok = (rows) => ({ ok: true, message: '', rows, cause: null })
const fail = (message, cause = null) => ({ ok: false, message, rows: [], cause })

/**
 * Names and group membership for everyone in a church. Safe for every role —
 * the directory_search RPC returns no PII, and the base members table returns
 * baseline callers nothing at all under RLS.
 *
 * @param {string} churchId
 * @returns {Promise<{ ok: boolean, message: string, rows: object[], cause: unknown }>}
 */
export async function listDirectory(churchId) {
  if (!churchId) return fail(MESSAGES.noChurch)

  const { data, error } = await supabase.rpc('directory_search', { p_church_id: churchId })
  if (error) return fail(MESSAGES.loadFailed, error)

  return ok((data || []).map((row) => ({
    id: row.member_id,
    first_name: row.first_name,
    last_name: row.last_name,
    ministries: row.ministries || [],
    small_groups: row.small_groups || [],
  })))
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
 * @param {{ churchId: string, canSeeDetail: boolean }} params
 * @returns {Promise<{ ok: boolean, message: string, rows: object[], cause: unknown }>}
 */
export async function listRecords({ churchId, canSeeDetail }) {
  if (!canSeeDetail) return fail(MESSAGES.notPermitted)
  if (!churchId) return fail(MESSAGES.noChurch)

  // Scoped to the active church explicitly: RLS returns every church to a
  // SuperAdmin, so without this their list would merge all of them.
  const { data, error } = await supabase
    .from('members')
    .select(MEMBER_COLUMNS)
    .eq('member_of', churchId)
    .is('archived_at', null)

  if (error) return fail(MESSAGES.loadFailed, error)
  return ok(data || [])
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

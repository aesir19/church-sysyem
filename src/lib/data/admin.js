// Every read and write behind the Settings area goes through here.
//
// Same reason members.js and groups.js exist: the rules below are not obvious from a
// call site, and a screen that re-derives them gets them subtly wrong.
//
// FOUR THINGS THIS MODULE EXISTS TO STOP CALLERS GETTING WRONG:
//
// 1. THERE ARE TWO ACCOUNT LISTS, AND THEY ARE NOT INTERCHANGEABLE.
//    list_accounts() carries e-mail addresses and is SuperAdmin-only.
//    list_church_accounts() carries names and roles, no e-mail, and is also open to a
//    Head Pastor — who is deliberately outside can_see_member_detail (0015). The pastor
//    screen must use the second, or it renders empty for the one role that most needs
//    it. Asking for the wrong one fails as *no rows*, never as an error.
//
// 2. NO ROWS AND NO PERMISSION LOOK IDENTICAL. Both RPCs return an empty set rather
//    than raising when the caller is not allowed — deliberately, so a probe learns
//    nothing. So every read here reports `permitted` alongside the rows, derived from
//    the caller's capabilities rather than from the row count, and the screen can tell
//    "nobody is waiting" apart from "this is not yours to see".
//
// 3. AN UNLINKED ACCOUNT IS THE POINT, NOT AN ERROR. Most accounts in the queue have no
//    member, no church and no role. That is the state every sign-up is in until someone
//    acts. Callers must not filter it out or treat it as incomplete data.
//
// 4. THE WRITES ARE RPCs THAT RETURN VOID, so there is no row to count. They report
//    failure by raising, which is the opposite of the PostgREST convention write() was
//    built for — hence writeRpc, which classifies the raised error instead.

import { supabase } from '../supabase'
import { writeRpc } from './write'

const MESSAGES = {
  loadFailed: 'Failed to load accounts. Please try again.',
  notPermitted: 'You do not have permission to manage accounts.',
  linkFailed: 'That account could not be linked.',
  unlinkFailed: 'That account could not be unlinked.',
  roleFailed: 'That role could not be changed.',
  assignFailed: 'That leader could not be assigned.',
  unassignFailed: 'That leader could not be unassigned.',
  inviteFailed: 'That invitation could not be sent.',
  resendFailed: 'That invitation could not be resent.',
  cancelFailed: 'That invitation could not be cancelled.'
}

const fail = (message, cause = null, extra = {}) =>
  ({ ok: false, message, rows: [], permitted: false, cause, ...extra })

const ok = (rows, extra = {}) =>
  ({ ok: true, message: '', rows, permitted: true, cause: null, ...extra })

/**
 * Every account, with its e-mail address. SuperAdmin only.
 *
 * @param {{ canManageAccounts: boolean }} params — pass the caller's capability. It is
 *   not read from the composable here so this stays testable without mounting anything,
 *   the same choice listGroups made.
 */
export async function listAccounts ({ canManageAccounts }) {
  if (!canManageAccounts) return fail(MESSAGES.notPermitted)

  const { data, error } = await supabase.rpc('list_accounts')
  if (error) return fail(MESSAGES.loadFailed, error)

  const rows = data || []
  return ok(rows, {
    // The queue is the whole reason this screen exists, so it is computed here rather
    // than left to each caller to re-filter.
    waiting: rows.filter(r => !r.member_id),
    linked: rows.filter(r => !!r.member_id)
  })
}

/**
 * Linked accounts by church — names and roles, never e-mail. SuperAdmin and Head Pastor.
 *
 * @param {{ churchId?: string|null, canAssignPastors: boolean }} params
 */
export async function listChurchAccounts ({ churchId = null, canAssignPastors }) {
  if (!canAssignPastors) return fail(MESSAGES.notPermitted)

  const { data, error } = await supabase.rpc('list_church_accounts', {
    p_church_id: churchId
  })
  if (error) return fail(MESSAGES.loadFailed, error)

  return ok(data || [])
}

/** The churches this caller may act across. Empty for everyone below Head Pastor. */
export async function listChurches ({ canAssignPastors }) {
  if (!canAssignPastors) return fail(MESSAGES.notPermitted)

  const { data, error } = await supabase.rpc('list_churches')
  if (error) return fail(MESSAGES.loadFailed, error)

  return ok(data || [])
}

/**
 * Tie a sign-in to a member record. Passing `memberId: null` unlinks.
 *
 * Refused if the account leads a small group and the member is changing (0023) — the
 * group would end up led by someone who was never on its roster.
 */
export function linkAccount ({ accountId, memberId }) {
  return writeRpc(
    supabase.rpc('link_account_to_member', { p_account: accountId, p_member: memberId }),
    { messages: { failed: memberId === null ? MESSAGES.unlinkFailed : MESSAGES.linkFailed } }
  )
}

/** Set an account's role. SuperAdmin for any value; Head Pastor for pastor / member. */
export function setUserRole ({ accountId, role }) {
  return writeRpc(
    supabase.rpc('set_user_role', { p_target: accountId, p_role: role }),
    { messages: { failed: MESSAGES.roleFailed } }
  )
}

/** Make this account the leader of this small group. */
export function assignSmallGroupLeader ({ accountId, groupId }) {
  return writeRpc(
    supabase.rpc('assign_small_group_leader', { p_account: accountId, p_group: groupId }),
    { messages: { failed: MESSAGES.assignFailed } }
  )
}

export function unassignSmallGroupLeader ({ accountId, groupId }) {
  return writeRpc(
    supabase.rpc('unassign_small_group_leader', { p_account: accountId, p_group: groupId }),
    { messages: { failed: MESSAGES.unassignFailed } }
  )
}

/**
 * Pending invitations the caller may see. SuperAdmin sees all; a Church Leader
 * sees only their own church's. Zero rows to anyone else — so `permitted` is
 * derived from the capability, not the row count (rule 2 of this module).
 *
 * @param {{ canInvite: boolean }} params
 */
export async function listPendingInvites ({ canInvite }) {
  if (!canInvite) return fail(MESSAGES.notPermitted)

  const { data, error } = await supabase.rpc('list_pending_invites')
  if (error) return fail(MESSAGES.loadFailed, error)

  return ok(data || [])
}

/**
 * Send an account invitation to a member. The address is NOT passed — the Edge
 * Function derives it from the member record, the one source of truth (ADR-0019),
 * so a mistyped address is impossible. Goes through the invite-user Edge Function,
 * not an RPC: sending the e-mail needs the service-role key, which never reaches the
 * browser (ADR-0018). All authorisation is still the database's, under the caller's
 * JWT, inside the function.
 *
 * @param {{ memberId: string, role?: string|null }} params
 */
export async function inviteAccount ({ memberId, role = null }) {
  return invokeInvite('invite', { member_id: memberId, role }, MESSAGES.inviteFailed)
}

/**
 * Re-send a pending invitation. No new member link — the pending row already
 * carries it; this just re-mails the member's address.
 *
 * @param {{ email: string }} params
 */
export async function resendInvite ({ email }) {
  return invokeInvite('resend', { email }, MESSAGES.resendFailed)
}

/**
 * Cancel a pending invitation — live or orphaned. Deletes the un-accepted login (if
 * one still exists) and releases the invite record, so the member can be invited
 * again. Identified by the address on the pending row. Same permission as resend:
 * a Super Admin cancels any, a Church Leader only their own church's.
 *
 * @param {{ email: string }} params
 */
export async function cancelInvite ({ email }) {
  return invokeInvite('cancel', { email }, MESSAGES.cancelFailed)
}

// The Edge Function returns { ok, full_name } on success and { error: <message> }
// with a non-2xx status on failure. supabase-js surfaces that failure as `error`
// and hides the body on it, so the caller-safe message is read back off
// error.context (the raw Response). Anything unreadable falls back to `fallback`.
async function invokeInvite (mode, body, fallback) {
  const { data, error } = await supabase.functions.invoke('invite-user', {
    body: { ...body, mode }
  })

  if (error) {
    let message = fallback
    try {
      const payload = await error.context?.json?.()
      if (payload?.error) message = payload.error
    } catch { /* keep the fallback */ }
    return fail(message, error)
  }

  return ok([], { fullName: data?.full_name ?? null, email: data?.email ?? null })
}

/**
 * The leaders of the groups on screen, keyed by group id.
 *
 * Read straight from the table rather than through an RPC: RLS already scopes it to the
 * groups the caller can see, and the group card needs nothing but a name.
 */
export async function listGroupLeaders ({ groupIds = [] } = {}) {
  if (!groupIds.length) return ok([], { byGroup: new Map() })

  const { data, error } = await supabase
    .from('small_group_leaders')
    .select('group_id, account_id, assigned_at')
    .in('group_id', groupIds)

  if (error) return fail(MESSAGES.loadFailed, error, { byGroup: new Map() })

  const byGroup = new Map()
  for (const row of data || []) byGroup.set(row.group_id, row)

  return ok(data || [], { byGroup })
}

export const ADMIN_MESSAGES = MESSAGES

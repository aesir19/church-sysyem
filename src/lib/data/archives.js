import { supabase } from '../supabase'
import { writeRpc } from './write'

const fail = (message, cause = null) => ({ ok: false, message, cause, rows: [], permitted: false })
const REFUSALS = {
  AR001: 'You cannot archive your own record. Ask another authorized person to do it.',
  AR002: 'Only a SuperAdmin can archive a member linked to a SuperAdmin or Head Pastor account.',
  AR003: 'This is the last active SuperAdmin. Assign another SuperAdmin first.',
  AR004: 'Account access could not be changed. Nothing was saved. Please try again.',
  AR005: 'Enter a reason for restoring this member.',
  AR006: 'Restore the member before changing their account access or link.',
  AR007: 'The retained roles or assignments have changed. Reload and confirm them again.',
  AR008: 'This account has another sign-in restriction. Contact your administrator.',
}

async function mutate(name, args, failure) {
  const result = await writeRpc(supabase.rpc(name, args), { messages: { failed: failure } })
  if (!result.ok && REFUSALS[result.cause?.code]) return { ...result, message: REFUSALS[result.cause.code] }
  if (result.ok && !result.rows[0]?.id) return fail(failure)
  return result
}

export function archiveMember({ id, reason = '' }) {
  return mutate('archive_member', { p_member_id: id, p_reason: reason.trim() || null },
    'Could not archive this member and disable their linked account. Nothing was saved. Please try again.')
}

export async function restoreMember({ id, reason }) {
  if (!reason?.trim()) return fail('Enter a reason for restoring this member.')
  return mutate('restore_archived_member', { p_member_id: id, p_reason: reason.trim() }, 'Could not restore this member. Please try again.')
}

export async function getArchivedMember({ id, canRead }) {
  if (!id || !canRead) return fail('You do not have access to this archive.')
  try {
    const { data, error } = await supabase.rpc('archived_member_detail', { p_member_id: id })
    if (error || !data?.id) return fail('Could not load this record. Please try again.', error)
    return { ok: true, member: data, message: '' }
  } catch (cause) {
    return fail('Could not load this record. Please try again.', cause)
  }
}

export async function enableAccount({ id, assignments, confirmedKeys }) {
  if (!assignments?.length || assignments.some(a => !confirmedKeys?.includes(a.key))) {
    return fail('Confirm every retained role and assignment before re-enabling access.')
  }
  return mutate('enable_archived_account', { p_member_id: id, p_confirmed_assignments: assignments },
    'Could not re-enable access. The account remains disabled. Please try again.')
}

export async function listArchivedMembers({ churchId, canRead, query = '', page = 1, awaiting = false, isSuperAdmin = false }) {
  if (!churchId || !canRead || (awaiting && !isSuperAdmin)) return fail('You do not have access to this archive.')
  try {
    const { data, error } = await supabase.rpc('list_archived_members', {
      p_church_id: churchId, p_query: query.trim().slice(0, 200), p_page: page, p_awaiting: awaiting,
    })
    if (error || !data || !Array.isArray(data.rows)) return fail('Could not load archived members. Please try again.', error)
    return { ok: true, permitted: true, message: '', rows: data.rows, total: data.total,
      archivedCount: data.archived_count, awaitingCount: data.awaiting_count }
  } catch (cause) {
    return fail('Could not load archived members. Please try again.', cause)
  }
}

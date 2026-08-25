// Volunteer roles, assignments, and the programme — the reads/writes the Stage-3
// event detail (frame 6b) and the mobile "I can serve" sheet (7s) make. Migration
// 0035, spec #87.
//
// TWO LISTS, ONE EVENT (Q11). The volunteer ROSTER (event_roles + event_assignments)
// drives the "6 of 9 filled" gauge and carries the eligibility/clash rules. The
// PROGRAMME (event_programme_items) is a separate running order whose "lead" is a plain
// note — no gauge, no eligibility, no clash. This module keeps them apart on purpose.
//
// THE BOUNDARY. Raw assignment rows (identities, a guest's contact) are viewer-only —
// RLS returns them only to canViewEvents callers. A plain member never reads the roster:
// they see fill COUNTS through roleFill() (RPC event_role_fill) and volunteer through
// offerToServe() (RPC offer_to_serve), which auto-accepts (Q3), refuses a finance-required
// role (Q7) and a full role (Q8). Eligibility for a finance-required role is enforced in
// the DB (assignment guard, 0035), not here; the app only mirrors it for the affordance.
//
// SCOPING & WRITES follow events.js exactly: church_id is passed explicitly, and every
// mutation goes through the write() seam so a refused write can never read as success.

import { supabase } from '../supabase'
import { write } from './write'

const MESSAGES = {
  rolesFailed: 'Could not load the volunteer roles. Please try again.',
  rosterFailed: 'Could not load the roster. Please try again.',
  programmeFailed: 'Could not load the programme. Please try again.',
  roleSaveFailed: 'That role could not be saved.',
  roleDeleteFailed: 'That role could not be removed.',
  assignFailed: 'That person could not be assigned.',
  unassignFailed: 'That assignment could not be removed.',
  statusFailed: 'That assignment could not be updated.',
  itemSaveFailed: 'That programme item could not be saved.',
  itemDeleteFailed: 'That programme item could not be removed.',
  offerFailed: 'You could not be signed up. Please try again.',
}

export const ROLE_COLUMNS =
  'id, church_id, event_id, label, count_required, requires_finance, note, created_at, created_by'

// Assignments embed the member's name the same way the attendance roster does. A guest
// carries its own name/contact/affiliation and no member.
export const ASSIGNMENT_COLUMNS =
  'id, church_id, event_id, role_id, member_id, guest_name, guest_contact, ' +
  'guest_affiliation, status, created_at, members(first_name, middle_name, last_name)'

export const PROGRAMME_COLUMNS =
  'id, church_id, event_id, item_time, title, note, lead_member_id, lead_name, position, ' +
  'members:members!event_programme_items_lead_fkey(first_name, middle_name, last_name)'

// --- Roles ------------------------------------------------------------------

/** The roles an event declares (frame 6c). Ordered by creation so the list is stable. */
export async function listRoles({ eventId }) {
  if (!eventId) return { ok: false, roles: [], message: MESSAGES.rolesFailed }
  const { data, error } = await supabase
    .from('event_roles')
    .select(ROLE_COLUMNS)
    .eq('event_id', eventId)
    .order('created_at', { ascending: true })
  if (error) return { ok: false, roles: [], message: MESSAGES.rolesFailed }
  return { ok: true, roles: data ?? [], message: '' }
}

/** Add a role an event needs (stories 1, 5). `churchId` is the event's church. */
export function addRole({ eventId, churchId, label, countRequired = 1, requiresFinance = false, note = null }) {
  return write(
    supabase.from('event_roles').insert({
      event_id: eventId, church_id: churchId, label,
      count_required: countRequired, requires_finance: requiresFinance, note,
    }),
    { columns: ROLE_COLUMNS, messages: single(MESSAGES.roleSaveFailed) }
  )
}

/** Change a role's label, count, requirement, or note (stories 4, 5). */
export function updateRole(id, payload) {
  return write(
    supabase.from('event_roles').update(payload).eq('id', id),
    { columns: ROLE_COLUMNS, messages: single(MESSAGES.roleSaveFailed) }
  )
}

/** Remove a role. Its assignments cascade in the DB (0035). */
export function deleteRole(id) {
  return write(supabase.from('event_roles').delete().eq('id', id), {
    columns: 'id', messages: single(MESSAGES.roleDeleteFailed),
  })
}

// --- Assignments (the roster) ----------------------------------------------

/**
 * The roster: every role with the people assigned to it, joined in JS so the view
 * renders one list per role with filled/open slots (frame 6b, story 14). Returns
 * { ok, roles: [{ ...role, assignments: [...] }], message }.
 */
export async function listRoster({ eventId }) {
  if (!eventId) return { ok: false, roles: [], message: MESSAGES.rosterFailed }
  const [rolesRes, aRes] = await Promise.all([
    supabase.from('event_roles').select(ROLE_COLUMNS).eq('event_id', eventId).order('created_at', { ascending: true }),
    supabase.from('event_assignments').select(ASSIGNMENT_COLUMNS).eq('event_id', eventId).order('created_at', { ascending: true }),
  ])
  if (rolesRes.error || aRes.error) return { ok: false, roles: [], message: MESSAGES.rosterFailed }
  const byRole = new Map()
  for (const a of aRes.data ?? []) {
    if (!byRole.has(a.role_id)) byRole.set(a.role_id, [])
    byRole.get(a.role_id).push(decorateAssignment(a))
  }
  const roles = (rolesRes.data ?? []).map((r) => ({
    ...r,
    assignments: byRole.get(r.id) ?? [],
    filled: (byRole.get(r.id) ?? []).length,
  }))
  return { ok: true, roles, message: '' }
}

/** Assign a member to a role (story 6). Eligibility for a finance-required role is
 *  enforced by the DB guard (0035); a refused write returns { ok:false }. */
export function assignMember({ eventId, churchId, roleId, memberId, status = 'confirmed' }) {
  return write(
    supabase.from('event_assignments').insert({
      event_id: eventId, church_id: churchId, role_id: roleId, member_id: memberId, status,
    }),
    { columns: ASSIGNMENT_COLUMNS, messages: single(MESSAGES.assignFailed) }
  )
}

/** Assign a named external guest — or a helper from another church (Q1) — to a role
 *  (stories 11, 12). Only a name is required; contact and affiliation are optional (Q5). */
export function assignGuest({ eventId, churchId, roleId, guestName, guestContact = null, guestAffiliation = null, status = 'confirmed' }) {
  return write(
    supabase.from('event_assignments').insert({
      event_id: eventId, church_id: churchId, role_id: roleId,
      guest_name: guestName, guest_contact: guestContact, guest_affiliation: guestAffiliation, status,
    }),
    { columns: ASSIGNMENT_COLUMNS, messages: single(MESSAGES.assignFailed) }
  )
}

/** Remove an assignment (story 13) — including a "did not arrive" removal at closeout (story 35). */
export function unassign(id) {
  return write(supabase.from('event_assignments').delete().eq('id', id), {
    columns: 'id', messages: single(MESSAGES.unassignFailed),
  })
}

/** Flip an assignment between open and confirmed (story 14). */
export function setAssignmentStatus(id, status) {
  return write(
    supabase.from('event_assignments').update({ status }).eq('id', id),
    { columns: ASSIGNMENT_COLUMNS, messages: single(MESSAGES.statusFailed) }
  )
}

/**
 * Per-role fill counts (the gauge, and the mobile sheet) via the definer RPC — no
 * identities, so a plain member can read a published event's gauge. Returns
 * { ok, roles: [{ role_id, label, count_required, filled, requires_finance }], message }.
 */
export async function roleFill({ eventId }) {
  if (!eventId) return { ok: false, roles: [], message: MESSAGES.rolesFailed }
  const { data, error } = await supabase.rpc('event_role_fill', { p_event_id: eventId })
  if (error) return { ok: false, roles: [], message: MESSAGES.rolesFailed }
  return { ok: true, roles: data ?? [], message: '' }
}

/** A member offers themselves to a role from the mobile sheet (story 37). Auto-accepts
 *  (Q3) via the RPC, which enforces Q7/Q8. Returns write()-shaped { ok, message }. */
export async function offerToServe(roleId) {
  const { error } = await supabase.rpc('offer_to_serve', { p_role_id: roleId })
  if (error) return { ok: false, message: cleanRpcError(error) || MESSAGES.offerFailed }
  return { ok: true, message: '' }
}

// --- Clash detection (soft warnings, computed app-side — Q2/Q8) --------------

/**
 * Other duties this member already has that overlap [startsAt, endsAt] (frame 7f's
 * "already on sound"). A WARNING the assign dialog shows BEFORE the choice (story 42) —
 * never a block for people (Q8). Reads assignments the caller may already see (own church,
 * canViewEvents). `excludeEventId` drops the event being staffed. Returns a list of
 * { eventId, title, starts_at, ends_at } for the warning.
 */
export async function findPersonClashes({ churchId, memberId, startsAt, endsAt, excludeEventId = null }) {
  if (!churchId || !memberId || !startsAt) return []
  const { data: rows, error } = await supabase
    .from('event_assignments')
    .select('event_id')
    .eq('church_id', churchId)
    .eq('member_id', memberId)
  if (error || !rows?.length) return []
  const ids = [...new Set(rows.map((r) => r.event_id))].filter((id) => id && id !== excludeEventId)
  if (!ids.length) return []
  const { data: evs, error: evErr } = await supabase
    .from('events')
    .select('id, title, starts_at, ends_at')
    .in('id', ids)
    .neq('status', 'cancelled')
  if (evErr || !evs) return []
  return evs
    .filter((e) => overlaps(e.starts_at, e.ends_at, startsAt, endsAt))
    .map((e) => ({ eventId: e.id, title: e.title, starts_at: e.starts_at, ends_at: e.ends_at }))
}

/**
 * Published events in the next `withinDays` that are short of volunteers — the calendar's
 * "needs a decision" gaps card (6a, story 3). Bounded by the short look-ahead window, so the
 * per-event fill lookups stay few. Returns [{ id, title, starts_at, needed, filled, gap }].
 */
export async function listUnderstaffedEvents({ churchId, withinDays = 7, now = new Date() }) {
  if (!churchId) return []
  const from = now.toISOString()
  const to = new Date(now.getTime() + withinDays * 86400000).toISOString()
  const { data, error } = await supabase
    .from('events')
    .select('id, title, starts_at')
    .eq('church_id', churchId)
    .eq('status', 'published')
    .gte('starts_at', from)
    .lt('starts_at', to)
    .order('starts_at', { ascending: true })
  if (error || !data?.length) return []
  const out = []
  for (const e of data) {
    const { data: fill } = await supabase.rpc('event_role_fill', { p_event_id: e.id })
    const roles = fill || []
    if (!roles.length) continue
    const needed = roles.reduce((s, r) => s + r.count_required, 0)
    const filled = roles.reduce((s, r) => s + Math.min(r.filled, r.count_required), 0)
    if (filled < needed) out.push({ ...e, needed, filled, gap: needed - filled })
  }
  return out
}

// --- Programme --------------------------------------------------------------

/** The running order (frame 6b, story 18). Ordered by position. */
export async function listProgramme({ eventId }) {
  if (!eventId) return { ok: false, items: [], message: MESSAGES.programmeFailed }
  const { data, error } = await supabase
    .from('event_programme_items')
    .select(PROGRAMME_COLUMNS)
    .eq('event_id', eventId)
    .order('position', { ascending: true })
  if (error) return { ok: false, items: [], message: MESSAGES.programmeFailed }
  return { ok: true, items: (data ?? []).map(decorateProgramme), message: '' }
}

/** Add a programme item (story 16). `leadMemberId` OR `leadName` names the lead, or neither
 *  ("not assigned", story 19). `position` is set by the caller from the current length. */
export function addProgrammeItem({ eventId, churchId, title, itemTime = null, note = null, leadMemberId = null, leadName = null, position = 0 }) {
  return write(
    supabase.from('event_programme_items').insert({
      event_id: eventId, church_id: churchId, title, item_time: itemTime,
      note, lead_member_id: leadMemberId, lead_name: leadName, position,
    }),
    { columns: PROGRAMME_COLUMNS, messages: single(MESSAGES.itemSaveFailed) }
  )
}

export function updateProgrammeItem(id, payload) {
  return write(
    supabase.from('event_programme_items').update(payload).eq('id', id),
    { columns: PROGRAMME_COLUMNS, messages: single(MESSAGES.itemSaveFailed) }
  )
}

export function deleteProgrammeItem(id) {
  return write(supabase.from('event_programme_items').delete().eq('id', id), {
    columns: 'id', messages: single(MESSAGES.itemDeleteFailed),
  })
}

/** Persist a reorder (story 17): [{ id, position }, …]. Sequential so a refusal stops early. */
export async function reorderProgramme(items) {
  for (const { id, position } of items) {
    const res = await updateProgrammeItem(id, { position })
    if (!res.ok) return res
  }
  return { ok: true, message: '' }
}

// --- helpers ----------------------------------------------------------------

function single(msg) { return { blocked: msg, denied: msg, failed: msg } }

/** Two intervals overlap when each starts before the other ends. A missing end is treated
 *  as a zero-length point at its start, so a dateless/end-less event never falsely clashes. */
export function overlaps(aStart, aEnd, bStart, bEnd) {
  const as = new Date(aStart).getTime()
  const bs = new Date(bStart).getTime()
  const ae = aEnd ? new Date(aEnd).getTime() : as
  const be = bEnd ? new Date(bEnd).getTime() : bs
  return as < be && bs < ae
}

function fullName(m) {
  if (!m) return null
  return [m.first_name, m.middle_name, m.last_name].filter(Boolean).join(' ').trim() || null
}

function decorateAssignment(a) {
  return {
    ...a,
    displayName: a.member_id ? fullName(a.members) : a.guest_name,
    isGuest: !a.member_id,
  }
}

function decorateProgramme(i) {
  return { ...i, leadDisplayName: i.lead_member_id ? fullName(i.members) : (i.lead_name ?? null) }
}

/** PostgREST/Postgres RAISE messages arrive as { message }. The DB guard/RPCs raise
 *  human-readable text (0035); surface it directly so the user sees the real reason. */
function cleanRpcError(error) {
  const m = error?.message ?? ''
  // Strip a leading Postgres context prefix if present; keep the sentence.
  return m.replace(/^.*?:\s*/, '').trim() || null
}

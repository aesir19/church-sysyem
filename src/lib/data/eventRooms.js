// Rooms — the per-church bookable list and the soft double-booking check (frames 7j,
// 7b). Migration 0035, spec #87.
//
// Rooms are a SHORT per-church list, not a scheduling product. An event is placed in one
// room (events.room_id) or none ("no room needed", story 24). The list is managed by
// Church Leader + SuperAdmin (Q4, can_manage_rooms); Events Team only picks from it.
//
// THE CLASH IS A WARNING, NOT A WALL (Q2). Two events in the same room in overlapping
// hours surface as an amber warning the composer shows before saving (frame 7b) — the
// save is allowed to override (two events deliberately sharing the hall is legitimate).
// So the check is a plain read computed app-side, not a DB exclusion constraint.

import { supabase } from '../supabase'
import { write } from './write'
import { overlaps } from './eventRoles'

const MESSAGES = {
  loadFailed: 'Could not load the rooms. Please try again.',
  saveFailed: 'That room could not be saved.',
  deleteFailed: 'That room could not be removed.',
}

export const ROOM_COLUMNS = 'id, church_id, label, capacity, is_bookable, created_at'

/** The church's rooms, ordered by name. Bookable and unbookable both — an unbookable
 *  space (the pastor's office, story 23) is listed but the picker disables it. */
export async function listRooms({ churchId }) {
  if (!churchId) return { ok: false, rooms: [], message: MESSAGES.loadFailed }
  const { data, error } = await supabase
    .from('event_rooms')
    .select(ROOM_COLUMNS)
    .eq('church_id', churchId)
    .order('label', { ascending: true })
  if (error) return { ok: false, rooms: [], message: MESSAGES.loadFailed }
  return { ok: true, rooms: data ?? [], message: '' }
}

/** Add a room (story 26; Church Leader/SuperAdmin only — RLS enforces). */
export function addRoom({ churchId, label, capacity = null, isBookable = true }) {
  return write(
    supabase.from('event_rooms').insert({ church_id: churchId, label, capacity, is_bookable: isBookable }),
    { columns: ROOM_COLUMNS, messages: single(MESSAGES.saveFailed) }
  )
}

export function updateRoom(id, payload) {
  return write(
    supabase.from('event_rooms').update(payload).eq('id', id),
    { columns: ROOM_COLUMNS, messages: single(MESSAGES.saveFailed) }
  )
}

/** Remove a room. Any event pointing at it has room_id set to NULL by the FK (0035),
 *  so a booked event becomes "no room" rather than breaking. */
export function deleteRoom(id) {
  return write(supabase.from('event_rooms').delete().eq('id', id), {
    columns: 'id', messages: single(MESSAGES.deleteFailed),
  })
}

/**
 * Other events already booked into `roomId` whose hours overlap [startsAt, endsAt]
 * (frame 7b amber banner, story 25). A WARNING computed before the save, never a block
 * (Q2). `excludeEventId` drops the event being edited. Returns a list of clashing
 * { eventId, title, starts_at, ends_at }; empty means the room is free.
 */
export async function findRoomClashes({ churchId, roomId, startsAt, endsAt, excludeEventId = null }) {
  if (!churchId || !roomId || !startsAt) return []
  const { data, error } = await supabase
    .from('events')
    .select('id, title, starts_at, ends_at')
    .eq('church_id', churchId)
    .eq('room_id', roomId)
    .neq('status', 'cancelled')
  if (error || !data) return []
  return data
    .filter((e) => e.id !== excludeEventId && overlaps(e.starts_at, e.ends_at, startsAt, endsAt))
    .map((e) => ({ eventId: e.id, title: e.title, starts_at: e.starts_at, ends_at: e.ends_at }))
}

function single(msg) { return { blocked: msg, denied: msg, failed: msg } }

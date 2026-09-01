// Corrections for the append-only finance ledger (migration 0039).
//
// A collection or expense is never edited or deleted. A mistake is fixed by
// calling one of these RPCs, which — server-side, under definer rights — writes a
// REVERSAL of the original (copying its figures so it fully cancels) and, when the
// caller is replacing rather than voiding, a fresh REPLACEMENT entry. The client
// never computes the reversal, so it can never post one that fails to cancel.
//
//   void    → replace: false           (bogus/duplicate; nets to zero)
//   correct → replace: true + payload  (reversal + the corrected entry)

import { supabase } from '../supabase'
import { writeRpc } from './write'

export const COLLECTION_REASONS = Object.freeze([
  { value: 'duplicate', label: 'Duplicate entry' },
  { value: 'wrong_amount', label: 'Wrong amount' },
  { value: 'wrong_contributor', label: 'Wrong contributor' },
  { value: 'wrong_date', label: 'Wrong date' },
  { value: 'other', label: 'Other (add a note)' },
])

export const EXPENSE_REASONS = Object.freeze([
  { value: 'duplicate', label: 'Duplicate entry' },
  { value: 'wrong_amount', label: 'Wrong amount' },
  { value: 'wrong_description', label: 'Wrong description' },
  { value: 'wrong_date', label: 'Wrong date' },
  { value: 'other', label: 'Other (add a note)' },
])

/**
 * @param {{
 *   targetId: string, reason: string, note?: string|null, replace?: boolean,
 *   replacement?: { amount:number, from?:string|null, isTithes:boolean, collectedOn:string, eventId?:string|null }|null
 * }} params
 */
export function correctCollection ({ targetId, reason, note = null, replace = false, replacement = null }) {
  return writeRpc(
    supabase.rpc('correct_collection', {
      p_target: targetId,
      p_reason: reason,
      p_note: note,
      p_replace: replace,
      p_new_amount: replacement?.amount ?? null,
      p_new_from: replacement?.from ?? null,
      p_new_is_tithes: replacement?.isTithes ?? null,
      p_new_collected_on: replacement?.collectedOn ?? null,
      p_new_event_id: replacement?.eventId ?? null,
    }),
    { messages: { denied: 'You cannot correct this entry. It may belong to another church.' } }
  )
}

/**
 * @param {{
 *   targetId: number, reason: string, note?: string|null, replace?: boolean,
 *   replacement?: { amount:number, description:string, spentOn:string, notes?:string|null }|null
 * }} params
 */
export function correctExpense ({ targetId, reason, note = null, replace = false, replacement = null }) {
  return writeRpc(
    supabase.rpc('correct_expense', {
      p_target: targetId,
      p_reason: reason,
      p_note: note,
      p_replace: replace,
      p_new_amount: replacement?.amount ?? null,
      p_new_description: replacement?.description ?? null,
      p_new_spent_on: replacement?.spentOn ?? null,
      p_new_notes: replacement?.notes ?? null,
    }),
    { messages: { denied: 'You cannot correct this expense. It may belong to another church.' } }
  )
}

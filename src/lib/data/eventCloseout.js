// Post-event closeout — turning a passed event into a closed record wired to
// attendance, expense, and collection (frames 7o, 6b). Migration 0035, spec #87.
//
// THE WRITE BOUNDARY IS THE POINT (rule 2). Events Team may create THIS EVENT's own
// attendance (through an ad-hoc service linked by services.event_id) and THIS EVENT's
// own expense (expenses.event_id) — never the general domains. They may NOT write a
// collection (Finance only, story 31) and never see who gave: the only figure they get
// is the aggregate, via the event_collection_total RPC (story 33). Every write here
// rides the event-scoped RLS OR-paths added in 0035; a refused write returns { ok:false }.
//
// TWO STATES (Q15). The date passing makes an event "Happened" (derived, prompts
// closeout). Marking it "Closed" is an explicit act (closed_at) once the numbers are in
// and the review (Q16) is written. A happened-but-not-closed event is excluded from the
// "closed" statistics — a derived read, not a stored flag (story 34).

import { supabase } from '../supabase'
import { write } from './write'

const MESSAGES = {
  loadFailed: 'Could not load the closeout. Please try again.',
  serviceFailed: 'Attendance could not be started for this event.',
  expenseFailed: 'That expense could not be saved.',
  reviewFailed: 'The review could not be saved.',
  closeFailed: 'This event could not be closed.',
}

// Attendance opens 2h before the event and closes 1h after (Q9). Kept as constants so
// the composer's "track attendance" copy and the provisioning agree on one window.
const OPEN_BEFORE_MS = 2 * 60 * 60 * 1000
const CLOSE_AFTER_MS = 1 * 60 * 60 * 1000
const MAX_WINDOW_MS = 24 * 60 * 60 * 1000 // services_window_check cap (0013).

/**
 * The ad-hoc service window for an event: opens start−2h, closes end+1h (Q9). Pure and
 * exported for testing. A single-day head count — if the span would exceed 24h (a
 * multi-day event handed in whole) the close is clamped so the DB window check holds;
 * multi-day events record attendance per date, one service each.
 */
export function serviceWindow(event) {
  const start = new Date(event.starts_at)
  const end = event.ends_at ? new Date(event.ends_at) : start
  const opens = new Date(start.getTime() - OPEN_BEFORE_MS)
  let closes = new Date(end.getTime() + CLOSE_AFTER_MS)
  if (closes.getTime() - opens.getTime() > MAX_WINDOW_MS) {
    closes = new Date(opens.getTime() + MAX_WINDOW_MS)
  }
  return { opens_at: opens.toISOString(), closes_at: closes.toISOString() }
}

/**
 * Find or create the event's attendance service (Q17). Called when a "track attendance"
 * event is published so live check-in is ready, and again at closeout as a safety net.
 * Idempotent: returns the existing service if one already links this event. Returns
 * write()-shaped { ok, rows: [service], message }.
 */
export async function ensureEventService({ event }) {
  if (!event?.id || !event?.starts_at) return { ok: false, rows: [], message: MESSAGES.serviceFailed }
  const { data: existing, error } = await supabase
    .from('services')
    .select('id, label, opens_at, closes_at, event_id, service_date')
    .eq('event_id', event.id)
    .order('opens_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!error && existing) return { ok: true, rows: [existing], message: '' }

  const win = serviceWindow(event)
  return write(
    supabase.from('services').insert({
      church_id: event.church_id,
      event_id: event.id,
      schedule_id: null,
      label: event.title,
      opens_at: win.opens_at,
      closes_at: win.closes_at,
    }),
    { columns: 'id, label, opens_at, closes_at, event_id, service_date', messages: single(MESSAGES.serviceFailed) }
  )
}

/** Head count for an event's service — the number the closeout shows (story 29). A count
 *  request moves no rows (rule 1), the same discipline attendance.js keeps. */
export async function attendanceCount({ serviceId }) {
  if (!serviceId) return 0
  const { count, error } = await supabase
    .from('attendance')
    .select('id', { count: 'exact', head: true })
    .eq('service_id', serviceId)
  return error ? 0 : (count ?? 0)
}

/** The event's own expenses (story 30). Events Team reads these through the event-scoped
 *  OR-path (0035); they cannot read any other expense. */
export async function listEventExpenses({ eventId }) {
  if (!eventId) return { ok: false, expenses: [], message: MESSAGES.loadFailed }
  const { data, error } = await supabase
    .from('expenses')
    .select('id, description, amount, spent_on, event_id, from_church')
    .eq('event_id', eventId)
    .order('spent_on', { ascending: false })
  if (error) return { ok: false, expenses: [], message: MESSAGES.loadFailed }
  return { ok: true, expenses: data ?? [], message: '' }
}

/** Attach an expense to the event (story 30). from_church is the event's church; the
 *  event-scoped RLS refuses any expense that is not this event's. */
export function addEventExpense({ event, description, amount, spentOn }) {
  return write(
    supabase.from('expenses').insert({
      event_id: event.id, from_church: event.church_id,
      description, amount, spent_on: spentOn,
    }),
    { columns: 'id, description, amount, spent_on, event_id', messages: single(MESSAGES.expenseFailed) }
  )
}

/** The event's collection TOTAL — aggregate only, never who gave (story 33). Via the
 *  definer RPC so Events Team gets the figure without the identity-bearing rows (0031). */
export async function collectionTotal({ eventId }) {
  if (!eventId) return 0
  const { data, error } = await supabase.rpc('event_collection_total', { p_event_id: eventId })
  return error ? 0 : Number(data ?? 0)
}

/** Save the debrief (Q16, story: went well / didn't / follow-ups). Prompted, not required. */
export function saveReview(id, { wentWell = null, wentWrong = null, followups = null }) {
  return write(
    supabase.from('events').update({
      review_went_well: wentWell, review_went_wrong: wentWrong, review_followups: followups,
      updated_at: new Date().toISOString(),
    }).eq('id', id),
    { columns: 'id, review_went_well, review_went_wrong, review_followups', messages: single(MESSAGES.reviewFailed) }
  )
}

/** Mark the event Closed (Q15) — the manual act that ends closeout. Reopening clears it. */
export function markClosed(id, closed = true) {
  return write(
    supabase.from('events').update({
      closed_at: closed ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }).eq('id', id),
    { columns: 'id, closed_at', messages: single(MESSAGES.closeFailed) }
  )
}

/**
 * Derive the closeout state a view renders (frame 7o). Pure and exported for testing.
 * `happened` = the start is in the past; `closed` = the team marked it done. A happened
 * event that is not yet closed is "awaiting closeout" and is the one statistics EXCLUDE
 * (story 34) — this function is that derived read, no stored flag. The collection is
 * shown but never gates `closed`: Events Team cannot close it (Finance owns it, story 31).
 */
export function deriveCloseout({ event, attendanceCount = 0, expenses = [], collectionTotal = 0, now = new Date() }) {
  const started = event?.starts_at ? new Date(event.starts_at) : null
  const happened = !!started && started.getTime() < now.getTime() && event.status !== 'draft'
  const closed = !!event?.closed_at
  const expenseTotal = expenses.reduce((s, e) => s + Number(e.amount ?? 0), 0)
  return {
    happened,
    closed,
    // "Awaiting closeout": a passed, published event not yet closed — excluded from the
    // closed count until the team settles it.
    awaitingCloseout: happened && !closed && event.status === 'published',
    records: {
      attendance: {
        tracked: !!event?.attendance_tracked,
        count: attendanceCount,
        open: !!event?.attendance_tracked && attendanceCount === 0,
      },
      expense: { items: expenses, total: expenseTotal, open: expenses.length === 0 },
      // Finance-owned: informational to Events Team, never actionable, never blocks close.
      collection: { total: collectionTotal, pending: !collectionTotal, financeOnly: true },
    },
    canClose: happened && !closed,
  }
}

function single(msg) { return { blocked: msg, denied: msg, failed: msg } }

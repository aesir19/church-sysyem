/**
 * Device-local memory of who has already been checked in from this phone.
 *
 * WHY THIS IS NOT A SERVER LOOKUP. An attendee who taps "Check in" and sees a
 * generic confirmation may not trust it and will tap again. The obvious fix is
 * for the server to reply "you're already listed" — and that is exactly the
 * oracle `submit_checkin` is built to avoid, because it answers "is X here
 * today?" for anyone who types a name into a page whose URL is printed on a
 * wall. See docs/decisions/0007-public-checkin-endpoint.md.
 *
 * So the knowledge stays on the device that produced it. Nothing here is derived
 * from the database, and clearing this storage returns a caller to exactly where
 * they started: able to submit a name, able to learn nothing. It also adds no
 * request — the page already calls `checkin_session_status` to render itself,
 * and this reads no further.
 *
 * NOTHING HERE IS A SECURITY CONTROL. It is a convenience, and it is trivially
 * cleared by its owner. Duplicate submissions are made harmless by the partial
 * unique indexes in 0013, not by this file. Every entry point therefore fails
 * soft: if storage is unavailable — Safari private mode, a full quota, cookies
 * disabled — the page must behave exactly as it did before this existed.
 */

import { normalizeName } from './attendanceWindow'
import { sanitizeCheckinName } from './checkinPayload'

const STORAGE_KEY = 'udfc.checkin.recorded'
const SCHEMA_VERSION = 1

/**
 * A volunteer's phone is an expected case — `CheckinView` has a "Check in
 * someone else" button — so this holds a list, not one name. The cap bounds a
 * shared device; past it, check-ins still record server-side and simply stop
 * being remembered locally.
 */
const MAX_NAMES_PER_SERVICE = 50

/** Two services can legitimately be live in one day. Anything older is pruned. */
const MAX_SERVICES = 4

/**
 * Identify the open service without using the token.
 *
 * `checkin_session_status` deliberately returns no service id, so the window is
 * keyed by what it does return. The token is deliberately NOT part of this key:
 * it is already in the URL on this device, and writing it into localStorage
 * would persist it past the visit for no benefit. A collision needs two churches
 * whose windows close at the same millisecond with the same label on the same
 * date, and its consequence is a stale name on a shared phone.
 *
 * @returns {string} '' when the session is not usable as a key
 */
export function checkinServiceKey(session) {
  const closesAt = session?.closes_at
  const serviceDate = session?.service_date
  if (!closesAt || !serviceDate) return ''
  return [serviceDate, normalizeName(session?.service_label), String(closesAt)].join('|')
}

function readStore(storage) {
  try {
    const raw = storage?.getItem(STORAGE_KEY)
    if (!raw) return { v: SCHEMA_VERSION, entries: [] }

    const parsed = JSON.parse(raw)
    // A version bump discards rather than migrates. This is throwaway
    // convenience state; there is nothing here worth a migration path.
    if (!parsed || parsed.v !== SCHEMA_VERSION || !Array.isArray(parsed.entries)) {
      return { v: SCHEMA_VERSION, entries: [] }
    }
    return parsed
  } catch {
    // Unreadable, unparseable, or storage disabled. Behave as if empty.
    return { v: SCHEMA_VERSION, entries: [] }
  }
}

function writeStore(storage, store) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // Quota or a disabled store. The check-in itself already succeeded
    // server-side, so losing the local note is not worth surfacing.
  }
}

/**
 * Drop entries whose window has closed.
 *
 * Expiry is what stops last Sunday's names greeting someone this Sunday, and it
 * is why `closesAt` is stored alongside. An entry with an unparseable date is
 * dropped rather than kept — stale state here is worse than absent state.
 */
function pruneEntries(entries, now) {
  const cutoff = now instanceof Date ? now.getTime() : Date.now()
  return entries
    .filter((entry) => {
      if (!entry?.key || !Array.isArray(entry.names)) return false
      const closesAt = Date.parse(entry.closesAt)
      return Number.isFinite(closesAt) && closesAt > cutoff
    })
    .slice(-MAX_SERVICES)
}

/**
 * Names already checked in from this device for this service, most recent last.
 *
 * @returns {string[]} empty when nothing is remembered, storage is unavailable,
 *   or the window has since closed
 */
export function readCheckedInNames(storage, session, now = new Date()) {
  const key = checkinServiceKey(session)
  if (!key) return []

  const entry = pruneEntries(readStore(storage).entries, now).find((row) => row.key === key)
  return entry ? [...entry.names] : []
}

/**
 * Record that `name` was checked in from this device for this service.
 *
 * Deduplicates on the same normalisation the database uses, so "juan  dela cruz"
 * does not appear twice alongside "Juan Dela Cruz". Pruning happens on write as
 * well as read, which is what keeps the key from growing on a device that is
 * used every week.
 *
 * @returns {string[]} the names now remembered for this service
 */
export function rememberCheckinName(storage, session, name, now = new Date()) {
  const key = checkinServiceKey(session)
  const display = sanitizeCheckinName(name)
  if (!key || !display) return []

  const store = readStore(storage)
  const entries = pruneEntries(store.entries, now)

  const existing = entries.find((row) => row.key === key)
  const entry = existing ?? { key, closesAt: String(session.closes_at), names: [] }

  const normalized = normalizeName(display)
  if (!entry.names.some((held) => normalizeName(held) === normalized)) {
    entry.names = [...entry.names, display].slice(-MAX_NAMES_PER_SERVICE)
  }

  const next = existing ? entries : [...entries, entry].slice(-MAX_SERVICES)
  writeStore(storage, { v: SCHEMA_VERSION, entries: next })

  return [...entry.names]
}

/** Forget everything. Exposed for tests and for a deliberate reset. */
export function clearCheckinMemory(storage) {
  try {
    storage?.removeItem(STORAGE_KEY)
  } catch {
    // Nothing to do, and nothing worth reporting.
  }
}

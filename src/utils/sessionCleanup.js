/**
 * Which localStorage keys a sign-out clears, and which it must not.
 *
 * WHAT THIS FIXES (D12). There were two sign-out paths and they cleared
 * different things: `DashboardLayout` removed `udfc.myChurchName` and
 * `udfc.myUserName`, while `DashboardView`'s own button removed only the
 * church name. Signing out from the wrong one left the previous user's first
 * name cached, so the next person to sign in on that browser was greeted by
 * somebody else's name until the fetch resolved.
 *
 * The fix is not "make the two agree". It is that there is one list and it
 * lives here — a pure function over injected storage, matching this codebase's
 * convention of testable logic in `utils/` behind a thin composable
 * (checkinMemory.js / CheckinView.vue is the model). `useSession.js` is that
 * wrapper, and it is what both call sites use.
 *
 * THE SECOND LIST IS THE LOAD-BEARING ONE. Two keys survive a sign-out on
 * purpose, and both would look like oversights to someone tidying up:
 *
 *   udfc.checkin.recorded — device-scoped, owned by checkinMemory.js. A
 *     volunteer's phone must not forget who it already checked in because a
 *     staff member signed out of the dashboard. See ADR-0007.
 *   udfc.theme — a display preference, not session state. It should outlive
 *     a session.
 *
 * Neither holds member PII, which is what makes leaving them safe. Anything
 * that does hold PII belongs in SESSION_KEYS.
 */

import { THEME_STORAGE_KEY } from './theme'

/** Cleared on sign-out. Cached identity, scoped to whoever was signed in. */
export const SESSION_KEYS = Object.freeze(['udfc.myChurchName', 'udfc.myUserName'])

/**
 * Deliberately NOT cleared. Declared rather than merely omitted so that the
 * intent is greppable from the key, and so a test can assert no key is in both
 * lists — the way this decision would otherwise be lost.
 */
export const SESSION_SURVIVING_KEYS = Object.freeze(['udfc.checkin.recorded', THEME_STORAGE_KEY])

/**
 * Forget the signed-in user's cached identity.
 *
 * Fails soft, per key: storage may be unavailable (Safari private mode,
 * cookies disabled) and a sign-out must complete regardless — the session
 * itself is ended by `supabase.auth.signOut()`, not by this.
 *
 * @param {Pick<Storage, 'removeItem'>} [storage]
 */
export function clearSessionStorageKeys(storage) {
  for (const key of SESSION_KEYS) {
    try {
      storage?.removeItem(key)
    } catch {
      // Unavailable store. Nothing to do, and nothing worth surfacing.
    }
  }
}

/**
 * The one sign-out.
 *
 * Thin wrapper over src/utils/sessionCleanup.js, which holds the decidable part
 * — which localStorage keys go and which stay — and is unit-tested without a
 * DOM. What is left here is the browser I/O and the navigation, in the order
 * they have to happen.
 *
 * WHY IT IS ONE FUNCTION AND NOT TWO AGREEING ONES (D12). `DashboardLayout` and
 * `DashboardView` each had their own sign-out clearing a different set of keys.
 * Two paths that agree today diverge the next time one of them is edited; one
 * path cannot.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It does not clear the active-church or
 * role state. `supabase.auth.signOut()` emits SIGNED_OUT, which
 * useActiveChurch.js and useCurrentRole.js already listen for — duplicating
 * that here would give those modules a second, untested reset path.
 */

import { useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'
import { clearSessionStorageKeys } from '../utils/sessionCleanup'

export function useSession() {
  const router = useRouter()

  /**
   * End the session and return to the sign-in page.
   *
   * Storage is cleared FIRST. `signOut()` is a network call that can fail or
   * hang; clearing after it would leave the previous user's cached name on the
   * device in exactly the case where the sign-out did not complete, which is
   * the case where it matters most.
   */
  async function signOut() {
    clearSessionStorageKeys(typeof window === 'undefined' ? undefined : window.localStorage)
    await supabase.auth.signOut()
    router.push('/login')
  }

  return { signOut }
}

/**
 * The light/dark toggle, and the one place that writes `<html data-theme>`.
 *
 * Thin wrapper over src/utils/theme.js, matching this codebase's convention of
 * pure logic in `utils/` with the browser I/O kept in a composable
 * (checkinMemory.js / CheckinView.vue is the model). Everything decidable
 * without a DOM lives there and is unit-tested; what remains here is the
 * attribute write and the media-query subscription.
 *
 * Module-scoped state, deliberately: the theme is one property of the document,
 * not of a component. Two toggles mounted at once — the sidebar footer and the
 * style-guide route — must read the same value, not two copies of it.
 */

import { readonly, ref } from 'vue'
import { LIGHT, nextTheme, readStoredTheme, resolveTheme, storeTheme } from '../utils/theme'

const DARK_QUERY = '(prefers-color-scheme: dark)'

const current = ref(LIGHT)
let started = false

/** Storage and matchMedia are absent during SSR and under `environment: 'node'`. */
function storage() {
  return typeof window === 'undefined' ? undefined : window.localStorage
}

function systemPrefersDark() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
  return window.matchMedia(DARK_QUERY).matches
}

function apply(theme) {
  current.value = theme
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme)
  }
}

/**
 * Resolve and apply the theme, then follow the system setting for as long as
 * the user has not overridden it.
 *
 * Called once from main.js before mount. Idempotent, so a hot reload or a
 * second import cannot register a second media listener.
 */
export function startTheme() {
  if (started) return current.value
  started = true

  apply(resolveTheme(storage(), systemPrefersDark()))

  // Following the system live is the point of storing null rather than a
  // snapshot: a user who has never chosen gets their OS switching at sunset for
  // free. Once they choose, their choice stops being overridden.
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    window.matchMedia(DARK_QUERY).addEventListener('change', (event) => {
      if (readStoredTheme(storage()) === null) apply(event.matches ? 'dark' : LIGHT)
    })
  }

  return current.value
}

export function useTheme() {
  /** Record an explicit choice. From here on the system setting is ignored. */
  function setTheme(theme) {
    const stored = storeTheme(storage(), theme)
    if (stored) apply(stored)
  }

  function toggleTheme() {
    setTheme(nextTheme(current.value))
  }

  return {
    theme: readonly(current),
    setTheme,
    toggleTheme,
  }
}

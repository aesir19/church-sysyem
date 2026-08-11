/**
 * Which of the two token palettes is in effect.
 *
 * Dark mode is not a second stylesheet. `src/styles/tokens.css` declares one set
 * of semantic names and two sets of values for them, and the only thing that
 * chooses between the two is a `data-theme` attribute on `<html>`. Everything
 * here exists to decide what that attribute should say — nothing here knows a
 * colour. See docs/REDESIGN.md Amendment 7.
 *
 * Storage is injected, not reached for, following the convention in
 * checkinMemory.js: it keeps the module testable under `environment: 'node'`
 * and makes every failure path explicit. A theme preference is the least
 * important state in the app, so every entry point fails soft — a browser with
 * storage disabled gets the system preference and a toggle that works for the
 * life of the page.
 */

/**
 * Also named as a string by sessionCleanup.js's do-not-clear list (Amendment 7):
 * a theme preference should outlive a sign-out, exactly as
 * `udfc.checkin.recorded` does.
 */
export const THEME_STORAGE_KEY = 'udfc.theme'

export const LIGHT = 'light'
export const DARK = 'dark'

/**
 * A value that is not one of the two themes is not a third theme. Letting one
 * through would put an unknown string on `<html data-theme>`, which matches no
 * block in tokens.css — the page renders light while claiming to be something
 * else, and the toggle appears stuck.
 */
function isTheme(value) {
  return value === LIGHT || value === DARK
}

/**
 * The user's explicit choice, or null if they have never made one.
 *
 * The distinction matters: null means "follow the system", which is a live
 * relationship, not a snapshot of what the system said on the first visit.
 *
 * @returns {'light'|'dark'|null}
 */
export function readStoredTheme(storage) {
  try {
    const stored = storage?.getItem(THEME_STORAGE_KEY)
    return isTheme(stored) ? stored : null
  } catch {
    // Storage disabled or unreadable. Behave as if no choice was ever made.
    return null
  }
}

/**
 * The theme to apply right now.
 *
 * `prefersDark` is the caller's reading of `prefers-color-scheme: dark`. It is
 * passed in rather than queried because `matchMedia` does not exist during SSR
 * or in the node test environment; when it is unknown, light wins, since that is
 * the palette every view is authored against.
 *
 * @param {'light'|'dark'} [prefersDark] omitted or null when unknown
 * @returns {'light'|'dark'}
 */
export function resolveTheme(storage, prefersDark) {
  return readStoredTheme(storage) ?? (prefersDark === true ? DARK : LIGHT)
}

/**
 * Persist an explicit choice.
 *
 * @returns {'light'|'dark'|null} the theme now stored, or null if it was not a
 *   theme and nothing was written
 */
export function storeTheme(storage, theme) {
  if (!isTheme(theme)) return null
  try {
    storage?.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // Quota, or a disabled store. The theme still applies for this page.
  }
  return theme
}

/**
 * The theme a toggle should move to.
 *
 * An unknown current theme resolves to dark, because the user is looking at the
 * light palette by default and dark is the useful offer.
 *
 * @returns {'light'|'dark'}
 */
export function nextTheme(current) {
  return current === DARK ? LIGHT : DARK
}

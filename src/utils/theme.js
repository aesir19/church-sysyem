// Theme resolution. Pure functions plus the two DOM pokes, kept out of the
// composable so they can be unit-tested without mounting anything.
//
// THREE STATES, NOT TWO. The mockups' profile page offers Light / Dark /
// System, and `system` is the default. tokens.css handles `system` by defining
// dark under `prefers-color-scheme` guarded by `:not([data-theme="light"])`,
// which means the correct DOM representation of `system` is NO attribute at
// all — not `data-theme="system"`. Writing the literal string would land on a
// selector that matches nothing and silently pin every user to light.

// NAMED THIS, NOT `THEME_KEY`. sessionCleanup.js imports this exact identifier
// to build SESSION_SURVIVING_KEYS — the list of localStorage keys that outlive a
// sign-out. Renaming it does not break a build: the import silently resolves to
// `undefined`, the surviving list quietly stops naming the theme, and signing
// out starts wiping a display preference nobody asked it to touch. That is
// exactly what happened once already.
export const THEME_STORAGE_KEY = 'udfc.theme'

export const THEMES = ['light', 'dark', 'system']

export function isTheme (value) {
  return THEMES.includes(value)
}

export function readStoredTheme (storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(THEME_STORAGE_KEY)
    return isTheme(raw) ? raw : 'system'
  } catch {
    // Private mode, or storage disabled. System is the honest fallback.
    return 'system'
  }
}

export function writeStoredTheme (theme, storage = globalThis.localStorage) {
  if (!isTheme(theme)) return false
  try {
    storage?.setItem(THEME_STORAGE_KEY, theme)
    return true
  } catch {
    return false
  }
}

// What the user actually sees, given their choice and the OS.
export function resolveTheme (theme, prefersDark) {
  if (theme === 'dark') return 'dark'
  if (theme === 'light') return 'light'
  return prefersDark ? 'dark' : 'light'
}

export function applyTheme (theme, root = globalThis.document?.documentElement) {
  if (!root) return
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
}

// Called from main.js BEFORE the app mounts. Without this the first paint is
// light and then flips, which is the flash every themed app gets wrong once.
export function startTheme () {
  applyTheme(readStoredTheme())
}

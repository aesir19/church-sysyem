import { describe, expect, it } from 'vitest'
import {
  THEME_STORAGE_KEY,
  nextTheme,
  readStoredTheme,
  resolveTheme,
  storeTheme,
} from '../../src/utils/theme.js'

/** Minimal stand-in for localStorage, matching tests/utils/checkinMemory.test.js. */
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  }
}

/** Storage that throws on every call — Safari private mode, disabled cookies. */
function hostileStorage() {
  return {
    getItem: () => {
      throw new Error('denied')
    },
    setItem: () => {
      throw new Error('quota')
    },
    removeItem: () => {
      throw new Error('denied')
    },
  }
}

describe('THEME_STORAGE_KEY', () => {
  // Load-bearing, not cosmetic: this exact key is on
  // sessionCleanup.js's do-not-clear list alongside udfc.checkin.recorded, so a
  // theme preference outlives a sign-out. That list will name the key as a
  // string; if this constant drifts, the two stop referring to the same thing
  // and sign-out silently starts resetting the theme.
  it('is the key the do-not-clear list names', () => {
    expect(THEME_STORAGE_KEY).toBe('udfc.theme')
  })
})

describe('resolveTheme', () => {
  it('prefers an explicit stored choice over the system setting', () => {
    const dark = fakeStorage({ [THEME_STORAGE_KEY]: 'dark' })
    expect(resolveTheme(dark, false)).toBe('dark')

    const light = fakeStorage({ [THEME_STORAGE_KEY]: 'light' })
    expect(resolveTheme(light, true)).toBe('light')
  })

  it('follows the system setting when nothing has been chosen', () => {
    expect(resolveTheme(fakeStorage(), true)).toBe('dark')
    expect(resolveTheme(fakeStorage(), false)).toBe('light')
  })

  // A value that is not one of the two themes is not a third theme. Passing it
  // through would put an unknown string on <html data-theme>, which matches no
  // block in tokens.css and renders the light palette while claiming otherwise.
  it('treats an unrecognised stored value as no choice at all', () => {
    const junk = fakeStorage({ [THEME_STORAGE_KEY]: 'midnight' })
    expect(resolveTheme(junk, true)).toBe('dark')
    expect(resolveTheme(junk, false)).toBe('light')
  })

  it('is case-sensitive rather than guessing at intent', () => {
    const shouty = fakeStorage({ [THEME_STORAGE_KEY]: 'DARK' })
    expect(resolveTheme(shouty, false)).toBe('light')
  })

  it('falls back to the system setting when storage is unavailable', () => {
    expect(resolveTheme(hostileStorage(), true)).toBe('dark')
    expect(resolveTheme(undefined, true)).toBe('dark')
    expect(resolveTheme(undefined, false)).toBe('light')
  })

  // matchMedia is absent in SSR and in the node test environment. Treating
  // "unknown" as light is the safe default: it is the palette every view is
  // authored against.
  it('defaults to light when the system preference is unknown', () => {
    expect(resolveTheme(fakeStorage(), undefined)).toBe('light')
    expect(resolveTheme(fakeStorage(), null)).toBe('light')
  })
})

describe('readStoredTheme', () => {
  it('reports null when no choice has been made', () => {
    expect(readStoredTheme(fakeStorage())).toBeNull()
  })

  it('reports the stored choice', () => {
    expect(readStoredTheme(fakeStorage({ [THEME_STORAGE_KEY]: 'dark' }))).toBe('dark')
  })

  it('reports null for an unrecognised value', () => {
    expect(readStoredTheme(fakeStorage({ [THEME_STORAGE_KEY]: 'midnight' }))).toBeNull()
  })

  it('reports null rather than throwing when storage is unavailable', () => {
    expect(readStoredTheme(hostileStorage())).toBeNull()
    expect(readStoredTheme(undefined)).toBeNull()
  })
})

describe('storeTheme', () => {
  it('persists a choice that resolveTheme then reads back', () => {
    const storage = fakeStorage()
    storeTheme(storage, 'dark')
    expect(resolveTheme(storage, false)).toBe('dark')
  })

  it('refuses to write a value that is not a theme', () => {
    const storage = fakeStorage()
    storeTheme(storage, 'midnight')
    expect(storage.getItem(THEME_STORAGE_KEY)).toBeNull()
  })

  it('returns the theme now in effect', () => {
    expect(storeTheme(fakeStorage(), 'dark')).toBe('dark')
    expect(storeTheme(fakeStorage(), 'midnight')).toBeNull()
  })

  // A theme preference is the least important thing in the app. Losing it must
  // never take a page down with it.
  it('fails soft when the write is refused', () => {
    expect(() => storeTheme(hostileStorage(), 'dark')).not.toThrow()
    expect(() => storeTheme(undefined, 'dark')).not.toThrow()
  })
})

describe('nextTheme', () => {
  it('toggles between the two themes', () => {
    expect(nextTheme('light')).toBe('dark')
    expect(nextTheme('dark')).toBe('light')
  })

  it('round-trips', () => {
    expect(nextTheme(nextTheme('light'))).toBe('light')
  })

  // The toggle is rendered against whatever is currently applied. If that is
  // ever unknown, offering "dark" is the useful move — the user is looking at
  // the light palette by default.
  it('treats an unknown current theme as light', () => {
    expect(nextTheme(undefined)).toBe('dark')
    expect(nextTheme('midnight')).toBe('dark')
  })
})

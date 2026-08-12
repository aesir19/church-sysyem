// Theme resolution.
//
// REWRITTEN FOR A THREE-STATE MODEL. The previous suite tested two themes and a
// `nextTheme` toggle. The mockups' profile page offers Light / Dark / System and
// makes System the default, so `system` is now a stored value in its own right
// rather than the absence of one. Every behaviour the old suite defended is
// still asserted below — the storage key, explicit-beats-system, an
// unrecognised value not becoming a third theme, and hostile storage not
// throwing — plus the one the new model adds, which is that `system` must reach
// the DOM as NO attribute rather than as the literal string.

import { describe, expect, it } from 'vitest'
import {
  THEME_STORAGE_KEY,
  THEMES,
  isTheme,
  readStoredTheme,
  writeStoredTheme,
  resolveTheme,
  applyTheme,
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

/** Enough of an Element to see what applyTheme did. */
function fakeRoot() {
  const attrs = new Map()
  return {
    setAttribute: (k, v) => attrs.set(k, v),
    removeAttribute: (k) => attrs.delete(k),
    getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
    has: (k) => attrs.has(k),
  }
}

describe('THEME_STORAGE_KEY', () => {
  // Load-bearing, not cosmetic: this exact identifier is imported by
  // sessionCleanup.js to build SESSION_SURVIVING_KEYS, so a theme preference
  // outlives a sign-out. Renaming the export does not fail a build — the import
  // resolves to undefined and sign-out quietly starts wiping the theme.
  it('is the key the do-not-clear list names', () => {
    expect(THEME_STORAGE_KEY).toBe('udfc.theme')
  })
})

describe('isTheme', () => {
  it('accepts exactly the three states', () => {
    expect(THEMES).toEqual(['light', 'dark', 'system'])
    for (const t of THEMES) expect(isTheme(t)).toBe(true)
  })

  it('rejects anything else, including the empty string and null', () => {
    for (const bad of ['Dark', 'auto', '', null, undefined, 0]) {
      expect(isTheme(bad)).toBe(false)
    }
  })
})

describe('readStoredTheme', () => {
  it('reports the stored choice', () => {
    expect(readStoredTheme(fakeStorage({ [THEME_STORAGE_KEY]: 'dark' }))).toBe('dark')
    expect(readStoredTheme(fakeStorage({ [THEME_STORAGE_KEY]: 'light' }))).toBe('light')
  })

  // `system` is the default because it is the honest answer to "what do you
  // want" before anyone has said. It is NOT a third colour scheme.
  it('falls back to system when no choice has been made', () => {
    expect(readStoredTheme(fakeStorage())).toBe('system')
  })

  it('falls back to system for an unrecognised value rather than trusting it', () => {
    expect(readStoredTheme(fakeStorage({ [THEME_STORAGE_KEY]: 'midnight' }))).toBe('system')
  })

  it('falls back to system rather than throwing when storage is unavailable', () => {
    expect(() => readStoredTheme(hostileStorage())).not.toThrow()
    expect(readStoredTheme(hostileStorage())).toBe('system')
  })
})

describe('writeStoredTheme', () => {
  it('persists a choice that readStoredTheme then reads back', () => {
    const storage = fakeStorage()
    expect(writeStoredTheme('dark', storage)).toBe(true)
    expect(readStoredTheme(storage)).toBe('dark')
  })

  it('refuses to write a value that is not a theme', () => {
    const storage = fakeStorage()
    expect(writeStoredTheme('midnight', storage)).toBe(false)
    expect(readStoredTheme(storage)).toBe('system')
  })

  it('reports failure rather than throwing when storage is unavailable', () => {
    expect(() => writeStoredTheme('dark', hostileStorage())).not.toThrow()
    expect(writeStoredTheme('dark', hostileStorage())).toBe(false)
  })
})

describe('resolveTheme', () => {
  it('prefers an explicit choice over the system setting', () => {
    expect(resolveTheme('dark', false)).toBe('dark')
    expect(resolveTheme('light', true)).toBe('light')
  })

  it('follows the system setting when the choice is system', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })
})

describe('applyTheme', () => {
  it('stamps an explicit choice onto the root', () => {
    const root = fakeRoot()
    applyTheme('dark', root)
    expect(root.getAttribute('data-theme')).toBe('dark')
    applyTheme('light', root)
    expect(root.getAttribute('data-theme')).toBe('light')
  })

  // THE ONE THAT MATTERS. tokens.css expresses `system` as the ABSENCE of the
  // attribute — dark is declared under `prefers-color-scheme` guarded by
  // `:not([data-theme="light"])`. Writing the literal string "system" would land
  // on a selector that matches nothing and pin every such user to light.
  it('removes the attribute for system rather than writing the word', () => {
    const root = fakeRoot()
    applyTheme('dark', root)
    applyTheme('system', root)
    expect(root.has('data-theme')).toBe(false)
    expect(root.getAttribute('data-theme')).toBe(null)
  })

  it('does nothing, and does not throw, without a root', () => {
    expect(() => applyTheme('dark', null)).not.toThrow()
  })
})

import { describe, expect, it } from 'vitest'
import {
  SESSION_KEYS,
  SESSION_SURVIVING_KEYS,
  clearSessionStorageKeys,
} from '../../src/utils/sessionCleanup.js'
import { THEME_STORAGE_KEY } from '../../src/utils/theme.js'

/** Minimal stand-in for localStorage, matching tests/utils/checkinMemory.test.js. */
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    keys: () => [...map.keys()],
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

const POPULATED = {
  'udfc.myChurchName': 'Grace Chapel',
  'udfc.myUserName': 'Grace',
  'udfc.checkin.recorded': '{"v":1,"entries":[]}',
  'udfc.theme': 'dark',
}

describe('clearSessionStorageKeys', () => {
  it('clears the two keys that belong to the signed-in session', () => {
    const storage = fakeStorage(POPULATED)
    clearSessionStorageKeys(storage)

    expect(storage.getItem('udfc.myChurchName')).toBeNull()
    expect(storage.getItem('udfc.myUserName')).toBeNull()
  })

  // The whole point of D12. The two sign-out paths cleared different key sets,
  // and the fix is not "make them agree" but "there is one list, here".
  it('leaves the device-scoped keys alone', () => {
    const storage = fakeStorage(POPULATED)
    clearSessionStorageKeys(storage)

    // checkinMemory.js owns this one and it is deliberately device-scoped: a
    // volunteer's phone must not forget who it already checked in because a
    // staff member signed out of the dashboard in another tab.
    expect(storage.getItem('udfc.checkin.recorded')).toBe('{"v":1,"entries":[]}')
    // REDESIGN.md Amendment 7: a theme preference should outlive a session.
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe('dark')
  })

  it('touches nothing outside the two named keys', () => {
    const storage = fakeStorage({ ...POPULATED, 'sb-auth-token': 'x', unrelated: 'y' })
    clearSessionStorageKeys(storage)

    expect(storage.keys().sort()).toEqual(
      ['sb-auth-token', 'udfc.checkin.recorded', 'udfc.theme', 'unrelated'].sort(),
    )
  })

  it('reports the keys it clears, so a caller can assert on them', () => {
    expect([...SESSION_KEYS].sort()).toEqual(['udfc.myChurchName', 'udfc.myUserName'])
  })

  // A key can only be in one list. If a future edit adds one to both, the
  // do-not-clear intent loses silently — this is what catches that.
  it('never names a key in both lists', () => {
    for (const key of SESSION_SURVIVING_KEYS) {
      expect(SESSION_KEYS, `${key} is in both lists`).not.toContain(key)
    }
    expect(SESSION_SURVIVING_KEYS).toContain(THEME_STORAGE_KEY)
    expect(SESSION_SURVIVING_KEYS).toContain('udfc.checkin.recorded')
  })

  it('fails soft when storage throws', () => {
    expect(() => clearSessionStorageKeys(hostileStorage())).not.toThrow()
  })

  it('fails soft when there is no storage at all', () => {
    expect(() => clearSessionStorageKeys(undefined)).not.toThrow()
  })
})

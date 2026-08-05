import { describe, expect, it } from 'vitest'
import {
  checkinServiceKey,
  clearCheckinMemory,
  readCheckedInNames,
  rememberCheckinName,
} from '../../src/utils/checkinMemory.js'

/** Minimal stand-in for localStorage. */
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    get size() {
      return map.size
    },
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

const NOW = new Date('2026-08-09T02:00:00.000Z')

const SESSION = {
  church_name: 'UDFC',
  service_label: 'Sunday Service',
  service_date: '2026-08-09',
  closes_at: '2026-08-09T03:00:00.000Z',
}

describe('checkinServiceKey', () => {
  it('is stable for the same session', () => {
    expect(checkinServiceKey(SESSION)).toBe(checkinServiceKey({ ...SESSION }))
  })

  it('differs when the window differs', () => {
    const evening = { ...SESSION, closes_at: '2026-08-09T11:00:00.000Z' }
    expect(checkinServiceKey(evening)).not.toBe(checkinServiceKey(SESSION))
  })

  it('differs across service dates, so last week does not match this week', () => {
    const lastWeek = { ...SESSION, service_date: '2026-08-02' }
    expect(checkinServiceKey(lastWeek)).not.toBe(checkinServiceKey(SESSION))
  })

  // The token is in the URL on this device already; persisting it to storage
  // would extend its life past the visit for no benefit.
  it('never contains the check-in token', () => {
    const token = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6'
    expect(checkinServiceKey({ ...SESSION, token })).not.toContain(token)
  })

  it('returns empty for a session missing a window', () => {
    expect(checkinServiceKey({ ...SESSION, closes_at: null })).toBe('')
    expect(checkinServiceKey({ ...SESSION, service_date: null })).toBe('')
    expect(checkinServiceKey(null)).toBe('')
  })
})

describe('rememberCheckinName / readCheckedInNames', () => {
  it('remembers a name for the service it was recorded against', () => {
    const storage = fakeStorage()
    rememberCheckinName(storage, SESSION, 'Juan Dela Cruz', NOW)
    expect(readCheckedInNames(storage, SESSION, NOW)).toEqual(['Juan Dela Cruz'])
  })

  it('knows nothing before anything is recorded', () => {
    expect(readCheckedInNames(fakeStorage(), SESSION, NOW)).toEqual([])
  })

  // A volunteer's phone checking in a queue of people is an expected case —
  // CheckinView offers "Check in someone else" — so this is a list, not a slot.
  it('accumulates several names from one device', () => {
    const storage = fakeStorage()
    rememberCheckinName(storage, SESSION, 'Juan Dela Cruz', NOW)
    rememberCheckinName(storage, SESSION, 'Maria Santos', NOW)
    expect(readCheckedInNames(storage, SESSION, NOW)).toEqual(['Juan Dela Cruz', 'Maria Santos'])
  })

  it('deduplicates on the database normalisation, not on raw text', () => {
    const storage = fakeStorage()
    rememberCheckinName(storage, SESSION, 'Juan Dela Cruz', NOW)
    rememberCheckinName(storage, SESSION, '  juan   dela cruz ', NOW)
    expect(readCheckedInNames(storage, SESSION, NOW)).toEqual(['Juan Dela Cruz'])
  })

  it('stores the sanitised form, so display matches what the server received', () => {
    const storage = fakeStorage()
    rememberCheckinName(storage, SESSION, '  Juan\tDela   Cruz  ', NOW)
    expect(readCheckedInNames(storage, SESSION, NOW)).toEqual(['Juan Dela Cruz'])
  })

  it('ignores a blank name', () => {
    const storage = fakeStorage()
    expect(rememberCheckinName(storage, SESSION, '   ', NOW)).toEqual([])
    expect(readCheckedInNames(storage, SESSION, NOW)).toEqual([])
  })

  it('keeps services separate', () => {
    const storage = fakeStorage()
    const evening = { ...SESSION, service_label: 'Evening Service', closes_at: '2026-08-09T11:00:00.000Z' }

    rememberCheckinName(storage, SESSION, 'Juan Dela Cruz', NOW)
    rememberCheckinName(storage, evening, 'Maria Santos', NOW)

    expect(readCheckedInNames(storage, SESSION, NOW)).toEqual(['Juan Dela Cruz'])
    expect(readCheckedInNames(storage, evening, NOW)).toEqual(['Maria Santos'])
  })
})

describe('expiry', () => {
  // Without this, last Sunday's name greets someone this Sunday.
  it('forgets a service once its window has closed', () => {
    const storage = fakeStorage()
    rememberCheckinName(storage, SESSION, 'Juan Dela Cruz', NOW)

    const afterClose = new Date('2026-08-09T03:00:01.000Z')
    expect(readCheckedInNames(storage, SESSION, afterClose)).toEqual([])
  })

  it('still remembers right up to the closing instant', () => {
    const storage = fakeStorage()
    rememberCheckinName(storage, SESSION, 'Juan Dela Cruz', NOW)

    const justBefore = new Date('2026-08-09T02:59:59.000Z')
    expect(readCheckedInNames(storage, SESSION, justBefore)).toEqual(['Juan Dela Cruz'])
  })

  it('drops closed services from storage on the next write', () => {
    const storage = fakeStorage()
    rememberCheckinName(storage, SESSION, 'Juan Dela Cruz', NOW)

    const nextWeek = { ...SESSION, service_date: '2026-08-16', closes_at: '2026-08-16T03:00:00.000Z' }
    const laterNow = new Date('2026-08-16T02:00:00.000Z')
    rememberCheckinName(storage, nextWeek, 'Maria Santos', laterNow)

    const stored = JSON.parse(storage.getItem('udfc.checkin.recorded'))
    expect(stored.entries).toHaveLength(1)
    expect(stored.entries[0].names).toEqual(['Maria Santos'])
  })
})

describe('failing soft', () => {
  // The page must behave exactly as it did before this file existed whenever
  // storage is unavailable. This is a convenience, never a gate.
  it('reads as empty when storage throws', () => {
    expect(readCheckedInNames(hostileStorage(), SESSION, NOW)).toEqual([])
  })

  it('does not throw when a write is refused', () => {
    expect(() => rememberCheckinName(hostileStorage(), SESSION, 'Juan Dela Cruz', NOW)).not.toThrow()
  })

  it('tolerates a missing storage object entirely', () => {
    expect(readCheckedInNames(undefined, SESSION, NOW)).toEqual([])
    expect(() => rememberCheckinName(undefined, SESSION, 'Juan Dela Cruz', NOW)).not.toThrow()
    expect(() => clearCheckinMemory(undefined)).not.toThrow()
  })

  it('recovers from corrupted contents rather than throwing', () => {
    const storage = fakeStorage({ 'udfc.checkin.recorded': 'not json{' })
    expect(readCheckedInNames(storage, SESSION, NOW)).toEqual([])
    rememberCheckinName(storage, SESSION, 'Juan Dela Cruz', NOW)
    expect(readCheckedInNames(storage, SESSION, NOW)).toEqual(['Juan Dela Cruz'])
  })

  it('discards a payload written by an older schema', () => {
    const stale = JSON.stringify({ v: 0, entries: [{ key: checkinServiceKey(SESSION), closesAt: SESSION.closes_at, names: ['Old Format'] }] })
    const storage = fakeStorage({ 'udfc.checkin.recorded': stale })
    expect(readCheckedInNames(storage, SESSION, NOW)).toEqual([])
  })

  it('drops entries with an unparseable window rather than keeping them', () => {
    const bad = JSON.stringify({ v: 1, entries: [{ key: checkinServiceKey(SESSION), closesAt: 'whenever', names: ['Ghost'] }] })
    const storage = fakeStorage({ 'udfc.checkin.recorded': bad })
    expect(readCheckedInNames(storage, SESSION, NOW)).toEqual([])
  })
})

describe('clearCheckinMemory', () => {
  it('forgets everything', () => {
    const storage = fakeStorage()
    rememberCheckinName(storage, SESSION, 'Juan Dela Cruz', NOW)
    clearCheckinMemory(storage)
    expect(readCheckedInNames(storage, SESSION, NOW)).toEqual([])
  })
})

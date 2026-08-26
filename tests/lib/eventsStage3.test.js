// Pure-logic tests for the Stage-3 (#87) helpers: ICS export, the holiday overlay,
// the attendance window, the closeout derivation, and interval overlap. The DB-boundary
// rules (eligibility, event-scoped writes, aggregate-only collections) are asserted
// separately through the db-test harness; these cover the browser-side logic.

import { describe, it, expect } from 'vitest'
import { buildIcs, eventToVevent, toIcsUtc, icsFilename } from '../../src/lib/ics'
import { expandHolidays, definedThrough } from '../../src/lib/holidays'
import { serviceWindow, deriveCloseout } from '../../src/lib/data/eventCloseout'
import { overlaps } from '../../src/lib/data/eventRoles'

describe('ics', () => {
  const event = {
    id: 'e1',
    title: 'Anniversary; a big, one',
    starts_at: '2026-06-12T01:30:00.000Z',
    ends_at: '2026-06-12T05:00:00.000Z',
    location: 'Main Hall',
    status: 'published',
  }

  it('formats a UTC instant in basic form', () => {
    expect(toIcsUtc('2026-06-12T01:30:00.000Z')).toBe('20260612T013000Z')
  })

  it('escapes text per RFC 5545', () => {
    const lines = eventToVevent(event, { stamp: '2026-01-01T00:00:00Z' })
    expect(lines).toContain('SUMMARY:Anniversary\\; a big\\, one')
    expect(lines).toContain('LOCATION:Main Hall')
  })

  it('builds a valid calendar wrapper and one VEVENT', () => {
    const ics = buildIcs(event, { stamp: '2026-01-01T00:00:00Z' })
    expect(ics.startsWith('BEGIN:VCALENDAR')).toBe(true)
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true)
    expect((ics.match(/BEGIN:VEVENT/g) || []).length).toBe(1)
    expect(ics.includes('\r\n')).toBe(true)
  })

  it('marks a cancelled event and defaults a missing end to +1h', () => {
    const ics = buildIcs({ ...event, ends_at: null, status: 'cancelled' })
    expect(ics).toContain('STATUS:CANCELLED')
    expect(ics).toContain('DTEND:20260612T023000Z') // start + 1h
  })

  it('skips dateless events', () => {
    const ics = buildIcs([{ id: 'x', title: 'Draft', starts_at: null }, event])
    expect((ics.match(/BEGIN:VEVENT/g) || []).length).toBe(1)
  })

  it('makes a filesystem-safe filename', () => {
    expect(icsFilename('August 2026 / events')).toBe('August-2026-events.ics')
    expect(icsFilename('')).toBe('calendar.ics')
  })
})

describe('holidays', () => {
  const list = [
    { date: '2026-01-01', name: "New Year", type: 'regular' },
    { date: '2026-02-17', name: 'Chinese New Year', type: 'special' },
    { date: '2027-01-01', name: 'New Year', type: 'regular' },
  ]

  it('expands only holidays inside the window', () => {
    const items = expandHolidays(new Date(2026, 0, 1), new Date(2026, 11, 31), list)
    expect(items.map((i) => i.title)).toEqual(['New Year', 'Chinese New Year'])
    expect(items.every((i) => i.isHoliday && i.kind === 'holiday')).toBe(true)
  })

  it('carries the regular/special type', () => {
    const items = expandHolidays(new Date(2026, 0, 1), new Date(2026, 11, 31), list)
    expect(items.find((i) => i.title === 'Chinese New Year').holidayType).toBe('special')
    expect(items.find((i) => i.title === 'New Year').holidayType).toBe('regular')
  })

  it('anchors an all-day holiday so the Manila date is stable', () => {
    const [item] = expandHolidays(new Date(2026, 0, 1), new Date(2026, 0, 2), list)
    // Noon local on Jan 1 — never rolls back to Dec 31 through the ISO round-trip.
    expect(new Date(item.starts_at).getFullYear()).toBe(2026)
  })

  it('reports the last covered year', () => {
    expect(definedThrough(list)).toBe(2027)
  })
})

describe('serviceWindow', () => {
  it('opens 2h before and closes 1h after (Q9)', () => {
    const w = serviceWindow({ starts_at: '2026-06-12T10:00:00.000Z', ends_at: '2026-06-12T12:00:00.000Z' })
    expect(w.opens_at).toBe('2026-06-12T08:00:00.000Z')
    expect(w.closes_at).toBe('2026-06-12T13:00:00.000Z')
  })

  it('defaults a missing end to the start', () => {
    const w = serviceWindow({ starts_at: '2026-06-12T10:00:00.000Z', ends_at: null })
    expect(w.opens_at).toBe('2026-06-12T08:00:00.000Z')
    expect(w.closes_at).toBe('2026-06-12T11:00:00.000Z')
  })

  it('clamps a span over 24h so the DB window check holds', () => {
    const w = serviceWindow({ starts_at: '2026-06-12T10:00:00.000Z', ends_at: '2026-06-15T10:00:00.000Z' })
    const span = new Date(w.closes_at).getTime() - new Date(w.opens_at).getTime()
    expect(span).toBe(24 * 60 * 60 * 1000)
  })
})

describe('deriveCloseout', () => {
  const past = '2026-06-12T10:00:00.000Z'
  const future = '2999-06-12T10:00:00.000Z'
  const now = new Date('2026-08-25T00:00:00.000Z')

  it('a passed, published, unclosed event is awaiting closeout (excluded from stats)', () => {
    const s = deriveCloseout({ event: { starts_at: past, status: 'published', attendance_tracked: true }, now })
    expect(s.happened).toBe(true)
    expect(s.awaitingCloseout).toBe(true)
    expect(s.closed).toBe(false)
    expect(s.canClose).toBe(true)
  })

  it('a future event has not happened and cannot be closed', () => {
    const s = deriveCloseout({ event: { starts_at: future, status: 'published' }, now })
    expect(s.happened).toBe(false)
    expect(s.canClose).toBe(false)
  })

  it('a closed event reads as done', () => {
    const s = deriveCloseout({ event: { starts_at: past, status: 'published', closed_at: past }, now })
    expect(s.closed).toBe(true)
    expect(s.awaitingCloseout).toBe(false)
    expect(s.canClose).toBe(false)
  })

  it('attendance is open only when tracked and empty', () => {
    const tracked0 = deriveCloseout({ event: { starts_at: past, status: 'published', attendance_tracked: true }, attendanceCount: 0, now })
    const tracked5 = deriveCloseout({ event: { starts_at: past, status: 'published', attendance_tracked: true }, attendanceCount: 5, now })
    const untracked = deriveCloseout({ event: { starts_at: past, status: 'published', attendance_tracked: false }, now })
    expect(tracked0.records.attendance.open).toBe(true)
    expect(tracked5.records.attendance.open).toBe(false)
    expect(untracked.records.attendance.open).toBe(false)
  })

  it('the collection is finance-owned and never gates close', () => {
    const s = deriveCloseout({ event: { starts_at: past, status: 'published' }, collectionTotal: 0, now })
    expect(s.records.collection.financeOnly).toBe(true)
    expect(s.records.collection.pending).toBe(true)
    // canClose ignores the collection.
    expect(s.canClose).toBe(true)
  })
})

describe('overlaps', () => {
  it('detects overlapping intervals', () => {
    expect(overlaps('2026-06-12T10:00:00Z', '2026-06-12T12:00:00Z', '2026-06-12T11:00:00Z', '2026-06-12T13:00:00Z')).toBe(true)
  })
  it('does not clash on touching endpoints', () => {
    expect(overlaps('2026-06-12T10:00:00Z', '2026-06-12T12:00:00Z', '2026-06-12T12:00:00Z', '2026-06-12T13:00:00Z')).toBe(false)
  })
  it('separate intervals do not overlap', () => {
    expect(overlaps('2026-06-12T10:00:00Z', '2026-06-12T11:00:00Z', '2026-06-12T12:00:00Z', '2026-06-12T13:00:00Z')).toBe(false)
  })
})

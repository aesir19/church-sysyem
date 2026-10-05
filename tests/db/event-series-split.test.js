// Changing "this date and the ones after it" (#103 bug 2 + #105): one all-or-nothing split.
//
// The rules under test were agreed with the owner on 2026-10-05 (see the comment on #105) and
// reworked after code review (0050):
//   * the date being changed lands on exactly the day picked, and the new schedule starts there;
//     the old schedule ends the day before the earlier of the two days. Earlier dates are never
//     touched. A date that has already started cannot be changed this way; moving earlier may not
//     jump back over a saved date
//   * already-planned later dates (saved rows) STAY where they are by default, keeping their own
//     details. Only when the owner ticks "Also move already-planned future dates" does each one
//     move to the new schedule's date in the Sunday-first week it actually sits in, and take its
//     details; with no new date that week it stays put as a standalone event
//   * "planned" and "past" are judged on each date's actual start, by the database clock
//   * cancelled dates stay cancelled; people, programme, money and attendance stay attached, and
//     a date that changes day files its attendance as history (0047)
//   * a one-time key makes a retry after a lost reply return the first result; the same key with
//     a different change is refused
//   * Events Team / SuperAdmin of the series' own church only; a deleted series cannot change
//
// Runs against a real database inside a rolled-back transaction (`npm run test:db`).

import { describe, it, expect, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import {
  hasDatabase, withRollback, asPrincipal, refusalMessage,
  isAuthorizationFailure, disconnect,
} from './helpers/database.js'
import { makeChurch, makePrincipal, addToGroup, findSystemMinistry } from './helpers/fixtures.js'

afterAll(disconnect)

const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d))

/** The first date on or after today + `days` (Manila) that falls on `dow` (Sunday = 0). */
async function dayAfter (tx, days, dow) {
  const [row] = await tx.$queryRawUnsafe(
    `SELECT d::date AS d
       FROM generate_series((now() AT TIME ZONE 'Asia/Manila')::date + $1::int,
                            (now() AT TIME ZONE 'Asia/Manila')::date + $1::int + 6, interval '1 day') d
      WHERE extract(dow FROM d)::int = $2::int`,
    days, dow
  )
  return iso(row.d)
}

const shift = (ymd, days) => {
  const d = new Date(`${ymd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return iso(d)
}

async function makeSeries (tx, churchId, { startsOn = '2026-01-04', weekday = 0, timeStart = '08:00' } = {}) {
  const [row] = await tx.$queryRawUnsafe(
    `INSERT INTO public.event_series
       (church_id, title, kind, status, cadence, weekday, time_start, starts_on, published_at)
     VALUES ($1::uuid, 'zz-series', 'service', 'published', 'weekly', $2::int, $3::time, $4::date, now())
     RETURNING id`,
    churchId, weekday, timeStart, startsOn
  )
  return row.id
}

/** A saved date of a series on `date` (Manila) at `time`. */
async function makeDate (tx, churchId, seriesId, date, { time = '08:00', title = 'zz-date', status = 'published' } = {}) {
  const [row] = await tx.$queryRawUnsafe(
    `INSERT INTO public.events (church_id, title, kind, status, starts_at, published_at, series_id, occurrence_date)
     VALUES ($1::uuid, $2, 'service', $3, (($4::date + $5::time) AT TIME ZONE 'Asia/Manila'), now(), $6::uuid, $4::date)
     RETURNING id`,
    churchId, title, status, date, time, seriesId
  )
  return row.id
}

async function addExpense (tx, churchId, eventId) {
  await tx.$executeRawUnsafe(
    `INSERT INTO public.expenses (event_id, from_church, description, amount, spent_on)
     VALUES ($1::uuid, $2::uuid, 'zz-expense', '100', current_date)`,
    eventId, churchId
  )
}

async function addProgramme (tx, churchId, eventId) {
  await tx.$executeRawUnsafe(
    `INSERT INTO public.event_programme_items (church_id, event_id, title) VALUES ($1::uuid, $2::uuid, 'zz-item')`,
    churchId, eventId
  )
}

async function addAttendance (tx, churchId, eventId, n = 1) {
  const [svc] = await tx.$queryRawUnsafe(
    `INSERT INTO public.services (church_id, label, opens_at, closes_at, event_id)
     VALUES ($1::uuid, $3, now() - interval '1 hour', now() + interval '1 hour', $2::uuid) RETURNING id`,
    churchId, eventId, `zz-svc-${Math.random().toString(36).slice(2, 10)}`
  )
  for (let i = 0; i < n; i++) {
    await tx.$executeRawUnsafe(
      `INSERT INTO public.attendance (service_id, church_id, guest_name, source) VALUES ($1::uuid, $2::uuid, $3, 'self')`,
      svc.id, churchId, `zz-guest-${i}`
    )
  }
  return svc.id
}

async function world (tx) {
  const churchA = await makeChurch(tx, 'a')
  const churchB = await makeChurch(tx, 'b')
  const eventsMinistry = await findSystemMinistry(tx, 'events')
  const eventsTeam = await makePrincipal(tx, { role: 'member', churchId: churchA })
  await addToGroup(tx, eventsMinistry, eventsTeam.memberId)
  const eventsTeamB = await makePrincipal(tx, { role: 'member', churchId: churchB })
  await addToGroup(tx, eventsMinistry, eventsTeamB.memberId)
  const plainMember = await makePrincipal(tx, { role: 'member', churchId: churchA })
  return { churchA, churchB, eventsTeam, eventsTeamB, plainMember }
}

// The new schedule every test splits to: Saturdays at 09:00, a new title.
const NEW_RULE = {
  title: 'zz-new', kind: 'service', status: 'published', location: 'zz-hall',
  cadence: 'weekly', interval_n: 1, weekday: 6, time_start: '09:00', time_end: '10:30',
}

// `from` is the date being changed; `starts` the day it moves to (default: stays on its day).
const split = (tx, { series, from, starts = from, rule = NEW_RULE, moves = null, key = randomUUID() }) =>
  tx.$queryRawUnsafe(
    `SELECT public.split_event_series($1::uuid, $2::date, $3::date, $4::jsonb, $5::jsonb, $6::uuid) AS r`,
    series, from, starts, JSON.stringify(rule), moves == null ? null : JSON.stringify(moves), key
  ).then((rows) => rows[0].r)

const eventRow = async (tx, id) =>
  (await tx.$queryRawUnsafe(
    `SELECT id, series_id, occurrence_date, title, status, location,
            to_char(starts_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD HH24:MI') AS local_start
       FROM public.events WHERE id = $1::uuid`, id))[0]

const seriesRow = async (tx, id) =>
  (await tx.$queryRawUnsafe(
    `SELECT id, church_id, title, weekday, starts_on, ends_on, status, deleted_at FROM public.event_series WHERE id = $1::uuid`, id))[0]

describe.skipIf(!hasDatabase())('split_event_series — the schedule itself', () => {
  it('ends the old schedule the day before and starts the new one on the chosen date', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      const series = await makeSeries(tx, w.churchA)
      const from = await dayAfter(tx, 14, 0)
      const past = await makeDate(tx, w.churchA, series, await dayAfter(tx, -14, 0), { title: 'zz-past' })
      await asPrincipal(tx, w.eventsTeam.accountId)

      const r = await split(tx, { series, from })

      expect(r.already_done).toBe(false)
      expect(iso((await seriesRow(tx, series)).ends_on)).toBe(shift(from, -1))
      const created = await seriesRow(tx, r.new_series_id)
      expect(created).toMatchObject({ church_id: w.churchA, title: 'zz-new', weekday: 6, status: 'published', deleted_at: null })
      expect(iso(created.starts_on)).toBe(from)
      // An earlier saved date is not touched.
      expect(await eventRow(tx, past)).toMatchObject({ series_id: series, title: 'zz-past' })
    })
  })

  it('replaces the schedule outright when the change starts on its very first date', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      const from = await dayAfter(tx, 14, 0)
      const series = await makeSeries(tx, w.churchA, { startsOn: from })
      const planned = await makeDate(tx, w.churchA, series, shift(from, 7), { title: 'zz-planned' })
      await asPrincipal(tx, w.eventsTeam.accountId)

      const r = await split(tx, { series, from })

      expect(await seriesRow(tx, series)).toBeUndefined()
      expect(await eventRow(tx, planned)).toMatchObject({ series_id: r.new_series_id, title: 'zz-planned' })
    })
  })
})

describe.skipIf(!hasDatabase())('split_event_series — already-planned later dates', () => {
  it('leaves them alone by default: same date, own details, cancelled stays cancelled', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      const series = await makeSeries(tx, w.churchA)
      const from = await dayAfter(tx, 14, 0)
      const special = await makeDate(tx, w.churchA, series, shift(from, 7), { title: 'zz-special', time: '07:00' })
      const cancelled = await makeDate(tx, w.churchA, series, shift(from, 14), { status: 'cancelled' })
      await asPrincipal(tx, w.eventsTeam.accountId)

      const r = await split(tx, { series, from })

      expect(await eventRow(tx, special)).toMatchObject({
        series_id: r.new_series_id, title: 'zz-special', local_start: `${shift(from, 7)} 07:00`,
      })
      expect(iso((await eventRow(tx, special)).occurrence_date)).toBe(shift(from, 7))
      expect(await eventRow(tx, cancelled)).toMatchObject({ series_id: r.new_series_id, status: 'cancelled' })
    })
  })

  it('when asked, moves each to the same week on the new schedule and gives it the new details', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      const series = await makeSeries(tx, w.churchA)
      const from = await dayAfter(tx, 14, 0)
      const sunday = shift(from, 7)
      const saturday = shift(from, 13) // the Saturday of that Sunday-first week
      const planned = await makeDate(tx, w.churchA, series, sunday, { title: 'zz-special' })
      await addExpense(tx, w.churchA, planned)
      await addProgramme(tx, w.churchA, planned)
      await asPrincipal(tx, w.eventsTeam.accountId)

      const r = await split(tx, { series, from, moves: [{ event_id: planned, to_date: saturday }] })

      expect(r.moved).toBe(1)
      const e = await eventRow(tx, planned)
      expect(e).toMatchObject({ series_id: r.new_series_id, title: 'zz-new', location: 'zz-hall', local_start: `${saturday} 09:00` })
      expect(iso(e.occurrence_date)).toBe(saturday)
      // Money and programme stay attached.
      const [{ n: expenses }] = await tx.$queryRawUnsafe(`SELECT count(*)::int AS n FROM public.expenses WHERE event_id = $1::uuid`, planned)
      const [{ n: items }] = await tx.$queryRawUnsafe(`SELECT count(*)::int AS n FROM public.event_programme_items WHERE event_id = $1::uuid`, planned)
      expect([expenses, items]).toEqual([1, 1])
    })
  })

  it('keeps a cancelled date cancelled when it moves', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      const series = await makeSeries(tx, w.churchA)
      const from = await dayAfter(tx, 14, 0)
      const cancelled = await makeDate(tx, w.churchA, series, shift(from, 7), { status: 'cancelled' })
      await asPrincipal(tx, w.eventsTeam.accountId)

      await split(tx, { series, from, moves: [{ event_id: cancelled, to_date: shift(from, 13) }] })

      expect(await eventRow(tx, cancelled)).toMatchObject({ status: 'cancelled', title: 'zz-new' })
    })
  })

  it('keeps a date with no new date that week where it is, as a standalone event', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      const series = await makeSeries(tx, w.churchA)
      const from = await dayAfter(tx, 14, 0)
      const planned = await makeDate(tx, w.churchA, series, shift(from, 7), { title: 'zz-special', time: '07:00' })
      await asPrincipal(tx, w.eventsTeam.accountId)

      const r = await split(tx, { series, from, moves: [{ event_id: planned, to_date: null }] })

      expect(r.standalone).toBe(1)
      expect(await eventRow(tx, planned)).toMatchObject({
        series_id: null, occurrence_date: null, title: 'zz-special', local_start: `${shift(from, 7)} 07:00`,
      })
    })
  })

  it('files attendance as history when a planned date moves to another day', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      const series = await makeSeries(tx, w.churchA)
      const from = await dayAfter(tx, 14, 0)
      const planned = await makeDate(tx, w.churchA, series, shift(from, 7))
      const svc = await addAttendance(tx, w.churchA, planned, 2)
      await asPrincipal(tx, w.eventsTeam.accountId)

      await split(tx, { series, from, moves: [{ event_id: planned, to_date: shift(from, 13) }] })

      const [s] = await tx.$queryRawUnsafe(`SELECT event_id, history_at FROM public.services WHERE id = $1::uuid`, svc)
      expect(s.event_id).toBe(planned)
      expect(s.history_at).not.toBeNull()
    })
  })

  it('moves a planned date within the week it actually sits in, not its original slot', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      const series = await makeSeries(tx, w.churchA)
      const from = await dayAfter(tx, 14, 0)
      // Slot: the Sunday a week on. Actually moved to the Monday after that (the next week).
      const [moved] = await tx.$queryRawUnsafe(
        `INSERT INTO public.events (church_id, title, kind, status, starts_at, published_at, series_id, occurrence_date)
         VALUES ($1::uuid, 'zz-moved', 'service', 'published', (($2::date + time '08:00') AT TIME ZONE 'Asia/Manila'),
                 now(), $3::uuid, $4::date) RETURNING id`,
        w.churchA, shift(from, 15), series, shift(from, 7)
      )
      await asPrincipal(tx, w.eventsTeam.accountId)

      await split(tx, { series, from, moves: [{ event_id: moved.id, to_date: shift(from, 20) }] })

      expect(iso((await eventRow(tx, moved.id)).occurrence_date)).toBe(shift(from, 20))
    })
  })

  it('refuses a move to another week', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      const series = await makeSeries(tx, w.churchA)
      const from = await dayAfter(tx, 14, 0)
      const planned = await makeDate(tx, w.churchA, series, shift(from, 7))
      await asPrincipal(tx, w.eventsTeam.accountId)

      const msg = await refusalMessage(tx, () =>
        split(tx, { series, from, moves: [{ event_id: planned, to_date: shift(from, 20) }] }))
      expect(msg).toMatch(/same week/)
    })
  })

  it('leaves a planned date that is not in the list as it is', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      const series = await makeSeries(tx, w.churchA)
      const from = await dayAfter(tx, 14, 0)
      const a = await makeDate(tx, w.churchA, series, shift(from, 7))
      const b = await makeDate(tx, w.churchA, series, shift(from, 14), { title: 'zz-special' })
      await asPrincipal(tx, w.eventsTeam.accountId)

      const r = await split(tx, { series, from, moves: [{ event_id: a, to_date: shift(from, 13) }] })

      expect(await eventRow(tx, b)).toMatchObject({ series_id: r.new_series_id, title: 'zz-special' })
      expect(iso((await eventRow(tx, b)).occurrence_date)).toBe(shift(from, 14))
    })
  })
})

describe.skipIf(!hasDatabase())('split_event_series — the date being changed', () => {
  it('always takes the change, while the other planned dates stay as they are', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      const series = await makeSeries(tx, w.churchA)
      const from = await dayAfter(tx, 14, 0)
      const selected = await makeDate(tx, w.churchA, series, from, { title: 'zz-old' })
      const other = await makeDate(tx, w.churchA, series, shift(from, 7), { title: 'zz-special' })
      await asPrincipal(tx, w.eventsTeam.accountId)

      // Sundays become Tuesdays from this date.
      const r = await split(tx, { series, from, starts: shift(from, 2), rule: { ...NEW_RULE, weekday: 2 } })

      expect(await eventRow(tx, selected)).toMatchObject({
        series_id: r.new_series_id, title: 'zz-new', local_start: `${shift(from, 2)} 09:00`,
      })
      expect(await eventRow(tx, other)).toMatchObject({ series_id: r.new_series_id, title: 'zz-special' })
    })
  })

  it('lands on exactly the day picked in a later week, and the new schedule starts there', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      const series = await makeSeries(tx, w.churchA)
      const from = await dayAfter(tx, 14, 0)
      const monday = shift(from, 8) // the Monday of the NEXT week
      const selected = await makeDate(tx, w.churchA, series, from)
      await asPrincipal(tx, w.eventsTeam.accountId)

      const r = await split(tx, { series, from, starts: monday, rule: { ...NEW_RULE, weekday: 1 } })

      expect(iso((await eventRow(tx, selected)).occurrence_date)).toBe(monday)
      expect(iso((await seriesRow(tx, r.new_series_id)).starts_on)).toBe(monday)
      expect(iso((await seriesRow(tx, series)).ends_on)).toBe(shift(from, -1))
    })
  })

  it('starts the new schedule on an earlier new date, across the week boundary', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      const series = await makeSeries(tx, w.churchA)
      const sunday = await dayAfter(tx, 14, 0)
      const saturday = shift(sunday, -1)
      const selected = await makeDate(tx, w.churchA, series, sunday)
      await asPrincipal(tx, w.eventsTeam.accountId)

      const r = await split(tx, { series, from: sunday, starts: saturday })

      expect(iso((await seriesRow(tx, r.new_series_id)).starts_on)).toBe(saturday)
      expect(iso((await seriesRow(tx, series)).ends_on)).toBe(shift(saturday, -1))
      expect(iso((await eventRow(tx, selected)).occurrence_date)).toBe(saturday)
    })
  })

  it('refuses moving earlier past a saved earlier date, so dates cannot swap order', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      const series = await makeSeries(tx, w.churchA)
      const from = await dayAfter(tx, 14, 0)
      await makeDate(tx, w.churchA, series, from)
      await asPrincipal(tx, w.eventsTeam.accountId)

      const msg = await refusalMessage(tx, () => split(tx, { series, from: shift(from, 7), starts: shift(from, -1) }))
      expect(msg).toMatch(/earlier date of this repeating event/)
    })
  })

  it('judges the date being changed where it actually sits: moved into the past, it is past', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      const series = await makeSeries(tx, w.churchA)
      const from = await dayAfter(tx, 14, 0)
      await tx.$executeRawUnsafe(
        `INSERT INTO public.events (church_id, title, kind, status, starts_at, published_at, series_id, occurrence_date)
         VALUES ($1::uuid, 'zz-moved', 'service', 'published', now() - interval '1 day', now(), $2::uuid, $3::date)`,
        w.churchA, series, from
      )
      await asPrincipal(tx, w.eventsTeam.accountId)

      expect(await refusalMessage(tx, () => split(tx, { series, from }))).toMatch(/already happened/)
    })
  })

  it('stands a planned date on its own when the changed date takes its day', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      const series = await makeSeries(tx, w.churchA)
      const from = await dayAfter(tx, 14, 0)
      const selected = await makeDate(tx, w.churchA, series, from)
      const next = await makeDate(tx, w.churchA, series, shift(from, 7), { title: 'zz-special' })
      await asPrincipal(tx, w.eventsTeam.accountId)

      // The changed date moves a week on, onto the next planned Sunday.
      const r = await split(tx, { series, from, starts: shift(from, 7), rule: { ...NEW_RULE, weekday: 0 } })

      expect(iso((await eventRow(tx, selected)).occurrence_date)).toBe(shift(from, 7))
      expect(await eventRow(tx, next)).toMatchObject({ series_id: null, title: 'zz-special' })
      expect(r.standalone).toBe(1)
    })
  })
})

describe.skipIf(!hasDatabase())('preview_split_event_series — the planned dates the screen offers', () => {
  it('lists upcoming saved dates by their actual day, and leaves out ones already past', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      const series = await makeSeries(tx, w.churchA)
      const from = await dayAfter(tx, 14, 0)
      const upcoming = await makeDate(tx, w.churchA, series, shift(from, 7), { status: 'cancelled' })
      await tx.$executeRawUnsafe(
        `INSERT INTO public.events (church_id, title, kind, status, starts_at, published_at, series_id, occurrence_date)
         VALUES ($1::uuid, 'zz-past', 'service', 'published', now() - interval '1 day', now(), $2::uuid, $3::date)`,
        w.churchA, series, shift(from, 14)
      )
      await asPrincipal(tx, w.eventsTeam.accountId)

      const [{ r }] = await tx.$queryRawUnsafe(`SELECT public.preview_split_event_series($1::uuid, $2::date) AS r`, series, from)
      expect(r).toEqual([{ id: upcoming, occurrence_date: shift(from, 7), actual_date: shift(from, 7), status: 'cancelled' }])
    })
  })

  it('refuses a caller who cannot manage this church\'s events', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      const series = await makeSeries(tx, w.churchA)
      await asPrincipal(tx, w.eventsTeamB.accountId)
      const msg = await refusalMessage(tx, () =>
        tx.$queryRawUnsafe(`SELECT public.preview_split_event_series($1::uuid, current_date)`, series))
      expect(isAuthorizationFailure(msg)).toBe(true)
    })
  })
})

describe.skipIf(!hasDatabase())('split_event_series — who may, when, and safe repeats', () => {
  it('refuses a member who is not Events Team, and an Events Team member of another church', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      const series = await makeSeries(tx, w.churchA)
      const from = await dayAfter(tx, 14, 0)
      for (const account of [w.plainMember, w.eventsTeamB]) {
        await asPrincipal(tx, account.accountId)
        const msg = await refusalMessage(tx, () => split(tx, { series, from }))
        expect(isAuthorizationFailure(msg)).toBe(true)
      }
    })
  })

  it('refuses a split from a date that has already started', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      // Today's slot at 00:00 Manila has already started by the time this runs.
      const [{ dow }] = await tx.$queryRawUnsafe(
        `SELECT extract(dow FROM (now() AT TIME ZONE 'Asia/Manila'))::int AS dow`)
      const today = await dayAfter(tx, 0, dow)
      const series = await makeSeries(tx, w.churchA, { weekday: dow, timeStart: '00:00' })
      await asPrincipal(tx, w.eventsTeam.accountId)

      const msg = await refusalMessage(tx, () => split(tx, { series, from: today }))
      expect(msg).toMatch(/already happened/)
    })
  })

  it('refuses to change a deleted series, by split or by a direct edit', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      const series = await makeSeries(tx, w.churchA)
      const from = await dayAfter(tx, 14, 0)
      await asPrincipal(tx, w.eventsTeam.accountId)
      await tx.$queryRawUnsafe(`SELECT public.delete_event_series($1::uuid)`, series)

      expect(await refusalMessage(tx, () => split(tx, { series, from }))).toMatch(/deleted/)
      expect(await refusalMessage(tx, () =>
        tx.$executeRawUnsafe(`UPDATE public.event_series SET title = 'zz-edit' WHERE id = $1::uuid`, series))).toMatch(/deleted/)
    })
  })

  it('returns the first result for a repeated key and splits only once', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      const series = await makeSeries(tx, w.churchA)
      const from = await dayAfter(tx, 14, 0)
      const key = randomUUID()
      await asPrincipal(tx, w.eventsTeam.accountId)

      const first = await split(tx, { series, from, key })
      const second = await split(tx, { series, from, key })

      expect(second).toMatchObject({ already_done: true, new_series_id: first.new_series_id })
      // The same key with a DIFFERENT change is refused, not silently dropped.
      expect(await refusalMessage(tx, () => split(tx, { series, from, starts: shift(from, 1), key })))
        .toMatch(/already saved/)
      const [{ n }] = await tx.$queryRawUnsafe(
        `SELECT count(*)::int AS n FROM public.event_series WHERE church_id = $1::uuid`, w.churchA)
      expect(n).toBe(2)
    })
  })

  it('leaves everything unchanged when the last step fails', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      const series = await makeSeries(tx, w.churchA)
      const from = await dayAfter(tx, 14, 0)
      const planned = await makeDate(tx, w.churchA, series, shift(from, 7), { title: 'zz-special' })
      await tx.$executeRawUnsafe(
        `CREATE FUNCTION pg_temp.zz_boom() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'zz forced failure'; END $$`
      )
      await tx.$executeRawUnsafe(
        `CREATE TRIGGER zz_boom BEFORE UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION pg_temp.zz_boom()`
      )
      await asPrincipal(tx, w.eventsTeam.accountId)

      const msg = await refusalMessage(tx, () =>
        split(tx, { series, from, moves: [{ event_id: planned, to_date: shift(from, 13) }] }))

      expect(msg).toMatch(/zz forced failure/)
      expect((await seriesRow(tx, series)).ends_on).toBeNull()
      expect(await eventRow(tx, planned)).toMatchObject({ series_id: series, title: 'zz-special' })
      const [{ n }] = await tx.$queryRawUnsafe(
        `SELECT count(*)::int AS n FROM public.event_series WHERE church_id = $1::uuid`, w.churchA)
      expect(n).toBe(1)
    })
  })
})

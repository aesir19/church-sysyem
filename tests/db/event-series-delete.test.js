// Deleting a repeating event (#103 bug 2 + #105): one all-or-nothing database operation.
//
// The rules under test were agreed with the owner on 2026-10-05 (see the comment on #105):
//   * soft delete — the series ends and is marked deleted; past dates stay, no restore
//   * an upcoming date with recorded work (attendance, finance, people, programme) survives as a
//     standalone event with its links; one without is removed
//   * "past" is the exact start time against the database clock (Asia/Manila), by the event's
//     ACTUAL start, not its original slot
//   * only Events Team / SuperAdmin of the series' own church; a repeat call changes nothing
//
// Runs against a real database inside a rolled-back transaction (`npm run test:db`).

import { describe, it, expect, afterAll } from 'vitest'
import {
  hasDatabase, withRollback, asPrincipal, refusalMessage,
  isAuthorizationFailure, disconnect,
} from './helpers/database.js'
import { makeChurch, makePrincipal, addToGroup, findSystemMinistry } from './helpers/fixtures.js'

afterAll(disconnect)

/** Today's date and weekday in Manila — the clock the rules are judged on. */
async function manilaToday (tx) {
  const [row] = await tx.$queryRawUnsafe(
    `SELECT (now() AT TIME ZONE 'Asia/Manila')::date AS d,
            extract(dow FROM (now() AT TIME ZONE 'Asia/Manila'))::int AS dow`
  )
  return { date: row.d.toISOString().slice(0, 10), dow: row.dow }
}

async function makeSeries (tx, churchId, { startsOn, timeStart = '00:00', weekday = 0, endsOn = null } = {}) {
  const [row] = await tx.$queryRawUnsafe(
    `INSERT INTO public.event_series
       (church_id, title, kind, status, cadence, weekday, time_start, starts_on, ends_on, published_at)
     VALUES ($1::uuid, 'zz-series', 'service', 'published', 'weekly', $2::int, $3::time, $4::date, $5::date, now())
     RETURNING id`,
    churchId, weekday, timeStart, startsOn, endsOn
  )
  return row.id
}

/** A saved date of a series. `when` is a SQL timestamptz expression, e.g. "now() + interval '3 days'". */
async function makeOccurrence (tx, churchId, seriesId, when, { title = 'zz-date', status = 'published' } = {}) {
  const [row] = await tx.$queryRawUnsafe(
    `INSERT INTO public.events (church_id, title, kind, status, starts_at, published_at, series_id, occurrence_date)
     VALUES ($1::uuid, $2, 'service', $3, ${when}, now(), $4::uuid,
             ((${when}) AT TIME ZONE 'Asia/Manila')::date)
     RETURNING id`,
    churchId, title, status, seriesId
  )
  return row.id
}

async function addAttendance (tx, churchId, eventId, n = 1) {
  const [svc] = await tx.$queryRawUnsafe(
    `INSERT INTO public.services (church_id, label, opens_at, closes_at, event_id)
     VALUES ($1::uuid, 'zz-svc', now() - interval '1 hour', now() + interval '1 hour', $2::uuid) RETURNING id`,
    churchId, eventId
  )
  for (let i = 0; i < n; i++) {
    await tx.$executeRawUnsafe(
      `INSERT INTO public.attendance (service_id, church_id, guest_name, source) VALUES ($1::uuid, $2::uuid, $3, 'self')`,
      svc.id, churchId, `zz-guest-${i}`
    )
  }
  return svc.id
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

async function addOpenRole (tx, churchId, eventId) {
  await tx.$executeRawUnsafe(
    `INSERT INTO public.event_roles (church_id, event_id, label, count_required) VALUES ($1::uuid, $2::uuid, 'zz-usher', 2)`,
    churchId, eventId
  )
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
  const today = await manilaToday(tx)
  return { churchA, churchB, eventsTeam, eventsTeamB, plainMember, today }
}

const del = (tx, seriesId) =>
  tx.$queryRawUnsafe(`SELECT public.delete_event_series($1::uuid) AS r`, seriesId).then((rows) => rows[0].r)

const eventRow = async (tx, id) =>
  (await tx.$queryRawUnsafe(`SELECT id, series_id, occurrence_date FROM public.events WHERE id = $1::uuid`, id))[0]

const seriesRow = async (tx, id) =>
  (await tx.$queryRawUnsafe(`SELECT id, ends_on, deleted_at FROM public.event_series WHERE id = $1::uuid`, id))[0]

describe.skipIf(!hasDatabase())('delete_event_series — what stays and what goes', () => {
  it('marks the series deleted, keeps past dates attached, and ends it so no new dates appear', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      const series = await makeSeries(tx, w.churchA, { startsOn: '2026-01-04', weekday: w.today.dow })
      const past = await makeOccurrence(tx, w.churchA, series, `now() - interval '9 days'`)
      await asPrincipal(tx, w.eventsTeam.accountId)

      const result = await del(tx, series)

      expect(result.already_deleted).toBe(false)
      const s = await seriesRow(tx, series)
      expect(s.deleted_at).not.toBeNull()
      expect(s.ends_on).not.toBeNull()
      expect(await eventRow(tx, past)).toMatchObject({ series_id: series })
    })
  })

  it('keeps an upcoming date that has recorded work as a standalone event with its links', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      const series = await makeSeries(tx, w.churchA, { startsOn: '2026-01-04', weekday: w.today.dow })
      const withAttendance = await makeOccurrence(tx, w.churchA, series, `now() + interval '10 days'`)
      const withExpense = await makeOccurrence(tx, w.churchA, series, `now() + interval '17 days'`)
      const withProgramme = await makeOccurrence(tx, w.churchA, series, `now() + interval '24 days'`)
      const svc = await addAttendance(tx, w.churchA, withAttendance, 3)
      await addExpense(tx, w.churchA, withExpense)
      await addProgramme(tx, w.churchA, withProgramme)
      await asPrincipal(tx, w.eventsTeam.accountId)

      const result = await del(tx, series)

      expect(result.kept).toBe(3)
      for (const id of [withAttendance, withExpense, withProgramme]) {
        expect(await eventRow(tx, id)).toMatchObject({ series_id: null, occurrence_date: null })
      }
      // The links survive: the attendance service still points at its event.
      const [link] = await tx.$queryRawUnsafe(`SELECT event_id FROM public.services WHERE id = $1::uuid`, svc)
      expect(link.event_id).toBe(withAttendance)
    })
  })

  it('removes an upcoming date with no recorded work — unfilled roles and cancelled dates included', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      const series = await makeSeries(tx, w.churchA, { startsOn: '2026-01-04', weekday: w.today.dow })
      const plain = await makeOccurrence(tx, w.churchA, series, `now() + interval '10 days'`)
      const rolesOnly = await makeOccurrence(tx, w.churchA, series, `now() + interval '17 days'`)
      const cancelled = await makeOccurrence(tx, w.churchA, series, `now() + interval '24 days'`, { status: 'cancelled' })
      await addOpenRole(tx, w.churchA, rolesOnly)
      await asPrincipal(tx, w.eventsTeam.accountId)

      const result = await del(tx, series)

      expect(result.kept).toBe(0)
      expect(result.removed).toBe(3)
      for (const id of [plain, rolesOnly, cancelled]) expect(await eventRow(tx, id)).toBeUndefined()
    })
  })

  it('judges past by the actual start, not the original slot', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      const series = await makeSeries(tx, w.churchA, { startsOn: '2026-01-04', weekday: w.today.dow })
      // Slot was last month but it was moved to next week: upcoming, so it is judged as upcoming.
      const [moved] = await tx.$queryRawUnsafe(
        `INSERT INTO public.events (church_id, title, kind, status, starts_at, published_at, series_id, occurrence_date)
         VALUES ($1::uuid, 'zz-moved', 'service', 'published', now() + interval '7 days', now(), $2::uuid,
                 ((now() - interval '30 days') AT TIME ZONE 'Asia/Manila')::date) RETURNING id`,
        w.churchA, series
      )
      await addExpense(tx, w.churchA, moved.id)
      await asPrincipal(tx, w.eventsTeam.accountId)

      await del(tx, series)

      expect(await eventRow(tx, moved.id)).toMatchObject({ series_id: null })
    })
  })

  it('counts a date that already started today as past, so it stays on the calendar', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      // A series whose slot is today at 00:00 Manila — already started by the time this runs.
      const series = await makeSeries(tx, w.churchA, { startsOn: '2026-01-04', weekday: w.today.dow, timeStart: '00:00' })
      await asPrincipal(tx, w.eventsTeam.accountId)

      await del(tx, series)

      const s = await seriesRow(tx, series)
      expect(s.ends_on.toISOString().slice(0, 10)).toBe(w.today.date)
    })
  })

  it('hard-deletes a series that has not started yet, keeping any upcoming date that has work', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      const series = await makeSeries(tx, w.churchA, { startsOn: '2099-01-04', weekday: 0 })
      const [future] = await tx.$queryRawUnsafe(
        `INSERT INTO public.events (church_id, title, kind, status, starts_at, published_at, series_id, occurrence_date)
         VALUES ($1::uuid, 'zz-future', 'service', 'published', '2099-01-11T00:00:00Z', now(), $2::uuid, '2099-01-11') RETURNING id`,
        w.churchA, series
      )
      await addExpense(tx, w.churchA, future.id)
      await asPrincipal(tx, w.eventsTeam.accountId)

      await del(tx, series)

      expect(await seriesRow(tx, series)).toBeUndefined()
      expect(await eventRow(tx, future.id)).toMatchObject({ series_id: null })
    })
  })
})

describe.skipIf(!hasDatabase())('delete_event_series — who may, and safe repeats', () => {
  it('refuses a member who is not Events Team, and an Events Team member of another church', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      const series = await makeSeries(tx, w.churchA, { startsOn: '2026-01-04', weekday: w.today.dow })
      for (const account of [w.plainMember, w.eventsTeamB]) {
        await asPrincipal(tx, account.accountId)
        const msg = await refusalMessage(tx, () => del(tx, series))
        expect(isAuthorizationFailure(msg)).toBe(true)
      }
    })
  })

  it('does nothing the second time — a retry after a lost reply is harmless', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      const series = await makeSeries(tx, w.churchA, { startsOn: '2026-01-04', weekday: w.today.dow })
      const upcoming = await makeOccurrence(tx, w.churchA, series, `now() + interval '10 days'`)
      await addExpense(tx, w.churchA, upcoming)
      await asPrincipal(tx, w.eventsTeam.accountId)

      const first = await del(tx, series)
      const before = await seriesRow(tx, series)
      const second = await del(tx, series)
      const after = await seriesRow(tx, series)

      expect(first.already_deleted).toBe(false)
      expect(second.already_deleted).toBe(true)
      expect(after).toEqual(before)
      expect(await eventRow(tx, upcoming)).toMatchObject({ series_id: null })
    })
  })

  it('leaves everything unchanged when the last step fails', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      const series = await makeSeries(tx, w.churchA, { startsOn: '2026-01-04', weekday: w.today.dow })
      const upcoming = await makeOccurrence(tx, w.churchA, series, `now() + interval '10 days'`)
      await addExpense(tx, w.churchA, upcoming)
      // Break the final write: any update to the series row now raises.
      await tx.$executeRawUnsafe(
        `CREATE FUNCTION pg_temp.zz_boom() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'zz forced failure'; END $$`
      )
      await tx.$executeRawUnsafe(
        `CREATE TRIGGER zz_boom BEFORE UPDATE ON public.event_series FOR EACH ROW EXECUTE FUNCTION pg_temp.zz_boom()`
      )
      await asPrincipal(tx, w.eventsTeam.accountId)

      const msg = await refusalMessage(tx, () => del(tx, series))

      expect(msg).toMatch(/zz forced failure/)
      expect(await eventRow(tx, upcoming)).toMatchObject({ series_id: series })
      expect((await seriesRow(tx, series)).deleted_at).toBeNull()
    })
  })
})

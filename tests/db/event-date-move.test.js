// Moving a single event to another date (#105 rules 3–6), owner decisions of 2026-10-05:
//   * a PAST event (start time already passed, database clock) with 11 or more attendance
//     records cannot move; 10 or fewer can. The count is current + history, members + guests,
//     so clearing current attendance cannot bypass the lock
//   * moving to a different calendar day (Asia/Manila) files the old attendance as history: the
//     old check-in service is kept, marked history and closed; nothing is copied or deleted.
//     A service with no attendance is simply removed. Attendance starts fresh for the new date
//   * a time-only change on the same day keeps attendance as it is
//   * nobody can add attendance to a history service
// One trigger on events does this, so it happens in the same transaction as the move itself.
//
// Runs against a real database inside a rolled-back transaction (`npm run test:db`).

import { describe, it, expect, afterAll } from 'vitest'
import {
  hasDatabase, withRollback, asPrincipal, refusalMessage,
  isAuthorizationFailure, disconnect,
} from './helpers/database.js'
import { makeChurch, makePrincipal, addToGroup, findSystemMinistry } from './helpers/fixtures.js'

afterAll(disconnect)

/** `when` is a SQL timestamptz expression. */
async function makeEvent (tx, churchId, when) {
  const [row] = await tx.$queryRawUnsafe(
    `INSERT INTO public.events (church_id, title, kind, status, starts_at, published_at)
     VALUES ($1::uuid, 'zz-event', 'special_service', 'published', ${when}, now()) RETURNING id`,
    churchId
  )
  return row.id
}

async function makeService (tx, churchId, eventId, { history = false } = {}) {
  const [svc] = await tx.$queryRawUnsafe(
    `INSERT INTO public.services (church_id, label, opens_at, closes_at, event_id, history_at)
     VALUES ($1::uuid, $3, now() - interval '3 hours', now() - interval '1 hour', $2::uuid,
             ${history ? 'now()' : 'NULL'}) RETURNING id`,
    churchId, eventId, `zz-svc-${Math.random().toString(36).slice(2, 10)}`
  )
  return svc.id
}

async function addAttendance (tx, churchId, serviceId, n) {
  for (let i = 0; i < n; i++) {
    await tx.$executeRawUnsafe(
      `INSERT INTO public.attendance (service_id, church_id, guest_name, source) VALUES ($1::uuid, $2::uuid, $3, 'self')`,
      serviceId, churchId, `zz-guest-${i}`
    )
  }
}

const fileAsHistory = (tx, serviceId) =>
  tx.$executeRawUnsafe(`UPDATE public.services SET history_at = now() WHERE id = $1::uuid`, serviceId)

async function world (tx) {
  const churchA = await makeChurch(tx, 'a')
  const eventsMinistry = await findSystemMinistry(tx, 'events')
  const eventsTeam = await makePrincipal(tx, { role: 'member', churchId: churchA })
  await addToGroup(tx, eventsMinistry, eventsTeam.memberId)
  return { churchA, eventsTeam }
}

const moveBy = (tx, eventId, interval) =>
  tx.$executeRawUnsafe(
    `UPDATE public.events SET starts_at = starts_at + interval '${interval}' WHERE id = $1::uuid`,
    eventId
  )

const serviceRow = async (tx, id) =>
  (await tx.$queryRawUnsafe(`SELECT id, event_id, history_at, closes_at FROM public.services WHERE id = $1::uuid`, id))[0]

const attendanceOn = async (tx, serviceId) =>
  (await tx.$queryRawUnsafe(`SELECT count(*)::int AS n FROM public.attendance WHERE service_id = $1::uuid`, serviceId))[0].n

describe.skipIf(!hasDatabase())('moving a past event — the 11-record lock', () => {
  it('refuses to move a past event with 11 attendance records', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      const ev = await makeEvent(tx, w.churchA, `now() - interval '3 days'`)
      await addAttendance(tx, w.churchA, await makeService(tx, w.churchA, ev), 11)
      await asPrincipal(tx, w.eventsTeam.accountId)

      const msg = await refusalMessage(tx, () => moveBy(tx, ev, '1 day'))
      expect(msg).toMatch(/11 or more attendance records/)
    })
  })

  it('lets a past event with 10 records move, filing its attendance as history', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      const ev = await makeEvent(tx, w.churchA, `now() - interval '3 days'`)
      const svc = await makeService(tx, w.churchA, ev)
      await addAttendance(tx, w.churchA, svc, 10)
      await asPrincipal(tx, w.eventsTeam.accountId)

      await moveBy(tx, ev, '1 day')

      const s = await serviceRow(tx, svc)
      expect(s.event_id).toBe(ev)          // still linked to its event
      expect(s.history_at).not.toBeNull()  // but filed as history
      expect(await attendanceOn(tx, svc)).toBe(10) // nothing copied or deleted
    })
  })

  it('stays locked when the 11 records are already history, even with no current attendance', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      const ev = await makeEvent(tx, w.churchA, `now() - interval '3 days'`)
      const old = await makeService(tx, w.churchA, ev)
      await addAttendance(tx, w.churchA, old, 11)
      await fileAsHistory(tx, old)
      await asPrincipal(tx, w.eventsTeam.accountId)

      const msg = await refusalMessage(tx, () => moveBy(tx, ev, '1 day'))
      expect(msg).toMatch(/11 or more attendance records/)
    })
  })

  it('does not lock an upcoming event, whatever its count', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      const ev = await makeEvent(tx, w.churchA, `now() + interval '3 days'`)
      await addAttendance(tx, w.churchA, await makeService(tx, w.churchA, ev), 11)
      await asPrincipal(tx, w.eventsTeam.accountId)

      await moveBy(tx, ev, '1 day')
      const [row] = await tx.$queryRawUnsafe(`SELECT starts_at > now() + interval '3 days' AS moved FROM public.events WHERE id = $1::uuid`, ev)
      expect(row.moved).toBe(true)
    })
  })
})

describe.skipIf(!hasDatabase())('moving an event — what happens to attendance', () => {
  it('keeps attendance current when only the time changes on the same day', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      // 12:00 Manila tomorrow, moved to 13:00 the same day.
      const ev = await makeEvent(tx, w.churchA,
        `(((now() AT TIME ZONE 'Asia/Manila')::date + 1 + time '12:00') AT TIME ZONE 'Asia/Manila')`)
      const svc = await makeService(tx, w.churchA, ev)
      await addAttendance(tx, w.churchA, svc, 2)
      await asPrincipal(tx, w.eventsTeam.accountId)

      await moveBy(tx, ev, '1 hour')

      expect((await serviceRow(tx, svc)).history_at).toBeNull()
    })
  })

  it('removes an empty check-in service when the date changes, so a fresh one is made for the new date', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      const ev = await makeEvent(tx, w.churchA, `now() + interval '3 days'`)
      const svc = await makeService(tx, w.churchA, ev)
      await asPrincipal(tx, w.eventsTeam.accountId)

      await moveBy(tx, ev, '2 days')

      expect(await serviceRow(tx, svc)).toBeUndefined()
    })
  })

  it('refuses new attendance on a history service', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      const ev = await makeEvent(tx, w.churchA, `now() - interval '3 days'`)
      const svc = await makeService(tx, w.churchA, ev, { history: true })

      const msg = await refusalMessage(tx, () => addAttendance(tx, w.churchA, svc, 1))
      expect(msg).toMatch(/history/)
    })
  })

  it('refuses deleting attendance from a history service, so the lock cannot be cleared away', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      const ev = await makeEvent(tx, w.churchA, `now() - interval '3 days'`)
      const svc = await makeService(tx, w.churchA, ev)
      await addAttendance(tx, w.churchA, svc, 2)
      await tx.$executeRawUnsafe(`UPDATE public.services SET history_at = now() WHERE id = $1::uuid`, svc)

      const msg = await refusalMessage(tx, () =>
        tx.$executeRawUnsafe(`DELETE FROM public.attendance WHERE service_id = $1::uuid`, svc))
      expect(msg).toMatch(/history/)
      expect(await attendanceOn(tx, svc)).toBe(2)
    })
  })

  it('leaves the event and its attendance unchanged when filing history fails', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      const ev = await makeEvent(tx, w.churchA, `now() - interval '3 days'`)
      const svc = await makeService(tx, w.churchA, ev)
      await addAttendance(tx, w.churchA, svc, 3)
      await tx.$executeRawUnsafe(
        `CREATE FUNCTION pg_temp.zz_boom() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'zz forced failure'; END $$`
      )
      await tx.$executeRawUnsafe(
        `CREATE TRIGGER zz_boom BEFORE UPDATE ON public.services FOR EACH ROW EXECUTE FUNCTION pg_temp.zz_boom()`
      )
      await asPrincipal(tx, w.eventsTeam.accountId)

      const msg = await refusalMessage(tx, () => moveBy(tx, ev, '1 day'))

      expect(msg).toMatch(/zz forced failure/)
      const [row] = await tx.$queryRawUnsafe(`SELECT starts_at < now() - interval '2 days' AS unmoved FROM public.events WHERE id = $1::uuid`, ev)
      expect(row.unmoved).toBe(true)
      expect((await serviceRow(tx, svc)).history_at).toBeNull()
    })
  })
})

describe.skipIf(!hasDatabase())('event_edit_state — what the edit screen asks before offering a change', () => {
  it('reports past, the counts, and the lock for a saved event', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      const ev = await makeEvent(tx, w.churchA, `now() - interval '3 days'`)
      const old = await makeService(tx, w.churchA, ev)
      await addAttendance(tx, w.churchA, old, 6)
      await fileAsHistory(tx, old)
      await addAttendance(tx, w.churchA, await makeService(tx, w.churchA, ev), 5)
      await asPrincipal(tx, w.eventsTeam.accountId)

      const [{ r }] = await tx.$queryRawUnsafe(`SELECT public.event_edit_state($1::uuid, NULL) AS r`, ev)
      expect(r).toEqual({ is_past: true, current_attendance: 5, total_attendance: 11, locked: true })
    })
  })

  it('judges an unsaved date by the start it is given, on the database clock', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      await asPrincipal(tx, w.eventsTeam.accountId)
      const [{ past }] = await tx.$queryRawUnsafe(`SELECT public.event_edit_state(NULL, now() - interval '1 minute') AS past`)
      const [{ future }] = await tx.$queryRawUnsafe(`SELECT public.event_edit_state(NULL, now() + interval '1 minute') AS future`)
      expect(past).toEqual({ is_past: true, current_attendance: 0, total_attendance: 0, locked: false })
      expect(future.is_past).toBe(false)
    })
  })

  it('refuses a caller who cannot manage events', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      const ev = await makeEvent(tx, w.churchA, `now() - interval '3 days'`)
      const plain = await makePrincipal(tx, { role: 'member', churchId: w.churchA })
      await asPrincipal(tx, plain.accountId)
      const msg = await refusalMessage(tx, () => tx.$queryRawUnsafe(`SELECT public.event_edit_state($1::uuid, NULL)`, ev))
      expect(isAuthorizationFailure(msg)).toBe(true)
    })
  })
})

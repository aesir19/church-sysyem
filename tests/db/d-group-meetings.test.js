// Leaders' Group meetings (docs/specs/d-group-leader-view.md, Phase 2) — the database
// contract. The rules, agreed with the owner on 2026-10-16:
//
//   * a Group meeting belongs to one D-Group; only that group's leaders create one
//   * the group's leaders, the Events Team and SuperAdmin edit, cancel and remove it
//   * delete only before the meeting starts; afterwards it can be cancelled, not deleted
//   * it is seen ONLY by the group's members and leaders, the Events Team and SuperAdmin —
//     meetings are often in a member's home, so a pastor or another group sees nothing
//   * repeating meetings use the existing series tools, widened to the group's leaders
//   * Group meetings made before 0056 have no group and stay as they were
//
// Runs the candidate migration inside a rolled-back transaction (`npm run test:db`).

import { describe, it, expect, afterAll } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import {
  hasDatabase, withRollback, asPrincipal, asOwner, asAnon, refusalMessage, isAuthorizationFailure, disconnect
} from './helpers/database.js'
import { makeChurch, makePrincipal, makeDGroup, addToGroup, findSystemMinistry } from './helpers/fixtures.js'

afterAll(disconnect)

const CANDIDATE = '0056_d_group_meetings'
async function candidate (tx) {
  const path = new URL(`../../prisma/migrations/${CANDIDATE}/migration.sql`, import.meta.url)
  if (!existsSync(path)) return
  const [applied] = await tx.$queryRawUnsafe(
    'SELECT EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name = $1 AND finished_at IS NOT NULL) AS done', CANDIDATE)
  if (applied.done) return
  const sql = readFileSync(path, 'utf8').replace(/^BEGIN;\s*/m, '').replace(/^COMMIT;\s*/m, '')
  await tx.$executeRawUnsafe(`DO $candidate$ BEGIN EXECUTE $migration$${sql}$migration$; END $candidate$;`)
}

// One church, two D-Groups, and everyone whose access differs.
async function world (tx) {
  await candidate(tx)
  const church = await makeChurch(tx)
  const group = await makeDGroup(tx, church, 'mine')
  const otherGroup = await makeDGroup(tx, church, 'other')

  const leader = await makePrincipal(tx, { role: 'member', churchId: church })
  const otherLeader = await makePrincipal(tx, { role: 'member', churchId: church })
  for (const [p, g] of [[leader, group], [otherLeader, otherGroup]]) {
    await tx.$executeRawUnsafe(
      'INSERT INTO public.small_group_leaders (account_id, group_id) VALUES ($1::uuid, $2::uuid)', p.accountId, g)
  }
  const groupMember = await makePrincipal(tx, { role: 'member', churchId: church })
  await addToGroup(tx, group, groupMember.memberId)
  const outsider = await makePrincipal(tx, { role: 'member', churchId: church })
  await addToGroup(tx, otherGroup, outsider.memberId)
  const pastor = await makePrincipal(tx, { role: 'pastor', churchId: church })
  const admin = await makePrincipal(tx, { role: 'super_admin', churchId: church })
  const eventsTeam = await makePrincipal(tx, { role: 'member', churchId: church })
  await addToGroup(tx, await findSystemMinistry(tx, 'events'), eventsTeam.memberId)

  return { church, group, otherGroup, leader, otherLeader, groupMember, outsider, pastor, admin, eventsTeam }
}

// A meeting written as `who` through RLS, the way the app writes it. `when` is SQL.
async function createMeeting (tx, who, { church, group, when = "now() + interval '3 days'", kind = 'group_meeting' }) {
  await asPrincipal(tx, who.accountId)
  const [row] = await tx.$queryRawUnsafe(
    `INSERT INTO public.events (church_id, title, kind, status, starts_at, published_at, location, small_group_id)
     VALUES ($1::uuid, 'zz-meeting', $2, 'published', ${when}, now(), 'zz-home-address', $3::uuid)
     RETURNING id`, church, kind, group)
  await asOwner(tx)
  return row.id
}

// The same, but built as the owner — for testing reads and deletes of a meeting that exists.
async function seedMeeting (tx, { church, group, when = "now() + interval '3 days'" }) {
  const [row] = await tx.$queryRawUnsafe(
    `INSERT INTO public.events (church_id, title, kind, status, starts_at, published_at, location, small_group_id)
     VALUES ($1::uuid, 'zz-meeting', 'group_meeting', 'published', ${when}, now(), 'zz-home-address', $2::uuid)
     RETURNING id`, church, group)
  return row.id
}

async function seedSeries (tx, { church, group }) {
  const [row] = await tx.$queryRawUnsafe(
    `INSERT INTO public.event_series
       (church_id, title, kind, status, cadence, weekday, time_start, starts_on, published_at, location, small_group_id)
     VALUES ($1::uuid, 'zz-weekly', 'group_meeting', 'published', 'weekly',
             extract(dow FROM (now() AT TIME ZONE 'Asia/Manila'))::int, '19:30', current_date, now(), 'zz-home-address', $2::uuid)
     RETURNING id`, church, group)
  return row.id
}

async function sees (tx, who, table, id) {
  await asPrincipal(tx, who.accountId)
  const rows = await tx.$queryRawUnsafe(`SELECT id FROM public.${table} WHERE id = $1::uuid`, id)
  await asOwner(tx)
  return rows.length === 1
}

async function refused (tx, who, statement, ...params) {
  await asPrincipal(tx, who.accountId)
  const message = await refusalMessage(tx, () => tx.$executeRawUnsafe(statement, ...params))
  await asOwner(tx)
  return message
}

// An UPDATE or DELETE that RLS filters out affects no rows rather than raising.
async function affected (tx, who, statement, ...params) {
  await asPrincipal(tx, who.accountId)
  const n = await tx.$executeRawUnsafe(statement, ...params)
  await asOwner(tx)
  return n
}

describe.skipIf(!hasDatabase())('Group meetings — database contract', () => {
  it('lets a leader create a meeting for their own group, and nobody else create one', async () => {
    await withRollback(async tx => {
      const w = await world(tx)
      expect(await createMeeting(tx, w.leader, w)).toBeTruthy()

      const insert = `INSERT INTO public.events (church_id, title, kind, status, starts_at, published_at, small_group_id)
                      VALUES ($1::uuid, 'zz', 'group_meeting', 'published', now() + interval '1 day', now(), $2::uuid)`
      for (const who of [w.otherLeader, w.eventsTeam, w.admin, w.groupMember, w.pastor]) {
        expect(isAuthorizationFailure(await refused(tx, who, insert, w.church, w.group))).toBe(true)
      }
    })
  })

  it('keeps the meeting tied to a group, and the group to its own kind', async () => {
    await withRollback(async tx => {
      const w = await world(tx)
      // A new Group meeting must name its group; only a Group meeting may name one.
      expect(await refusalMessage(tx, () => tx.$executeRawUnsafe(
        `INSERT INTO public.events (church_id, title, kind, status, starts_at)
         VALUES ($1::uuid, 'zz', 'group_meeting', 'draft', now())`, w.church))).toMatch(/group_meeting_needs_group|check/i)
      expect(await refusalMessage(tx, () => tx.$executeRawUnsafe(
        `INSERT INTO public.events (church_id, title, kind, status, starts_at, small_group_id)
         VALUES ($1::uuid, 'zz', 'outreach', 'draft', now(), $2::uuid)`, w.church, w.group))).toMatch(/only_group_meetings_have_group|check/i)
      // A leader cannot turn their meeting into another kind of event.
      const id = await createMeeting(tx, w.leader, w)
      expect(await refused(tx, w.leader, `UPDATE public.events SET kind = 'outreach', small_group_id = NULL WHERE id = $1::uuid`, id))
        .toMatch(/row-level security|check/i)
    })
  })

  it('shows a meeting only to its group, its leaders, the Events Team and SuperAdmin', async () => {
    await withRollback(async tx => {
      const w = await world(tx)
      const id = await seedMeeting(tx, w)
      for (const who of [w.leader, w.groupMember, w.eventsTeam, w.admin]) expect(await sees(tx, who, 'events', id)).toBe(true)
      for (const who of [w.otherLeader, w.outsider, w.pastor]) expect(await sees(tx, who, 'events', id)).toBe(false)
      // Signed out: no grant on events at all (0032), so the read is refused outright.
      await asAnon(tx)
      expect(isAuthorizationFailure(await refusalMessage(tx, () =>
        tx.$queryRawUnsafe('SELECT id FROM public.events WHERE id = $1::uuid', id)))).toBe(true)
      await asOwner(tx)
    })
  })

  it('lets the group’s leaders, the Events Team and SuperAdmin edit or cancel it, and nobody else', async () => {
    await withRollback(async tx => {
      const w = await world(tx)
      const id = await seedMeeting(tx, w)
      const cancel = `UPDATE public.events SET status = 'cancelled', cancel_reason = 'zz' WHERE id = $1::uuid`
      for (const who of [w.otherLeader, w.groupMember, w.pastor]) expect(await affected(tx, who, cancel, id)).toBe(0)
      for (const who of [w.leader, w.eventsTeam, w.admin]) expect(await affected(tx, who, cancel, id)).toBe(1)
      // Moving it to a group they don't lead is refused.
      expect(await refused(tx, w.leader, 'UPDATE public.events SET small_group_id = $2::uuid WHERE id = $1::uuid', id, w.otherGroup))
        .toMatch(/row-level security/i)
    })
  })

  it('allows delete only before the meeting starts', async () => {
    await withRollback(async tx => {
      const w = await world(tx)
      const del = 'DELETE FROM public.events WHERE id = $1::uuid'
      for (const who of [w.leader, w.eventsTeam, w.admin]) {
        const past = await seedMeeting(tx, { ...w, when: "now() - interval '1 day'" })
        expect(await affected(tx, who, del, past)).toBe(0)
        const upcoming = await seedMeeting(tx, w)
        expect(await affected(tx, who, del, upcoming)).toBe(1)
      }
      expect(await affected(tx, w.otherLeader, del, await seedMeeting(tx, w))).toBe(0)
    })
  })

  it('treats a repeating meeting the same way, through the series tools', async () => {
    await withRollback(async tx => {
      const w = await world(tx)
      // The leader creates the series through RLS.
      await asPrincipal(tx, w.leader.accountId)
      const [{ id: series }] = await tx.$queryRawUnsafe(
        `INSERT INTO public.event_series
           (church_id, title, kind, status, cadence, weekday, time_start, starts_on, published_at, small_group_id)
         VALUES ($1::uuid, 'zz-weekly', 'group_meeting', 'published', 'weekly', 4, '19:30', current_date, now(), $2::uuid)
         RETURNING id`, w.church, w.group)
      await asOwner(tx)

      for (const who of [w.leader, w.groupMember, w.eventsTeam]) expect(await sees(tx, who, 'event_series', series)).toBe(true)
      for (const who of [w.outsider, w.pastor, w.otherLeader]) expect(await sees(tx, who, 'event_series', series)).toBe(false)

      // A moved date is saved as its own row; it inherits the group, so it stays private.
      await asPrincipal(tx, w.leader.accountId)
      const [{ id: moved }] = await tx.$queryRawUnsafe(
        `INSERT INTO public.events (church_id, title, kind, status, starts_at, published_at, series_id, occurrence_date)
         VALUES ($1::uuid, 'zz-weekly', 'group_meeting', 'published', now() + interval '8 days', now(), $2::uuid,
                 (now() AT TIME ZONE 'Asia/Manila')::date + 7)
         RETURNING id`, w.church, series)
      await asOwner(tx)
      expect(await sees(tx, w.groupMember, 'events', moved)).toBe(true)
      expect(await sees(tx, w.outsider, 'events', moved)).toBe(false)

      // The series tools answer the group's leader and refuse another group's.
      await asPrincipal(tx, w.otherLeader.accountId)
      expect(isAuthorizationFailure(await refusalMessage(tx, () =>
        tx.$queryRawUnsafe('SELECT public.preview_delete_event_series($1::uuid)', series)))).toBe(true)
      await asPrincipal(tx, w.leader.accountId)
      const [{ r }] = await tx.$queryRawUnsafe('SELECT public.delete_event_series($1::uuid) AS r', series)
      expect(r.already_deleted).toBe(false)
      await asOwner(tx)
    })
  })

  it('opens the series split preview to the group’s leader only', async () => {
    await withRollback(async tx => {
      const w = await world(tx)
      const series = await seedSeries(tx, w)
      const preview = () => tx.$queryRawUnsafe(
        `SELECT public.preview_split_event_series($1::uuid, (now() AT TIME ZONE 'Asia/Manila')::date + 7)`, series)
      await asPrincipal(tx, w.leader.accountId)
      await preview()
      await asPrincipal(tx, w.otherLeader.accountId)
      expect(isAuthorizationFailure(await refusalMessage(tx, preview))).toBe(true)
      await asOwner(tx)
    })
  })

  // Group meetings made before 0056 have no group. The visibility rule keys on the group,
  // so a row without one follows the old rule — the same path every ordinary event takes,
  // which is what this checks. (Such rows cannot be rebuilt here: the new check covers
  // every insert, and they only exist as history.)
  it('leaves ordinary church events exactly as they were', async () => {
    await withRollback(async tx => {
      const w = await world(tx)
      await asPrincipal(tx, w.eventsTeam.accountId)
      const [{ id }] = await tx.$queryRawUnsafe(
        `INSERT INTO public.events (church_id, title, kind, status, starts_at, published_at)
         VALUES ($1::uuid, 'zz-outreach', 'outreach', 'published', now() + interval '1 day', now()) RETURNING id`, w.church)
      await asOwner(tx)
      for (const who of [w.outsider, w.pastor, w.leader]) expect(await sees(tx, who, 'events', id)).toBe(true)
      expect(await affected(tx, w.leader, `UPDATE public.events SET title = 'zz-x' WHERE id = $1::uuid`, id)).toBe(0)
    })
  })
})

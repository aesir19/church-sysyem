import { describe, it, expect, afterAll } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { hasDatabase, withRollback, asPrincipal, asOwner, disconnect } from './helpers/database.js'
import { makeChurch, makeMember, makePrincipal, makeDGroup, addToGroup } from './helpers/fixtures.js'

afterAll(disconnect)

// The D-Group leader dashboard's one read (docs/specs/d-group-leader-view.md, Phase 1).
// Runs the candidate migration inside the rolled-back transaction, so nothing is
// deployed; once staging has applied it, the candidate step is skipped.
const CANDIDATE = '0055_d_group_dashboard'
async function candidate (tx) {
  const path = new URL(`../../prisma/migrations/${CANDIDATE}/migration.sql`, import.meta.url)
  if (!existsSync(path)) return
  const [applied] = await tx.$queryRawUnsafe(
    'SELECT EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name = $1 AND finished_at IS NOT NULL) AS done', CANDIDATE)
  if (applied.done) return
  const sql = readFileSync(path, 'utf8').replace(/^BEGIN;\s*/m, '').replace(/^COMMIT;\s*/m, '')
  await tx.$executeRawUnsafe(`DO $candidate$ BEGIN EXECUTE $migration$${sql}$migration$; END $candidate$;`)
}

async function dashboard (tx, accountId) {
  await asPrincipal(tx, accountId)
  const [row] = await tx.$queryRawUnsafe('SELECT public.d_group_dashboard() AS d')
  await asOwner(tx)
  return row.d
}

async function makeLeader (tx, churchId, ...groupIds) {
  const leader = await makePrincipal(tx, { role: 'member', churchId })
  for (const groupId of groupIds) {
    await tx.$executeRawUnsafe(
      'INSERT INTO public.small_group_leaders (account_id, group_id) VALUES ($1::uuid, $2::uuid)',
      leader.accountId, groupId)
  }
  return leader
}

// A Sunday `weeksAgo` weeks before the current Manila week, 09:00 Manila.
async function makeSunday (tx, churchId, weeksAgo, { label = 'Sunday Service', cancelled = false } = {}) {
  const [row] = await tx.$queryRawUnsafe(
    `INSERT INTO public.services (church_id, label, opens_at, closes_at)
     SELECT $1::uuid, $2, t, t + CASE WHEN $4 THEN interval '0' ELSE interval '3 hours' END
     FROM (SELECT ((date_trunc('week', now() AT TIME ZONE 'Asia/Manila')::date - 1 - 7 * $3::int)
                   + time '09:00') AT TIME ZONE 'Asia/Manila' AS t) s
     RETURNING id`,
    churchId, label, weeksAgo, cancelled)
  return row.id
}

async function attend (tx, churchId, serviceId, memberId) {
  await tx.$executeRawUnsafe(
    `INSERT INTO public.attendance (service_id, church_id, member_id, source) VALUES ($1::uuid, $2::uuid, $3::uuid, 'self')`,
    serviceId, churchId, memberId)
}

// One published event `daysFromNow` days away with one role filled by `memberId`.
// `lastDayOfWeek` places it at 20:00 Manila on this week's Sunday instead.
async function serve (tx, churchId, memberId, { daysFromNow = 0, lastDayOfWeek = false, status = 'confirmed', eventStatus = 'published', role = 'Ushering' }) {
  const [event] = await tx.$queryRawUnsafe(
    `INSERT INTO public.events (church_id, title, kind, status, starts_at, published_at)
     VALUES ($1::uuid, 'zz-test event', 'outreach', $2,
             CASE WHEN $4 THEN ((date_trunc('week', now() AT TIME ZONE 'Asia/Manila')::date + 6) + time '20:00') AT TIME ZONE 'Asia/Manila'
                  ELSE now() + make_interval(days => $3::int) END,
             CASE WHEN $2 = 'published' THEN now() END)
     RETURNING id`, churchId, eventStatus, daysFromNow, lastDayOfWeek)
  const [roleRow] = await tx.$queryRawUnsafe(
    'INSERT INTO public.event_roles (church_id, event_id, label) VALUES ($1::uuid, $2::uuid, $3) RETURNING id',
    churchId, event.id, role)
  await tx.$executeRawUnsafe(
    `INSERT INTO public.event_assignments (church_id, event_id, role_id, member_id, status)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5)`,
    churchId, event.id, roleRow.id, memberId, status)
}

const memberIds = d => d.members.map(m => m.member_id)
const memberRow = (d, id) => d.members.find(m => m.member_id === id)

describe.skipIf(!hasDatabase())('D-Group dashboard — database contract', () => {
  it('returns only the groups the caller leads, and nothing to a non-leader', async () => {
    await withRollback(async tx => {
      await candidate(tx)
      const church = await makeChurch(tx)
      const mine = await makeDGroup(tx, church, 'mine')
      const theirs = await makeDGroup(tx, church, 'theirs')
      const inMine = await makeMember(tx, church)
      const inTheirs = await makeMember(tx, church)
      await addToGroup(tx, mine, inMine)
      await addToGroup(tx, theirs, inTheirs)
      const leader = await makeLeader(tx, church, mine)
      const pastor = await makePrincipal(tx, { role: 'pastor', churchId: church })

      const d = await dashboard(tx, leader.accountId)
      expect(d.groups.map(g => g.id)).toEqual([mine])
      expect(memberIds(d)).toEqual([inMine])

      const none = await dashboard(tx, pastor.accountId)
      expect(none.groups).toEqual([])
      expect(none.members).toEqual([])
    })
  })

  it('combines every group a multi-group leader leads, and leaves out archived members', async () => {
    await withRollback(async tx => {
      await candidate(tx)
      const church = await makeChurch(tx)
      const a = await makeDGroup(tx, church, 'a')
      const b = await makeDGroup(tx, church, 'b')
      const inA = await makeMember(tx, church)
      const inB = await makeMember(tx, church)
      const archived = await makeMember(tx, church)
      await addToGroup(tx, a, inA)
      await addToGroup(tx, b, inB)
      await addToGroup(tx, b, archived)
      await tx.$executeRawUnsafe('UPDATE public.members SET archived_at = now() WHERE id = $1::uuid', archived)
      const leader = await makeLeader(tx, church, a, b)

      const d = await dashboard(tx, leader.accountId)
      expect(new Set(d.groups.map(g => g.id))).toEqual(new Set([a, b]))
      expect(new Set(memberIds(d))).toEqual(new Set([inA, inB]))
      expect(memberRow(d, inB).group_id).toBe(b)
    })
  })

  it('returns nothing to a leader whose account is disabled', async () => {
    await withRollback(async tx => {
      await candidate(tx)
      const church = await makeChurch(tx)
      const group = await makeDGroup(tx, church)
      await addToGroup(tx, group, await makeMember(tx, church))
      const leader = await makeLeader(tx, church, group)
      await tx.$executeRawUnsafe('UPDATE public.user_accounts SET archive_disabled_at = now() WHERE id = $1::uuid', leader.accountId)

      const d = await dashboard(tx, leader.accountId)
      expect(d.groups).toEqual([])
      expect(d.members).toEqual([])
    })
  })

  it('exposes no contact details, address or birth year', async () => {
    await withRollback(async tx => {
      await candidate(tx)
      const church = await makeChurch(tx)
      const group = await makeDGroup(tx, church)
      const member = await makeMember(tx, church)
      await tx.$executeRawUnsafe(
        `UPDATE public.members SET address = 'zz-secret street', email = 'zz@secret.test', contact_number = '0999'
         WHERE id = $1::uuid`, member)
      await addToGroup(tx, group, member)
      const leader = await makeLeader(tx, church, group)

      const d = await dashboard(tx, leader.accountId)
      const row = memberRow(d, member)
      expect(Object.keys(row).sort()).toEqual([
        'attendance', 'birth_day', 'birth_month', 'group_id', 'is_baptized',
        'is_one_to_one_completed', 'is_turning_point_completed', 'joined_at', 'member_id',
        'name', 'served_recent', 'serving_this_week'
      ])
      expect(row.birth_month).toBe(1)
      expect(row.birth_day).toBe(1)
      expect(JSON.stringify(d)).not.toMatch(/zz-secret|zz@secret|0999|1990/)
    })
  })

  it('marks the last four Sunday services present, missed, or not yet in group', async () => {
    await withRollback(async tx => {
      await candidate(tx)
      const church = await makeChurch(tx)
      const group = await makeDGroup(tx, church)
      // Five Sundays, oldest first; only the last four count. A cancelled Sunday and a
      // non-Sunday service are not Sunday services.
      const sundays = []
      for (const weeksAgo of [4, 3, 2, 1, 0]) sundays.push(await makeSunday(tx, church, weeksAgo))
      await makeSunday(tx, church, 0, { label: 'Typhoon', cancelled: true })
      await tx.$executeRawUnsafe(
        `INSERT INTO public.services (church_id, label, opens_at, closes_at)
         VALUES ($1::uuid, 'Midweek', now() - interval '2 days', now() - interval '1 day')`, church)
      const [, s1, s2, s3, s4] = sundays

      const veteran = await makeMember(tx, church)
      const newcomer = await makeMember(tx, church)
      await addToGroup(tx, group, veteran)
      await addToGroup(tx, group, newcomer)
      // The veteran predates the dates (as every existing membership will); the
      // newcomer joined after the second-to-last of the four.
      await tx.$executeRawUnsafe('UPDATE public.small_group_members SET joined_at = NULL WHERE member_id = $1::uuid', veteran)
      await tx.$executeRawUnsafe(
        `UPDATE public.small_group_members SET joined_at = (SELECT opens_at + interval '1 day' FROM public.services WHERE id = $2::uuid)
         WHERE member_id = $1::uuid`, newcomer, s2)
      await attend(tx, church, s1, veteran)
      await attend(tx, church, s4, veteran)
      await attend(tx, church, s4, newcomer)
      const leader = await makeLeader(tx, church, group)

      const d = await dashboard(tx, leader.accountId)
      expect(d.services.map(s => s.id)).toEqual([s1, s2, s3, s4])
      const statuses = id => memberRow(d, id).attendance.map(a => a.status)
      expect(statuses(veteran)).toEqual(['present', 'missed', 'missed', 'present'])
      expect(statuses(newcomer)).toEqual(['not_in_group', 'not_in_group', 'missed', 'present'])
    })
  })

  // A service still open for check-in would mark everyone "missed" mid-service. A
  // services row stays open at most 24 hours (0013), so an open SUNDAY service can only
  // be built on a Manila Sunday; other days this runs as skipped rather than pretending.
  const manilaSunday = new Date(Date.now() + 8 * 3_600_000).getUTCDay() === 0
  it.runIf(manilaSunday)('leaves out a Sunday service whose check-in is still open', async () => {
    await withRollback(async tx => {
      await candidate(tx)
      const church = await makeChurch(tx)
      const group = await makeDGroup(tx, church)
      const closed = await makeSunday(tx, church, 1)
      const [open] = await tx.$queryRawUnsafe(
        `INSERT INTO public.services (church_id, label, opens_at, closes_at)
         VALUES ($1::uuid, 'Sunday Service', now() - interval '1 minute', now() + interval '1 hour') RETURNING id`, church)
      await addToGroup(tx, group, await makeMember(tx, church))
      const leader = await makeLeader(tx, church, group)

      const d = await dashboard(tx, leader.accountId)
      expect(d.services.map(s => s.id)).toEqual([closed])
      expect(d.services.map(s => s.id)).not.toContain(open.id)
    })
  })

  it('counts confirmed serving in the last 90 days and lists this week’s', async () => {
    await withRollback(async tx => {
      await candidate(tx)
      const church = await makeChurch(tx)
      const group = await makeDGroup(tx, church)
      const member = await makeMember(tx, church)
      await addToGroup(tx, group, member)
      await serve(tx, church, member, { daysFromNow: -10 })
      await serve(tx, church, member, { daysFromNow: -30 })
      await serve(tx, church, member, { daysFromNow: -120 })
      await serve(tx, church, member, { daysFromNow: -5, status: 'open' })
      await serve(tx, church, member, { daysFromNow: -6, eventStatus: 'cancelled' })
      await serve(tx, church, member, { lastDayOfWeek: true, role: 'Worship team' })
      await serve(tx, church, member, { lastDayOfWeek: true, status: 'open', role: 'Parking' })
      const leader = await makeLeader(tx, church, group)

      const d = await dashboard(tx, leader.accountId)
      const row = memberRow(d, member)
      expect(row.served_recent).toBe(2)
      expect(row.serving_this_week.map(s => s.role)).toEqual(['Worship team'])
      expect(Object.keys(row.serving_this_week[0]).sort()).toEqual(['event_title', 'role', 'starts_at'])
    })
  })

  it('stamps new memberships and groups with their start date', async () => {
    await withRollback(async tx => {
      await candidate(tx)
      const church = await makeChurch(tx)
      const group = await makeDGroup(tx, church)
      const member = await makeMember(tx, church)
      await addToGroup(tx, group, member)
      const [row] = await tx.$queryRawUnsafe(
        `SELECT g.started_at IS NOT NULL AS group_dated, m.joined_at IS NOT NULL AS member_dated
         FROM public.small_groups g JOIN public.small_group_members m ON m.small_group_id = g.id
         WHERE g.id = $1::uuid`, group)
      expect(row).toEqual({ group_dated: true, member_dated: true })
    })
  })
})

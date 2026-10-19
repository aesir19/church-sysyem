// Saving one date of a repeating event — "Skip this date", "This date only", and a Group
// meeting's cancel / move / edit — writes a saved row with the app's upsert:
//
//   POST /events?on_conflict=series_id,occurrence_date   (supabase .upsert(row, { onConflict }))
//
// which PostgREST runs as INSERT … ON CONFLICT (series_id, occurrence_date) DO UPDATE. Until
// 0057 the only uniqueness on those columns was a PARTIAL index (… WHERE series_id IS NOT
// NULL), which ON CONFLICT cannot use without repeating the predicate — something PostgREST
// never sends — so every such save failed with 42P10 (found live on staging, 2026-10-16).
// These run that exact statement. Runs in a rolled-back transaction (`npm run test:db`).

import { describe, it, expect, afterAll } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { hasDatabase, withRollback, asPrincipal, asOwner, disconnect } from './helpers/database.js'
import { makeChurch, makePrincipal, makeDGroup, addToGroup, findSystemMinistry } from './helpers/fixtures.js'

afterAll(disconnect)

const CANDIDATE = '0057_event_occurrence_unique'
async function candidate (tx) {
  const path = new URL(`../../prisma/migrations/${CANDIDATE}/migration.sql`, import.meta.url)
  if (!existsSync(path)) return
  const [applied] = await tx.$queryRawUnsafe(
    'SELECT EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name = $1 AND finished_at IS NOT NULL) AS done', CANDIDATE)
  if (applied.done) return
  const sql = readFileSync(path, 'utf8').replace(/^BEGIN;\s*/m, '').replace(/^COMMIT;\s*/m, '')
  await tx.$executeRawUnsafe(`DO $candidate$ BEGIN EXECUTE $migration$${sql}$migration$; END $candidate$;`)
}

async function makeSeries (tx, churchId, { kind = 'service', groupId = null } = {}) {
  const [row] = await tx.$queryRawUnsafe(
    `INSERT INTO public.event_series
       (church_id, title, kind, status, cadence, weekday, time_start, starts_on, published_at, small_group_id)
     VALUES ($1::uuid, 'zz-series', $2, 'published', 'weekly', 4, '19:30', current_date, now(), $3::uuid)
     RETURNING id`, churchId, kind, groupId)
  return row.id
}

// The app's upsert, as PostgREST runs it.
async function saveDate (tx, accountId, { churchId, seriesId, kind, status, reason }) {
  await asPrincipal(tx, accountId)
  const rows = await tx.$queryRawUnsafe(
    `INSERT INTO public.events (church_id, series_id, occurrence_date, title, kind, status, starts_at, cancel_reason)
     VALUES ($1::uuid, $2::uuid, current_date + 7, 'zz-date', $3, $4, now() + interval '7 days', $5)
     ON CONFLICT (series_id, occurrence_date) DO UPDATE
       SET status = excluded.status, cancel_reason = excluded.cancel_reason
     RETURNING id, status, cancel_reason`, churchId, seriesId, kind, status, reason)
  await asOwner(tx)
  return rows[0]
}

describe.skipIf(!hasDatabase())('saving one date of a repeating event', () => {
  it('lets the Events team skip a date, and change it again', async () => {
    await withRollback(async tx => {
      await candidate(tx)
      const church = await makeChurch(tx)
      const team = await makePrincipal(tx, { role: 'member', churchId: church })
      await addToGroup(tx, await findSystemMinistry(tx, 'events'), team.memberId)
      const seriesId = await makeSeries(tx, church)

      const first = await saveDate(tx, team.accountId, { churchId: church, seriesId, kind: 'service', status: 'cancelled', reason: 'Typhoon' })
      const again = await saveDate(tx, team.accountId, { churchId: church, seriesId, kind: 'service', status: 'cancelled', reason: 'Typhoon signal 3' })
      expect(again.id).toBe(first.id)
      expect(again.cancel_reason).toBe('Typhoon signal 3')
    })
  })

  it('lets a group’s leader cancel one date of its repeating meeting', async () => {
    await withRollback(async tx => {
      await candidate(tx)
      const church = await makeChurch(tx)
      const group = await makeDGroup(tx, church)
      const leader = await makePrincipal(tx, { role: 'member', churchId: church })
      await tx.$executeRawUnsafe('INSERT INTO public.small_group_leaders (account_id, group_id) VALUES ($1::uuid, $2::uuid)', leader.accountId, group)
      const seriesId = await makeSeries(tx, church, { kind: 'group_meeting', groupId: group })

      const saved = await saveDate(tx, leader.accountId, { churchId: church, seriesId, kind: 'group_meeting', status: 'cancelled', reason: 'Fiesta' })
      expect(saved).toMatchObject({ status: 'cancelled', cancel_reason: 'Fiesta' })
    })
  })

  it('still allows one date per slot, and any number of one-off events', async () => {
    await withRollback(async tx => {
      await candidate(tx)
      const church = await makeChurch(tx)
      const seriesId = await makeSeries(tx, church)
      const insertDate = () => tx.$executeRawUnsafe(
        `INSERT INTO public.events (church_id, series_id, occurrence_date, title, kind, status, starts_at)
         VALUES ($1::uuid, $2::uuid, current_date + 7, 'zz', 'service', 'draft', now())`, church, seriesId)
      await insertDate()
      await tx.$executeRawUnsafe('SAVEPOINT dup')
      await expect(insertDate()).rejects.toThrow(/already exists|duplicate key|unique/i)
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT dup')
      for (let i = 0; i < 2; i++) {
        await tx.$executeRawUnsafe(
          `INSERT INTO public.events (church_id, title, kind, status, starts_at) VALUES ($1::uuid, 'zz-one-off', 'outreach', 'draft', now())`, church)
      }
    })
  })
})

// The Stage-3 (#87) write boundary, asserted against real RLS — the tests #87 calls "the
// ones that matter most". This is where rule 2 is proven, not described: every claim about
// what Events Team may and may not do is a policy/trigger/grant, and only a real database
// can tell you whether the policy actually says what the mockup promised.
//
// Each test builds its own two-church world, switches to a chosen principal, asserts, and
// rolls back (see helpers/database.js). Nothing is ever written; the suite runs on demand
// with `npm run test:db`, never in `npm test`.

import { describe, it, expect, afterAll } from 'vitest'
import {
  hasDatabase, withRollback, asPrincipal, refusalMessage,
  isAuthorizationFailure, disconnect,
} from './helpers/database.js'
import {
  makeChurch, makeMember, makePrincipal, addToGroup, findSystemMinistry,
} from './helpers/fixtures.js'

afterAll(disconnect)

async function makeEvent (tx, churchId) {
  const [row] = await tx.$queryRawUnsafe(
    `INSERT INTO public.events (church_id, title, kind, status, starts_at, published_at)
     VALUES ($1::uuid, 'zz-event', 'special_service', 'published', now() - interval '1 day', now())
     RETURNING id`,
    churchId
  )
  return row.id
}

async function makeRole (tx, churchId, eventId, { requiresFinance = false, count = 1, label = 'zz-role' } = {}) {
  const [row] = await tx.$queryRawUnsafe(
    `INSERT INTO public.event_roles (church_id, event_id, label, count_required, requires_finance)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5) RETURNING id`,
    churchId, eventId, label, count, requiresFinance
  )
  return row.id
}

/** The smallest world in which every Stage-3 boundary is observable. */
async function world (tx) {
  const churchA = await makeChurch(tx, 'a')
  const churchB = await makeChurch(tx, 'b')
  const eventsMinistry = await findSystemMinistry(tx, 'events')
  const financeMinistry = await findSystemMinistry(tx, 'finance')

  const eventsTeam = await makePrincipal(tx, { role: 'member', churchId: churchA })
  await addToGroup(tx, eventsMinistry, eventsTeam.memberId)
  const churchLeader = await makePrincipal(tx, { role: 'church_leader', churchId: churchA })
  const plainMember = await makePrincipal(tx, { role: 'member', churchId: churchA })

  const financeTarget = await makeMember(tx, churchA, 'fin')
  await addToGroup(tx, financeMinistry, financeTarget)
  const plainTarget = await makeMember(tx, churchA, 'plain')
  const memberB = await makeMember(tx, churchB, 'b')

  const eventId = await makeEvent(tx, churchA)
  const financeRole = await makeRole(tx, churchA, eventId, { requiresFinance: true, label: 'zz-count' })
  const openRole = await makeRole(tx, churchA, eventId, { requiresFinance: false, label: 'zz-usher' })

  return {
    churchA, churchB, eventsTeam, churchLeader, plainMember,
    financeTarget, plainTarget, memberB, eventId, financeRole, openRole,
  }
}

describe.skipIf(!hasDatabase())('Stage 3 — eligibility (a finance role is filled only by finance)', () => {
  it('rejects a non-finance member, however the write is shaped', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      await asPrincipal(tx, w.eventsTeam.accountId)
      const msg = await refusalMessage(tx, () => tx.$executeRawUnsafe(
        `INSERT INTO public.event_assignments (church_id, event_id, role_id, member_id, status)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'confirmed')`,
        w.churchA, w.eventId, w.financeRole, w.plainTarget
      ))
      expect(msg).toMatch(/finance/i)
    })
  })

  it('rejects a guest (a guest can never satisfy a finance role)', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      await asPrincipal(tx, w.eventsTeam.accountId)
      const msg = await refusalMessage(tx, () => tx.$executeRawUnsafe(
        `INSERT INTO public.event_assignments (church_id, event_id, role_id, guest_name, status)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'zz-guest', 'confirmed')`,
        w.churchA, w.eventId, w.financeRole
      ))
      expect(msg).toMatch(/finance/i)
    })
  })

  it('accepts a finance-team member for the finance role', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      await asPrincipal(tx, w.eventsTeam.accountId)
      const rows = await tx.$queryRawUnsafe(
        `INSERT INTO public.event_assignments (church_id, event_id, role_id, member_id, status)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'confirmed') RETURNING id`,
        w.churchA, w.eventId, w.financeRole, w.financeTarget
      )
      expect(rows).toHaveLength(1)
    })
  })

  it('accepts any member for a non-finance role', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      await asPrincipal(tx, w.eventsTeam.accountId)
      const rows = await tx.$queryRawUnsafe(
        `INSERT INTO public.event_assignments (church_id, event_id, role_id, member_id, status)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'confirmed') RETURNING id`,
        w.churchA, w.eventId, w.openRole, w.plainTarget
      )
      expect(rows).toHaveLength(1)
    })
  })
})

describe.skipIf(!hasDatabase())('Stage 3 — the expense/collection boundary', () => {
  it('lets Events Team attach an expense to their own event', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      await asPrincipal(tx, w.eventsTeam.accountId)
      const rows = await tx.$queryRawUnsafe(
        `INSERT INTO public.expenses (event_id, from_church, description, amount, spent_on)
         VALUES ($1::uuid, $2::uuid, 'zz-sound', '500', current_date) RETURNING id`,
        w.eventId, w.churchA
      )
      expect(rows).toHaveLength(1)
    })
  })

  it('refuses a general (event-less) expense from Events Team', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      await asPrincipal(tx, w.eventsTeam.accountId)
      const msg = await refusalMessage(tx, () => tx.$executeRawUnsafe(
        `INSERT INTO public.expenses (from_church, description, amount, spent_on)
         VALUES ($1::uuid, 'zz-general', '500', current_date)`,
        w.churchA
      ))
      expect(isAuthorizationFailure(msg)).toBe(true)
    })
  })

  it('refuses a collection from Events Team entirely (Finance owns it)', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      await asPrincipal(tx, w.eventsTeam.accountId)
      const msg = await refusalMessage(tx, () => tx.$executeRawUnsafe(
        `INSERT INTO public.collections (from_church, event_id, amount, "collectedOn", is_tithes)
         VALUES ($1::uuid, $2::uuid, '500', current_date, false)`,
        w.churchA, w.eventId
      ))
      expect(isAuthorizationFailure(msg)).toBe(true)
    })
  })

  it('gives Events Team the collection TOTAL but never the rows', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      // Finance's collection, created as the owner (RLS bypassed for setup).
      await tx.$executeRawUnsafe(
        `INSERT INTO public.collections (from_church, event_id, amount, "collectedOn", is_tithes)
         VALUES ($1::uuid, $2::uuid, '500', current_date, false)`,
        w.churchA, w.eventId
      )
      await asPrincipal(tx, w.eventsTeam.accountId)

      // The identity-bearing rows are invisible (0031 stands).
      const rows = await tx.$queryRawUnsafe(
        `SELECT id FROM public.collections WHERE event_id = $1::uuid`, w.eventId
      )
      expect(rows).toHaveLength(0)

      // The aggregate is all they get.
      const [{ total }] = await tx.$queryRawUnsafe(
        `SELECT public.event_collection_total($1::uuid) AS total`, w.eventId
      )
      expect(Number(total)).toBe(500)
    })
  })
})

describe.skipIf(!hasDatabase())('Stage 3 — attendance is event-scoped, not the general domain', () => {
  it('lets Events Team create an ad-hoc service for their own event', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      await asPrincipal(tx, w.eventsTeam.accountId)
      const rows = await tx.$queryRawUnsafe(
        `INSERT INTO public.services (church_id, event_id, schedule_id, label, opens_at, closes_at)
         VALUES ($1::uuid, $2::uuid, NULL, 'zz-svc', now(), now() + interval '2 hours') RETURNING id`,
        w.churchA, w.eventId
      )
      expect(rows).toHaveLength(1)
    })
  })

  it('refuses a general (event-less) service from Events Team', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      await asPrincipal(tx, w.eventsTeam.accountId)
      const msg = await refusalMessage(tx, () => tx.$executeRawUnsafe(
        `INSERT INTO public.services (church_id, schedule_id, label, opens_at, closes_at)
         VALUES ($1::uuid, NULL, 'zz-svc', now(), now() + interval '2 hours')`,
        w.churchA
      ))
      expect(isAuthorizationFailure(msg)).toBe(true)
    })
  })
})

describe.skipIf(!hasDatabase())('Stage 3 — rooms are the Church Leader\'s, not Events Team\'s', () => {
  it('lets a Church Leader add a room', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      await asPrincipal(tx, w.churchLeader.accountId)
      const rows = await tx.$queryRawUnsafe(
        `INSERT INTO public.event_rooms (church_id, label) VALUES ($1::uuid, 'zz-hall') RETURNING id`,
        w.churchA
      )
      expect(rows).toHaveLength(1)
    })
  })

  it('refuses Events Team adding a room', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      await asPrincipal(tx, w.eventsTeam.accountId)
      const msg = await refusalMessage(tx, () => tx.$executeRawUnsafe(
        `INSERT INTO public.event_rooms (church_id, label) VALUES ($1::uuid, 'zz-hall')`,
        w.churchA
      ))
      expect(isAuthorizationFailure(msg)).toBe(true)
    })
  })
})

describe.skipIf(!hasDatabase())('Stage 3 — the cross-church wall (Q1: guests, never browsing)', () => {
  it('does not let Events Team read another church\'s members', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      await asPrincipal(tx, w.eventsTeam.accountId)
      const rows = await tx.$queryRawUnsafe(
        `SELECT id FROM public.members WHERE member_of = $1::uuid`, w.churchB
      )
      expect(rows).toHaveLength(0)
    })
  })
})

describe.skipIf(!hasDatabase())('Stage 3 — member self-offer (Q3 auto-accept, Q7 restricted)', () => {
  it('auto-accepts a member onto an open role', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      await asPrincipal(tx, w.plainMember.accountId)
      const [row] = await tx.$queryRawUnsafe(
        `SELECT public.offer_to_serve($1::uuid) AS id`, w.openRole
      )
      expect(row.id).toBeTruthy()
    })
  })

  it('refuses a member self-offering to a finance-required role', async () => {
    await withRollback(async (tx) => {
      const w = await world(tx)
      await asPrincipal(tx, w.plainMember.accountId)
      const msg = await refusalMessage(tx, () => tx.$queryRawUnsafe(
        `SELECT public.offer_to_serve($1::uuid)`, w.financeRole
      ))
      expect(msg).toMatch(/events team/i)
    })
  })
})

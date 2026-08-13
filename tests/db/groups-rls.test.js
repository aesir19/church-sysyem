// What each role can actually see and do with groups and group membership.
//
// This is a behavioural snapshot of the policies as they stand. Its job is to make the
// `groups` split (#74) a refactor rather than a rewrite-and-hope: run it before, split,
// run it after, and any line that changes is a permission that moved.
//
// Every test builds its own two churches so that "my church" and "not my church" are
// unambiguous, and asserts on the ids it created. Never on row counts of the whole
// table — staging holds real data and a count assertion would break whenever somebody
// adds a small group.

import { describe, it, expect, afterAll } from 'vitest'
import {
  hasDatabase, withRollback, asPrincipal, asAnonymousAuthenticated, asAnon, asOwner,
  refusalMessage, isAuthorizationFailure, disconnect
} from './helpers/database.js'
import {
  makeChurch, makeMember, makePrincipal, makeMinistry, makeSmallGroup,
  addToGroup, findSystemMinistry, visibleGroupIds, visibleMembershipIds
} from './helpers/fixtures.js'

afterAll(disconnect)

/**
 * Two churches, a global ministry, and a small group in each — the smallest world in
 * which every scoping rule is observable.
 */
async function twoChurchWorld (tx) {
  const churchA = await makeChurch(tx, 'a')
  const churchB = await makeChurch(tx, 'b')
  const ministry = await makeMinistry(tx, { label: 'plain' })
  const groupA = await makeSmallGroup(tx, churchA, 'in-a')
  const groupB = await makeSmallGroup(tx, churchB, 'in-b')
  const memberA = await makeMember(tx, churchA, 'in-a')
  const memberB = await makeMember(tx, churchB, 'in-b')
  return { churchA, churchB, ministry, groupA, groupB, memberA, memberB }
}

describe.skipIf(!hasDatabase())('groups — who can see what', () => {
  it('shows a Super Admin every church\'s small groups', async () => {
    await withRollback(async tx => {
      const w = await twoChurchWorld(tx)
      const { accountId } = await makePrincipal(tx, { role: 'super_admin', churchId: w.churchA })

      await asPrincipal(tx, accountId)
      const seen = await visibleGroupIds(tx)

      expect(seen.has(w.ministry)).toBe(true)
      expect(seen.has(w.groupA)).toBe(true)
      expect(seen.has(w.groupB)).toBe(true)
    })
  })

  it('shows a Head Pastor every church\'s small groups', async () => {
    await withRollback(async tx => {
      const w = await twoChurchWorld(tx)
      const { accountId } = await makePrincipal(tx, { role: 'head_pastor', churchId: w.churchA })

      await asPrincipal(tx, accountId)
      const seen = await visibleGroupIds(tx)

      expect(seen.has(w.groupA)).toBe(true)
      expect(seen.has(w.groupB)).toBe(true)
    })
  })

  it('shows a Pastor global ministries and their own church only', async () => {
    await withRollback(async tx => {
      const w = await twoChurchWorld(tx)
      const { accountId } = await makePrincipal(tx, { role: 'pastor', churchId: w.churchA })

      await asPrincipal(tx, accountId)
      const seen = await visibleGroupIds(tx)

      expect(seen.has(w.ministry)).toBe(true)
      expect(seen.has(w.groupA)).toBe(true)
      expect(seen.has(w.groupB)).toBe(false)
    })
  })

  it('shows a Church Leader global ministries and their own church only', async () => {
    await withRollback(async tx => {
      const w = await twoChurchWorld(tx)
      const { accountId } = await makePrincipal(tx, { role: 'church_leader', churchId: w.churchA })

      await asPrincipal(tx, accountId)
      const seen = await visibleGroupIds(tx)

      expect(seen.has(w.groupA)).toBe(true)
      expect(seen.has(w.groupB)).toBe(false)
    })
  })

  it('shows an account with no member record nothing at all', async () => {
    await withRollback(async tx => {
      const w = await twoChurchWorld(tx)
      // The state every sign-up is in until an admin links it: authenticated, no member.
      const { accountId } = await makePrincipal(tx, { role: 'unassigned', churchId: null })

      await asPrincipal(tx, accountId)
      const seen = await visibleGroupIds(tx)

      expect(seen.has(w.ministry)).toBe(false)
      expect(seen.has(w.groupA)).toBe(false)
      expect(seen.has(w.groupB)).toBe(false)
    })
  })

  it('shows a request carrying no claims nothing at all', async () => {
    await withRollback(async tx => {
      const w = await twoChurchWorld(tx)

      await asAnonymousAuthenticated(tx)
      const seen = await visibleGroupIds(tx)

      expect(seen.size).toBe(0)
      expect(seen.has(w.ministry)).toBe(false)
    })
  })

  it('gives the public role no access to either table', async () => {
    // `anon` is a different Postgres role from a claimless `authenticated`, with its own
    // grants, so the test above says nothing about it. 0009 exists because revoking from
    // PUBLIC does not remove anon's default EXECUTE — the repo has made this mistake
    // once already, and the split re-issues every grant on these tables.
    await withRollback(async tx => {
      await twoChurchWorld(tx)
      await asAnon(tx)

      for (const table of ['groups', 'group_members']) {
        const message = await refusalMessage(tx, () =>
          tx.$queryRawUnsafe(`SELECT id FROM public.${table}`)
        )
        expect(isAuthorizationFailure(message), `anon reading ${table}`).toBe(true)
      }
    })
  })
})

describe.skipIf(!hasDatabase())('group membership — who can see what', () => {
  it('shows a Super Admin memberships across churches', async () => {
    await withRollback(async tx => {
      const w = await twoChurchWorld(tx)
      const inA = await addToGroup(tx, w.groupA, w.memberA)
      const inB = await addToGroup(tx, w.groupB, w.memberB)
      const { accountId } = await makePrincipal(tx, { role: 'super_admin', churchId: w.churchA })

      await asPrincipal(tx, accountId)
      const seen = await visibleMembershipIds(tx)

      expect(seen.has(inA)).toBe(true)
      expect(seen.has(inB)).toBe(true)
    })
  })

  it('shows a Head Pastor memberships across churches', async () => {
    await withRollback(async tx => {
      const w = await twoChurchWorld(tx)
      const inA = await addToGroup(tx, w.groupA, w.memberA)
      const inB = await addToGroup(tx, w.groupB, w.memberB)
      const { accountId } = await makePrincipal(tx, { role: 'head_pastor', churchId: w.churchA })

      await asPrincipal(tx, accountId)
      const seen = await visibleMembershipIds(tx)

      expect(seen.has(inA)).toBe(true)
      expect(seen.has(inB)).toBe(true)
    })
  })

  it.each([
    ['pastor'],
    ['church_leader']
  ])('scopes %s to their own church\'s memberships', async role => {
    await withRollback(async tx => {
      const w = await twoChurchWorld(tx)
      const inA = await addToGroup(tx, w.groupA, w.memberA)
      const inB = await addToGroup(tx, w.groupB, w.memberB)
      const { accountId } = await makePrincipal(tx, { role, churchId: w.churchA })

      await asPrincipal(tx, accountId)
      const seen = await visibleMembershipIds(tx)

      expect(seen.has(inA)).toBe(true)
      expect(seen.has(inB)).toBe(false)
    })
  })

  it('shows a Finance member their own church only, despite the ministry being global', async () => {
    // A ministry's rows span every church, so a ministry member is exactly the case
    // where a scope branch is easy to lose: the group is visible to them, the other
    // church's people in it are not.
    await withRollback(async tx => {
      const w = await twoChurchWorld(tx)
      const finance = await findSystemMinistry(tx, 'finance')
      const person = await makePrincipal(tx, { role: 'member', churchId: w.churchA })
      await addToGroup(tx, finance, person.memberId)
      const ourside = await addToGroup(tx, finance, w.memberA)
      const theirside = await addToGroup(tx, finance, w.memberB)

      await asPrincipal(tx, person.accountId)
      const seen = await visibleMembershipIds(tx)

      expect(seen.has(ourside)).toBe(true)
      expect(seen.has(theirside)).toBe(false)
    })
  })

  it('shows an account with no member record no memberships at all', async () => {
    await withRollback(async tx => {
      const w = await twoChurchWorld(tx)
      const inA = await addToGroup(tx, w.groupA, w.memberA)
      const { accountId } = await makePrincipal(tx, { role: 'unassigned', churchId: null })

      await asPrincipal(tx, accountId)
      const seen = await visibleMembershipIds(tx)

      expect(seen.has(inA)).toBe(false)
    })
  })
})

describe.skipIf(!hasDatabase())('creating, renaming and deleting a small group', () => {
  it('lets a Church Leader create one in their own church', async () => {
    await withRollback(async tx => {
      const w = await twoChurchWorld(tx)
      const { accountId } = await makePrincipal(tx, { role: 'church_leader', churchId: w.churchA })

      await asPrincipal(tx, accountId)
      const rows = await tx.$executeRawUnsafe(
        `INSERT INTO public.groups (name, type, church_id)
         VALUES ('zz-test-created-by-leader', 'Small Group', $1::uuid)`,
        w.churchA
      )

      expect(rows).toBe(1)
    })
  })

  it('refuses a Church Leader creating one in another church', async () => {
    await withRollback(async tx => {
      const w = await twoChurchWorld(tx)
      const { accountId } = await makePrincipal(tx, { role: 'church_leader', churchId: w.churchA })

      await asPrincipal(tx, accountId)
      const message = await refusalMessage(tx, () => tx.$executeRawUnsafe(
        `INSERT INTO public.groups (name, type, church_id)
         VALUES ('zz-test-cross-church', 'Small Group', $1::uuid)`,
        w.churchB
      ))

      expect(isAuthorizationFailure(message)).toBe(true)
    })
  })

  it('refuses a Pastor creating one — small groups are Church Leader work', async () => {
    await withRollback(async tx => {
      const w = await twoChurchWorld(tx)
      const { accountId } = await makePrincipal(tx, { role: 'pastor', churchId: w.churchA })

      await asPrincipal(tx, accountId)
      const message = await refusalMessage(tx, () => tx.$executeRawUnsafe(
        `INSERT INTO public.groups (name, type, church_id)
         VALUES ('zz-test-by-pastor', 'Small Group', $1::uuid)`,
        w.churchA
      ))

      expect(isAuthorizationFailure(message)).toBe(true)
    })
  })

  it('refuses everyone creating a Ministry, Super Admin included', async () => {
    // Ministries are seeded by migration and are not client-creatable at all. Worth
    // pinning: it is easy to widen this by accident when rewriting the insert policy.
    await withRollback(async tx => {
      const w = await twoChurchWorld(tx)
      const { accountId } = await makePrincipal(tx, { role: 'super_admin', churchId: w.churchA })

      await asPrincipal(tx, accountId)
      const message = await refusalMessage(tx, () => tx.$executeRawUnsafe(
        `INSERT INTO public.groups (name, type) VALUES ('zz-test-new-ministry', 'Ministry')`
      ))

      expect(isAuthorizationFailure(message)).toBe(true)
    })
  })

  it('lets a Church Leader rename their own church\'s group but not another\'s', async () => {
    // Both halves in one test on purpose. Renaming another church's group is not an
    // error — an invisible row is simply not matched — so the negative half alone would
    // pass just as well if the UPDATE policy were deleted outright. Only the pair
    // distinguishes "scoped correctly" from "nobody can rename anything".
    await withRollback(async tx => {
      const w = await twoChurchWorld(tx)
      const { accountId } = await makePrincipal(tx, { role: 'church_leader', churchId: w.churchA })

      await asPrincipal(tx, accountId)

      expect(await tx.$executeRawUnsafe(
        `UPDATE public.groups SET name = 'zz-test-should-not-happen' WHERE id = $1::uuid`, w.groupB
      )).toBe(0)
      expect(await tx.$executeRawUnsafe(
        `UPDATE public.groups SET name = 'zz-test-renamed' WHERE id = $1::uuid`, w.groupA
      )).toBe(1)
    })
  })

  it('lets a Church Leader delete their own church\'s group but not another\'s', async () => {
    await withRollback(async tx => {
      const w = await twoChurchWorld(tx)
      const { accountId } = await makePrincipal(tx, { role: 'church_leader', churchId: w.churchA })

      await asPrincipal(tx, accountId)

      expect(await tx.$executeRawUnsafe(`DELETE FROM public.groups WHERE id = $1::uuid`, w.groupB)).toBe(0)
      expect(await tx.$executeRawUnsafe(`DELETE FROM public.groups WHERE id = $1::uuid`, w.groupA)).toBe(1)
    })
  })
})

describe.skipIf(!hasDatabase())('adding and removing group members', () => {
  it('lets a Church Leader add someone to an ordinary ministry', async () => {
    await withRollback(async tx => {
      const w = await twoChurchWorld(tx)
      const { accountId } = await makePrincipal(tx, { role: 'church_leader', churchId: w.churchA })

      await asPrincipal(tx, accountId)
      const rows = await tx.$executeRawUnsafe(
        `INSERT INTO public.group_members (group_id, member_id) VALUES ($1::uuid, $2::uuid)`,
        w.ministry, w.memberA
      )

      expect(rows).toBe(1)
    })
  })

  it('refuses a Pastor adding someone to an ordinary ministry', async () => {
    await withRollback(async tx => {
      const w = await twoChurchWorld(tx)
      const { accountId } = await makePrincipal(tx, { role: 'pastor', churchId: w.churchA })

      await asPrincipal(tx, accountId)
      const message = await refusalMessage(tx, () => tx.$executeRawUnsafe(
        `INSERT INTO public.group_members (group_id, member_id) VALUES ($1::uuid, $2::uuid)`,
        w.ministry, w.memberA
      ))

      expect(isAuthorizationFailure(message)).toBe(true)
    })
  })

  it('makes the Finance ministry Pastor-only: the Pastor may, the Church Leader may not', async () => {
    // The one carve-out in can_manage_group_members, and the single easiest thing to
    // lose in a rewrite. Both halves are asserted in one test so they cannot drift apart.
    await withRollback(async tx => {
      const w = await twoChurchWorld(tx)
      const finance = await findSystemMinistry(tx, 'finance')
      expect(finance, 'the finance ministry should exist — seeded by 0014').toBeTruthy()

      const pastor = await makePrincipal(tx, { role: 'pastor', churchId: w.churchA })
      const leader = await makePrincipal(tx, { role: 'church_leader', churchId: w.churchA })

      await asPrincipal(tx, leader.accountId)
      const message = await refusalMessage(tx, () => tx.$executeRawUnsafe(
        `INSERT INTO public.group_members (group_id, member_id) VALUES ($1::uuid, $2::uuid)`,
        finance, w.memberA
      ))
      expect(isAuthorizationFailure(message)).toBe(true)

      await asOwner(tx)
      await asPrincipal(tx, pastor.accountId)
      const rows = await tx.$executeRawUnsafe(
        `INSERT INTO public.group_members (group_id, member_id) VALUES ($1::uuid, $2::uuid)`,
        finance, w.memberA
      )
      expect(rows).toBe(1)
    })
  })

  it('refuses a Church Leader reaching outside their own church', async () => {
    // Named for what it actually exercises. The refusal comes from the church scope —
    // is_member_in_my_church — and NOT from group_accepts_member: delete that function
    // entirely and this still passes. The Super Admin twin below is the one that
    // reaches the church-consistency rule, because Super Admin skips the scope branch.
    await withRollback(async tx => {
      const w = await twoChurchWorld(tx)
      const { accountId } = await makePrincipal(tx, { role: 'church_leader', churchId: w.churchA })

      await asPrincipal(tx, accountId)
      const message = await refusalMessage(tx, () => tx.$executeRawUnsafe(
        `INSERT INTO public.group_members (group_id, member_id) VALUES ($1::uuid, $2::uuid)`,
        w.groupA, w.memberB
      ))

      expect(isAuthorizationFailure(message)).toBe(true)
    })
  })

  it('refuses a Super Admin adding another church\'s member to a small group', async () => {
    // Super Admin crosses churches, but a small group still only accepts its own
    // church's members — group_accepts_member, not the church scope, is what says no.
    await withRollback(async tx => {
      const w = await twoChurchWorld(tx)
      const { accountId } = await makePrincipal(tx, { role: 'super_admin', churchId: w.churchA })

      await asPrincipal(tx, accountId)
      const message = await refusalMessage(tx, () => tx.$executeRawUnsafe(
        `INSERT INTO public.group_members (group_id, member_id) VALUES ($1::uuid, $2::uuid)`,
        w.groupB, w.memberA
      ))

      expect(isAuthorizationFailure(message)).toBe(true)
    })
  })

  it('lets a Super Admin add a member to a small group in a church that is not theirs', async () => {
    await withRollback(async tx => {
      // The admin belongs to church A; both the group and the member are church B's.
      // Cross-church reach and church-consistency in one statement.
      const w = await twoChurchWorld(tx)
      const { accountId } = await makePrincipal(tx, { role: 'super_admin', churchId: w.churchA })

      await asPrincipal(tx, accountId)
      const rows = await tx.$executeRawUnsafe(
        `INSERT INTO public.group_members (group_id, member_id) VALUES ($1::uuid, $2::uuid)`,
        w.groupB, w.memberB
      )

      expect(rows).toBe(1)
    })
  })

  it('refuses an account with no member record adding anyone anywhere', async () => {
    await withRollback(async tx => {
      const w = await twoChurchWorld(tx)
      const { accountId } = await makePrincipal(tx, { role: 'unassigned', churchId: null })

      await asPrincipal(tx, accountId)
      const message = await refusalMessage(tx, () => tx.$executeRawUnsafe(
        `INSERT INTO public.group_members (group_id, member_id) VALUES ($1::uuid, $2::uuid)`,
        w.ministry, w.memberA
      ))

      expect(isAuthorizationFailure(message)).toBe(true)
    })
  })

  it('lets a Church Leader remove a member of their own church but not another\'s', async () => {
    await withRollback(async tx => {
      const w = await twoChurchWorld(tx)
      const inA = await addToGroup(tx, w.groupA, w.memberA)
      const inB = await addToGroup(tx, w.groupB, w.memberB)
      const { accountId } = await makePrincipal(tx, { role: 'church_leader', churchId: w.churchA })

      await asPrincipal(tx, accountId)

      expect(await tx.$executeRawUnsafe(`DELETE FROM public.group_members WHERE id = $1::uuid`, inB)).toBe(0)
      expect(await tx.$executeRawUnsafe(`DELETE FROM public.group_members WHERE id = $1::uuid`, inA)).toBe(1)
    })
  })
})

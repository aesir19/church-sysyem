// The predicate and capability functions, exercised as each role.
//
// The policies in groups-rls.test.js are thin wrappers over these. If a composite
// quietly changes shape during the split, every policy that calls it changes with it
// and no individual policy looks wrong — so these are asserted directly.
//
// Same rules as the sibling suite: one rolled-back transaction per test, fixtures built
// as the owner, assertions made as `authenticated`.

import { describe, it, expect, afterAll } from 'vitest'
import {
  hasDatabase, withRollback, asPrincipal, asAnonymousAuthenticated, asOwner, disconnect
} from './helpers/database.js'
import {
  makeChurch, makeMember, makePrincipal, makeMinistry, makeSmallGroup,
  addToGroup, findSystemMinistry
} from './helpers/fixtures.js'

afterAll(disconnect)

/** Evaluate a no-argument boolean predicate as the current principal. */
async function predicate (tx, name) {
  const [row] = await tx.$queryRawUnsafe(`SELECT public.${name}() AS value`)
  return row.value
}

/** The whole capability set in one round trip, as the app fetches it. */
async function permissions (tx) {
  const [row] = await tx.$queryRawUnsafe(`SELECT * FROM public.get_my_permissions()`)
  return row
}

describe.skipIf(!hasDatabase())('ministry membership decides ministry roles', () => {
  it('makes someone in the Finance ministry a finance member, and nobody else', async () => {
    await withRollback(async tx => {
      const church = await makeChurch(tx)
      const finance = await findSystemMinistry(tx, 'finance')
      const inFinance = await makePrincipal(tx, { role: 'member', churchId: church })
      const outsider = await makePrincipal(tx, { role: 'member', churchId: church })
      await addToGroup(tx, finance, inFinance.memberId)

      await asPrincipal(tx, inFinance.accountId)
      expect(await predicate(tx, 'is_finance_member')).toBe(true)
      expect(await predicate(tx, 'can_write_finance')).toBe(true)

      await asOwner(tx)
      await asPrincipal(tx, outsider.accountId)
      expect(await predicate(tx, 'is_finance_member')).toBe(false)
      expect(await predicate(tx, 'can_write_finance')).toBe(false)
    })
  })

  it('does not let renaming the Finance ministry change who has finance access', async () => {
    // Defect D4. Authorization keys on the immutable ministry_key, never the display
    // name, so a rename cannot grant or revoke anything. The split moves this column to
    // another table, which is exactly when a rewrite might reach for `name` again.
    await withRollback(async tx => {
      const church = await makeChurch(tx)
      const finance = await findSystemMinistry(tx, 'finance')
      const treasurer = await makePrincipal(tx, { role: 'member', churchId: church })
      await addToGroup(tx, finance, treasurer.memberId)

      await asPrincipal(tx, treasurer.accountId)
      expect(await predicate(tx, 'is_finance_member')).toBe(true)

      await asOwner(tx)
      await tx.$executeRawUnsafe(
        `UPDATE public.groups SET name = 'zz-test-renamed-finance' WHERE id = $1::uuid`,
        finance
      )

      await asPrincipal(tx, treasurer.accountId)
      expect(await predicate(tx, 'is_finance_member')).toBe(true)
    })
  })

  it('recognises only the real Finance ministry as the finance group', async () => {
    await withRollback(async tx => {
      const church = await makeChurch(tx)
      const finance = await findSystemMinistry(tx, 'finance')
      const otherMinistry = await makeMinistry(tx, { label: 'not-finance' })
      const smallGroup = await makeSmallGroup(tx, church)
      const { accountId } = await makePrincipal(tx, { role: 'super_admin', churchId: church })

      await asPrincipal(tx, accountId)
      const check = async id => {
        const [row] = await tx.$queryRawUnsafe(`SELECT public.is_finance_group($1::uuid) AS value`, id)
        return row.value
      }

      expect(await check(finance)).toBe(true)
      expect(await check(otherMinistry)).toBe(false)
      expect(await check(smallGroup)).toBe(false)
    })
  })
})

describe.skipIf(!hasDatabase())('capability composites per role', () => {
  it('gives a Super Admin everything', async () => {
    await withRollback(async tx => {
      const church = await makeChurch(tx)
      const { accountId } = await makePrincipal(tx, { role: 'super_admin', churchId: church })

      await asPrincipal(tx, accountId)
      const p = await permissions(tx)

      expect(p.role).toBe('super_admin')
      expect(p.is_super_admin).toBe(true)
      expect(await predicate(tx, 'can_see_member_detail')).toBe(true)
      expect(await predicate(tx, 'can_view_finance')).toBe(true)
      expect(await predicate(tx, 'can_view_attendance')).toBe(true)
      expect(await predicate(tx, 'can_write_members')).toBe(true)
      expect(await predicate(tx, 'can_manage_small_groups')).toBe(true)
    })
  })

  it('keeps member detail away from a Head Pastor while allowing finance and attendance', async () => {
    // The deliberate asymmetry in the model, and the one most likely to be "tidied up"
    // by someone who assumes the senior role sees everything.
    await withRollback(async tx => {
      const church = await makeChurch(tx)
      const { accountId } = await makePrincipal(tx, { role: 'head_pastor', churchId: church })

      await asPrincipal(tx, accountId)

      expect(await predicate(tx, 'can_see_member_detail')).toBe(false)
      expect(await predicate(tx, 'can_view_finance')).toBe(true)
      expect(await predicate(tx, 'can_view_attendance')).toBe(true)
      expect(await predicate(tx, 'can_write_members')).toBe(false)
      expect(await predicate(tx, 'can_manage_small_groups')).toBe(false)
    })
  })

  it('makes a Pastor a viewer, not a writer', async () => {
    await withRollback(async tx => {
      const church = await makeChurch(tx)
      const { accountId } = await makePrincipal(tx, { role: 'pastor', churchId: church })

      await asPrincipal(tx, accountId)

      expect(await predicate(tx, 'can_see_member_detail')).toBe(true)
      expect(await predicate(tx, 'can_view_finance')).toBe(true)
      expect(await predicate(tx, 'can_write_members')).toBe(false)
      expect(await predicate(tx, 'can_write_finance')).toBe(false)
      expect(await predicate(tx, 'can_manage_attendance')).toBe(false)
      expect(await predicate(tx, 'can_manage_small_groups')).toBe(false)
    })
  })

  it('lets a Church Leader manage small groups but not members or money', async () => {
    await withRollback(async tx => {
      const church = await makeChurch(tx)
      const { accountId } = await makePrincipal(tx, { role: 'church_leader', churchId: church })

      await asPrincipal(tx, accountId)

      expect(await predicate(tx, 'can_manage_small_groups')).toBe(true)
      expect(await predicate(tx, 'can_see_member_detail')).toBe(true)
      expect(await predicate(tx, 'can_write_members')).toBe(false)
      expect(await predicate(tx, 'can_write_finance')).toBe(false)
    })
  })

  it('grants the Secretariat member writing and the Welcome Team attendance', async () => {
    await withRollback(async tx => {
      const church = await makeChurch(tx)
      const secretariat = await findSystemMinistry(tx, 'secretariat')
      const welcome = await findSystemMinistry(tx, 'welcome')
      const clerk = await makePrincipal(tx, { role: 'member', churchId: church })
      const usher = await makePrincipal(tx, { role: 'member', churchId: church })
      await addToGroup(tx, secretariat, clerk.memberId)
      await addToGroup(tx, welcome, usher.memberId)

      await asPrincipal(tx, clerk.accountId)
      expect(await predicate(tx, 'can_write_members')).toBe(true)
      expect(await predicate(tx, 'can_see_member_detail')).toBe(true)
      expect(await predicate(tx, 'can_manage_attendance')).toBe(false)

      await asOwner(tx)
      await asPrincipal(tx, usher.accountId)
      expect(await predicate(tx, 'can_manage_attendance')).toBe(true)
      expect(await predicate(tx, 'can_view_attendance')).toBe(true)
      expect(await predicate(tx, 'can_see_member_detail')).toBe(false)
    })
  })

  it('gives an account with no member record and no role nothing', async () => {
    await withRollback(async tx => {
      const { accountId } = await makePrincipal(tx, { role: 'unassigned', churchId: null })

      await asPrincipal(tx, accountId)

      for (const name of [
        'can_see_member_detail', 'can_view_finance', 'can_view_attendance',
        'can_write_members', 'can_write_finance', 'can_manage_attendance',
        'can_manage_small_groups'
      ]) {
        expect(await predicate(tx, name), `${name} should be false`).toBe(false)
      }
    })
  })

  it('gives a request carrying no claims nothing', async () => {
    await withRollback(async tx => {
      await asAnonymousAuthenticated(tx)

      expect(await predicate(tx, 'can_see_member_detail')).toBe(false)
      expect(await predicate(tx, 'can_view_finance')).toBe(false)
      expect(await predicate(tx, 'can_manage_small_groups')).toBe(false)
    })
  })
})

describe.skipIf(!hasDatabase())('a church is derived from the member record, never stored', () => {
  it('resolves the account\'s church through its linked member', async () => {
    await withRollback(async tx => {
      const church = await makeChurch(tx)
      const { accountId } = await makePrincipal(tx, { role: 'pastor', churchId: church })

      await asPrincipal(tx, accountId)
      const [row] = await tx.$queryRawUnsafe(`SELECT public.get_my_church_id() AS id`)

      expect(row.id).toBe(church)
    })
  })

  it('resolves no church for an account with no member record', async () => {
    await withRollback(async tx => {
      const { accountId } = await makePrincipal(tx, { role: 'pastor', churchId: null })

      await asPrincipal(tx, accountId)
      const [row] = await tx.$queryRawUnsafe(`SELECT public.get_my_church_id() AS id`)

      expect(row.id).toBeNull()
    })
  })
})

describe.skipIf(!hasDatabase())('the two paths to member data', () => {
  it('shows a Head Pastor no member rows but a working directory', async () => {
    // 0015's split: the base table carries PII and is gated to can_see_member_detail;
    // everyone else gets names and group names through directory_search and nothing more.
    await withRollback(async tx => {
      const church = await makeChurch(tx)
      const subject = await makeMember(tx, church, 'findable')
      const group = await makeSmallGroup(tx, church)
      await addToGroup(tx, group, subject)
      const { accountId } = await makePrincipal(tx, { role: 'head_pastor', churchId: church })

      await asPrincipal(tx, accountId)

      const rows = await tx.$queryRawUnsafe(
        `SELECT id FROM public.members WHERE id = $1::uuid`, subject
      )
      expect(rows).toHaveLength(0)

      const found = await tx.$queryRawUnsafe(
        `SELECT member_id, small_groups FROM public.directory_search(NULL, $1::uuid, 500)`, church
      )
      expect(found.some(r => r.member_id === subject)).toBe(true)
    })
  })

  it('shows a Church Leader the member row itself', async () => {
    await withRollback(async tx => {
      const church = await makeChurch(tx)
      const subject = await makeMember(tx, church, 'visible')
      const { accountId } = await makePrincipal(tx, { role: 'church_leader', churchId: church })

      await asPrincipal(tx, accountId)
      const rows = await tx.$queryRawUnsafe(
        `SELECT id FROM public.members WHERE id = $1::uuid`, subject
      )

      expect(rows).toHaveLength(1)
    })
  })

  it('returns the searcher\'s own church only, and nothing at all when unlinked', async () => {
    await withRollback(async tx => {
      const churchA = await makeChurch(tx, 'a')
      const churchB = await makeChurch(tx, 'b')
      const inA = await makeMember(tx, churchA, 'here')
      const inB = await makeMember(tx, churchB, 'elsewhere')
      const leader = await makePrincipal(tx, { role: 'church_leader', churchId: churchA })
      const stranger = await makePrincipal(tx, { role: 'unassigned', churchId: null })

      await asPrincipal(tx, leader.accountId)
      const scoped = await tx.$queryRawUnsafe(
        `SELECT member_id FROM public.directory_search(NULL, NULL, 1000)`
      )
      const ids = new Set(scoped.map(r => r.member_id))
      expect(ids.has(inA)).toBe(true)
      expect(ids.has(inB)).toBe(false)

      await asOwner(tx)
      await asPrincipal(tx, stranger.accountId)
      const nothing = await tx.$queryRawUnsafe(
        `SELECT member_id FROM public.directory_search(NULL, NULL, 1000)`
      )
      expect(nothing).toHaveLength(0)
    })
  })
})

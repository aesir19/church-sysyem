// 0022: account linking, pastor assignment, and the Small Group Leader role.
//
// Almost every assertion here is a refusal, which is the point. These functions are
// SECURITY DEFINER — they run as the owner and bypass RLS entirely — so the `IF NOT
// authorized THEN RAISE` line at the top of each one *is* the access control. There is
// no policy behind it to catch a mistake.
//
// Same harness rules as the sibling suites: one rolled-back transaction per test,
// fixtures built as the owner, assertions made as `authenticated`.

import { describe, it, expect, afterAll } from 'vitest'
import {
  hasDatabase, withRollback, asPrincipal, asAnon, asOwner,
  refusalMessage, isAuthorizationFailure, flushDeferredConstraints, disconnect
} from './helpers/database.js'
import {
  makeChurch, makeMember, makePrincipal, makeMinistry, makeSmallGroup, addToGroup
} from './helpers/fixtures.js'

afterAll(disconnect)

// Reads. Returns rows.
const call = (tx, sql, ...args) => tx.$queryRawUnsafe(sql, ...args)

// The RPCs that RETURN void. $queryRaw cannot deserialize a void column, so these go
// through $executeRaw, which asks for a command tag rather than a result set. An error
// still propagates, which is all the refusal assertions need.
const perform = (tx, sql, ...args) => tx.$executeRawUnsafe(sql, ...args)

/** A church with a small group, and an account that is already in that group. */
async function groupWithCandidate (tx, label = 'a') {
  const church = await makeChurch(tx, label)
  const group = await makeSmallGroup(tx, church, label)
  const candidate = await makePrincipal(tx, { role: 'member', churchId: church })
  await addToGroup(tx, group, candidate.memberId)
  return { church, group, candidate }
}

describe.skipIf(!hasDatabase())('list_accounts', () => {
  it('shows a Super Admin the accounts, with the e-mail address', async () => {
    await withRollback(async tx => {
      const church = await makeChurch(tx)
      const subject = await makePrincipal(tx, { role: 'member', churchId: church })
      const admin = await makePrincipal(tx, { role: 'super_admin', churchId: church })

      await asPrincipal(tx, admin.accountId)
      const rows = await call(tx, `SELECT account_id, email, role FROM public.list_accounts()`)

      const found = rows.find(r => r.account_id === subject.accountId)
      expect(found).toBeTruthy()
      expect(found.role).toBe('member')
    })
  })

  it.each([
    ['head_pastor'], ['pastor'], ['church_leader'], ['member'], ['unassigned']
  ])('returns zero rows to %s rather than raising', async role => {
    // Zero rows, not an error. A refusal that raises tells the caller they guessed a
    // real capability; an empty set tells them nothing.
    await withRollback(async tx => {
      const church = await makeChurch(tx)
      const { accountId } = await makePrincipal(tx, { role, churchId: church })

      await asPrincipal(tx, accountId)
      const rows = await call(tx, `SELECT account_id FROM public.list_accounts()`)

      expect(rows).toHaveLength(0)
    })
  })

  it('refuses the public role outright', async () => {
    await withRollback(async tx => {
      await asAnon(tx)
      const message = await refusalMessage(tx, () =>
        call(tx, `SELECT account_id FROM public.list_accounts()`)
      )
      expect(isAuthorizationFailure(message)).toBe(true)
    })
  })
})

describe.skipIf(!hasDatabase())('link_account_to_member', () => {
  it('lets a Super Admin link an account, giving it a church', async () => {
    await withRollback(async tx => {
      const church = await makeChurch(tx)
      const person = await makeMember(tx, church, 'newcomer')
      const stranger = await makePrincipal(tx, { role: 'member', churchId: null })
      const admin = await makePrincipal(tx, { role: 'super_admin', churchId: church })

      await asPrincipal(tx, admin.accountId)
      await perform(tx, `SELECT public.link_account_to_member($1::uuid, $2::uuid)`,
        stranger.accountId, person)

      // The church follows from the member record — that is the whole model.
      await asOwner(tx)
      await asPrincipal(tx, stranger.accountId)
      const [row] = await call(tx, `SELECT public.get_my_church_id() AS id`)
      expect(row.id).toBe(church)
    })
  })

  it('lets a Super Admin unlink, without touching the member record', async () => {
    await withRollback(async tx => {
      const church = await makeChurch(tx)
      const subject = await makePrincipal(tx, { role: 'member', churchId: church })
      const admin = await makePrincipal(tx, { role: 'super_admin', churchId: church })

      await asPrincipal(tx, admin.accountId)
      await perform(tx, `SELECT public.link_account_to_member($1::uuid, NULL)`, subject.accountId)

      await asOwner(tx)
      const [account] = await call(tx,
        `SELECT member_id FROM public.user_accounts WHERE id = $1::uuid`, subject.accountId)
      expect(account.member_id).toBeNull()

      // Removing access must never remove the person from the church roll.
      const [member] = await call(tx,
        `SELECT id FROM public.members WHERE id = $1::uuid`, subject.memberId)
      expect(member).toBeTruthy()
    })
  })

  it.each([
    ['head_pastor'], ['pastor'], ['church_leader'], ['member'], ['unassigned']
  ])('refuses %s', async role => {
    await withRollback(async tx => {
      const church = await makeChurch(tx)
      const person = await makeMember(tx, church, 'target')
      const stranger = await makePrincipal(tx, { role: 'member', churchId: null })
      const { accountId } = await makePrincipal(tx, { role, churchId: church })

      await asPrincipal(tx, accountId)
      const message = await refusalMessage(tx, () =>
        perform(tx, `SELECT public.link_account_to_member($1::uuid, $2::uuid)`, stranger.accountId, person)
      )

      expect(isAuthorizationFailure(message)).toBe(true)
    })
  })

  it('refuses an account trying to link itself', async () => {
    // The self-elevation path: without the SuperAdmin gate this is how anyone with a
    // sign-in would hand themselves a church.
    await withRollback(async tx => {
      const church = await makeChurch(tx)
      const person = await makeMember(tx, church, 'coveted')
      const self = await makePrincipal(tx, { role: 'unassigned', churchId: null })

      await asPrincipal(tx, self.accountId)
      const message = await refusalMessage(tx, () =>
        perform(tx, `SELECT public.link_account_to_member($1::uuid, $2::uuid)`, self.accountId, person)
      )

      expect(isAuthorizationFailure(message)).toBe(true)
    })
  })

  it('refuses a member who already belongs to another account', async () => {
    await withRollback(async tx => {
      const church = await makeChurch(tx)
      const taken = await makePrincipal(tx, { role: 'member', churchId: church })
      const other = await makePrincipal(tx, { role: 'member', churchId: null })
      const admin = await makePrincipal(tx, { role: 'super_admin', churchId: church })

      await asPrincipal(tx, admin.accountId)
      const message = await refusalMessage(tx, () =>
        perform(tx, `SELECT public.link_account_to_member($1::uuid, $2::uuid)`,
          other.accountId, taken.memberId)
      )

      // The SQLSTATE, not the message. Prisma recognises 23505 and replaces the
      // RAISE text with its own "Unique constraint failed"; supabase-js, which is what
      // the application actually uses, passes the message through. The code is the part
      // that is stable across both clients, so that is what is asserted.
      expect(message).toMatch(/23505|already linked/i)
    })
  })

  it('refuses an archived member', async () => {
    await withRollback(async tx => {
      const church = await makeChurch(tx)
      const person = await makeMember(tx, church, 'departed')
      await tx.$executeRawUnsafe(
        `UPDATE public.members SET archived_at = now() WHERE id = $1::uuid`, person)
      const stranger = await makePrincipal(tx, { role: 'unassigned', churchId: null })
      const admin = await makePrincipal(tx, { role: 'super_admin', churchId: church })

      await asPrincipal(tx, admin.accountId)
      const message = await refusalMessage(tx, () =>
        perform(tx, `SELECT public.link_account_to_member($1::uuid, $2::uuid)`,
          stranger.accountId, person)
      )

      expect(message).toMatch(/no such active member/i)
    })
  })
})

describe.skipIf(!hasDatabase())('set_user_role', () => {
  it('lets a Head Pastor appoint a pastor and demote one to member', async () => {
    await withRollback(async tx => {
      const church = await makeChurch(tx)
      const subject = await makePrincipal(tx, { role: 'member', churchId: church })
      const head = await makePrincipal(tx, { role: 'head_pastor', churchId: church })

      await asPrincipal(tx, head.accountId)
      await perform(tx, `SELECT public.set_user_role($1::uuid, 'pastor')`, subject.accountId)
      await perform(tx, `SELECT public.set_user_role($1::uuid, 'member')`, subject.accountId)

      await asOwner(tx)
      const [row] = await call(tx,
        `SELECT role FROM public.user_accounts WHERE id = $1::uuid`, subject.accountId)
      expect(row.role).toBe('member')
    })
  })

  it.each([
    ['super_admin'], ['head_pastor'], ['church_leader'], ['unassigned']
  ])('refuses a Head Pastor setting %s', async role => {
    await withRollback(async tx => {
      const church = await makeChurch(tx)
      const subject = await makePrincipal(tx, { role: 'member', churchId: church })
      const head = await makePrincipal(tx, { role: 'head_pastor', churchId: church })

      await asPrincipal(tx, head.accountId)
      const message = await refusalMessage(tx, () =>
        perform(tx, `SELECT public.set_user_role($1::uuid, $2)`, subject.accountId, role)
      )

      expect(isAuthorizationFailure(message)).toBe(true)
    })
  })

  it.each([
    ['super_admin'], ['head_pastor']
  ])('refuses a Head Pastor acting on an account that already holds %s', async role => {
    // Otherwise the appointment power is also a demotion power, and a Head Pastor could
    // reduce the people who granted it to plain members.
    await withRollback(async tx => {
      const church = await makeChurch(tx)
      const senior = await makePrincipal(tx, { role, churchId: church })
      const head = await makePrincipal(tx, { role: 'head_pastor', churchId: church })

      await asPrincipal(tx, head.accountId)
      const message = await refusalMessage(tx, () =>
        perform(tx, `SELECT public.set_user_role($1::uuid, 'member')`, senior.accountId)
      )

      expect(isAuthorizationFailure(message)).toBe(true)
    })
  })

  it.each([
    ['pastor'], ['church_leader'], ['member'], ['unassigned']
  ])('refuses %s setting any role at all', async role => {
    await withRollback(async tx => {
      const church = await makeChurch(tx)
      const subject = await makePrincipal(tx, { role: 'member', churchId: church })
      const { accountId } = await makePrincipal(tx, { role, churchId: church })

      await asPrincipal(tx, accountId)
      const message = await refusalMessage(tx, () =>
        perform(tx, `SELECT public.set_user_role($1::uuid, 'pastor')`, subject.accountId)
      )

      expect(isAuthorizationFailure(message)).toBe(true)
    })
  })

  it('refuses a role that is not in the whitelist, even from a Super Admin', async () => {
    await withRollback(async tx => {
      const church = await makeChurch(tx)
      const subject = await makePrincipal(tx, { role: 'member', churchId: church })
      const admin = await makePrincipal(tx, { role: 'super_admin', churchId: church })

      await asPrincipal(tx, admin.accountId)
      const message = await refusalMessage(tx, () =>
        perform(tx, `SELECT public.set_user_role($1::uuid, 'root')`, subject.accountId)
      )

      expect(message).toMatch(/invalid role/i)
    })
  })
})

describe.skipIf(!hasDatabase())('assigning a small group leader', () => {
  it.each([
    ['super_admin'], ['head_pastor']
  ])('lets %s assign in any church', async role => {
    await withRollback(async tx => {
      const w = await groupWithCandidate(tx)
      const elsewhere = await makeChurch(tx, 'elsewhere')
      const { accountId } = await makePrincipal(tx, { role, churchId: elsewhere })

      await asPrincipal(tx, accountId)
      await perform(tx, `SELECT public.assign_small_group_leader($1::uuid, $2::uuid)`,
        w.candidate.accountId, w.group)

      await asOwner(tx)
      const rows = await call(tx,
        `SELECT account_id FROM public.small_group_leaders WHERE group_id = $1::uuid`, w.group)
      expect(rows).toHaveLength(1)
    })
  })

  it('lets a Pastor assign within their own church but not another', async () => {
    await withRollback(async tx => {
      const mine = await groupWithCandidate(tx, 'mine')
      const theirs = await groupWithCandidate(tx, 'theirs')
      const { accountId } = await makePrincipal(tx, { role: 'pastor', churchId: mine.church })

      await asPrincipal(tx, accountId)

      const message = await refusalMessage(tx, () =>
        perform(tx, `SELECT public.assign_small_group_leader($1::uuid, $2::uuid)`,
          theirs.candidate.accountId, theirs.group)
      )
      expect(isAuthorizationFailure(message)).toBe(true)

      await perform(tx, `SELECT public.assign_small_group_leader($1::uuid, $2::uuid)`,
        mine.candidate.accountId, mine.group)

      await asOwner(tx)
      const rows = await call(tx,
        `SELECT id FROM public.small_group_leaders WHERE group_id = $1::uuid`, mine.group)
      expect(rows).toHaveLength(1)
    })
  })

  it.each([
    ['church_leader'], ['member'], ['unassigned']
  ])('refuses %s', async role => {
    await withRollback(async tx => {
      const w = await groupWithCandidate(tx)
      const { accountId } = await makePrincipal(tx, { role, churchId: w.church })

      await asPrincipal(tx, accountId)
      const message = await refusalMessage(tx, () =>
        perform(tx, `SELECT public.assign_small_group_leader($1::uuid, $2::uuid)`,
          w.candidate.accountId, w.group)
      )

      expect(isAuthorizationFailure(message)).toBe(true)
    })
  })

  it('refuses someone who is not in the group', async () => {
    await withRollback(async tx => {
      const w = await groupWithCandidate(tx)
      const outsider = await makePrincipal(tx, { role: 'member', churchId: w.church })
      const admin = await makePrincipal(tx, { role: 'super_admin', churchId: w.church })

      await asPrincipal(tx, admin.accountId)
      const message = await refusalMessage(tx, () =>
        perform(tx, `SELECT public.assign_small_group_leader($1::uuid, $2::uuid)`,
          outsider.accountId, w.group)
      )

      expect(message).toMatch(/already be a member of the group/i)
    })
  })

  it('refuses an account with no member record', async () => {
    // The dependency that makes account linking the first slice: assignment against an
    // unlinked account is a no-op that would otherwise look like it worked.
    await withRollback(async tx => {
      const w = await groupWithCandidate(tx)
      const stranger = await makePrincipal(tx, { role: 'member', churchId: null })
      const admin = await makePrincipal(tx, { role: 'super_admin', churchId: w.church })

      await asPrincipal(tx, admin.accountId)
      const message = await refusalMessage(tx, () =>
        perform(tx, `SELECT public.assign_small_group_leader($1::uuid, $2::uuid)`,
          stranger.accountId, w.group)
      )

      expect(message).toMatch(/not linked to a member record/i)
    })
  })

  it('refuses a ministry — only small groups have leaders', async () => {
    await withRollback(async tx => {
      const church = await makeChurch(tx)
      const ministry = await makeMinistry(tx, { label: 'no-leaders-here' })
      const person = await makePrincipal(tx, { role: 'member', churchId: church })
      await addToGroup(tx, ministry, person.memberId)
      const admin = await makePrincipal(tx, { role: 'super_admin', churchId: church })

      await asPrincipal(tx, admin.accountId)
      const message = await refusalMessage(tx, () =>
        perform(tx, `SELECT public.assign_small_group_leader($1::uuid, $2::uuid)`,
          person.accountId, ministry)
      )

      // No alternation. The caller is a SuperAdmin, so 'not authorized' is unreachable
      // here — allowing it would only widen what a broken trigger could still satisfy.
      expect(message).toMatch(/only a small group can have a leader/i)
    })
  })

  it('lets one person lead several groups', async () => {
    await withRollback(async tx => {
      const church = await makeChurch(tx)
      const first = await makeSmallGroup(tx, church, 'first')
      const second = await makeSmallGroup(tx, church, 'second')
      const person = await makePrincipal(tx, { role: 'member', churchId: church })
      await addToGroup(tx, first, person.memberId)
      await addToGroup(tx, second, person.memberId)
      const admin = await makePrincipal(tx, { role: 'super_admin', churchId: church })

      await asPrincipal(tx, admin.accountId)
      await perform(tx, `SELECT public.assign_small_group_leader($1::uuid, $2::uuid)`, person.accountId, first)
      await perform(tx, `SELECT public.assign_small_group_leader($1::uuid, $2::uuid)`, person.accountId, second)

      const [row] = await call(tx, `SELECT public.my_led_group_ids() AS ids`)
      expect(row.ids).toHaveLength(0) // the admin leads nothing

      await asOwner(tx)
      await asPrincipal(tx, person.accountId)
      const [led] = await call(tx, `SELECT public.my_led_group_ids() AS ids`)
      expect(new Set(led.ids)).toEqual(new Set([first, second]))
    })
  })

  it('records who assigned the leader and when', async () => {
    await withRollback(async tx => {
      const w = await groupWithCandidate(tx)
      const admin = await makePrincipal(tx, { role: 'super_admin', churchId: w.church })

      await asPrincipal(tx, admin.accountId)
      await perform(tx, `SELECT public.assign_small_group_leader($1::uuid, $2::uuid)`,
        w.candidate.accountId, w.group)

      await asOwner(tx)
      const [row] = await call(tx,
        `SELECT assigned_by, assigned_at FROM public.small_group_leaders WHERE group_id = $1::uuid`,
        w.group)

      expect(row.assigned_by).toBe(admin.accountId)
      expect(row.assigned_at).toBeInstanceOf(Date)
    })
  })

  it('is idempotent — assigning twice leaves one row', async () => {
    await withRollback(async tx => {
      const w = await groupWithCandidate(tx)
      const admin = await makePrincipal(tx, { role: 'super_admin', churchId: w.church })

      await asPrincipal(tx, admin.accountId)
      await perform(tx, `SELECT public.assign_small_group_leader($1::uuid, $2::uuid)`, w.candidate.accountId, w.group)
      await perform(tx, `SELECT public.assign_small_group_leader($1::uuid, $2::uuid)`, w.candidate.accountId, w.group)

      await asOwner(tx)
      const rows = await call(tx,
        `SELECT id FROM public.small_group_leaders WHERE group_id = $1::uuid`, w.group)
      expect(rows).toHaveLength(1)
    })
  })

  it('lets an authorised caller unassign, and refuses everyone else', async () => {
    await withRollback(async tx => {
      const w = await groupWithCandidate(tx)
      const admin = await makePrincipal(tx, { role: 'super_admin', churchId: w.church })
      const leaderElsewhere = await makePrincipal(tx, { role: 'church_leader', churchId: w.church })

      await asPrincipal(tx, admin.accountId)
      await perform(tx, `SELECT public.assign_small_group_leader($1::uuid, $2::uuid)`, w.candidate.accountId, w.group)

      await asOwner(tx)
      await asPrincipal(tx, leaderElsewhere.accountId)
      const message = await refusalMessage(tx, () =>
        perform(tx, `SELECT public.unassign_small_group_leader($1::uuid, $2::uuid)`, w.candidate.accountId, w.group)
      )
      expect(isAuthorizationFailure(message)).toBe(true)

      await asOwner(tx)
      await asPrincipal(tx, admin.accountId)
      await perform(tx, `SELECT public.unassign_small_group_leader($1::uuid, $2::uuid)`, w.candidate.accountId, w.group)

      await asOwner(tx)
      const rows = await call(tx,
        `SELECT id FROM public.small_group_leaders WHERE group_id = $1::uuid`, w.group)
      expect(rows).toHaveLength(0)
    })
  })
})

describe.skipIf(!hasDatabase())('a leader cannot be dropped from the roster they lead', () => {
  it('refuses removing the leader from the group', async () => {
    await withRollback(async tx => {
      const w = await groupWithCandidate(tx)
      const admin = await makePrincipal(tx, { role: 'super_admin', churchId: w.church })

      await asPrincipal(tx, admin.accountId)
      await perform(tx, `SELECT public.assign_small_group_leader($1::uuid, $2::uuid)`, w.candidate.accountId, w.group)

      const message = await refusalMessage(tx, async () => {
        await tx.$executeRawUnsafe(
          `DELETE FROM public.group_members WHERE group_id = $1::uuid AND member_id = $2::uuid`,
          w.group, w.candidate.memberId)
        // The rule is a deferred constraint trigger; without this it would not run
        // until COMMIT, which this harness never reaches.
        await flushDeferredConstraints(tx)
      })

      expect(message).toMatch(/leads this group/i)
    })
  })

  it('allows the removal once they have been unassigned', async () => {
    await withRollback(async tx => {
      const w = await groupWithCandidate(tx)
      const admin = await makePrincipal(tx, { role: 'super_admin', churchId: w.church })

      await asPrincipal(tx, admin.accountId)
      await perform(tx, `SELECT public.assign_small_group_leader($1::uuid, $2::uuid)`, w.candidate.accountId, w.group)
      await perform(tx, `SELECT public.unassign_small_group_leader($1::uuid, $2::uuid)`, w.candidate.accountId, w.group)

      await asOwner(tx)
      await tx.$executeRawUnsafe(
        `DELETE FROM public.group_members WHERE group_id = $1::uuid AND member_id = $2::uuid`,
        w.group, w.candidate.memberId)
      await flushDeferredConstraints(tx)

      const rows = await call(tx,
        `SELECT id FROM public.group_members WHERE group_id = $1::uuid`, w.group)
      expect(rows).toHaveLength(0)
    })
  })

  it('still allows deleting the whole group, leader and all', async () => {
    // The reason the trigger is deferred. Deleting the group cascades to both tables in
    // an order Postgres does not promise; an immediate check would refuse a legitimate
    // delete, complaining about a leader of a group that is being destroyed anyway.
    await withRollback(async tx => {
      const w = await groupWithCandidate(tx)
      const admin = await makePrincipal(tx, { role: 'super_admin', churchId: w.church })

      await asPrincipal(tx, admin.accountId)
      await perform(tx, `SELECT public.assign_small_group_leader($1::uuid, $2::uuid)`, w.candidate.accountId, w.group)

      await asOwner(tx)
      await tx.$executeRawUnsafe(`DELETE FROM public.groups WHERE id = $1::uuid`, w.group)
      await flushDeferredConstraints(tx)

      const rows = await call(tx,
        `SELECT id FROM public.small_group_leaders WHERE group_id = $1::uuid`, w.group)
      expect(rows).toHaveLength(0)
    })
  })
})

describe.skipIf(!hasDatabase())('what a Small Group Leader may do', () => {
  it('gains attendance and nothing else', async () => {
    await withRollback(async tx => {
      const w = await groupWithCandidate(tx)
      const admin = await makePrincipal(tx, { role: 'super_admin', churchId: w.church })

      await asPrincipal(tx, admin.accountId)
      await perform(tx, `SELECT public.assign_small_group_leader($1::uuid, $2::uuid)`, w.candidate.accountId, w.group)

      await asOwner(tx)
      await asPrincipal(tx, w.candidate.accountId)

      const [p] = await call(tx, `SELECT * FROM public.get_my_permissions()`)
      expect(p.is_small_group_leader).toBe(true)
      expect(p.role).toBe('member')

      const check = async name => {
        const [row] = await call(tx, `SELECT public.${name}() AS value`)
        return row.value
      }

      expect(await check('can_view_attendance')).toBe(true)
      // Everything else stays exactly where a plain member is. No money, in particular:
      // the leader is not concerned with it and neither are their people.
      expect(await check('can_view_finance')).toBe(false)
      expect(await check('can_write_finance')).toBe(false)
      expect(await check('can_see_member_detail')).toBe(false)
      expect(await check('can_write_members')).toBe(false)
      expect(await check('can_manage_small_groups')).toBe(false)
      expect(await check('can_manage_attendance')).toBe(false)
    })
  })

  it('reports no leadership for someone who leads nothing', async () => {
    await withRollback(async tx => {
      const church = await makeChurch(tx)
      const { accountId } = await makePrincipal(tx, { role: 'member', churchId: church })

      await asPrincipal(tx, accountId)
      const [p] = await call(tx, `SELECT * FROM public.get_my_permissions()`)
      const [led] = await call(tx, `SELECT public.my_led_group_ids() AS ids`)

      expect(p.is_small_group_leader).toBe(false)
      expect(led.ids).toEqual([])
    })
  })
})

describe.skipIf(!hasDatabase())('the public role reaches none of it', () => {
  it.each([
    ['small_group_leaders table', `SELECT id FROM public.small_group_leaders`],
    ['list_accounts', `SELECT account_id FROM public.list_accounts()`],
    ['is_small_group_leader', `SELECT public.is_small_group_leader()`],
    ['my_led_group_ids', `SELECT public.my_led_group_ids()`]
  ])('refuses anon on %s', async (_label, sql) => {
    await withRollback(async tx => {
      await asAnon(tx)
      const message = await refusalMessage(tx, () => call(tx, sql))
      expect(isAuthorizationFailure(message)).toBe(true)
    })
  })

  // The writers, which are what the REVOKE block in the migration is actually about.
  // A nil uuid is fine: the grant is checked before the body runs, so these never get
  // far enough for the argument to matter.
  it.each([
    ['link_account_to_member', `SELECT public.link_account_to_member(
       '00000000-0000-0000-0000-000000000000'::uuid, NULL)`],
    ['set_user_role', `SELECT public.set_user_role(
       '00000000-0000-0000-0000-000000000000'::uuid, 'super_admin')`],
    ['assign_small_group_leader', `SELECT public.assign_small_group_leader(
       '00000000-0000-0000-0000-000000000000'::uuid,
       '00000000-0000-0000-0000-000000000000'::uuid)`],
    ['unassign_small_group_leader', `SELECT public.unassign_small_group_leader(
       '00000000-0000-0000-0000-000000000000'::uuid,
       '00000000-0000-0000-0000-000000000000'::uuid)`]
  ])('refuses anon on %s', async (_label, sql) => {
    await withRollback(async tx => {
      await asAnon(tx)
      const message = await refusalMessage(tx, () => perform(tx, sql))
      expect(isAuthorizationFailure(message)).toBe(true)
    })
  })
})

describe.skipIf(!hasDatabase())('0023 — the review fixes', () => {
  it('lets an administrator account be deleted after they have assigned a leader', async () => {
    // assigned_by was NOT NULL with a bare REFERENCES, which defaults to NO ACTION.
    // user_accounts cascades from auth.users, so one assignment was enough to make the
    // administrator permanently undeletable — an audit column blocking erasure of the
    // person it names.
    await withRollback(async tx => {
      const w = await groupWithCandidate(tx)
      const admin = await makePrincipal(tx, { role: 'super_admin', churchId: w.church })

      await asPrincipal(tx, admin.accountId)
      await perform(tx, `SELECT public.assign_small_group_leader($1::uuid, $2::uuid)`,
        w.candidate.accountId, w.group)

      await asOwner(tx)
      await tx.$executeRawUnsafe(`DELETE FROM auth.users WHERE id = $1::uuid`, admin.accountId)

      // The assignment survives, recording that its author is gone.
      const [row] = await call(tx,
        `SELECT assigned_by FROM public.small_group_leaders WHERE group_id = $1::uuid`, w.group)
      expect(row.assigned_by).toBeNull()
    })
  })

  it('refuses to unlink an account that still leads a group', async () => {
    // Otherwise is_small_group_leader() stays true for an account with no member record,
    // which keeps attendance open to someone with no church.
    await withRollback(async tx => {
      const w = await groupWithCandidate(tx)
      const admin = await makePrincipal(tx, { role: 'super_admin', churchId: w.church })

      await asPrincipal(tx, admin.accountId)
      await perform(tx, `SELECT public.assign_small_group_leader($1::uuid, $2::uuid)`,
        w.candidate.accountId, w.group)

      const message = await refusalMessage(tx, () =>
        perform(tx, `SELECT public.link_account_to_member($1::uuid, NULL)`, w.candidate.accountId)
      )

      expect(message).toMatch(/leads a small group/i)
    })
  })

  it('refuses to point a leading account at a different member', async () => {
    // The group would end up with a leader who was never on its roster — exactly the
    // state the deferred trigger exists to prevent, reached by another door.
    await withRollback(async tx => {
      const w = await groupWithCandidate(tx)
      const somebodyElse = await makeMember(tx, w.church, 'other')
      const admin = await makePrincipal(tx, { role: 'super_admin', churchId: w.church })

      await asPrincipal(tx, admin.accountId)
      await perform(tx, `SELECT public.assign_small_group_leader($1::uuid, $2::uuid)`,
        w.candidate.accountId, w.group)

      const message = await refusalMessage(tx, () =>
        perform(tx, `SELECT public.link_account_to_member($1::uuid, $2::uuid)`,
          w.candidate.accountId, somebodyElse)
      )

      expect(message).toMatch(/leads a small group/i)
    })
  })

  it('still allows relinking an account to the member it already has', async () => {
    // Nothing moves, so there is nothing to protect against.
    await withRollback(async tx => {
      const w = await groupWithCandidate(tx)
      const admin = await makePrincipal(tx, { role: 'super_admin', churchId: w.church })

      await asPrincipal(tx, admin.accountId)
      await perform(tx, `SELECT public.assign_small_group_leader($1::uuid, $2::uuid)`,
        w.candidate.accountId, w.group)
      await perform(tx, `SELECT public.link_account_to_member($1::uuid, $2::uuid)`,
        w.candidate.accountId, w.candidate.memberId)

      await asOwner(tx)
      const [row] = await call(tx,
        `SELECT member_id FROM public.user_accounts WHERE id = $1::uuid`, w.candidate.accountId)
      expect(row.member_id).toBe(w.candidate.memberId)
    })
  })

  it('unlinks cleanly once the leadership has been given up', async () => {
    await withRollback(async tx => {
      const w = await groupWithCandidate(tx)
      const admin = await makePrincipal(tx, { role: 'super_admin', churchId: w.church })

      await asPrincipal(tx, admin.accountId)
      await perform(tx, `SELECT public.assign_small_group_leader($1::uuid, $2::uuid)`,
        w.candidate.accountId, w.group)
      await perform(tx, `SELECT public.unassign_small_group_leader($1::uuid, $2::uuid)`,
        w.candidate.accountId, w.group)
      await perform(tx, `SELECT public.link_account_to_member($1::uuid, NULL)`, w.candidate.accountId)

      await asOwner(tx)
      const [row] = await call(tx,
        `SELECT member_id FROM public.user_accounts WHERE id = $1::uuid`, w.candidate.accountId)
      expect(row.member_id).toBeNull()
    })
  })
})

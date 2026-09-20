// Account invitations cross auth.users and public.account_invites. Supabase creates
// the auth row before invited_at is populated, so the account remains unlinked until
// acceptance (0038). Pending-list and resend lookups must therefore use the pending
// invite's member_id, not user_accounts.member_id.

import { randomUUID } from 'node:crypto'
import { describe, it, expect, afterAll } from 'vitest'
import {
  hasDatabase, withRollback, asPrincipal, asOwner, disconnect,
} from './helpers/database.js'
import {
  makeChurch, makeMember, makePrincipal,
} from './helpers/fixtures.js'

afterAll(disconnect)

describe.skipIf(!hasDatabase())('pending account invitations', () => {
  it('keeps an unaccepted, not-yet-linked invite visible and eligible for resend', async () => {
    await withRollback(async tx => {
      const churchId = await makeChurch(tx, 'pending-invite')
      const memberId = await makeMember(tx, churchId, 'invitee')
      const admin = await makePrincipal(tx, { role: 'super_admin', churchId })
      const accountId = randomUUID()
      const email = `zz-invite-${randomUUID()}@example.test`

      await tx.$executeRawUnsafe(
        `UPDATE public.members SET email = $1 WHERE id = $2::uuid`,
        email,
        memberId
      )
      await tx.$executeRawUnsafe(
        `INSERT INTO public.account_invites (email, member_id, role, invited_by)
         VALUES (lower($1), $2::uuid, 'head_pastor', $3::uuid)`,
        email,
        memberId,
        admin.accountId
      )

      // This is the sequence Supabase's invite API actually uses. handle_new_user()
      // sees invited_at as NULL during INSERT, so user_accounts stays unlinked. The
      // acceptance trigger cannot run yet because email_confirmed_at is still NULL.
      await tx.$executeRawUnsafe(
        `INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`,
        accountId,
        email
      )
      await tx.$executeRawUnsafe(
        `UPDATE auth.users SET invited_at = now() WHERE id = $1::uuid`,
        accountId
      )

      const [account] = await tx.$queryRawUnsafe(
        `SELECT member_id FROM public.user_accounts WHERE id = $1::uuid`,
        accountId
      )
      expect(account.member_id).toBeNull()

      await asPrincipal(tx, admin.accountId)

      const pending = await tx.$queryRawUnsafe(
        `SELECT id, member_id, role FROM public.list_pending_invites()`
      )
      expect(pending).toContainEqual(expect.objectContaining({
        id: accountId,
        member_id: memberId,
        role: 'head_pastor',
      }))

      const accounts = await tx.$queryRawUnsafe(
        `SELECT account_id FROM public.list_accounts()`
      )
      expect(accounts).not.toContainEqual({ account_id: accountId })

      const resend = await tx.$queryRawUnsafe(
        `SELECT account_id, member_id, role
           FROM public.invite_to_resend($1)`,
        email
      )
      expect(resend).toEqual([{
        account_id: accountId,
        member_id: memberId,
        role: 'head_pastor',
      }])

      // The Edge Function deletes the unaccepted auth account, then calls
      // invite_member again. The original pending row must not block that fresh send.
      await asOwner(tx)
      await tx.$executeRawUnsafe(
        `DELETE FROM auth.users WHERE id = $1::uuid`,
        accountId
      )

      await asPrincipal(tx, admin.accountId)
      const reinvited = await tx.$queryRawUnsafe(
        `SELECT email, full_name
           FROM public.invite_member($1::uuid, 'head_pastor')`,
        memberId
      )
      expect(reinvited).toEqual([expect.objectContaining({ email })])

      await asOwner(tx)
      const invites = await tx.$queryRawUnsafe(
        `SELECT consumed_at
           FROM public.account_invites
          WHERE lower(email) = lower($1)
          ORDER BY created_at`,
        email
      )
      expect(invites).toHaveLength(2)
      expect(invites.filter(row => row.consumed_at === null)).toHaveLength(1)
      expect(invites.filter(row => row.consumed_at !== null)).toHaveLength(1)
    })
  })

  it('refuses a Church Leader resend that would recreate a privileged role', async () => {
    await withRollback(async tx => {
      const churchId = await makeChurch(tx, 'privileged-resend')
      const memberId = await makeMember(tx, churchId, 'privileged-invitee')
      const admin = await makePrincipal(tx, { role: 'super_admin', churchId })
      const leader = await makePrincipal(tx, { role: 'church_leader', churchId })
      const accountId = randomUUID()
      const email = `zz-privileged-${randomUUID()}@example.test`

      await tx.$executeRawUnsafe(
        `UPDATE public.members SET email = $1 WHERE id = $2::uuid`,
        email,
        memberId
      )
      await tx.$executeRawUnsafe(
        `INSERT INTO public.account_invites (email, member_id, role, invited_by)
         VALUES (lower($1), $2::uuid, 'head_pastor', $3::uuid)`,
        email,
        memberId,
        admin.accountId
      )
      await tx.$executeRawUnsafe(
        `INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`,
        accountId,
        email
      )
      await tx.$executeRawUnsafe(
        `UPDATE auth.users SET invited_at = now() WHERE id = $1::uuid`,
        accountId
      )

      await asPrincipal(tx, leader.accountId)
      const resend = await tx.$queryRawUnsafe(
        `SELECT account_id FROM public.invite_to_resend($1)`,
        email
      )
      expect(resend).toHaveLength(0)

      // The authorization preflight returned no account for the Edge Function to
      // delete, so the pending login remains intact.
      await asOwner(tx)
      const authRows = await tx.$queryRawUnsafe(
        `SELECT id FROM auth.users WHERE id = $1::uuid`,
        accountId
      )
      expect(authRows).toHaveLength(1)
    })
  })

  it.each([
    ['the member email changed', `UPDATE public.members SET email = 'changed@example.test' WHERE id = $1::uuid`],
    ['the member was archived', `UPDATE public.members SET archived_at = now() WHERE id = $1::uuid`],
  ])('refuses resend before deleting the auth account when %s', async (_label, mutateMember) => {
    await withRollback(async tx => {
      const churchId = await makeChurch(tx, 'stale-resend')
      const memberId = await makeMember(tx, churchId, 'stale-invitee')
      const admin = await makePrincipal(tx, { role: 'super_admin', churchId })
      const accountId = randomUUID()
      const email = `zz-stale-${randomUUID()}@example.test`

      await tx.$executeRawUnsafe(
        `UPDATE public.members SET email = $1 WHERE id = $2::uuid`,
        email,
        memberId
      )
      await tx.$executeRawUnsafe(
        `INSERT INTO public.account_invites (email, member_id, role, invited_by)
         VALUES (lower($1), $2::uuid, 'member', $3::uuid)`,
        email,
        memberId,
        admin.accountId
      )
      await tx.$executeRawUnsafe(
        `INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`,
        accountId,
        email
      )
      await tx.$executeRawUnsafe(
        `UPDATE auth.users SET invited_at = now() WHERE id = $1::uuid`,
        accountId
      )
      await tx.$executeRawUnsafe(mutateMember, memberId)

      await asPrincipal(tx, admin.accountId)
      const resend = await tx.$queryRawUnsafe(
        `SELECT account_id FROM public.invite_to_resend($1)`,
        email
      )
      expect(resend).toHaveLength(0)

      await asOwner(tx)
      const authRows = await tx.$queryRawUnsafe(
        `SELECT id FROM auth.users WHERE id = $1::uuid`,
        accountId
      )
      expect(authRows).toHaveLength(1)
    })
  })
})

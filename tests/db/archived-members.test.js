import { describe, it, expect, afterAll } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { hasDatabase, withRollback, asPrincipal, asOwner, refusalMessage, disconnect } from './helpers/database.js'
import { makeChurch, makeMember, makePrincipal, addToGroup, findSystemMinistry } from './helpers/fixtures.js'

afterAll(disconnect)

// Exercise the candidate migration without deploying it. DDL, fixtures, bans, and
// backfill all roll back together; no persistent account access changes occur.
// A migration the target database has already applied is skipped, so the suite runs both
// before and after deployment.
const CANDIDATES = ['0052_archived_members', '0053_awaiting_access_restore_details']
async function candidate(tx) {
  for (const name of CANDIDATES) {
    const path = new URL(`../../prisma/migrations/${name}/migration.sql`, import.meta.url)
    if (!existsSync(path)) continue
    const [applied] = await tx.$queryRawUnsafe(
      'SELECT EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name = $1 AND finished_at IS NOT NULL) AS done', name)
    if (applied.done) continue
    const sql = readFileSync(path, 'utf8').replace(/^BEGIN;\s*/m, '').replace(/^COMMIT;\s*/m, '')
    await tx.$executeRawUnsafe(`DO $candidate$ BEGIN EXECUTE $migration$${sql}$migration$; END $candidate$;`)
  }
}

// The one-time rollout at the end of 0052. Where 0052 is already deployed, run just that
// section against the fixtures; otherwise the whole candidate runs it.
async function rollout(tx) {
  const sql = readFileSync(new URL('../../prisma/migrations/0052_archived_members/migration.sql', import.meta.url), 'utf8')
  const [applied] = await tx.$queryRawUnsafe(
    "SELECT EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name = '0052_archived_members' AND finished_at IS NOT NULL) AS done")
  if (!applied.done) return candidate(tx)
  const section = sql.slice(sql.indexOf('-- Existing archived accounts follow'), sql.indexOf("NOTIFY pgrst, 'reload config'"))
  await tx.$executeRawUnsafe(`DO $rollout$ BEGIN EXECUTE $migration$${section}$migration$; END $rollout$;`)
  await candidate(tx)
}

describe.skipIf(!hasDatabase())('archived members — database/API contract', () => {
  it.each([
    ['pastor', true, true], ['church_leader', true, false], ['head_pastor', false, false], ['member', false, false],
  ])('%s receives only its agreed archive permissions', async (role, read, restore) => {
    await withRollback(async tx => {
      await candidate(tx)
      const church = await makeChurch(tx)
      const admin = await makePrincipal(tx, { role: 'super_admin', churchId: church })
      const viewer = await makePrincipal(tx, { role, churchId: church })
      const member = await makePrincipal(tx, { role: 'member', churchId: church })
      await asPrincipal(tx, admin.accountId)
      await tx.$queryRawUnsafe('SELECT public.archive_member($1::uuid, $2)', member.memberId, 'Moved')
      await asPrincipal(tx, viewer.accountId)
      const list = () => tx.$queryRawUnsafe('SELECT public.list_archived_members($1::uuid) AS r', church)
      if (read) expect((await list())[0].r.rows.map(r => r.id)).toContain(member.memberId)
      else expect(await refusalMessage(tx, list)).toContain('not authorized')
      const recover = () => tx.$queryRawUnsafe('SELECT public.restore_archived_member($1::uuid, $2)', member.memberId, 'Returned')
      if (restore) await recover()
      else expect(await refusalMessage(tx, recover)).toContain('not authorized')
      expect(await refusalMessage(tx, () => tx.$queryRawUnsafe('SELECT public.list_archived_members($1::uuid, $2, 1, true)', church, ''))).toContain('not authorized')
    })
  })

  it('refuses self-archive, protected accounts, cross-church reads, and blank restoration reasons', async () => {
    await withRollback(async tx => {
      await candidate(tx)
      const church = await makeChurch(tx)
      const other = await makeChurch(tx)
      const admin = await makePrincipal(tx, { role: 'super_admin', churchId: church })
      const pastor = await makePrincipal(tx, { role: 'pastor', churchId: church })
      await asPrincipal(tx, pastor.accountId)
      expect(await refusalMessage(tx, () => tx.$queryRawUnsafe('SELECT public.archive_member($1::uuid)', pastor.memberId))).toContain('self_archive')
      expect(await refusalMessage(tx, () => tx.$queryRawUnsafe('SELECT public.archive_member($1::uuid)', admin.memberId))).toContain('protected_account')
      expect(await refusalMessage(tx, () => tx.$queryRawUnsafe('SELECT public.list_archived_members($1::uuid)', other))).toContain('not authorized')
      expect(await refusalMessage(tx, () => tx.$queryRawUnsafe('SELECT public.restore_archived_member($1::uuid, $2)', admin.memberId, '  '))).toContain('restore_reason_required')
    })
  })

  it('rolls back the member, account and history if Auth refuses the ban', async () => {
    await withRollback(async tx => {
      await candidate(tx)
      const church = await makeChurch(tx)
      const admin = await makePrincipal(tx, { role: 'super_admin', churchId: church })
      const member = await makePrincipal(tx, { role: 'member', churchId: church })
      await tx.$executeRawUnsafe(`CREATE FUNCTION public.zz_refuse_archive_ban() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced ban failure'; END $$`)
      await tx.$executeRawUnsafe('CREATE TRIGGER zz_refuse_archive_ban BEFORE UPDATE OF banned_until ON auth.users FOR EACH ROW EXECUTE FUNCTION public.zz_refuse_archive_ban()')
      await asPrincipal(tx, admin.accountId)
      expect(await refusalMessage(tx, () => tx.$queryRawUnsafe('SELECT public.archive_member($1::uuid)', member.memberId))).toContain('forced ban failure')
      const rows = await tx.$queryRawUnsafe('SELECT archived_at FROM public.members WHERE id = $1::uuid', member.memberId)
      expect(rows[0].archived_at).toBeNull()
      await asOwner(tx)
      expect(await tx.$queryRawUnsafe('SELECT id FROM public.member_archive_events WHERE member_id = $1::uuid', member.memberId)).toEqual([])
      const [a] = await tx.$queryRawUnsafe('SELECT archive_disabled_at FROM public.user_accounts WHERE id = $1::uuid', member.accountId)
      expect(a.archive_disabled_at).toBeNull()
    })
  })
  it('keeps a disabled account attached to its archived member until recovery', async () => {
    await withRollback(async tx => {
      await candidate(tx)
      const church = await makeChurch(tx)
      const admin = await makePrincipal(tx, { role: 'super_admin', churchId: church })
      const member = await makePrincipal(tx, { role: 'member', churchId: church })
      await asPrincipal(tx, admin.accountId)
      await tx.$queryRawUnsafe('SELECT public.archive_member($1::uuid, $2)', member.memberId, 'Moved')
      expect(await refusalMessage(tx, () => tx.$executeRawUnsafe('SELECT public.link_account_to_member($1::uuid, NULL::uuid)', member.accountId))).toContain('restore_first')
    })
  })
  it('disables accounts already linked to archived members at rollout without inventing an archive actor', async () => {
    await withRollback(async tx => {
      const church = await makeChurch(tx)
      const member = await makePrincipal(tx, { role: 'member', churchId: church })
      await tx.$executeRawUnsafe("UPDATE public.members SET archived_at = now() - interval '1 year', archived_reason = 'Legacy reason' WHERE id = $1::uuid", member.memberId)
      await rollout(tx)
      await asPrincipal(tx, member.accountId)
      expect(await refusalMessage(tx, () => tx.$queryRawUnsafe('SELECT public.check_archive_access()'))).toContain('account_disabled')
      await asOwner(tx)
      const [account] = await tx.$queryRawUnsafe('SELECT banned_until > now() AS banned FROM auth.users WHERE id = $1::uuid', member.accountId)
      expect(account.banned).toBe(true)
      const events = await tx.$queryRawUnsafe('SELECT actor_id, action FROM public.member_archive_events WHERE member_id = $1::uuid', member.memberId)
      expect(events).toEqual([{ actor_id: null, action: 'disable_at_rollout' }])
    })
  })
  it('refuses a rollout that would disable every active SuperAdmin', async () => {
    await withRollback(async tx => {
      await tx.$executeRawUnsafe(`UPDATE public.members SET archived_at = now()
        WHERE id IN (SELECT member_id FROM public.user_accounts WHERE role = 'super_admin' AND member_id IS NOT NULL)`)
      await tx.$executeRawUnsafe(`UPDATE auth.users SET banned_until = '9999-12-31'
        WHERE id IN (SELECT id FROM public.user_accounts WHERE role = 'super_admin' AND member_id IS NULL)`)
      await makePrincipal(tx, { role: 'super_admin', churchId: await makeChurch(tx) })
        .then(sa => tx.$executeRawUnsafe('UPDATE public.members SET archived_at = now() WHERE id = $1::uuid', sa.memberId))
      expect(await refusalMessage(tx, () => rollout(tx))).toContain('every active SuperAdmin')
    })
  })
  it('lets an account that recorded archive history be deleted later', async () => {
    await withRollback(async tx => {
      await candidate(tx)
      const church = await makeChurch(tx)
      const admin = await makePrincipal(tx, { role: 'super_admin', churchId: church })
      const member = await makePrincipal(tx, { role: 'member', churchId: church })
      await asPrincipal(tx, admin.accountId)
      await tx.$queryRawUnsafe('SELECT public.archive_member($1::uuid, $2)', member.memberId, 'Moved')
      await asOwner(tx)
      await tx.$executeRawUnsafe('DELETE FROM auth.users WHERE id = $1::uuid', admin.accountId)
      const events = await tx.$queryRawUnsafe('SELECT actor_id, action FROM public.member_archive_events WHERE member_id = $1::uuid', member.memberId)
      expect(events).toEqual([{ actor_id: null, action: 'archive' }])
    })
  })
  it('cancels a pending invite and its unaccepted login when the member is archived', async () => {
    await withRollback(async tx => {
      await candidate(tx)
      const church = await makeChurch(tx)
      const admin = await makePrincipal(tx, { role: 'super_admin', churchId: church })
      const memberId = await makeMember(tx, church, 'invitee')
      const invitedId = randomUUID()
      const email = `invitee-${invitedId}@example.test`
      await tx.$executeRawUnsafe('INSERT INTO auth.users (id, email, invited_at) VALUES ($1::uuid, $2, now())', invitedId, email)
      await tx.$executeRawUnsafe('INSERT INTO public.account_invites (email, member_id, role) VALUES ($1, $2::uuid, $3)', email, memberId, 'church_leader')
      await asPrincipal(tx, admin.accountId)
      await tx.$queryRawUnsafe('SELECT public.archive_member($1::uuid, $2)', memberId, 'Moved')
      await asOwner(tx)
      const [invite] = await tx.$queryRawUnsafe('SELECT consumed_at FROM public.account_invites WHERE member_id = $1::uuid', memberId)
      expect(invite.consumed_at).not.toBeNull()
      expect(await tx.$queryRawUnsafe('SELECT id FROM auth.users WHERE id = $1::uuid', invitedId)).toEqual([])
    })
  })
  it('cannot bypass account disabling or restoration history through a direct member update', async () => {
    await withRollback(async tx => {
      await candidate(tx)
      const church = await makeChurch(tx)
      const admin = await makePrincipal(tx, { role: 'super_admin', churchId: church })
      const member = await makePrincipal(tx, { role: 'member', churchId: church })
      await asPrincipal(tx, admin.accountId)
      expect(await refusalMessage(tx, () => tx.$executeRawUnsafe('UPDATE public.members SET archived_at = now() WHERE id = $1::uuid', member.memberId))).toContain('permission denied')
      await tx.$queryRawUnsafe('SELECT public.archive_member($1::uuid, $2)', member.memberId, 'Moved')
      const changed = await tx.$executeRawUnsafe('UPDATE public.members SET first_name = $1 WHERE id = $2::uuid', 'Changed', member.memberId)
      expect(changed).toBe(0)
      expect(await refusalMessage(tx, () => tx.$executeRawUnsafe('UPDATE public.members SET archived_at = NULL WHERE id = $1::uuid', member.memberId))).toContain('permission denied')
    })
  })
  it('requires SuperAdmin confirmation of every current assignment before account recovery', async () => {
    await withRollback(async tx => {
      await candidate(tx)
      const church = await makeChurch(tx)
      const admin = await makePrincipal(tx, { role: 'super_admin', churchId: church })
      const pastor = await makePrincipal(tx, { role: 'pastor', churchId: church })
      const member = await makePrincipal(tx, { role: 'member', churchId: church })
      await asPrincipal(tx, admin.accountId)
      await tx.$queryRawUnsafe('SELECT public.archive_member($1::uuid, $2)', member.memberId, 'Moved away')
      await tx.$queryRawUnsafe('SELECT public.restore_archived_member($1::uuid, $2)', member.memberId, 'Returned')
      expect(await refusalMessage(tx, () => tx.$queryRawUnsafe('SELECT public.enable_archived_account($1::uuid, $2::jsonb)', member.memberId, '[]'))).toContain('assignments_changed')
      const [detail] = await tx.$queryRawUnsafe('SELECT public.archived_member_detail($1::uuid) AS r', member.memberId)
      await asPrincipal(tx, pastor.accountId)
      expect(await refusalMessage(tx, () => tx.$queryRawUnsafe('SELECT public.enable_archived_account($1::uuid, $2::jsonb)', member.memberId, JSON.stringify(detail.r.assignments)))).toContain('not authorized')
      await asPrincipal(tx, admin.accountId)
      await tx.$queryRawUnsafe('SELECT public.enable_archived_account($1::uuid, $2::jsonb)', member.memberId, JSON.stringify(detail.r.assignments))
      const [list] = await tx.$queryRawUnsafe('SELECT public.list_archived_members($1::uuid, $2, 1, true) AS r', church, '')
      expect(list.r.rows).toEqual([])
      await asPrincipal(tx, member.accountId)
      expect(await refusalMessage(tx, () => tx.$queryRawUnsafe('SELECT public.check_archive_access()'))).toContain('account_disabled')
      await asOwner(tx)
      const [account] = await tx.$queryRawUnsafe('SELECT banned_until FROM auth.users WHERE id = $1::uuid', member.accountId)
      expect(account.banned_until).toBeNull()
    })
  })
  it('restores groups and preserves archive history while keeping sign-in disabled', async () => {
    await withRollback(async tx => {
      await candidate(tx)
      const church = await makeChurch(tx)
      const admin = await makePrincipal(tx, { role: 'super_admin', churchId: church })
      const member = await makePrincipal(tx, { role: 'member', churchId: church })
      await addToGroup(tx, await findSystemMinistry(tx, 'secretariat'), member.memberId)
      await asPrincipal(tx, admin.accountId)
      await tx.$queryRawUnsafe('SELECT public.archive_member($1::uuid, $2)', member.memberId, 'Moved away')
      await tx.$queryRawUnsafe('SELECT public.restore_archived_member($1::uuid, $2)', member.memberId, 'Returned to church')
      const [detail] = await tx.$queryRawUnsafe('SELECT public.archived_member_detail($1::uuid) AS r', member.memberId)
      expect(detail.r.archived_at).toBeNull()
      expect(detail.r.disabled_at).not.toBeNull()
      expect(detail.r.restored_reason).toBe('Returned to church')
      expect(detail.r.assignments.some(a => a.label === 'Secretariat')).toBe(true)
      const [list] = await tx.$queryRawUnsafe('SELECT public.list_archived_members($1::uuid, $2, 1, true) AS r', church, '')
      const row = list.r.rows.find(r => r.id === member.memberId)
      expect(row.restored_reason).toBe('Returned to church')
      expect(row.restored_at).not.toBeNull()
      const [byReason] = await tx.$queryRawUnsafe('SELECT public.list_archived_members($1::uuid, $2, 1, true) AS r', church, 'returned to')
      expect(byReason.r.rows.map(r => r.id)).toContain(member.memberId)
      await asOwner(tx)
      const events = await tx.$queryRawUnsafe('SELECT action, reason FROM public.member_archive_events WHERE member_id = $1::uuid ORDER BY occurred_at', member.memberId)
      expect(events).toEqual([{ action: 'archive', reason: 'Moved away' }, { action: 'restore', reason: 'Returned to church' }])
    })
  })
  it('archives a linked member and rejects their existing session in the same operation', async () => {
    await withRollback(async tx => {
      await candidate(tx)
      const church = await makeChurch(tx)
      const pastor = await makePrincipal(tx, { role: 'pastor', churchId: church })
      const member = await makePrincipal(tx, { role: 'member', churchId: church })
      await addToGroup(tx, await findSystemMinistry(tx, 'secretariat'), member.memberId)
      await asPrincipal(tx, pastor.accountId)
      const [result] = await tx.$queryRawUnsafe('SELECT public.archive_member($1::uuid, $2) AS r', member.memberId, 'Moved away')
      expect(result.r.id).toBe(member.memberId)
      await asPrincipal(tx, member.accountId)
      expect(await refusalMessage(tx, () => tx.$queryRawUnsafe('SELECT public.check_archive_access()'))).toContain('account_disabled')
      const [permissions] = await tx.$queryRawUnsafe('SELECT public.is_secretariat() AS allowed')
      expect(permissions.allowed).toBe(false)
      await asOwner(tx)
      const [account] = await tx.$queryRawUnsafe('SELECT banned_until > now() AS banned FROM auth.users WHERE id = $1::uuid', member.accountId)
      expect(account.banned).toBe(true)
    })
  })
})

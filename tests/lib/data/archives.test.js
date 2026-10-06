import { beforeEach, describe, expect, it, vi } from 'vitest'

const remote = vi.hoisted(() => ({ result: { data: null, error: null } }))
vi.mock('../../../src/lib/supabase', () => ({ supabase: { rpc: vi.fn(async () => remote.result) } }))
const { listArchivedMembers, restoreMember, enableAccount, archiveMember, getArchivedMember } = await import('../../../src/lib/data/archives')

beforeEach(() => { remote.result = { data: null, error: null } })

describe('archive data boundary', () => {
  it('loads read-only detail and enables an account only after confirming every assignment', async () => {
    remote.result.data = { id: 'member-1', assignments: [{ key: 'role:member', label: 'Member', kind: 'Role' }] }
    expect(await getArchivedMember({ id: 'member-1', canRead: true })).toMatchObject({ ok: true, member: remote.result.data })
    expect(await enableAccount({ id: 'member-1', assignments: remote.result.data.assignments, confirmedKeys: [] })).toMatchObject({ ok: false })
    expect(await enableAccount({ id: 'member-1', assignments: remote.result.data.assignments, confirmedKeys: ['role:member'] })).toMatchObject({ ok: true })
  })
  it('explains archive safeguards without showing database details', async () => {
    remote.result.error = { code: 'AR001', message: 'sensitive database text' }
    expect(await archiveMember({ id: 'member-1' })).toMatchObject({ ok: false, message: "You cannot archive your own record. Ask another authorized person to do it." })
    remote.result.error = { code: '23514', message: 'private member data' }
    const result = await archiveMember({ id: 'member-1' })
    expect(result.ok).toBe(false)
    expect(result.message).not.toContain('private')
  })
  it('requires a restoration reason and does not report an empty backend reply as success', async () => {
    expect(await restoreMember({ id: 'member-1', reason: '  ' })).toMatchObject({ ok: false, message: 'Enter a reason for restoring this member.' })
    expect(await restoreMember({ id: 'member-1', reason: 'Returned' })).toMatchObject({ ok: false })
  })
  it('returns the scoped search results and both queue counts', async () => {
    remote.result.data = { rows: [{ id: 'member-1', first_name: 'Ana' }], total: 1, archived_count: 6, awaiting_count: 2 }
    expect(await listArchivedMembers({ churchId: 'church-1', canRead: true, query: 'Ana' })).toMatchObject({
      ok: true, rows: [{ id: 'member-1', first_name: 'Ana' }], total: 1, archivedCount: 6, awaitingCount: 2,
    })
  })
})

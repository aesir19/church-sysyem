import { describe, it, expect, vi, beforeEach } from 'vitest'

// The RPC-shaped sibling of groups.test.js. Everything here goes through supabase.rpc
// or one .from(), so a single recording mock is enough — unlike listGroups, which fires
// two concurrent queries against different tables and needs a builder per table.

const state = vi.hoisted(() => ({ rpc: {}, from: null, calls: [], invoke: null }))

vi.mock('../../../src/lib/supabase', () => ({
  supabase: {
    rpc: vi.fn((name, args) => {
      state.calls.push(['rpc', name, args])
      const result = state.rpc[name] ?? { data: [], error: null }
      // Real supabase.rpc returns a thenable builder; writeRpc awaits it directly.
      return Promise.resolve(result)
    }),
    functions: {
      invoke: vi.fn((name, opts) => {
        state.calls.push(['invoke', name, opts?.body])
        return Promise.resolve(state.invoke ?? { data: { ok: true }, error: null })
      })
    },
    from: vi.fn(table => {
      state.calls.push(['from', table])
      const builder = {
        select: vi.fn(function (cols) { state.calls.push(['select', cols]); return this }),
        in: vi.fn(function (col, vals) { state.calls.push(['in', col, vals]); return this }),
        then (onFulfilled, onRejected) {
          return Promise.resolve(state.from ?? { data: [], error: null })
            .then(onFulfilled, onRejected)
        }
      }
      return builder
    })
  }
}))

const {
  listAccounts, listChurchAccounts, listChurches, linkAccount, setUserRole,
  assignSmallGroupLeader, unassignSmallGroupLeader, listGroupLeaders,
  listPendingInvites, inviteAccount, resendInvite, cancelInvite, ADMIN_MESSAGES
} = await import('../../../src/lib/data/admin')

const rpcCalls = name => state.calls.filter(c => c[0] === 'rpc' && c[1] === name)
const invokeCalls = () => state.calls.filter(c => c[0] === 'invoke')

beforeEach(() => {
  state.rpc = {}
  state.from = null
  state.calls = []
  state.invoke = null
})

describe('listAccounts', () => {
  it('refuses without the capability, and does not call the database', async () => {
    // The RPC returns an empty set rather than raising when the caller is not allowed,
    // so a screen that only looked at row count could not tell "nobody is waiting" from
    // "not yours to see". Stopping here is what keeps those two apart.
    const res = await listAccounts({ canManageAccounts: false })

    expect(res.ok).toBe(false)
    expect(res.permitted).toBe(false)
    expect(res.message).toBe(ADMIN_MESSAGES.notPermitted)
    expect(rpcCalls('list_accounts')).toHaveLength(0)
  })

  it('splits the accounts into those waiting for a member record and those linked', async () => {
    state.rpc.list_accounts = {
      data: [
        { account_id: 'a1', email: 'new@example.test', member_id: null, role: 'unassigned' },
        { account_id: 'a2', email: 'known@example.test', member_id: 'm2', role: 'pastor' }
      ],
      error: null
    }

    const res = await listAccounts({ canManageAccounts: true })

    expect(res.ok).toBe(true)
    expect(res.rows).toHaveLength(2)
    expect(res.waiting.map(r => r.account_id)).toEqual(['a1'])
    expect(res.linked.map(r => r.account_id)).toEqual(['a2'])
  })

  it('treats an account with no member, church or role as normal, not as broken data', async () => {
    state.rpc.list_accounts = {
      data: [{ account_id: 'a1', email: 'new@example.test', member_id: null, church_id: null, role: 'unassigned' }],
      error: null
    }

    const res = await listAccounts({ canManageAccounts: true })

    expect(res.ok).toBe(true)
    expect(res.waiting).toHaveLength(1)
  })

  it('reports a failure rather than an empty queue', async () => {
    state.rpc.list_accounts = { data: null, error: { message: 'boom' } }

    const res = await listAccounts({ canManageAccounts: true })

    expect(res.ok).toBe(false)
    expect(res.message).toBe(ADMIN_MESSAGES.loadFailed)
    expect(res.rows).toEqual([])
  })
})

describe('listChurchAccounts', () => {
  it('refuses without the capability', async () => {
    const res = await listChurchAccounts({ canAssignPastors: false })

    expect(res.permitted).toBe(false)
    expect(rpcCalls('list_church_accounts')).toHaveLength(0)
  })

  it('passes the church through, and null for every church', async () => {
    await listChurchAccounts({ churchId: 'c1', canAssignPastors: true })
    await listChurchAccounts({ canAssignPastors: true })

    expect(rpcCalls('list_church_accounts')[0][2]).toEqual({ p_church_id: 'c1' })
    expect(rpcCalls('list_church_accounts')[1][2]).toEqual({ p_church_id: null })
  })
})

describe('listChurches', () => {
  it('refuses without the capability', async () => {
    const res = await listChurches({ canAssignPastors: false })

    expect(res.permitted).toBe(false)
    expect(rpcCalls('list_churches')).toHaveLength(0)
  })

  it('returns the churches', async () => {
    state.rpc.list_churches = { data: [{ id: 'c1', name: 'Bethel' }], error: null }

    const res = await listChurches({ canAssignPastors: true })

    expect(res.ok).toBe(true)
    expect(res.rows).toEqual([{ id: 'c1', name: 'Bethel' }])
  })
})

describe('the writes', () => {
  it('links an account to a member', async () => {
    state.rpc.link_account_to_member = { data: null, error: null }

    const res = await linkAccount({ accountId: 'a1', memberId: 'm1' })

    expect(res.ok).toBe(true)
    expect(rpcCalls('link_account_to_member')[0][2]).toEqual({ p_account: 'a1', p_member: 'm1' })
  })

  it('unlinks by passing a null member', async () => {
    state.rpc.link_account_to_member = { data: null, error: null }

    await linkAccount({ accountId: 'a1', memberId: null })

    expect(rpcCalls('link_account_to_member')[0][2]).toEqual({ p_account: 'a1', p_member: null })
  })

  it('reports a refused link as a failure with a message, never as success', async () => {
    // These RPCs return void, so there is no row count to inspect — a refusal arrives
    // as a raised error and nothing else. Reporting it as saved is the exact defect
    // write.js was written to stop.
    state.rpc.link_account_to_member = { data: null, error: { code: '42501', message: 'not authorized' } }

    const res = await linkAccount({ accountId: 'a1', memberId: 'm1' })

    expect(res.ok).toBe(false)
    expect(res.message).toBeTruthy()
  })

  it('surfaces the leader guard as a failure', async () => {
    state.rpc.link_account_to_member = {
      data: null,
      error: { code: '23503', message: 'that account leads a small group — unassign them as leader first' }
    }

    const res = await linkAccount({ accountId: 'a1', memberId: null })

    expect(res.ok).toBe(false)
  })

  it('sets a role', async () => {
    state.rpc.set_user_role = { data: null, error: null }

    const res = await setUserRole({ accountId: 'a1', role: 'pastor' })

    expect(res.ok).toBe(true)
    expect(rpcCalls('set_user_role')[0][2]).toEqual({ p_target: 'a1', p_role: 'pastor' })
  })

  it('assigns and unassigns a small group leader', async () => {
    state.rpc.assign_small_group_leader = { data: null, error: null }
    state.rpc.unassign_small_group_leader = { data: null, error: null }

    expect((await assignSmallGroupLeader({ accountId: 'a1', groupId: 'g1' })).ok).toBe(true)
    expect((await unassignSmallGroupLeader({ accountId: 'a1', groupId: 'g1' })).ok).toBe(true)

    expect(rpcCalls('assign_small_group_leader')[0][2]).toEqual({ p_account: 'a1', p_group: 'g1' })
    expect(rpcCalls('unassign_small_group_leader')[0][2]).toEqual({ p_account: 'a1', p_group: 'g1' })
  })

  it('reports a refused assignment', async () => {
    state.rpc.assign_small_group_leader = { data: null, error: { code: '42501', message: 'not authorized' } }

    const res = await assignSmallGroupLeader({ accountId: 'a1', groupId: 'g1' })

    expect(res.ok).toBe(false)
  })
})

describe('listPendingInvites', () => {
  it('refuses without the invite capability, and does not call the database', async () => {
    const res = await listPendingInvites({ canInvite: false })

    expect(res.ok).toBe(false)
    expect(res.permitted).toBe(false)
    expect(res.message).toBe(ADMIN_MESSAGES.notPermitted)
    expect(rpcCalls('list_pending_invites')).toHaveLength(0)
  })

  it('returns the pending rows the RPC scoped to the caller', async () => {
    state.rpc.list_pending_invites = {
      data: [{ id: 'i1', email: 'new@example.test', full_name: 'Ana Cruz', role: null }],
      error: null
    }

    const res = await listPendingInvites({ canInvite: true })

    expect(res.ok).toBe(true)
    expect(res.rows).toHaveLength(1)
    expect(res.rows[0].email).toBe('new@example.test')
  })

  it('reports a failure rather than an empty queue', async () => {
    state.rpc.list_pending_invites = { data: null, error: { message: 'boom' } }

    const res = await listPendingInvites({ canInvite: true })

    expect(res.ok).toBe(false)
    expect(res.message).toBe(ADMIN_MESSAGES.loadFailed)
  })
})

describe('inviteAccount', () => {
  it('sends the member and role through the Edge Function in invite mode — never an e-mail', async () => {
    // Member-first (ADR-0019): the address is derived server-side from the member, so
    // the client passes only who to invite. The e-mail comes back on success.
    state.invoke = { data: { ok: true, full_name: 'Ana Cruz', email: 'ana@example.test' }, error: null }

    const res = await inviteAccount({ memberId: 'm1', role: 'member' })

    expect(res.ok).toBe(true)
    expect(res.fullName).toBe('Ana Cruz')
    expect(res.email).toBe('ana@example.test')
    expect(invokeCalls()[0][1]).toBe('invite-user')
    expect(invokeCalls()[0][2]).toEqual({ member_id: 'm1', role: 'member', mode: 'invite' })
    // The client must not send an address — that is the whole point of the change.
    expect(invokeCalls()[0][2]).not.toHaveProperty('email')
  })

  it('passes null role through untouched (a Church Leader sets none)', async () => {
    state.invoke = { data: { ok: true }, error: null }

    await inviteAccount({ memberId: 'm1' })

    expect(invokeCalls()[0][2]).toEqual({ member_id: 'm1', role: null, mode: 'invite' })
  })

  it('surfaces the caller-safe message the function returned on the error body', async () => {
    // supabase-js hides the response body on `error`; the caller-safe line is read
    // back off error.context (the raw Response). This is exactly that path.
    state.invoke = {
      data: null,
      error: { context: { json: async () => ({ error: 'that member has no e-mail on file' }) } }
    }

    const res = await inviteAccount({ memberId: 'm1', role: 'member' })

    expect(res.ok).toBe(false)
    expect(res.message).toBe('that member has no e-mail on file')
  })

  it('falls back to a generic message when the error body cannot be read', async () => {
    state.invoke = { data: null, error: { message: 'network' } }

    const res = await inviteAccount({ memberId: 'm1', role: 'member' })

    expect(res.ok).toBe(false)
    expect(res.message).toBe(ADMIN_MESSAGES.inviteFailed)
  })
})

describe('cancelInvite', () => {
  it('cancels by e-mail through the Edge Function in cancel mode', async () => {
    state.invoke = { data: { ok: true, full_name: 'Ana Cruz' }, error: null }

    const res = await cancelInvite({ email: 'new@example.test' })

    expect(res.ok).toBe(true)
    expect(invokeCalls()[0][2]).toEqual({ email: 'new@example.test', mode: 'cancel' })
  })

  it('reports the function refusal', async () => {
    state.invoke = {
      data: null,
      error: { context: { json: async () => ({ error: 'There is no pending invitation you can cancel for that address.' }) } }
    }

    const res = await cancelInvite({ email: 'new@example.test' })

    expect(res.ok).toBe(false)
    expect(res.message).toBe('There is no pending invitation you can cancel for that address.')
  })

  it('falls back to a generic message when the error body cannot be read', async () => {
    state.invoke = { data: null, error: { message: 'network' } }

    const res = await cancelInvite({ email: 'x@example.test' })

    expect(res.ok).toBe(false)
    expect(res.message).toBe(ADMIN_MESSAGES.cancelFailed)
  })
})

describe('resendInvite', () => {
  it('re-sends by e-mail with no member and resend mode', async () => {
    state.invoke = { data: { ok: true }, error: null }

    const res = await resendInvite({ email: 'new@example.test' })

    expect(res.ok).toBe(true)
    expect(invokeCalls()[0][2]).toEqual({ email: 'new@example.test', mode: 'resend' })
  })

  it('reports the function refusal', async () => {
    state.invoke = {
      data: null,
      error: { context: { json: async () => ({ error: 'You are not allowed to resend that invitation.' }) } }
    }

    const res = await resendInvite({ email: 'new@example.test' })

    expect(res.ok).toBe(false)
    expect(res.message).toBe('You are not allowed to resend that invitation.')
  })
})

describe('listGroupLeaders', () => {
  it('asks for nothing when there are no groups on screen', async () => {
    const res = await listGroupLeaders({ groupIds: [] })

    expect(res.ok).toBe(true)
    expect(res.byGroup.size).toBe(0)
    expect(state.calls.filter(c => c[0] === 'from')).toHaveLength(0)
  })

  it('keys the leaders by group so a card can look its own up', async () => {
    state.from = {
      data: [
        { group_id: 'g1', account_id: 'a1', assigned_at: '2026-01-01' },
        { group_id: 'g2', account_id: 'a2', assigned_at: '2026-01-02' }
      ],
      error: null
    }

    const res = await listGroupLeaders({ groupIds: ['g1', 'g2'] })

    expect(res.byGroup.get('g1').account_id).toBe('a1')
    expect(res.byGroup.get('g2').account_id).toBe('a2')
  })

  it('returns an empty map on failure rather than pretending no group has a leader', async () => {
    state.from = { data: null, error: { message: 'boom' } }

    const res = await listGroupLeaders({ groupIds: ['g1'] })

    expect(res.ok).toBe(false)
    expect(res.byGroup.size).toBe(0)
  })
})

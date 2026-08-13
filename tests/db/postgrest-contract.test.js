// The shapes the browser actually asks for, asked over HTTP.
//
// WHY THIS IS SEPARATE FROM THE OTHER TWO SUITES
// The sibling suites talk direct SQL, which is the right way to test a policy and the
// wrong way to test the API in front of it. PostgREST resolves resource embedding —
// `members!inner(...)` — through foreign key constraints, so an embed can break for
// reasons no amount of SQL will reveal. That is not hypothetical: the first design for
// #74 put a UNION ALL view named `group_members` in front of two split tables, and
// PostgREST refused every embed against it with PGRST200 because a union view
// participates in no foreign key. Direct SQL against that same view worked perfectly.
//
// So this file exists to hold the other end of the contract. After a schema change,
// the sibling suites answer "does everyone still have exactly the permissions they
// had", and this one answers "can the application still ask its questions at all".
// Neither can answer the other's.
//
// READ-ONLY, DELIBERATELY. There is no transaction and nothing to roll back, because
// these requests go over HTTP as a real signed-in user and there is no way to unwind
// them. Every request here is a GET. Nothing in this file may ever write.
//
// The queries are copied from the call sites and should be kept in step with them:
//   src/lib/data/groups.js          — the group card grid
//   src/lib/data/members.js         — MEMBER_GROUPS_EMBED, the members table
//   src/components/groups/GroupDetailModal.vue — the group roster
//
// It signs in with the standing staging account in .env.staging rather than creating a
// principal, because a REST request needs a real JWT from the auth service and there
// is no rollback to clean up after one. That account's role decides what comes back,
// so these assert on the request being *accepted*, never on the rows — a 200 with zero
// rows is a pass. What is being tested is whether the query is expressible.

import { describe, it, expect, beforeAll } from 'vitest'
import { hasDatabase } from './helpers/database.js'

const url = process.env.VITE_SUPABASE_URL
const anonKey = process.env.VITE_SUPABASE_ANON_KEY
const email = process.env.USERNAME
const password = process.env.PASSWORD

const configured = hasDatabase() && !!(url && anonKey && email && password)

let jwt = null

beforeAll(async () => {
  if (!configured) return

  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password })
  })

  if (!response.ok) {
    // Loud, and without echoing the body — it can carry the address that failed.
    throw new Error(
      `could not sign in to staging as the standing test account (${response.status}). ` +
      'Check USERNAME and PASSWORD in .env.staging.'
    )
  }

  jwt = (await response.json()).access_token
})

/** GET a PostgREST query and return the status and, on failure, the message. */
async function get (query) {
  const response = await fetch(`${url}/rest/v1/${query}`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${jwt}` }
  })

  if (response.ok) return { ok: true, status: response.status, detail: '' }

  // PostgREST reports an unresolvable embed as PGRST200 with a message naming both
  // sides, which is the single most useful string to put in front of whoever broke it.
  const body = await response.text()
  return { ok: false, status: response.status, detail: body.slice(0, 400) }
}

describe.skipIf(!configured)('the queries the application makes are expressible', () => {
  it.each([
    [
      'group card grid — memberships with member names (lib/data/groups.js)',
      'group_members?select=group_id,member_id,members!inner(first_name,last_name,member_of)&limit=1'
    ],
    [
      'group roster — one group\'s memberships with names (GroupDetailModal.vue)',
      'group_members?select=id,member_id,members!inner(first_name,last_name,member_of)&limit=1'
    ],
    [
      'members table — the nested groups embed (MEMBER_GROUPS_EMBED, lib/data/members.js)',
      'members?select=id,first_name,last_name,group_members(groups(id,name,type))&limit=1'
    ],
    [
      'group card grid — the groups themselves, with the type/church union filter',
      'groups?select=id,name,type,church_id,color_slot,ministry_key&limit=1'
    ],
    [
      'overview — bare membership ids (lib/data/overview.js)',
      'group_members?select=member_id&limit=1'
    ]
  ])('%s', async (_label, query) => {
    const result = await get(query)

    expect(
      result.ok,
      `PostgREST rejected this query with ${result.status}. If this is PGRST200, a ` +
      `relationship the application depends on is no longer resolvable — most likely ` +
      `a table became a view that participates in no foreign key.\n${result.detail}`
    ).toBe(true)
  })

  it('reports a genuinely unresolvable embed rather than passing everything', async () => {
    // The canary. Without it, a harness that silently returned ok for every request
    // would look identical to one that works, and this whole file would be theatre.
    const result = await get('group_members?select=id,churches!inner(name)&limit=1')

    expect(result.ok).toBe(false)
    expect(result.detail).toContain('PGRST200')
  })
})

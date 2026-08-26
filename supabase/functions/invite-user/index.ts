// invite-user — the only place account invitations are sent. See ADR-0018.
//
// The service-role key lives here as a function secret and NOWHERE else. It is
// used for exactly one thing: the auth.admin invite call that creates the account
// and mails the link. It is NEVER used to decide who may invite — that decision is
// the database's, made under the caller's own JWT via invite_member(). Strip the
// RPC out and this function has no authority a caller didn't already have.
//
// Flow:
//   1. Verify the caller (platform verify_jwt) and read their token.
//   2. As the caller, call invite_member(email, member, role) — it enforces every
//      rule and records the invite. If it raises, we send nothing.
//   3. Only then, as service-role, inviteUserByEmail(). Its creation of the
//      auth.users row fires handle_new_user(), which links the member atomically.
//
// Secrets (supabase secrets set):
//   SERVICE_ROLE_KEY      — the service-role key. NOT SUPABASE_SERVICE_ROLE_KEY,
//                           which the platform reserves; we set our own name.
//   INVITE_REDIRECT_URL   — where the e-mail link lands, e.g.
//                           https://<site>/set-password (must be an allowed
//                           redirect URL in Auth settings).
// Provided by the platform: SUPABASE_URL, SUPABASE_ANON_KEY.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })

// Postgres error codes invite_member raises, mapped to HTTP + a caller-safe line.
// Anything unmapped becomes a generic 400 so we never leak a raw DB string.
function classifyRpcError(err: { code?: string; message?: string }): { status: number; message: string } {
  const msg = err?.message || ''
  switch (err?.code) {
    case '42501': return { status: 403, message: 'You are not allowed to invite for that member.' }
    case '23505': return { status: 409, message: msg || 'That invite already exists.' }
    case '23503': return { status: 400, message: 'That member could not be found or is no longer active.' }
    case '22023': return { status: 400, message: 'That e-mail address is not valid.' }
    default:      return { status: 400, message: 'That invitation could not be sent.' }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'missing authorization' }, 401)

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
  const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY')
  const REDIRECT_URL = Deno.env.get('INVITE_REDIRECT_URL')

  if (!SERVICE_ROLE_KEY || !REDIRECT_URL) {
    // A deploy that forgot its secrets fails closed and loud, not silently.
    return json({ error: 'invite sending is not configured' }, 500)
  }

  let body: { email?: string; member_id?: string; role?: string | null; mode?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid request body' }, 400)
  }

  const email = (body.email || '').trim()
  const mode = body.mode === 'resend' ? 'resend' : 'invite'
  if (!email) return json({ error: 'an e-mail address is required' }, 400)

  // The caller's own client — every RLS/role check runs as them, never as service-role.
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })

  // The service-role client, built after (never before) the caller is authorised.
  // Used only for the auth admin calls — delete an un-accepted account, send mail.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  let member: string
  let role: string | null
  let fullName: string | null = null

  if (mode === 'invite') {
    if (!body.member_id) return json({ error: 'a member is required' }, 400)
    member = body.member_id
    role = body.role ?? null
  } else {
    // Resend has no admin "re-mail an existing account" through the built-in
    // mailer, so it CLEARS the un-accepted account and invites fresh. First find
    // the still-pending account the caller is allowed to resend (own church, for a
    // Church Leader) and recover its member/role/name.
    const { data, error } = await caller.rpc('invite_to_resend', { p_email: email })
    if (error) return json({ error: 'that invitation could not be resent.' }, 400)
    const row = Array.isArray(data) ? data[0] : data
    if (!row) return json({ error: 'There is no pending invitation you can resend for that address.' }, 403)

    member = row.member_id
    role = row.role ?? null

    // Delete the un-accepted account. The auth.users FK cascades user_accounts, so
    // the member is unlinked and invite_member below will accept it again. Deleting
    // is safe because invite_to_resend only returned an account with no confirmed
    // e-mail — nobody has accepted it.
    const { error: delError } = await admin.auth.admin.deleteUser(row.account_id)
    if (delError) return json({ error: 'that invitation could not be resent.' }, 502)
  }

  // Record the (fresh) invite as the caller, so the member/role authority is
  // re-checked under their identity. On resend this re-inserts the row the delete
  // above freed up. If it raises, nothing is sent.
  const { data: inviteData, error: rpcError } = await caller.rpc('invite_member', {
    p_email: email,
    p_member: member,
    p_role: role,
  })
  if (rpcError) {
    const { status, message } = classifyRpcError(rpcError)
    return json({ error: message }, status)
  }
  fullName = (inviteData as string) ?? null

  // Authorised and recorded. Now send the e-mail (creates the auth.users row,
  // which the trigger links to the member atomically).
  const { error: sendError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: REDIRECT_URL,
    data: fullName ? { full_name: fullName } : undefined,
  })
  if (sendError) {
    return json({ error: 'The account was recorded but the e-mail could not be sent. Try Resend.' }, 502)
  }

  return json({ ok: true, full_name: fullName })
})

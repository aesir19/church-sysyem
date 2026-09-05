// invite-user — the only place account invitations are sent, resent or cancelled.
// See ADR-0018 (the seam) and ADR-0019 (member-first + cancel).
//
// The service-role key lives here as a function secret and NOWHERE else. It is used
// for exactly two things: the auth.admin invite call that creates the account and
// mails the link, and the auth.admin delete call that removes an un-accepted account
// (on resend and cancel). It is NEVER used to decide who may act — that decision is
// the database's, made under the caller's own JWT via the RPCs below. Strip the RPCs
// out and this function has no authority a caller didn't already have.
//
// Flow (invite):
//   1. Verify the caller (platform verify_jwt) and read their token.
//   2. As the caller, call invite_member(member, role) — it enforces every rule,
//      derives the member's e-mail (the caller never supplies one) and records the
//      invite. If it raises, we send nothing.
//   3. Only then, as service-role, inviteUserByEmail() to the address it returned.
//      Its creation of the auth.users row fires handle_new_user(), which links the
//      member atomically.
//
// Flow (cancel): as the caller, invite_to_cancel(email) says whether they may cancel
// and hands back the un-accepted account to delete (NULL if the login is already
// gone — an orphaned invite). Delete it as service-role (cascades user_accounts,
// unlinking the member), THEN cancel_invite(email) clears the invite record. Order
// matters: clearing the record before deleting the account would leave the member
// linked and re-invite would refuse.
//
// Secrets (supabase secrets set):
//   SERVICE_ROLE_KEY      — the service-role key. NOT SUPABASE_SERVICE_ROLE_KEY,
//                           which the platform reserves; we set our own name.
//   INVITE_REDIRECT_URL   — OPTIONAL fallback base URL for the e-mail link, used
//                           only when the request carries no Origin (a non-browser
//                           caller). Normally the link returns to the ORIGIN the app
//                           was called from. Every such origin must be listed under
//                           Auth → URL Configuration → Redirect URLs.
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

// Postgres error codes the invite RPCs raise, mapped to HTTP + a caller-safe line.
// Anything unmapped becomes a generic 400 so we never leak a raw DB string. For 23505
// and 22023 the raised message is already caller-safe and specific ("that member has
// no e-mail on file", "that email already has an account"), so it is preferred.
function classifyRpcError(err: { code?: string; message?: string }): { status: number; message: string } {
  const msg = err?.message || ''
  switch (err?.code) {
    case '42501': return { status: 403, message: 'You are not allowed to do that for this member.' }
    case '23505': return { status: 409, message: msg || 'That invite already exists.' }
    case '23503': return { status: 400, message: 'That member could not be found or is no longer active.' }
    case '22023': return { status: 400, message: msg || 'That invitation could not be sent.' }
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

  if (!SERVICE_ROLE_KEY) {
    // A deploy that forgot its secret fails closed and loud, not silently.
    return json({ error: 'invite sending is not configured' }, 500)
  }

  // The link returns to wherever the app was called from — localhost in dev, the site
  // in production — so no secret changes between environments. Supabase only honours a
  // redirect that is in its allowed list, so an attacker cannot bend this into an open
  // redirect by forging Origin. Falls back to a configured base for a caller with no
  // Origin (non-browser).
  const originBase = req.headers.get('Origin') || Deno.env.get('INVITE_REDIRECT_URL')
  if (!originBase) return json({ error: 'invite sending is not configured' }, 500)
  const REDIRECT_URL = `${originBase.replace(/\/+$/, '')}/set-password`

  let body: { email?: string; member_id?: string; role?: string | null; mode?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid request body' }, 400)
  }

  const email = (body.email || '').trim()
  const mode = body.mode === 'resend' ? 'resend' : body.mode === 'cancel' ? 'cancel' : 'invite'

  // The caller's own client — every RLS/role check runs as them, never as service-role.
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })

  // The service-role client, built after (never before) the caller is authorised.
  // Used only for the auth admin calls — delete an un-accepted account, send mail.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // --- Cancel: withdraw a pending invite (live or orphaned) -------------------
  if (mode === 'cancel') {
    if (!email) return json({ error: 'an e-mail address is required' }, 400)

    // Who, if anyone, may cancel this — and the un-accepted account to delete.
    const { data, error } = await caller.rpc('invite_to_cancel', { p_email: email })
    if (error) return json({ error: 'that invitation could not be cancelled.' }, 400)
    const row = Array.isArray(data) ? data[0] : data
    if (!row) return json({ error: 'There is no pending invitation you can cancel for that address.' }, 403)

    // Delete the un-accepted login first, so its FK cascade unlinks the member before
    // we clear the invite record. Skipped for an orphan, whose login is already gone.
    if (row.account_id) {
      const { error: delError } = await admin.auth.admin.deleteUser(row.account_id)
      if (delError) return json({ error: 'that invitation could not be cancelled.' }, 502)
    }

    // Release the invite record so the member and e-mail can be invited again.
    const { data: name, error: cancelError } = await caller.rpc('cancel_invite', { p_email: email })
    if (cancelError) {
      const { status, message } = classifyRpcError(cancelError)
      return json({ error: message }, status)
    }
    return json({ ok: true, full_name: (name as string) ?? row.full_name ?? null })
  }

  // --- Invite / resend: record the invite, then send the mail -----------------
  let member: string
  let role: string | null

  if (mode === 'invite') {
    if (!body.member_id) return json({ error: 'a member is required' }, 400)
    member = body.member_id
    role = body.role ?? null
  } else {
    // Resend has no admin "re-mail an existing account" through the built-in mailer,
    // so it CLEARS the un-accepted account and invites fresh. First find the still-
    // pending account the caller is allowed to resend (own church, for a Church
    // Leader) and recover its member/role.
    if (!email) return json({ error: 'an e-mail address is required' }, 400)
    const { data, error } = await caller.rpc('invite_to_resend', { p_email: email })
    if (error) return json({ error: 'that invitation could not be resent.' }, 400)
    const row = Array.isArray(data) ? data[0] : data
    if (!row) return json({ error: 'There is no pending invitation you can resend for that address.' }, 403)

    member = row.member_id
    role = row.role ?? null

    // Delete the un-accepted account. The auth.users FK cascades user_accounts, so the
    // member is unlinked and invite_member below accepts it again. Safe because
    // invite_to_resend only returned an account with no confirmed e-mail.
    const { error: delError } = await admin.auth.admin.deleteUser(row.account_id)
    if (delError) return json({ error: 'that invitation could not be resent.' }, 502)
  }

  // Record the (fresh) invite as the caller, so the member/role authority is re-checked
  // under their identity and the e-mail is derived from the member — never supplied by
  // the client. On resend this re-inserts the row the delete above freed up. If it
  // raises, nothing is sent.
  const { data: inviteData, error: rpcError } = await caller.rpc('invite_member', {
    p_member: member,
    p_role: role,
  })
  if (rpcError) {
    const { status, message } = classifyRpcError(rpcError)
    return json({ error: message }, status)
  }
  const invited = Array.isArray(inviteData) ? inviteData[0] : inviteData
  const sendTo = invited?.email as string | undefined
  const fullName = (invited?.full_name as string) ?? null
  if (!sendTo) {
    return json({ error: 'That invitation could not be sent.' }, 400)
  }

  // Authorised and recorded. Now send the e-mail (creates the auth.users row, which the
  // trigger links to the member atomically).
  const { error: sendError } = await admin.auth.admin.inviteUserByEmail(sendTo, {
    redirectTo: REDIRECT_URL,
    data: fullName ? { full_name: fullName } : undefined,
  })
  if (sendError) {
    return json({ error: 'The account was recorded but the e-mail could not be sent. Try Resend.' }, 502)
  }

  return json({ ok: true, full_name: fullName, email: sendTo })
})

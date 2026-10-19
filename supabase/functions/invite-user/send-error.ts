// Turns the error from auth.admin.inviteUserByEmail into an HTTP status and a line the
// person sending the invite can act on. Kept free of imports so the unit tests can load it.
//
// The invite is already recorded when this runs, but no login exists yet, so Resend has
// nothing to work on. Every message therefore says to send the invite again:
// invite_member replaces the stuck pending row.
//
// Supabase's own error text is shown for anything unmapped. It describes the mail
// service, not our data, and hiding it is what made failed invites impossible to diagnose.

export type SendError = { code?: string; status?: number; message?: string }

export function classifySendError(err: SendError): { status: number; message: string } {
  const code = err?.code || ''
  const raw = (err?.message || '').trim()

  if (code === 'over_email_send_rate_limit' || err?.status === 429) {
    return {
      status: 429,
      message: "No e-mail was sent: Supabase's hourly e-mail limit has been reached. Wait about an hour, then send the invite again.",
    }
  }
  if (code === 'email_address_invalid') {
    return {
      status: 400,
      message: "No e-mail was sent: Supabase says the address is invalid. Check the e-mail on the member's record, then send the invite again.",
    }
  }
  if (code === 'email_address_not_authorized') {
    return {
      status: 502,
      message: 'No e-mail was sent: the mail service is only allowed to send to the project team. Custom SMTP must be set up in Supabase.',
    }
  }

  const detail = raw ? ` Supabase said: "${raw}"${code ? ` (${code})` : ''}.` : ''
  return {
    status: 502,
    message: `No e-mail was sent.${detail} Send the invite again once that is fixed.`,
  }
}

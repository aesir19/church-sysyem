import { describe, it, expect } from 'vitest'
import { classifySendError } from '../../supabase/functions/invite-user/send-error.ts'

describe('classifySendError', () => {
  it('names the hourly e-mail limit and says to wait', () => {
    const r = classifySendError({ code: 'over_email_send_rate_limit', status: 429, message: 'email rate limit exceeded' })
    expect(r.status).toBe(429)
    expect(r.message).toMatch(/hourly e-mail limit/)
    expect(r.message).toMatch(/send the invite again/)
  })

  it('treats a bare 429 as the e-mail limit', () => {
    expect(classifySendError({ status: 429 }).status).toBe(429)
  })

  it('points an invalid address back at the member record', () => {
    const r = classifySendError({ code: 'email_address_invalid', status: 400, message: 'Email address "x@y.con" is invalid' })
    expect(r.status).toBe(400)
    expect(r.message).toMatch(/member's record/)
  })

  it('explains the default-mailer restriction', () => {
    const r = classifySendError({ code: 'email_address_not_authorized', status: 400 })
    expect(r.message).toMatch(/Custom SMTP/)
  })

  it("shows Supabase's own text for anything unmapped", () => {
    const r = classifySendError({ code: 'unexpected_failure', status: 500, message: 'Error sending invite email' })
    expect(r.status).toBe(502)
    expect(r.message).toContain('Supabase said: "Error sending invite email" (unexpected_failure)')
  })

  it('never tells the user to Resend, which needs a login that does not exist yet', () => {
    for (const err of [{ status: 429 }, { code: 'email_address_invalid' }, { message: 'boom' }, {}]) {
      expect(classifySendError(err).message).not.toMatch(/Resend/)
    }
  })
})

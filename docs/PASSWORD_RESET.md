# Password reset

## Agreed behavior

The owner agreed this scope in the September 5, 2026 implementation conversation:

- Every existing account can request recovery through **Forgot password?** on the login screen.
- `/forgot-password` accepts an email and displays the same confirmation whether or not an account exists. It never displays raw provider errors.
- The recovery email returns to `/reset-password`. A verified recovery session enables the existing password form with recovery wording; an ordinary session alone does not.
- Invalid, expired, or rejected links show a fresh-request action. Reloading a valid recovery page preserves the flow within that browser tab.
- Keep the existing eight-character minimum, matching confirmation, and strength meter. Supabase remains responsible for enforcing its configured password policy.
- After saving, request global sign-out and return to login. A failed sign-out offers a retry without submitting the password again.
- Existing invitation links continue using `/set-password` and invitation wording.

The actual login and set-password views were inspected in Playwright before implementation. The new screens use the existing AuthShell, fields, buttons, alerts, and design tokens.

## Deployment configuration

This change adds no provider, subscription, Edge Function, or database migration. It uses the existing Supabase Auth API. **Live email delivery and project settings have not been verified.** Before releasing:

1. Verify custom SMTP can deliver to ordinary account addresses within the project's $0/month constraint. Supabase's default SMTP is restricted to project-team recipients and two messages per hour; it is unsuitable for general account recovery. Do not enable a paid plan or overages without the owner's decision.
2. In Supabase **Authentication → URL Configuration → Redirect URLs**, allowlist each exact deployed origin followed by `/reset-password`, including `http://localhost:5173/reset-password` for local staging use. Keep the existing `/set-password` invitation destinations.
3. Verify the **Reset password** email template uses Supabase's generated confirmation URL (`{{ .ConfirmationURL }}`). It must verify the link through Auth before returning to the app; a bare link to `/reset-password` cannot establish a recovery session. Disable SMTP link tracking that rewrites authentication links.
4. Retain server-side recovery throttling. The request form's 60-second cooldown is feedback, not abuse prevention; browser navigation can reset it. Verify the actual Auth limits and email expiry in both staging and production. Changing email expiry also affects invitations and other email OTP flows.
5. Send a recovery email to an owner-approved staging test account, follow it, set the password, and sign in again. Check an expired/reused email link too. Automated tests mock Supabase and do not prove SMTP delivery or live token validation.

Global sign-out revokes refresh tokens. Already issued access JWTs can remain valid until their configured expiry; the UI does not claim immediate access revocation on all devices.

## Validation boundaries

The owner agreed browser-flow and router tests with Supabase mocked. Tests exercise reset requests, neutral confirmation, cooldown/errors, invalid callbacks with existing sessions, validation, update/retry, global logout/retry, refresh, and invitation compatibility without sending email or using member PII.

## Provider references

- [Password recovery](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail)
- [Custom SMTP and default mailer restrictions](https://supabase.com/docs/guides/auth/auth-smtp)
- [Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits)
- [Sign-out and JWT expiry](https://supabase.com/docs/guides/auth/signout)
- [Email link delivery considerations](https://supabase.com/docs/guides/deployment/going-into-prod)

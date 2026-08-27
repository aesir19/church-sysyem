# Deploying `invite-user` — first-time setup

This is the one Edge Function the app runs (ADR-0018). The website is built and shipped by
GitHub Actions; **this function is deployed separately, by hand, once.** After that you only
redeploy it if you change `index.ts`.

You need the Supabase CLI installed and you need to be an owner of the Supabase project.

## The four commands

Run these from the repository root. Replace the two `<...>` placeholders.

```bash
# 1. Sign in to Supabase (opens a browser once).
supabase login

# 2. Point the CLI at the project. The ref is in your Supabase dashboard URL:
#    https://supabase.com/dashboard/project/<THIS-IS-THE-REF>
supabase link --project-ref <project-ref>

# 3. Give the function its one secret. It lives ONLY on Supabase's servers —
#    never in the repo, never in the browser.
#      SERVICE_ROLE_KEY → Dashboard → Project Settings → API → service_role key
supabase secrets set SERVICE_ROLE_KEY="<service-role-key>"

# 4. Deploy the function.
supabase functions deploy invite-user
```

The invite link returns to **wherever the app called the function from** — `localhost` while you
test, your real site once it's deployed — so there is no per-environment secret to change. (You can
optionally set `INVITE_REDIRECT_URL` as a fallback for non-browser callers, but it isn't needed.)

## One Auth setting — the allowlist

The link is only honoured if its address is on Supabase's allowed list. In the dashboard:

- **Authentication → URL Configuration → Redirect URLs** — add every address the app is opened from:
  - `http://localhost:5173/set-password` (local testing)
  - `https://<your-site>/set-password` (once deployed)

Without the matching entry, the link in the e-mail is refused and the invitee cannot set a password.
This allowlist is also what makes it safe for the function to trust the calling origin.

## Checking it works

- In the app, sign in as a Super Admin, open the gear → **Invite user**, and invite a test
  address you control. The e-mail should arrive within a minute.
- If nothing arrives, check **Edge Functions → invite-user → Logs** in the dashboard. A
  `invite sending is not configured` error there means a secret in step 3 is missing.

## When you change the function

Only step 4 (`supabase functions deploy invite-user`) — the login, link, and secrets persist.
If you ever rotate the service-role key, re-run step 3 for `SERVICE_ROLE_KEY` and redeploy.

## How Resend works

Supabase's built-in mailer has no admin "re-send to an existing account", so **Resend clears the
un-accepted invitation and sends a fresh one** in a single action: it deletes the pending account
(which unlinks the member automatically), then invites the same person again. This is safe because
it only ever touches an account nobody has accepted yet — the old link stops working and a new
e-mail goes out. Once someone has set their password (accepted), they no longer appear as pending
and cannot be resent.

The greeting-by-name still depends on the invite e-mail template referencing the name — see below.

## The greeting name

The invitee's member name is attached to the invite (`full_name`), but Supabase's default **Invite**
e-mail template does not print it. To greet them by name, edit the template under
**Authentication → Emails → Invite user** to include `{{ .Data.full_name }}`. Until then the e-mail
is correct but nameless.

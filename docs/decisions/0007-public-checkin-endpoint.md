# ADR-0007 — The public check-in endpoint

**Status:** Accepted · **Date:** 2026-08-05 · **Implemented by:** `0013_attendance_and_checkin`

## Context

[BACKLOG.md B20](../BACKLOG.md) records that no `services` or `attendance` table exists, so
attendance cannot be correlated with giving or used for follow-up — and B22 notes that *"who is
due for follow-up?"*, arguably the primary pastoral question the system exists to serve, has no
data behind it. Attendance is that data.

Recording attendance from the staff dashboard needs no new decision; it is an ordinary
church-scoped table under the existing model. What needs a decision is the requirement that an
attendee **self-registers from their own phone by scanning a QR code**, with no account.

**The QR path is a relief valve, not the primary path** (owner, 2026-08-05). Its purpose is to
take load off the secretariat and ushers for attendees who are comfortable doing it themselves.
Elderly and non-technical attendees are recorded by staff exactly as before, and the staff form
in `AttendanceView` is a first-class surface rather than a fallback. This matters to every
trade-off below: when self check-in degrades, the congregation is not locked out — the queue at
the door simply gets longer. **A change that makes staff recording depend on the anonymous path
in any way inverts this and is wrong.**

That is the first unauthenticated write path in this system's history, and it runs directly
against a posture the project chose deliberately. `0009_narrow_grants` revoked every table
privilege *and* every function `EXECUTE` from `anon`, on the stated reasoning that the pre-auth
views use only `supabase.auth.*` and therefore *"`anon` needs no table access at all"*.
[VERIFICATION.md](../security/VERIFICATION.md) codifies it as a test: *"Anonymous caller touches
either table → Denied."*

Four constraints bound the design:

1. **Cost is priority 1 and binding** (CLAUDE.md). A public endpoint is a cost surface.
2. **[ADR-0002](0002-no-second-compute-vendor.md) forbids a second compute vendor.** No Netlify
   Function to put in front of this, no API server to rate-limit at.
3. **[ADR-0005](0005-jwt-in-localstorage-accepted.md) declined Cloudflare** — the one thing that
   would have supplied edge rate limiting and a WAF — because a DNS/TLS cutover is real
   operational risk on a system with no staging project.
4. **[SECURITY.md §3.18](../SECURITY.md) already records that there is no throttling anywhere**,
   and its proposed mitigation is a per-*user* insert ceiling. An anonymous caller has no user to
   key on, so that mitigation does not transfer.

## Decision

**Anonymous callers reach exactly two `SECURITY DEFINER` functions and no table.**

`anon` receives `EXECUTE` on `checkin_session_status(text)` and `submit_checkin(text,text,text)`,
and nothing else — no table grant, no sequence grant, and no RLS policy anywhere names `anon`. The
assertion *"`anon` holds zero table privileges"* stays literally true, and the VERIFICATION matrix
row stays valid exactly as written. What changes is narrower and checkable: the function-grant
list. A third entry appearing there is a regression, and the monthly review now checks for it.

Five sub-decisions carry the weight.

### The open window is the cost control, because nothing else can be

**Postgres cannot rate-limit an unauthenticated PostgREST endpoint.** By the time a function body
executes, the connection, the parse, and the planning are already paid for. There is no free
control that changes this: edge rate limiting means Cloudflare (declined, ADR-0005), and a CAPTCHA
means verifying a token with a secret the browser must not see, which means a second compute tier
(forbidden, ADR-0002) or an Edge Function.

What genuinely bounds the exposure is that **the endpoint is inert roughly 166 hours out of every
168.** Outside a configured window a call costs one index probe on `churches.checkin_token`, one on
the window resolver, and nothing else — no sanitizing, no name matching, no write. This is why the
order of operations inside `submit_checkin` is load-bearing and commented as such. Reordering it
for readability removes the control.

A per-service ceiling of 500 self check-ins also exists, but it is an **integrity** guard, not a
cost guard: an attendance row is ~100 bytes and 500 MB holds roughly 5M of them. Storage was never
the scarce thing. When the ceiling trips, self check-in returns `'closed'` and **the authenticated
staff path is unaffected** — self-service degrades to staff-service rather than the feature dying.
A hard failure would let 500 scripted requests at 07:55 take check-in away from a whole
congregation.

### The reply is not an oracle

`submit_checkin` returns `'recorded'` or `'closed'`. Nothing else.

`'recorded'` covers three outcomes that a friendlier API would distinguish: the name matched a
member, the name matched nobody and was stored as a guest, and the person had already checked in.
Distinguishing them would let anyone holding the token answer **"is X a member of this church?"**
and **"is X here today?"** by typing names — and the token is printed on a wall in a public
building and will be photographed. Both questions are exactly the PII the threat model's T1
(anonymous internet attacker) exists to protect.

Uniformity costs the attendee nothing; they do not care which branch ran. Staff see the actual
resolution on the roster. Two consequences follow and must not be "fixed":

- There is **no `EXCEPTION` block** anywhere in `submit_checkin`. An exception block opens a
  subtransaction and costs orders of magnitude more on the error path, which is a timing signal
  measurable through mobile jitter with enough samples. `ON CONFLICT DO NOTHING` has no such
  asymmetry.
- There is **no early `RETURN` past the window check**. Every accepted call runs the same
  statements in the same order.

`checkin_session_status` likewise returns zero rows for both *"nothing open"* and *"no such
token"*, so it cannot be used to discover which tokens are live.

**"You're already listed" must never come from the server.** The question was raised (owner,
2026-08-05) and the UX motivation is real: an attendee who taps submit and sees a generic
confirmation may not trust it and will tap again. But a server-sourced *"you are already listed"*
is precisely the oracle this section exists to prevent — it answers **"is X here today?"** for
anyone who types a name, which is the T1 exposure, and it does so more cheaply than any other
probe because a single request settles it.

The resolution is that **the device already knows.** The phone that submitted a check-in records
the service and the name it sent in `localStorage` (`src/utils/checkinMemory.js`), and on a repeat
visit within the same window `CheckinView` renders "You're already listed" from that record. It is
strictly better on both axes the question raised:

- **It leaks nothing.** The knowledge lives on the device that produced it, and is not derived
  from the database. Clearing `localStorage` returns the attacker to exactly where they started —
  able to submit a name, able to learn nothing.
- **It reduces traffic rather than adding it.** It costs no request of its own — the
  `checkin_session_status` call that renders the page happens either way — and the repeat
  *submission* it prevents never leaves the phone. The server-side variant would have *added* a
  round-trip to the one flow most likely to be repeated.

Three properties of the implementation are deliberate. It holds a **list** of names per service,
because a volunteer working a queue from one phone is an expected case and the "Check in someone
else" button exists for exactly that. Entries **expire at `closes_at`**, so last Sunday's names do
not greet this Sunday's attendee. And every path **fails soft** — storage disabled, quota full,
contents corrupted all degrade to the generic confirmation, because this is a convenience and must
never become a gate. Duplicate submissions are made harmless by the partial unique indexes in
`0013`, not by this file.

It does not cover a person who switches devices, which is correct — that is not the confusion
being solved. **Do not "improve" this by having the server confirm it.**

### A static token, rotated on a trigger rather than on a schedule

One QR per church, printed once and laminated. The URL is permanent. Rotation happens when
something warrants it, not on a calendar.

Weekly rotation was raised explicitly (owner, 2026-08-05) on the reasoning that a permanent code
is a standing target. It was rejected, and the reasoning is worth recording because the intuition
behind it is sound and the conclusion still goes the other way.

**What the token actually grants bounds the whole question.** It permits exactly two calls: ask
whether check-in is open, and submit a name during a live window. It carries **no read access of
any kind** — not the roster, not member records, not contributions. The worst outcome from a
leaked token is spurious attendance rows on one morning, capped at 500, deduplicated, and
correctable from the staff roster. It is a write-only slot into one table, not an entry point to
the system. Rotation is therefore shrinking an exposure that is already small, and the cost side
of the trade has to be judged against that.

**Weekly rotation also buys less than it appears to.** A code displayed to a congregation is
exposed to everyone in the room within minutes. Against the realistic threat — an attendee
photographs it and shares it — a weekly code and a permanent one are *identical*, because both
are in the attacker's hands during the same live window. Rotation only shrinks **long-tail**
leakage: a photo that resurfaces months later. That is a narrow gap.

**The cost is recurring and it lands in the worst place.** Weekly rotation is 52 print-and-place
operations a year, each one Sunday-morning-critical and each one performed by volunteers. The
week it is missed, self check-in silently stops and the load falls back on the ushers — the exact
burden the feature exists to remove. Trading a narrow long-tail gap for 52 annual chances to
break the feature at its moment of use is the wrong side of the trade.

So: **`rotate_my_checkin_token()` is the control, invoked on a trigger** — a poster posted
publicly, junk rows observed, a token believed shared outside the congregation. It is a deliberate
act with a stated consequence (every printed QR stops working), not a routine one. The prerequisite
is knowing when to press it, which makes the monitoring in SECURITY.md §3.21 load-bearing rather
than nice-to-have: **without detection, a trigger-based policy degrades to no policy at all.**

Two alternatives were left open rather than rejected outright:

- **Quarterly rotation**, tied to when posters are reprinted anyway rather than to a service. The
  human cost is near zero at that cadence. It requires a grace period in which the previous token
  still resolves, otherwise it reintroduces "someone forgot to swap the poster" at 1/13th the
  frequency instead of eliminating it. Not built; would need a second token column and an expiry.
- **Per-service rotation displayed on a screen** rather than a wall poster, deriving the code from
  the `services` row that already materializes automatically. This is the only variant with **no
  recurring human step**, and it is strictly better than both weekly and static — but only for
  churches that already project announcements, and it is unbuilt work. Revisit if a screen is
  available.

The token is 122 bits (a v4 UUID with hyphens stripped), not `gen_random_bytes` — that is pgcrypto,
which on Supabase lives in the `extensions` schema and would resolve to nothing under the
function's pinned `search_path`.

### The token lives in the URL fragment

`/checkin#t=<token>`, never `/checkin/<token>`.

Browsers do not send fragments to the server. The token therefore never appears in a Netlify
access log, a `Referer` header, or a server-side error report. For the same reason both
anon-callable functions are marked **`VOLATILE`**: PostgREST exposes `STABLE` and `IMMUTABLE`
functions over `GET`, which would put the token in a query string and undo this. The volatility is
a security property, not a performance one, and is commented at both definitions.

### Self-registered attendance is self-asserted, not verified

This is the honest limitation and it belongs in writing rather than in a footnote.

A static token plus a typed name means anyone holding the token can assert that any member was
present, or squat a name and pre-empt the real person's row. There is no way around this short of
per-attendee credentials, which is the entire membership-onboarding problem and is not what this
feature is.

`attendance.source` records the distinction — `'self'` versus `'staff'` — and **every roster
surfaces it**. The column is deliberately absent from the `INSERT` grant, so no client can forge
either value; the database defaults it to `'staff'` and only the definer function writes `'self'`.
That column grant is the whole control, in the same way `groups.color_slot` is in `0005`.

**Attendance produced by this feature is good enough for pastoral follow-up and headcounts. It is
not evidence.** Do not build anything on it that assumes otherwise.

## Consequences

- **`submit_checkin` is the first place in this system where authorization is a function body
  rather than a policy.** [ADR-0001](0001-rls-is-the-only-authz.md) sanctions definer RPCs for
  privileged action, so this is inside the letter of that decision, but it is a real widening of
  it. The function bypasses RLS entirely, which is why it repeats the `archived_at IS NULL` check
  that `is_member_in_my_church()` would otherwise have applied.
- **Do not add `FORCE ROW LEVEL SECURITY` to `attendance`, `services`, or `service_schedules`.** A
  table's owner is not subject to its own policies, and that is exactly what lets these functions
  write on an anonymous caller's behalf. Forcing RLS would break the anon path with no error at
  deploy time. This is noted in the migration too, because it is precisely the kind of thing a
  well-meaning hardening pass does.
- **Cross-church safety here rests on a foreign key, not a policy.** `attendance.church_id` is
  denormalized so RLS stays join-free, which on its own would let one church attach attendance to
  another church's service — the policy passes, the row lands, and the victim never sees it
  because their `SELECT` filters on `church_id`. A composite FK on `(service_id, church_id)`
  closes it. Anyone simplifying that FK reopens a silent cross-tenant write.
- **One runtime dependency was added: `qrcode-generator` (~21 kB, MIT).** CLAUDE.md requires a
  stated reason and a free-tier impact note, so both are here. *Reason:* rendering the QR in the
  browser avoids an image-generation service, which would be a second compute vendor
  (ADR-0002), and avoids storing a generated PNG, which would be Supabase Storage without a
  sizing plan. *Impact:* zero for attendees — it is `await import(...)`ed inside `AttendanceView`
  and Vite emits it as its own chunk, so it ships only to staff who open the QR panel, and never
  over church wifi to a phone. **Keep the dynamic import**; making it a static import moves 21 kB
  into the shared bundle.
- **Lazy route loading became load-bearing.** The check-in page is now the highest-volume asset in
  the application — every attendee, every service, cold cache, church wifi. Eager imports would
  have shipped the staff dashboard to all of them. Adding an eagerly-imported route is now a
  bandwidth regression, not a style question.
- **New PII with no retention policy.** Guest names and contact numbers are collected from people
  who are not users. [SECURITY.md §3.10](../SECURITY.md) already records that the Data Privacy Act
  of 2012 grants a right to erasure and that no retention policy exists; this enlarges that gap.
  The check-in page carries a collection notice, which is the free half of the answer. `attendance`
  cascades from `members`, so erasing a member erases their attendance.
- **A residual risk is accepted and recorded**, not mitigated: an unthrottled unauthenticated write
  endpoint, bounded by the window and the ceiling but not eliminated. See the new finding in
  SECURITY.md. If it proves insufficient in practice, the escalation path is the one ADR-0005
  already named — revisit Cloudflare — or revoke the two `anon` grants, which stops self check-in
  and leaves staff recording working.

## Reversal

Revoking `EXECUTE` on the two functions from `anon` closes the anonymous path completely and
destroys nothing:

```sql
REVOKE EXECUTE ON FUNCTION public.checkin_session_status(text)     FROM anon;
REVOKE EXECUTE ON FUNCTION public.submit_checkin(text, text, text) FROM anon;
```

That is the correct response to abuse. A full rollback of `0013` is for backing out the feature
and **destroys all attendance history** — see the warning at the top of its `rollback.sql`.

# UDFC Church Dashboard — the rules

There are three. Evaluate every decision against them, in order.

## 1. Cost — keep operating cost at $0/month, indefinitely. Binding.

Anything that risks pushing this project off a free tier needs an explicit owner decision
**before** work begins.

## 2. Security — a close second.

The app is on the public internet and stores member PII: names, birthdates, addresses, contact
details, baptismal status. Apply security controls unless they conflict with rule 1. When they do,
say what was deferred and why.

Default posture is **fail closed** — if a feature can't be made safe for free, it isn't built.

---
## 3. UI changes are seen, not spec'd

Do not plan or build a UI change from a written spec. Work from the actual view — a screenshot, or the running app.

If you cannot see it, stop and ask. Most screens here are behind auth and there is no tool that can reach them; "I'll build to the spec and we'll check later" is not the fallback.

Nothing gets reviewed, audited or committed until the owner has seen it.


Everything else is a judgement call. Ask when it matters.

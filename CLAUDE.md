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
## 3. UI changes are built from the view and the spec — and the two must collide

A UI change needs **both**: the actual view (a screenshot, or the running app) **and** the written spec for it. Build from neither alone.

- **The view without a spec** is guesswork about intent — you can see what's there, not what it's meant to become.
- **The spec without the view** is building blind. Most screens here are behind auth and no tool can reach them; "I'll build to the spec and we'll check later" is not the fallback.

Hold the two against each other before building. When the view and the spec **disagree** — the running screen does one thing, the spec says another — that collision is a **stop signal**, not yours to resolve by quietly picking one. Surface the conflict and ask. The disagreement is usually the most important thing you've found.

If you cannot see the view, or there is no spec, stop and ask.

Nothing gets reviewed, audited or committed until the owner has seen it.


Everything else is a judgement call. Ask when it matters.

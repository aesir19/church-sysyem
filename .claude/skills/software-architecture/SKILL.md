---
name: software-architecture
description: Applies a "what's hard to change?" lens to software design work — reviewing architecture decisions, scoping new projects, and writing architecture documentation. This skill is invoked explicitly, not automatically. Use it ONLY when the user names it directly — "use the software-architecture skill", "run the architecture review", "architecture-scope this project", "write this up as an ADR" — or otherwise makes clear they want this specific process applied. Do NOT use it merely because the conversation touches system design, tech stack choices, schema decisions, or scaling; answer those normally unless the user asks for the skill by name.
---

# Software Architecture

A lens for separating decisions that are expensive to reverse from decisions that
aren't, and spending deliberation accordingly.

## Core principles

These come from Martin Fowler's architecture guide and shape every mode below.

**Architecture is the important stuff — whatever that is.** There's no objective
test for what counts as architectural. The working definition: architecture is the
shared understanding that expert developers have of the system's design. It lives
in people's heads, not in a diagram. Documents serve that understanding; they
don't replace it.

**Architectural decisions are the ones you wish you could get right early.** Not
"the ones made early." The distinction matters — it reframes the question from
"what do we decide now?" to "what will hurt if we get it wrong?"

**High internal quality means faster delivery, not slower.** This inverts the
usual intuition that quality costs more. Cruft — the accumulated mess that makes
software hard to understand — slows every subsequent change. Experienced
developers put the payoff on internal quality at weeks, not months. So "we'll
clean it up after launch" is usually a losing trade even on a short project.

**Prefer evolutionary design.** Good architecture supports its own change. When a
decision is cheap to reverse, make it quickly and move on. Reserve real
deliberation for the irreversible ones.

## The central question

Every mode runs on the same sorting question:

> If we get this wrong, what does it cost to change in six months?

Sort decisions into three buckets:

- **Load-bearing** — changing it means rewriting large parts of the system, or
  migrating data that's already live. Data model, auth model, service boundaries,
  the public shape of an API, anything that touches money or user records.
  Deliberate here.
- **Contained** — changing it means rewriting one module. Choice of validation
  library, folder structure, how a single endpoint is implemented. Decide fast,
  don't agonize.
- **Cosmetic** — changing it is a find-and-replace. Naming, formatting, which
  utility library. Don't spend meeting time on these.

Most disagreements about architecture are actually disagreements about which
bucket something is in. Name the bucket explicitly and the argument usually
resolves.

## Mode selection

Pick the mode from what the user is doing. If it's ambiguous, ask — don't guess.

| The user is... | Use mode |
|---|---|
| Proposing a design, or has one already built | **Review** |
| Starting something new, or sizing up client work | **Scope** |
| Asking for a design doc, ADR, README, or handover | **Document** |

Since the user invokes this skill deliberately, their phrasing usually names the
mode already ("review this", "scope this out", "write this up"). Take them at
their word rather than re-deriving it.

---

## Mode: Review

Evaluate a design that already exists or has been proposed.

1. **Restate the design as you understand it**, in a few sentences. This surfaces
   misunderstandings before you spend effort critiquing the wrong thing, and it
   tests whether the design is actually explicable — if you can't state it
   plainly, that's finding number one.

2. **Sort the decisions** into load-bearing / contained / cosmetic. Say which is
   which. The user may disagree, and that disagreement is productive.

3. **Interrogate only the load-bearing ones.** For each, ask:
   - What breaks if this is wrong?
   - What's the migration path if we need to change it after launch?
   - Is there a cheaper decision that keeps the option open?

4. **Look for cruft risk** — places where the current shape will make the *next*
   change hard. Common ones: business logic leaking into the presentation layer,
   data access scattered across the codebase rather than contained, one module
   that every other module imports.

5. **Report.** Lead with what's working. Then the load-bearing concerns, each
   with a concrete alternative rather than a bare objection. Contained and
   cosmetic issues go in a short "minor" list at the end, or get dropped.

Resist the pull toward completeness. A review that flags four real problems is
more useful than one that lists twenty observations.

## Mode: Scope

Size up a new project — especially client work where the cost of a wrong early
decision lands on you.

1. **Establish what the system actually has to do.** Not features — obligations.
   Who uses it, what data it holds, what happens when it's wrong. A booking
   system that takes payments has different load-bearing decisions than a
   brochure site with a contact form.

2. **Find the constraints that aren't negotiable.** Deployment target, existing
   systems it must integrate with, who maintains it after handover, budget for
   ongoing hosting. These constrain architecture more than any preference does.

3. **Name the load-bearing decisions explicitly**, and only those. For a typical
   web project that's usually: the data model, the auth approach, whether
   anything needs to be a separate service, and the API contract if there's a
   client consuming it. Four to six items, not twenty.

4. **For each, state the decision, the alternative you rejected, and why.**
   This is the raw material for the architecture doc later — capture it now while
   the reasoning is fresh.

5. **Flag what you're deliberately deferring.** Explicitly listing "we are not
   deciding caching strategy yet, and here's why that's safe" is as valuable as
   the decisions themselves. It prevents relitigating and shows the client you're
   sequencing rather than forgetting.

For client work specifically: also flag any decision whose real driver is the
client's constraint rather than a technical one. Those are the ones that need
writing down, because they're the ones that look inexplicable to whoever
inherits the code.

## Mode: Document

Produce architecture documentation. Default to an ADR for a single decision, and
an overview doc for a whole system.

Documentation exists to build the shared understanding that *is* the
architecture. Write for a developer who joins in a year and needs to make a
change without breaking something. That reader needs reasoning, not inventory —
they can read the code to see what the tables are; they can't read the code to
find out why.

### ADR (single decision)

Use this exact structure:

```markdown
# ADR-[number]: [Decision in a short noun phrase]

**Status:** Proposed | Accepted | Superseded by ADR-[n]
**Date:** [YYYY-MM-DD]

## Context
What situation forces a decision? Include the constraints — technical,
budget, timeline, client-imposed.

## Decision
What we're doing, stated plainly and in the active voice.

## Alternatives considered
Each option, and the specific reason it lost. "Rejected because X" —
not just a list of what else exists.

## Consequences
What this makes easy, what it makes hard, and what it commits us to.
Include the bad parts; an ADR that only lists upsides is marketing.
```

### System overview

```markdown
# [System] — Architecture Overview

## What this system does
Two or three sentences. Obligations, not a feature list.

## Shape
The major pieces and how they talk to each other. A diagram helps but
prose must stand alone — diagrams rot faster than text.

## Load-bearing decisions
Each with a one-line rationale and a link to its ADR if one exists.

## Deliberately deferred
What hasn't been decided, and what would trigger deciding it.

## Where the bodies are buried
Known compromises, workarounds, and the reasons behind them. This is the
section that saves the next developer a week.
```

Keep both documents short enough that someone will actually read them. A
two-page overview that's current beats a twenty-page one that's stale.

## What to avoid

- **Don't recommend microservices by default.** They trade simplicity for
  independent deployability, and that trade only pays off with enough teams and
  enough scale to need it. For a single developer or a small team, a well-layered
  single application is almost always the better architecture.
- **Don't produce a diagram in place of reasoning.** Boxes and arrows show
  structure but not why.
- **Don't treat the pattern catalog as a menu.** Patterns solve specific
  problems. Establish the problem first.

## Further reading

`references/sources.md` has annotated links to the source material —
Fowler's architecture guide and the specific essays behind each principle here.
Read it when the user wants to go deeper on a particular topic, or when you need
to cite a source for a recommendation.
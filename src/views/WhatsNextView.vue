<script setup>
import Card from '../components/ui/Card.vue'
import Badge from '../components/ui/Badge.vue'
import Button from '../components/ui/Button.vue'

// The roadmap screen. It reads from nothing — every word here is written copy,
// which is why it is the one screen from the mockups that could be built
// complete on day one.
//
// KEEP THIS HONEST. The list below is the real backlog, and it is the screen a
// church leader reads to find out what they are waiting for. When one of these
// ships, it comes off this page in the same commit. A roadmap that still
// promises something already delivered is worse than no roadmap.

const FEATURED = {
  eyebrow: 'Next up',
  audience: 'For the Secretariat',
  title: 'Statistics Report',
  blurb:
    'A reporting hub that turns existing records — members, attendance and giving — into clear numbers, trends and print-ready summaries for leadership.',
  stage: 'Build',
  stages: ['Planning', 'Design', 'Build', 'Launch'],
  chips: [
    'Membership growth over time',
    'Attendance trends, service by service',
    'Giving summaries and totals',
    'Ministry & small-group participation',
    'One click, print-ready'
  ]
}

const ITEMS = [
  {
    n: 1,
    title: 'Refinement of Church Funds',
    points: ['Expenses customization', 'Custom calculations']
  },
  {
    n: 2,
    title: 'Member Notes & Journey History',
    points: [
      'Notes recorded against a member over time',
      'Each journey step dated and attributed to who recorded it'
    ]
  },
  {
    n: 3,
    title: 'Approval Workflows',
    points: [
      'New small groups & ministries',
      'Appointing small-group leaders',
      'New events — and more'
    ]
  }
]

// How far the featured item has progressed. Every rail up to and including the
// current stage reads as filled; the label of the current one is highlighted.
const activeStageIndex = FEATURED.stages.indexOf(FEATURED.stage)
</script>

<template>
  <div class="next">
    <header
      class="next__head anim-rise"
      style="--i: 0"
    >
      <p class="next__eyebrow">
        The road ahead
      </p>
      <h1 class="next__title">
        What's to come
      </h1>
      <p class="next__sub">
        Planned next, shaped around real church needs.
      </p>
    </header>

    <!-- Featured — full row, the one thing actively being built -->
    <Card
      tint="dark"
      class="feature anim-rise"
      style="--i: 1"
    >
        <div class="feature__meta">
          <Badge
            tone="onDark"
            eyebrow
          >
            {{ FEATURED.eyebrow }}
          </Badge>
          <span class="feature__audience">{{ FEATURED.audience }}</span>
        </div>

        <h2 class="feature__title">
          {{ FEATURED.title }}
        </h2>
        <p class="feature__blurb">
          {{ FEATURED.blurb }}
        </p>

        <ol
          class="stepper"
          :aria-label="`Progress: ${FEATURED.stage}`"
        >
          <li
            v-for="(stage, i) in FEATURED.stages"
            :key="stage"
            class="stepper__step"
            :class="{ 'is-active': stage === FEATURED.stage }"
            :aria-current="stage === FEATURED.stage ? 'step' : undefined"
          >
            <span
              class="stepper__rail"
              :class="{ 'is-done': i <= activeStageIndex }"
            />
            <span class="stepper__label">{{ stage }}</span>
          </li>
        </ol>

        <ul class="chips">
          <li
            v-for="chip in FEATURED.chips"
            :key="chip"
            class="chips__chip"
          >
            {{ chip }}
          </li>
        </ul>
    </Card>

    <!-- The backlog — one row of numbered items beneath the featured card -->
    <div class="next__rest">
      <Card
        v-for="(item, i) in ITEMS"
        :key="item.n"
        class="item anim-rise"
        :style="`--i: ${2 + i}`"
      >
        <div class="item__head">
          <span class="item__n">{{ item.n }}</span>
          <h3 class="item__title">
            {{ item.title }}
          </h3>
        </div>
        <ul class="item__points">
          <li
            v-for="p in item.points"
            :key="p"
          >
            {{ p }}
          </li>
        </ul>
      </Card>
    </div>

    <Card
      tint="accent"
      class="ask anim-rise"
      style="--i: 7"
    >
      <div class="ask__text">
        <h3 class="ask__title">
          Have a real church problem to solve?
        </h3>
        <p class="ask__sub">
          Submit your request — and we'll build it.
        </p>
      </div>
      <Button
        variant="primary"
        size="lg"
      >
        Submit a request
      </Button>
    </Card>
  </div>
</template>

<style scoped>
.next { display: flex; flex-direction: column; gap: var(--sp-16); }

.next__head { display: flex; flex-direction: column; gap: var(--sp-6); }

.next__eyebrow {
  font-size: var(--text-eyebrow);
  font-weight: 800;
  letter-spacing: var(--tracking-eyebrow);
  text-transform: uppercase;
  color: var(--accent-text);
}

.next__title {
  font-size: var(--text-h1);
  font-weight: 800;
  letter-spacing: var(--tracking-h1);
  line-height: var(--leading-h1);
}

.next__sub { font-size: var(--text-body); color: var(--ink-4); max-width: 62ch; }

.next__rest {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--sp-16);
}

/* --- Featured --------------------------------------------------------- */
.feature { display: flex; flex-direction: column; gap: var(--sp-14); padding: var(--sp-22); }

.feature__meta { display: flex; align-items: center; gap: var(--sp-10); }

.feature__audience { font-size: var(--text-meta); color: var(--dark-panel-ink-2); }

.feature__title {
  font-size: 21px;
  font-weight: 800;
  letter-spacing: var(--tracking-h3);
  color: #fff;
}

.feature__blurb { font-size: var(--text-body); color: var(--dark-panel-ink-2); line-height: 1.55; }

.stepper {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
  gap: var(--sp-8);
}

.stepper__step { display: flex; flex-direction: column; gap: var(--sp-8); }

.stepper__rail {
  height: 3px;
  border-radius: var(--r-pill);
  background: rgba(255, 255, 255, .16);
}
.stepper__rail.is-done { background: var(--accent-on-dark); }

.stepper__label { font-size: var(--text-meta); font-weight: 600; color: var(--dark-panel-ink-2); }
.stepper__step.is-active .stepper__label { color: var(--accent-on-dark); font-weight: 700; }

.chips { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: var(--sp-8); }

.chips__chip {
  padding: var(--sp-7) var(--sp-10);
  border-radius: var(--r-tag);
  background: rgba(255, 255, 255, .1);
  color: #fff;
  font-size: var(--text-meta);
  font-weight: 600;
}

/* --- Numbered items --------------------------------------------------- */
.item { display: flex; flex-direction: column; gap: var(--sp-12); }

.item__head { display: flex; align-items: center; gap: var(--sp-10); }

.item__n {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  flex: none;
  border-radius: var(--r-tag);
  background: var(--divider);
  color: var(--ink-3);
  font-size: var(--text-meta);
  font-weight: 800;
}

.item__title {
  font-size: var(--text-h3-sm);
  font-weight: 800;
  letter-spacing: var(--tracking-h3);
}

.item__points { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--sp-8); }

.item__points li {
  position: relative;
  padding-left: var(--sp-14);
  font-size: var(--text-body-sm);
  color: var(--ink-3);
  line-height: 1.5;
}
.item__points li::before {
  content: '';
  position: absolute;
  left: 0;
  top: .5em;
  width: 5px;
  height: 5px;
  border-radius: var(--r-pill);
  background: var(--magenta);
}
.next__rest .item__points li::before { background: var(--accent); }

/* --- Ask -------------------------------------------------------------- */
.ask { display: flex; align-items: center; gap: var(--sp-16); }

.ask__text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: var(--sp-3); }

.ask__title {
  font-size: var(--text-h3-sm);
  font-weight: 800;
  letter-spacing: var(--tracking-h3);
  color: var(--accent-darkest);
}
/* Not --accent-deep: it stays a mid cyan in the dark theme and this sits on the
   cyan tint, where it disappears. --accent-darkest inverts with the theme. */
.ask__sub { font-size: var(--text-body-sm); color: var(--accent-darkest); opacity: .85; }

@media (max-width: 1100px) {
  .next__rest { grid-template-columns: 1fr; }
}

@media (max-width: 700px) {
  .ask { flex-direction: column; align-items: stretch; }
}
</style>

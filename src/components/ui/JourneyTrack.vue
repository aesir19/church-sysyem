<script setup>
import { computed } from 'vue'
import { journeyProgress, journeyLabel, journeyTone, JOURNEY_TOTAL } from '../../utils/journey'

// The 74px track plus its label, as drawn in the members table's Journey
// column. A proportion, not a position — see utils/journey.js.

const props = defineProps({
  member: { type: Object, required: true }
})

const done = computed(() => journeyProgress(props.member))
const label = computed(() => journeyLabel(props.member))
const tone = computed(() => journeyTone(props.member))
const pct = computed(() => (done.value / JOURNEY_TOTAL) * 100)
</script>

<template>
  <div class="jt">
    <span
      class="jt__track"
      role="img"
      :aria-label="`Discipleship journey: ${done} of ${JOURNEY_TOTAL} complete`"
    >
      <span
        class="jt__fill anim-grow"
        :class="`jt__fill--${tone}`"
        :style="{ width: `${Math.max(done ? 8 : 0, pct)}%` }"
      />
    </span>
    <span
      class="jt__label"
      :class="`jt__label--${tone}`"
    >{{ label }}</span>
  </div>
</template>

<style scoped>
.jt { display: flex; align-items: center; gap: var(--sp-10); }

.jt__track {
  width: 74px;
  height: 6px;
  flex: none;
  border-radius: var(--r-pill);
  background: var(--divider);
  overflow: hidden;
}

.jt__fill { display: block; height: 100%; border-radius: var(--r-pill); }

/* Nothing started is magenta — this design's "worth your attention", which is
   exactly what a member nobody has begun a journey with is. */
.jt__fill--none     { background: var(--magenta); }
.jt__fill--partial  { background: var(--accent); }
.jt__fill--complete { background: var(--success); }

.jt__label { font-size: var(--text-meta); font-weight: 700; white-space: nowrap; }
.jt__label--none     { color: var(--magenta); }
.jt__label--partial  { color: var(--accent-text); }
.jt__label--complete { color: var(--success); }
</style>

<script setup>
import { computed } from 'vue'
import Avatar from '../ui/Avatar.vue'

// One card in the Groups grid: type tag, headcount, name, a stack of faces and
// a share bar.
//
// A BUTTON, NOT A DIV WITH @click. The whole card opens the group, so it has to
// be reachable and activatable from a keyboard — the same fix the members table
// needed. Everything inside is text and spans, so nothing is nested
// interactively.
//
// THE BAR IS SHARE OF THE LARGEST GROUP, not of the roll. Against the roll every
// bar would be a sliver and the row would say nothing; against the biggest group
// the grid reads as "how do these compare", which is the only question a card
// wall answers.

const props = defineProps({
  group: { type: Object, required: true },
  // The largest member_count in the grid, so every card scales to the same
  // reference. Guarded against zero below.
  maxCount: { type: Number, default: 0 },
  index: { type: Number, default: 0 }
})

defineEmits(['open'])

const isMinistry = computed(() => props.group.type === 'Ministry')

const sharePercent = computed(() => {
  if (!props.maxCount) return 0
  return Math.round((props.group.member_count / props.maxCount) * 100)
})

// "+10 more" beside the four faces. Absent rather than "+0 more" when the stack
// already shows everyone.
const moreLabel = computed(() => {
  const shown = props.group.sample_names.length
  const rest = props.group.member_count - shown
  return rest > 0 ? `+${rest} more` : ''
})
</script>

<template>
  <button
    type="button"
    class="gcard anim-rise"
    :style="`--i: ${index}`"
    @click="$emit('open', group)"
  >
    <span class="gcard__top">
      <span
        class="gcard__tag"
        :class="isMinistry ? 'gcard__tag--ministry' : 'gcard__tag--small'"
      >{{ group.type }}</span>
      <span class="gcard__count">{{ group.member_count }}</span>
    </span>

    <span class="gcard__name">{{ group.name }}</span>

    <!-- The mockup prints "Led by …" here. `groups` has no leader column, so
         there is nothing true to put in it; a leader is a schema change and a
         decision about who may assign one, which is future planning rather
         than a repaint. The row is left out instead of being invented. -->

    <span class="gcard__people">
      <span
        v-if="group.sample_names.length"
        class="gcard__faces"
      >
        <Avatar
          v-for="(name, i) in group.sample_names"
          :key="i"
          :name="name"
          :size="27"
          class="gcard__face"
        />
      </span>
      <span
        v-if="moreLabel"
        class="gcard__more"
      >{{ moreLabel }}</span>
      <span
        v-else-if="!group.member_count"
        class="gcard__more"
      >Nobody yet</span>
    </span>

    <span
      class="gcard__bar"
      aria-hidden="true"
    >
      <span
        class="gcard__fill"
        :class="isMinistry ? 'gcard__fill--ministry' : 'gcard__fill--small'"
        :style="`width: ${sharePercent}%`"
      />
    </span>
  </button>
</template>

<style scoped>
.gcard {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  width: 100%;
  text-align: left;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-card);
  box-shadow: var(--shadow-card);
  padding: var(--sp-18);
  font-family: var(--font-sans);
  cursor: pointer;
  transition: transform var(--dur-state) ease, box-shadow var(--dur-state) ease;
}
.gcard:hover { transform: translateY(-4px); box-shadow: var(--shadow-card-hover); }
.gcard:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.gcard__top { display: flex; align-items: center; justify-content: space-between; }

.gcard__tag {
  padding: 3px var(--sp-9);
  border-radius: var(--r-tag);
  font-size: var(--text-meta-sm);
  font-weight: 700;
  letter-spacing: .05em;
  text-transform: uppercase;
}
.gcard__tag--ministry { background: var(--accent-tint); color: var(--accent-dark); }
.gcard__tag--small { background: var(--magenta-tint); color: var(--magenta-deep); }

.gcard__count {
  font-size: 20px;
  font-weight: 800;
  letter-spacing: -0.03em;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}

.gcard__name {
  margin-top: var(--sp-12);
  font-size: var(--text-h3);
  font-weight: 800;
  letter-spacing: var(--tracking-h3);
  color: var(--ink);
  line-height: 1.25;
}

.gcard__people { display: flex; align-items: center; margin-top: var(--sp-14); min-height: 27px; }

/* Overlapped faces, each ringed in the card's own surface so the stack reads as
   depth rather than as a smudge. */
.gcard__faces { display: inline-flex; }
.gcard__face { margin-left: -7px; border: 2px solid var(--surface); }
.gcard__face:first-child { margin-left: 0; }

.gcard__more { margin-left: var(--sp-9); font-size: var(--text-meta); color: var(--ink-5); }

.gcard__bar {
  height: 5px;
  margin-top: var(--sp-14);
  border-radius: var(--r-pill);
  background: var(--divider);
  overflow: hidden;
}

.gcard__fill {
  display: block;
  height: 100%;
  border-radius: var(--r-pill);
  transform-origin: left;
  animation: grow var(--dur-grow) var(--ease-entrance) both;
  animation-delay: calc(var(--i, 0) * var(--stagger));
}
.gcard__fill--ministry { background: var(--accent); }
.gcard__fill--small { background: var(--magenta); }

@media (prefers-reduced-motion: reduce) {
  .gcard { transition: none; }
  .gcard__fill { animation: none; }
}
</style>

<script setup>
// The calendar's event peek (frame 7a). Clicking an event opens THIS small card floating over
// the grid, anchored to the event's spot — not a full-screen modal, not a redirect. It shows
// what / where / when for EVERY user; only a caller who can open the Events page (canViewEvents)
// gets "Go to event" (the role-gated action, 7r), and a plain member gets "I can serve" (the
// shipped self-offer, 7s) on a real published event. It reads the same for a real event and a
// worked-out series occurrence — both carry title/when/where.
//
// It positions itself in the browser (fixed, teleported to <body>) from the anchor rect of the
// clicked element, flipping above / clamping to the viewport near an edge. It closes on Escape,
// an outside click, or a scroll/resize that would strand it from its anchor.

import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import Button from '../ui/Button.vue'
import Badge from '../ui/Badge.vue'
import { kindLabel } from '../../lib/data/events'

const props = defineProps({
  open: { type: Boolean, default: false },
  item: { type: Object, default: null },
  // Viewport rect of the clicked event element ({ top,left,right,bottom,width,height }).
  anchor: { type: Object, default: null },
  canViewEvents: { type: Boolean, default: false },
})
const emit = defineEmits(['update:open', 'go', 'serve'])

const cardEl = ref(null)
const pos = ref({ top: 0, left: 0, placement: 'below' })
const CARD_W = 320
const GAP = 8
const MARGIN = 12

const isRealEvent = computed(() => {
  const id = String(props.item?.id || '')
  return !!id && !/^(series|sched|bday|holiday)-/.test(id)
})
const isCancelled = computed(() => props.item?.status === 'cancelled')
const isTentative = computed(() => props.item?.status === 'draft') // a dated draft (Q14)
const showGoTo = computed(() => props.canViewEvents)
const showServe = computed(() => !props.canViewEvents && isRealEvent.value && props.item?.status === 'published')

const whenLine = computed(() => {
  const e = props.item
  if (!e?.starts_at) return 'Date to be confirmed'
  const start = new Date(e.starts_at)
  const date = start.toLocaleDateString('en-PH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const en = e.ends_at ? ` – ${fmtTime(e.ends_at)}` : ''
  return `${date} · ${fmtTime(e.starts_at)}${en}`
})
function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(':00', '')
}

// Place the card from the anchor: below by default, flipped above when it would overrun the
// bottom, and clamped left/right so it never leaves the viewport.
async function place() {
  await nextTick()
  const a = props.anchor
  if (!a) return
  const vw = window.innerWidth
  const vh = window.innerHeight
  const h = cardEl.value?.offsetHeight || 200

  let left = a.left
  if (left + CARD_W > vw - MARGIN) left = vw - CARD_W - MARGIN
  if (left < MARGIN) left = MARGIN

  const below = a.bottom + GAP
  const above = a.top - GAP - h
  let top, placement
  if (below + h <= vh - MARGIN || above < MARGIN) { top = Math.min(below, vh - h - MARGIN); placement = 'below' }
  else { top = above; placement = 'above' }
  if (top < MARGIN) top = MARGIN

  pos.value = { top, left, placement }
  cardEl.value?.focus?.()
}

function close() { emit('update:open', false) }
function onKey(e) { if (e.key === 'Escape') close() }
function onScroll() { if (props.open) close() }

watch(() => props.open, (isOpen) => {
  if (isOpen) {
    place()
    window.addEventListener('keydown', onKey)
    // Capture-phase scroll catches the calendar's own scroll container too.
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
  } else {
    window.removeEventListener('keydown', onKey)
    window.removeEventListener('scroll', onScroll, true)
    window.removeEventListener('resize', onScroll)
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('scroll', onScroll, true)
  window.removeEventListener('resize', onScroll)
})
</script>

<template>
  <teleport to="body">
    <template v-if="open && item">
      <!-- Transparent catcher: an outside click dismisses, but there is no dark scrim — the card
           floats over the grid (7a), it does not take the screen the way a modal does. -->
      <div
        class="pk-catch"
        @click="close"
      />
      <div
        ref="cardEl"
        class="pk"
        :class="`pk--${pos.placement}`"
        :style="{ top: pos.top + 'px', left: pos.left + 'px' }"
        role="dialog"
        aria-modal="false"
        :aria-label="item.title"
        tabindex="-1"
      >
        <button
          class="pk__close"
          aria-label="Close"
          @click="close"
        >
          ✕
        </button>

        <div class="pk__tags">
          <span class="pk__kind">{{ kindLabel(item.kind) }}</span>
          <Badge
            v-if="isCancelled"
            tone="magenta"
          >
            Cancelled
          </Badge>
          <Badge
            v-else-if="isTentative"
            tone="neutral"
          >
            Tentative
          </Badge>
        </div>

        <h3 class="pk__title">
          {{ item.title }}
        </h3>
        <p class="pk__when">
          {{ whenLine }}
        </p>

        <p
          v-if="item.location"
          class="pk__where"
        >
          <svg
            class="pk__pin"
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
            <circle
              cx="12"
              cy="10"
              r="3"
            />
          </svg>
          {{ item.location }}
        </p>

        <p
          v-if="item.description"
          class="pk__desc"
        >
          {{ item.description }}
        </p>
        <p
          v-if="isCancelled && item.cancel_reason"
          class="pk__cancel"
        >
          {{ item.cancel_reason }}
        </p>

        <div
          v-if="showGoTo || showServe"
          class="pk__foot"
        >
          <Button
            v-if="showGoTo"
            variant="primary"
            size="sm"
            @click="emit('go', item)"
          >
            Go to event
          </Button>
          <Button
            v-else-if="showServe"
            variant="primary"
            size="sm"
            @click="emit('serve', item)"
          >
            I can serve
          </Button>
        </div>
      </div>
    </template>
  </teleport>
</template>

<style scoped>
.pk-catch { position: fixed; inset: 0; z-index: 60; background: transparent; }
.pk {
  position: fixed;
  z-index: 61;
  width: 320px;
  max-width: calc(100vw - 24px);
  box-sizing: border-box;
  padding: var(--sp-16) var(--sp-16) var(--sp-14);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: 0 1px 2px rgba(16,24,40,.05), 0 24px 44px -14px rgba(16,24,40,.5);
  animation: pk-pop .18s cubic-bezier(.2,.8,.2,1) both;
}
@keyframes pk-pop { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
.pk--above { transform-origin: bottom left; }

.pk__close { position: absolute; top: 10px; right: 10px; display: grid; place-items: center; width: 24px; height: 24px; border: none; background: transparent; color: var(--ink-5); font-size: 12px; border-radius: var(--r-control); cursor: pointer; transition: background .15s, color .15s; }
.pk__close:hover { background: var(--surface-subtle-2, rgba(0,0,0,.05)); color: var(--ink); }

.pk__tags { display: flex; align-items: center; gap: var(--sp-8); padding-right: 26px; }
.pk__kind { font-size: 10px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; color: var(--accent); }
.pk__title { margin: var(--sp-6) 0 0; font-size: var(--text-h3); font-weight: 800; letter-spacing: -0.025em; line-height: 1.25; }
.pk__when { margin: 4px 0 0; font-size: var(--text-body-sm); color: var(--ink-5); }
.pk__where { display: flex; align-items: center; gap: var(--sp-6); margin: var(--sp-10) 0 0; font-size: var(--text-body-sm); color: var(--ink-3); }
.pk__pin { flex: none; color: var(--ink-5); }
.pk__desc { margin: var(--sp-10) 0 0; font-size: var(--text-body-sm); color: var(--ink-2); line-height: 1.5; }
.pk__cancel { margin: var(--sp-8) 0 0; font-size: var(--text-meta); color: var(--magenta, #d6006c); font-style: italic; }
.pk__foot { display: flex; justify-content: flex-end; margin-top: var(--sp-14); }
</style>

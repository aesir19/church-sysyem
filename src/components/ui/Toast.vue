<script setup>
import { computed } from 'vue'
import Icon from './icons/Icon.vue'
import Spinner from './Spinner.vue'

const props = defineProps({
  toast: { type: Object, required: true }
})

defineEmits(['dismiss'])

const iconName = computed(() => ({
  success: 'check',
  error: 'close',
  info: 'eye',
  undo: 'undo'
}[props.toast.type] || 'check'))
</script>

<template>
  <!-- No role or aria-live here on purpose: ToastHost is the live region, and
       nesting a second one inside it makes some screen readers announce the
       same toast twice. -->
  <div
    class="toast"
    :class="`toast--${toast.type}`"
  >
    <span class="toast__tile">
      <Spinner
        v-if="toast.type === 'progress'"
        :size="14"
      />
      <Icon
        v-else
        :name="iconName"
        :size="14"
        :width="2.3"
      />
    </span>

    <div class="toast__text">
      <p class="toast__title">
        {{ toast.title }}
      </p>
      <p
        v-if="toast.body"
        class="toast__body"
      >
        {{ toast.body }}
      </p>
      <div
        v-if="toast.type === 'progress'"
        class="toast__track"
        aria-hidden="true"
      >
        <span class="toast__bar" />
      </div>
    </div>

    <button
      v-if="toast.action"
      type="button"
      class="toast__action"
      @click="toast.action.onClick?.(); $emit('dismiss')"
    >
      {{ toast.action.label }}
    </button>

    <button
      type="button"
      class="toast__close"
      aria-label="Dismiss notification"
      @click="$emit('dismiss')"
    >
      <Icon
        name="close"
        :size="12"
        :width="2.2"
      />
    </button>
  </div>
</template>

<style scoped>
/* The 3px left stripe is the accent; it is what makes a stack of three
   readable at a glance without reading any of them. */
.toast {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-10);
  width: min(360px, calc(100vw - 32px));
  padding: var(--sp-12) var(--sp-14);
  background: var(--surface);
  border: 1px solid var(--border);
  border-left: 3px solid var(--ink-5);
  border-radius: 13px;
  box-shadow: var(--shadow-popover);
  animation: slide var(--dur-slide) var(--ease-entrance) both;
}

.toast__tile {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  flex: none;
  border-radius: var(--r-pill);
  margin-top: 1px;
}

.toast__text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }

.toast__title {
  font-size: var(--text-body-sm);
  font-weight: 700;
  color: var(--ink);
  line-height: 1.4;
}

.toast__body { font-size: var(--text-meta); color: var(--ink-4); line-height: 1.45; }

.toast__action,
.toast__close {
  border: 0;
  background: transparent;
  font-family: var(--font-sans);
  cursor: pointer;
  border-radius: var(--r-tag);
  flex: none;
}

.toast__action {
  border: 1px solid var(--border-strong);
  padding: var(--sp-6) var(--sp-10);
  font-size: var(--text-meta);
  font-weight: 700;
  color: var(--ink-2);
  background: var(--surface);
}
.toast__action:hover { background: var(--surface-subtle-2); }

.toast__close {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  color: var(--ink-5);
  margin-top: 2px;
}
.toast__close:hover { color: var(--ink); background: var(--surface-subtle-2); }

.toast__track {
  height: 3px;
  border-radius: var(--r-pill);
  background: var(--divider);
  overflow: hidden;
  margin-top: var(--sp-6);
}
.toast__bar {
  display: block;
  height: 100%;
  width: 40%;
  border-radius: var(--r-pill);
  background: var(--accent);
  animation: indeterminate 1.4s var(--ease-entrance) infinite;
}
@keyframes indeterminate {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(350%); }
}

/* --- Types ------------------------------------------------------------ */
.toast--success { border-left-color: var(--success); }
.toast--success .toast__tile { background: var(--success-tint); color: var(--success); }

.toast--error { border-left-color: var(--magenta); }
.toast--error .toast__tile { background: var(--magenta-tint); color: var(--magenta); }

.toast--info,
.toast--progress { border-left-color: var(--accent); }
.toast--info .toast__tile,
.toast--progress .toast__tile { background: var(--accent-tint); color: var(--accent); }

/* Undo rides the dark panel — it is the one toast that must read as a
   reversible action rather than a report of something already settled. */
.toast--undo {
  background: var(--dark-panel);
  border-color: transparent;
  border-left-color: var(--accent-on-dark);
}
.toast--undo .toast__title { color: #fff; }
.toast--undo .toast__body { color: var(--dark-panel-ink-2); }
.toast--undo .toast__tile { background: rgba(255, 255, 255, .12); color: var(--accent-on-dark); }
.toast--undo .toast__action {
  background: rgba(255, 255, 255, .1);
  border-color: rgba(255, 255, 255, .18);
  color: #fff;
}
.toast--undo .toast__action:hover { background: rgba(255, 255, 255, .18); }
.toast--undo .toast__close { color: var(--dark-panel-ink-2); }
.toast--undo .toast__close:hover { color: #fff; background: rgba(255, 255, 255, .12); }

@media (prefers-reduced-motion: reduce) {
  .toast { animation: none; }
  .toast__bar { animation: none; width: 100%; opacity: .5; }
}
</style>

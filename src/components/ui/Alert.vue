<script setup>
import { computed } from 'vue'
import Icon from './icons/Icon.vue'

// The page banner — full width, above the content. The mockups draw five:
// live check-in (cyan gradient), month locked (warning), offline with a pending
// count (magenta), view-only role (neutral), month closed (success, dismissible).
//
// `role` is chosen from the tone rather than hardcoded: an offline or error
// banner is an assertive interruption, a "check-in is open" banner is not.
// Announcing everything assertively trains people to ignore it.

const props = defineProps({
  tone: {
    type: String,
    default: 'neutral',
    validator: v => ['neutral', 'live', 'warning', 'danger', 'success'].includes(v)
  },
  icon: { type: String, default: '' },
  dismissible: { type: Boolean, default: false },
  // The pulsing dot on the live check-in banner.
  pulse: { type: Boolean, default: false }
})

defineEmits(['dismiss'])

const defaultIcon = {
  neutral: 'eye',
  live: '',
  warning: 'alert',
  danger: 'offline',
  success: 'check'
}

const iconName = computed(() => props.icon || defaultIcon[props.tone])
const liveRegion = computed(() => (['danger', 'warning'].includes(props.tone) ? 'assertive' : 'polite'))
</script>

<template>
  <div
    class="alert"
    :class="`alert--${tone}`"
    role="status"
    :aria-live="liveRegion"
  >
    <span
      v-if="pulse"
      class="alert__pulse anim-pulse"
      aria-hidden="true"
    />
    <Icon
      v-else-if="iconName"
      :name="iconName"
      :size="16"
      :width="2.2"
      class="alert__icon"
    />

    <p class="alert__body">
      <slot />
    </p>

    <div
      v-if="$slots.action || dismissible"
      class="alert__actions"
    >
      <slot name="action" />
      <button
        v-if="dismissible"
        type="button"
        class="alert__dismiss"
        @click="$emit('dismiss')"
      >
        Dismiss
      </button>
    </div>
  </div>
</template>

<style scoped>
.alert {
  display: flex;
  align-items: center;
  gap: var(--sp-12);
  width: 100%;
  padding: var(--sp-14) var(--sp-18);
  border: 1px solid var(--border);
  border-radius: var(--r-inset);
  font-size: var(--text-body);
  background: var(--surface);
  color: var(--ink-3);
}

.alert__body { flex: 1; min-width: 0; }
/* The mockups bold the leading clause of every banner — "July is closed.",
   "You are offline." — and run the explanation on in normal weight. */
.alert__body :deep(strong) { color: var(--ink); font-weight: 700; }

.alert__actions { display: flex; align-items: center; gap: var(--sp-8); flex: none; }
.alert__icon { flex: none; }

.alert__pulse {
  width: 8px;
  height: 8px;
  border-radius: var(--r-pill);
  background: var(--accent);
  flex: none;
}

.alert__dismiss {
  border: 0;
  background: transparent;
  padding: var(--sp-6) var(--sp-8);
  font-family: var(--font-sans);
  font-size: var(--text-label);
  font-weight: 700;
  color: inherit;
  opacity: .8;
  cursor: pointer;
  border-radius: var(--r-tag);
}
.alert__dismiss:hover { opacity: 1; background: rgba(0, 0, 0, .04); }

/* --- Tones ------------------------------------------------------------ */
.alert--live {
  background: linear-gradient(135deg, var(--accent-tint-2), var(--accent-tint));
  border-color: var(--accent-border);
  color: var(--accent-darkest);
}
.alert--live .alert__body :deep(strong) { color: var(--accent-darkest); }

.alert--warning {
  background: var(--warning-tint);
  border-color: var(--warning-border);
  color: var(--warning-deep);
}
.alert--warning .alert__icon { color: var(--warning); }
.alert--warning .alert__body :deep(strong) { color: var(--warning-deep); }

.alert--danger {
  background: var(--magenta-tint);
  border-color: var(--magenta-border);
  color: var(--magenta-darkest);
}
.alert--danger .alert__icon { color: var(--magenta); }
.alert--danger .alert__body :deep(strong) { color: var(--magenta-darkest); }

.alert--success {
  background: var(--success-tint);
  border-color: var(--success-border);
  color: var(--success);
}
.alert--success .alert__body :deep(strong) { color: var(--success); }

.alert--neutral .alert__icon { color: var(--ink-5); }
</style>

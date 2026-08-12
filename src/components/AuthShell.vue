<script setup>
import AppLogo from './AppLogo.vue'

// The frame around sign in, set password, account pending and 404 — every
// screen that exists outside the dashboard shell but inside the same visual
// language.
//
// TWO SHAPES, because the mockups draw two. Sign-in and set-password are a
// left-aligned card on a cyan-to-magenta wash: they are forms, and a form reads
// down a left edge. The two account states are centred text on the plain app
// background with no card at all — they are announcements, and a card around an
// announcement makes it look like something you are meant to fill in.

defineProps({
  title: { type: String, default: '' },
  subtitle: { type: String, default: '' },
  // The default badge is the app mark. Pass the `badge` slot for a screen that
  // leads with its own — the lock on set-password, the clock on pending.
  icon: { type: Boolean, default: true },
  wash: { type: String, default: 'none', validator: v => ['none', 'auth'].includes(v) },
  width: { type: String, default: 'sm', validator: v => ['sm', 'md'].includes(v) },
  // false → the announcement shape: centred, no card, no border.
  card: { type: Boolean, default: true }
})
</script>

<template>
  <div
    class="auth"
    :class="`auth--${wash}`"
  >
    <div
      class="auth__panel"
      :class="[`auth__panel--${width}`, card ? 'auth__panel--card' : 'auth__panel--bare']"
    >
      <slot name="badge">
        <AppLogo
          v-if="icon"
          :wordmark="false"
          :size="44"
          class="auth__logo"
        />
      </slot>

      <div
        v-if="title || subtitle || $slots.subtitle"
        class="auth__head"
      >
        <h1
          v-if="title"
          class="auth__title"
        >
          {{ title }}
        </h1>
        <!-- `$slots.subtitle` is checked as well as the prop. A caller that
             needs markup in the sentence — "You were invited as <strong>Pastor,
             UDFC Bethel</strong>" — passes the slot and no prop, and testing
             the prop alone silently dropped the whole line. -->
        <p
          v-if="subtitle || $slots.subtitle"
          class="auth__sub"
        >
          <slot name="subtitle">
            {{ subtitle }}
          </slot>
        </p>
      </div>

      <slot />
    </div>

    <p
      v-if="$slots.footnote"
      class="auth__foot"
    >
      <slot name="footnote" />
    </p>
  </div>
</template>

<style scoped>
.auth {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-14);
  min-height: 100dvh;
  padding: var(--sp-28) var(--sp-16);
  background: var(--app-bg);
}

/* The mockup's own wash: cyan out of the top-left, through the app grey, into a
   magenta blush at the far corner. One gradient, used by both form screens —
   they are the same moment in the same flow and were never meant to be told
   apart by their background. */
.auth--auth {
  background: radial-gradient(
    120% 90% at 12% 0%,
    var(--accent-tint) 0%,
    var(--app-bg) 46%,
    var(--magenta-tint) 100%
  );
}

.auth__panel {
  display: flex;
  flex-direction: column;
  gap: var(--sp-18);
  width: 100%;
}

.auth__panel--card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 20px;
  box-shadow: var(--shadow-card), 0 30px 60px -34px rgba(16, 24, 40, .6);
  padding: 30px var(--sp-28);
  animation: rise var(--dur-rise) var(--ease-entrance) both;
}

.auth__panel--bare {
  align-items: center;
  text-align: center;
  animation: rise var(--dur-rise) var(--ease-entrance) both;
}

.auth__panel--sm { max-width: 380px; }
.auth__panel--md { max-width: 460px; }

.auth__logo { align-self: flex-start; }
.auth__panel--bare .auth__logo { align-self: center; }

.auth__head { display: flex; flex-direction: column; gap: var(--sp-6); }

.auth__title {
  font-size: 23px;
  font-weight: 800;
  letter-spacing: var(--tracking-h1);
  line-height: 1.2;
  color: var(--ink);
}

.auth__sub {
  font-size: var(--text-body);
  color: var(--ink-4);
  line-height: 1.55;
}
/* The mockups bold the part of the sentence that names who you are — "You were
   invited as Pastor, UDFC Bethel". */
.auth__sub :deep(strong) { color: var(--ink); font-weight: 700; }

.auth__foot {
  font-size: var(--text-meta);
  color: var(--ink-5);
  text-align: center;
  max-width: 380px;
  line-height: 1.5;
}

@media (prefers-reduced-motion: reduce) {
  .auth__panel { animation: none; }
}
</style>

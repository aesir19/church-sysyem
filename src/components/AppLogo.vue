<script setup>
/**
 * The one UDFC mark.
 *
 * Retires three byte-identical inline copies of this SVG (LoginView,
 * SetPasswordView, AccountPendingView). Lives in `src/components/` rather than
 * `src/components/ui/` deliberately: `ui/` holds domain-blind primitives that
 * could be dropped into any Vue app, and a church's own mark is the opposite of
 * that.
 *
 * A non-obvious finding this consolidation surfaced: the sidebar brand mark and
 * the auth-page logo were already TWO DIFFERENT GLYPHS — a door/circle icon in
 * AppSidebar against this cross/steeple. This file standardises on the
 * cross/steeple, which had three call sites to the door's one and reads as a
 * church at favicon size. Pointing the sidebar at this component is Stage 1b
 * work, when the shell is migrated.
 *
 * Colour comes from `currentColor`, not a hardcoded `#1a56db` as all three
 * copies carried. That is what lets the mark follow the theme into dark mode
 * and survive the rebrand as a token edit rather than an SVG edit.
 */
defineProps({
  size: { type: [Number, String], default: 48 },
  /** Announced name. Empty renders it decoratively, for use beside a wordmark. */
  title: { type: String, default: 'United Door of Faith Church' },
})
</script>

<template>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 64 64"
    :width="typeof size === 'number' ? `${size}px` : size"
    :height="typeof size === 'number' ? `${size}px` : size"
    class="app-logo"
    :role="title ? 'img' : undefined"
    :aria-hidden="title ? undefined : 'true'"
  >
    <title v-if="title">{{ title }}</title>
    <!-- Cross -->
    <rect x="29" y="8" width="6" height="28" rx="1" fill="currentColor" />
    <rect x="20" y="17" width="24" height="6" rx="1" fill="currentColor" />
    <!-- Sanctuary, and the door it is named for -->
    <path d="M16 38h32v22H16z" fill="currentColor" opacity="0.15" />
    <path d="M16 38h32" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round" />
    <rect x="28" y="46" width="8" height="14" rx="1" fill="currentColor" />
  </svg>
</template>

<style scoped>
.app-logo {
  display: block;
  color: var(--color-accent);
}
</style>

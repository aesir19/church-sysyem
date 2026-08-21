<script setup>
// Mockup 4g's second state: someone reached a settings page by URL that is not theirs.
//
// A DEEP-LINK BACKSTOP, NOT A NAV STATE. Out-of-scope navigation is hidden now, not
// locked (docs/decisions/0016-hide-out-of-scope-nav.md) — the settings gear itself is
// absent for anyone who cannot open it. This panel exists only for the case that
// remains: someone typing or bookmarking a settings URL they may not use. It fails
// closed with a sentence rather than a blank screen.

import Button from '../ui/Button.vue'
import Icon from '../ui/icons/Icon.vue'

defineProps({
  title: { type: String, default: 'This page is not yours to open' },
  detail: {
    type: String,
    default: 'Only a Super Admin manages accounts and roles. Ask an administrator if something needs changing.'
  }
})
</script>

<template>
  <div class="ny">
    <span class="ny__tile">
      <Icon
        name="lock"
        :size="22"
        :width="2"
      />
    </span>
    <h2 class="ny__title">
      {{ title }}
    </h2>
    <p class="ny__detail">
      {{ detail }}
    </p>
    <Button to="/dashboard/overview">
      Back to the dashboard
    </Button>
  </div>
</template>

<style scoped>
.ny {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-8);
  margin-top: 24px;
  padding: 34px 24px;
  border: 1px dashed var(--border);
  border-radius: var(--r-card);
  background: var(--surface);
  text-align: center;
}

.ny__tile {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: var(--r-inset);
  background: var(--surface-subtle);
  color: var(--ink-3);
}

.ny__title {
  margin: var(--sp-8) 0 0;
  font-size: var(--text-h3);
  font-weight: 800;
  letter-spacing: var(--tracking-h3);
}

.ny__detail {
  margin: 0 auto 6px;
  max-width: 46ch;
  font-size: var(--text-body-sm);
  color: var(--ink-3);
  text-wrap: pretty;
}
</style>

<script setup>
// Mockup 4g's second state: someone reached a settings page by URL that is not theirs.
//
// THIS IS WHY HIDING THE MENU ENTRY IS NOT A SILENT FAILURE. The nav shows a locked
// item rather than removing it, because a nav that shortens itself teaches people the
// feature does not exist. The settings menu does remove entries — but the page behind
// them still says no out loud, so nothing is ever hidden in a way that leaves somebody
// staring at a blank screen wondering what broke.

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

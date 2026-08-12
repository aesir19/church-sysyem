<script setup>
import Icon from './ui/icons/Icon.vue'

// The brand block: a cyan tile with the mark, then "UDFC" over "Church
// Dashboard". Appears at the top of the nav and centred on every auth screen.

defineProps({
  size: { type: Number, default: 34 },
  // The auth screens show the tile alone, centred, with the wordmark rendered
  // as the page heading instead.
  wordmark: { type: Boolean, default: true }
})
</script>

<template>
  <div
    class="logo"
    :class="{ 'logo--mark-only': !wordmark }"
  >
    <span
      class="logo__tile"
      :style="{ width: `${size}px`, height: `${size}px`, borderRadius: `${Math.round(size * 0.29)}px` }"
    >
      <Icon
        name="logo"
        :size="Math.round(size * 0.52)"
        :width="2"
      />
    </span>

    <span
      v-if="wordmark"
      class="logo__text"
    >
      <span class="logo__name">UDFC</span>
      <span class="logo__sub">Church Dashboard</span>
    </span>
  </div>
</template>

<style scoped>
.logo { display: flex; align-items: center; gap: var(--sp-10); min-width: 0; }
.logo--mark-only { justify-content: center; }

.logo__tile {
  display: grid;
  place-items: center;
  flex: none;
  background: linear-gradient(135deg, var(--accent), var(--accent-deep));
  color: #fff;
  box-shadow: var(--shadow-primary);
}

.logo__text { display: flex; flex-direction: column; min-width: 0; line-height: 1.2; }

.logo__name {
  font-size: var(--text-body);
  font-weight: 800;
  letter-spacing: var(--tracking-h3);
  color: var(--ink);
}

.logo__sub {
  font-size: var(--text-meta-sm);
  font-weight: 500;
  color: var(--ink-5);
}
</style>

<script setup>
/**
 * Renders one glyph from the static set in iconPaths.js.
 *
 * Decorative by default (`aria-hidden`), because an icon beside its own label
 * announced twice is worse than an icon not announced at all. Pass `title` only
 * when the icon is the only thing conveying the meaning — an icon-only button.
 */
import { computed } from 'vue'
import { iconPaths } from './iconPaths'

const props = defineProps({
  name: { type: String, required: true },
  /** Any CSS length, or a number of px. Colour comes from `currentColor`. */
  size: { type: [Number, String], default: 20 },
  /** Accessible name. Omit for decorative icons. */
  title: { type: String, default: '' },
})

const paths = computed(() => iconPaths(props.name))
const dimension = computed(() => (typeof props.size === 'number' ? `${props.size}px` : props.size))
</script>

<template>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    :width="dimension"
    :height="dimension"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="icon"
    :role="title ? 'img' : undefined"
    :aria-hidden="title ? undefined : 'true'"
  >
    <title v-if="title">{{ title }}</title>
    <path v-for="d in paths" :key="d" :d="d" />
  </svg>
</template>

<style scoped>
.icon {
  display: block;
  flex-shrink: 0;
}
</style>

<script setup>
import { computed } from 'vue'
import { iconPaths } from './iconPaths'

// A 24×24 stroked icon. Colour comes from `currentColor`, so an icon inherits
// whatever the surrounding text is doing and never needs a colour prop.
//
// ACCESSIBILITY. Decorative by default — `aria-hidden`, no focus, no name —
// because the overwhelming majority of these sit next to a visible label and
// announcing them again is noise. Pass `title` for the handful that stand alone
// (the theme toggle, the modal close button) and the element becomes an
// img-role node with an accessible name instead.
//
// The prop is `title` rather than `label` because it renders as the SVG
// <title> element, and because that is the name the rest of the codebase and
// its tests already use for it.

const props = defineProps({
  name: { type: String, required: true },
  size: { type: [Number, String], default: 17 },
  // The handoff specifies 1.9–2.4 depending on rendered size: heavier for small
  // glyphs, lighter for the large icon tiles.
  width: { type: [Number, String], default: 2 },
  title: { type: String, default: '' }
})

const parts = computed(() => iconPaths[props.name] || [])

if (import.meta.env.DEV) {
  // A missing icon renders as nothing at all, which is invisible in review and
  // ships. Fail loudly in dev only.
  if (!iconPaths[props.name]) {
    console.warn(`[Icon] unknown icon "${props.name}". See src/components/ui/icons/iconPaths.js`)
  }
}
</script>

<template>
  <svg
    class="icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="width"
    stroke-linecap="round"
    stroke-linejoin="round"
    :role="title ? 'img' : undefined"
    :aria-label="title || undefined"
    :aria-hidden="title ? undefined : 'true'"
    focusable="false"
  >
    <title v-if="title">{{ title }}</title>
    <component
      :is="tag"
      v-for="([tag, attrs], i) in parts"
      :key="i"
      v-bind="attrs"
    />
  </svg>
</template>

<style scoped>
.icon {
  display: block;
  flex: none;
}
</style>

<script setup>
import Icon from './icons/Icon.vue'

// Used for in-flight buttons and the indeterminate progress toast.
//
// NOT used for page loading. The handoff is explicit that a loading screen is
// skeleton bars with the `sweep` animation and no spinner — see the `.skeleton`
// class in tokens.css. A spinner says "wait"; a skeleton says "here is the
// shape of what is coming", which is the better answer on a roster of 248.

defineProps({
  size: { type: [Number, String], default: 16 },
  label: { type: String, default: 'Loading' }
})
</script>

<template>
  <span
    class="spinner"
    role="status"
    :aria-label="label"
  >
    <Icon
      name="spinner"
      :size="size"
      :width="2.4"
    />
  </span>
</template>

<style scoped>
.spinner { display: inline-flex; animation: spin .8s linear infinite; }

@keyframes spin { to { transform: rotate(360deg); } }

@media (prefers-reduced-motion: reduce) {
  /* A spinner that cannot spin communicates nothing, so it fades instead of
     freezing — the one place where "disable the animation" is the wrong fix. */
  .spinner { animation: pulse-fade 1.4s ease-in-out infinite; }
  @keyframes pulse-fade { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
}
</style>

<script setup>
import { computed } from 'vue'

// Initials on a tinted tile. There is no photography anywhere in this app —
// the handoff is explicit that every graphic is markup — so this is the only
// representation a person ever gets, and it appears at five sizes: 27px on the
// group cards, 32px in the members table, 50px in the detail panel, 56px on the
// profile page, 68px on the member profile header.
//
// The large sizes are a cyan gradient; the small ones are a flat tint. That is
// the mockups' rule, not an embellishment: a gradient at 27px reads as mud.

const props = defineProps({
  name: { type: String, default: '' },
  size: { type: Number, default: 32 },
  // Guests and anonymous givers have no name to initial. The mockups render a
  // grey em-dash tile for exactly this.
  placeholder: { type: Boolean, default: false }
})

const initials = computed(() => {
  const parts = (props.name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return ''
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
})

const gradient = computed(() => props.size >= 44)

const style = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
  borderRadius: `${props.size >= 44 ? Math.round(props.size * 0.32) : 9}px`,
  fontSize: `${Math.max(10, Math.round(props.size * 0.34))}px`
}))
</script>

<template>
  <span
    class="avatar"
    :class="{ 'avatar--gradient': gradient, 'avatar--placeholder': placeholder || !initials }"
    :style="style"
    :title="name || undefined"
  >
    <span aria-hidden="true">{{ placeholder || !initials ? '—' : initials }}</span>
    <span
      v-if="name"
      class="sr-only"
    >{{ name }}</span>
  </span>
</template>

<style scoped>
.avatar {
  display: inline-grid;
  place-items: center;
  flex: none;
  background: var(--accent-tint);
  color: var(--accent-darkest);
  font-weight: 800;
  letter-spacing: .01em;
  line-height: 1;
  font-variant-numeric: normal;
}

.avatar--gradient {
  background: linear-gradient(135deg, var(--accent), var(--accent-deep));
  color: #fff;
}

.avatar--placeholder {
  background: var(--divider);
  color: var(--ink-5);
  font-weight: 600;
}

.sr-only {
  position: absolute;
  width: 1px; height: 1px;
  padding: 0; margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>

<script setup>
import { computed } from 'vue'
import Modal from './ui/Modal.vue'
import Avatar from './ui/Avatar.vue'
import Icon from './ui/icons/Icon.vue'
import { useActiveChurch } from '../composables/useActiveChurch'

// Modal 12 in the handoff. A dialog rather than a <select>, deliberately: the
// mockups give each church a card carrying its member count and the caller's
// role there, which a native option cannot hold.
//
// Only rendered for a caller who can span churches — SuperAdmin and Head
// Pastor. Everyone else has exactly one church and the trigger is hidden, which
// is what `showChurchSelector` decides.

const props = defineProps({
  open: { type: Boolean, required: true }
})

const emit = defineEmits(['update:open'])

const { churches, activeChurchId, setActiveChurch } = useActiveChurch()

const list = computed(() => churches.value || [])

function choose (id) {
  if (id !== activeChurchId.value) setActiveChurch(id)
  emit('update:open', false)
}
</script>

<template>
  <Modal
    :open="props.open"
    title="Switch church"
    :description="`You have access to ${list.length} ${list.length === 1 ? 'church' : 'churches'}.`"
    width="sm"
    @update:open="emit('update:open', $event)"
  >
    <ul class="switch">
      <li
        v-for="church in list"
        :key="church.id"
      >
        <button
          type="button"
          class="switch__card"
          :class="{ 'is-current': church.id === activeChurchId }"
          :aria-current="church.id === activeChurchId ? 'true' : undefined"
          @click="choose(church.id)"
        >
          <Avatar
            :name="church.name"
            :size="34"
          />
          <span class="switch__text">
            <span class="switch__name">{{ church.name }}</span>
          </span>
          <Icon
            v-if="church.id === activeChurchId"
            name="check"
            :size="16"
            :width="2.3"
            class="switch__tick"
          />
        </button>
      </li>
    </ul>

    <p class="switch__note">
      Records never move between churches. Switching only changes what you are
      looking at.
    </p>
  </Modal>
</template>

<style scoped>
.switch { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--sp-8); }

.switch__card {
  display: flex;
  align-items: center;
  gap: var(--sp-12);
  width: 100%;
  padding: var(--sp-12);
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: var(--r-inset);
  cursor: pointer;
  text-align: left;
  font-family: var(--font-sans);
  transition: border-color var(--dur-state) ease, background-color var(--dur-state) ease;
}
.switch__card:hover { background: var(--surface-subtle-2); }

.switch__card.is-current {
  border-color: var(--accent);
  background: var(--accent-tint-2);
}

.switch__text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }

.switch__name {
  font-size: var(--text-body);
  font-weight: 700;
  color: var(--ink);
}

.switch__tick { color: var(--accent); flex: none; }

.switch__note {
  font-size: var(--text-meta);
  color: var(--ink-5);
  line-height: 1.5;
}
</style>

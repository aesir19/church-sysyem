<script setup>
// Confirm before cancelling a pending invite (ADR-0019).
//
// EVERY LINE HERE IS TRUE AT THE MOMENT THE BUTTON IS PRESSED (same discipline as
// ConfirmPastorModal). Cancelling deletes the person's unfinished login and releases
// the invite record, so the operator should see exactly that before they commit — and
// see it stated differently for an orphaned invite, whose login is already gone.

import { computed } from 'vue'
import Modal from '../ui/Modal.vue'
import Button from '../ui/Button.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  // A pending-invite row: { email, full_name, orphaned }
  invite: { type: Object, default: null }
})

const emit = defineEmits(['update:open', 'confirm'])

const isOrphan = computed(() => !!props.invite?.orphaned)

const title = computed(() =>
  props.invite ? `Cancel the invitation for ${props.invite.full_name}?` : ''
)

const consequences = computed(() => {
  if (!props.invite) return []
  const { email } = props.invite

  if (isOrphan.value) {
    return [
      { tone: 'accent', text: `Clears the leftover invitation for ${email}. Its login was already removed, so nothing else changes.` },
      { tone: 'muted', text: `${props.invite.full_name} can be invited again afterwards.` }
    ]
  }

  return [
    { tone: 'alert', text: `Deletes the unfinished login for ${email}. If they have not set a password yet, their invitation link stops working.` },
    { tone: 'muted', text: `${props.invite.full_name} keeps their member record — only the pending sign-in is removed.` },
    { tone: 'muted', text: 'You can invite them again afterwards.' }
  ]
})
</script>

<template>
  <Modal
    :open="open"
    width="md"
    :title="title"
    description="This takes effect immediately."
    @update:open="emit('update:open', $event)"
  >
    <ul class="cim">
      <li
        v-for="(item, index) in consequences"
        :key="index"
        class="cim__item"
      >
        <span
          class="cim__dot"
          :class="`cim__dot--${item.tone}`"
          aria-hidden="true"
        />
        <span class="cim__text">{{ item.text }}</span>
      </li>
    </ul>

    <template #footer>
      <Button @click="emit('update:open', false)">
        Go back
      </Button>
      <Button
        variant="danger"
        @click="emit('confirm')"
      >
        Yes, cancel the invitation
      </Button>
    </template>
  </Modal>
</template>

<style scoped>
.cim { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--sp-8); }

.cim__item {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-10);
  padding: var(--sp-10) var(--sp-12);
  border-radius: var(--r-inset);
  background: var(--surface-subtle);
}

.cim__dot {
  width: var(--sp-6);
  height: var(--sp-6);
  margin-top: var(--sp-7);
  flex: none;
  border-radius: var(--r-pill);
}
.cim__dot--accent { background: var(--accent); }
.cim__dot--alert { background: var(--magenta); }
.cim__dot--muted { background: var(--ink-4); }

.cim__text { font-size: var(--text-body-sm); color: var(--ink-2); text-wrap: pretty; }
</style>

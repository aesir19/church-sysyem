<script setup>
// Mockup 4e: confirm before a pastoral role changes hands.
//
// EVERY LINE IN A CONSEQUENCE LIST MUST BE TRUE AT THE MOMENT THE BUTTON IS PRESSED.
// That is why this is the one place in the admin work carrying no "Soon" markers.
// Elsewhere a coming-soon surface shows the reader where the product is going, which is
// useful. Here it would sit beside statements that are simply true and quietly
// undermine them — and this dialog is the last thing an administrator reads before
// granting authority over a church.
//
// So three lines from 4e are gone rather than badged: the ₱20,000 expense-approval
// threshold and "service oversight" describe features that do not exist, and "both
// people are e-mailed" would need a transactional e-mail provider, which is an unmade
// Rule 1 decision. What is left is what actually happens.

import { computed } from 'vue'
import Modal from '../ui/Modal.vue'
import Button from '../ui/Button.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  // { church, account, action: 'assign' | 'remove' }
  subject: { type: Object, default: null }
})

const emit = defineEmits(['update:open', 'confirm'])

const isAssign = computed(() => props.subject?.action === 'assign')

const title = computed(() => {
  if (!props.subject) return ''
  const { account, church } = props.subject
  return isAssign.value
    ? `Make ${account.full_name} a pastor of ${church.name}?`
    : `Remove ${account.full_name} as pastor of ${church.name}?`
})

const consequences = computed(() => {
  if (!props.subject) return []
  const { account, church } = props.subject

  if (isAssign.value) {
    return [
      { tone: 'accent', text: `${account.full_name} gains the pastor's view of ${church.name} — members, attendance and finance, for that church only.` },
      { tone: 'muted', text: 'A pastor sees; they do not write. Member records, money and attendance are still edited by the ministries responsible for them.' },
      { tone: 'muted', text: `${church.name} may have more than one pastor. This adds one; it removes nobody.` },
      { tone: 'muted', text: 'It takes effect immediately, the next time they load the dashboard.' }
    ]
  }

  return [
    { tone: 'alert', text: `${account.full_name} becomes a plain member and loses the pastor's view of ${church.name}.` },
    { tone: 'muted', text: 'Their member record and their place on the church roll are untouched.' },
    { tone: 'muted', text: 'Their sign-in keeps working. Only what they can see changes.' }
  ]
})
</script>

<template>
  <Modal
    :open="open"
    width="md"
    :title="title"
    :description="isAssign ? 'This takes effect immediately and applies to this church only.' : 'This takes effect immediately.'"
    @update:open="emit('update:open', $event)"
  >
    <ul class="cpm">
      <li
        v-for="(item, index) in consequences"
        :key="index"
        class="cpm__item"
      >
        <span
          class="cpm__dot"
          :class="`cpm__dot--${item.tone}`"
          aria-hidden="true"
        />
        <span class="cpm__text">{{ item.text }}</span>
      </li>
    </ul>

    <template #footer>
      <Button @click="emit('update:open', false)">
        Go back
      </Button>
      <Button
        :variant="isAssign ? 'primary' : 'danger'"
        @click="emit('confirm')"
      >
        {{ isAssign ? 'Yes, make them a pastor' : 'Yes, remove them' }}
      </Button>
    </template>
  </Modal>
</template>

<style scoped>
.cpm { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--sp-8); }

.cpm__item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--r-inset);
  background: var(--surface-subtle);
}

.cpm__dot {
  width: 6px;
  height: 6px;
  margin-top: 7px;
  flex: none;
  border-radius: var(--r-pill);
}
.cpm__dot--accent { background: var(--accent); }
.cpm__dot--alert { background: var(--magenta); }
.cpm__dot--muted { background: var(--ink-4); }

.cpm__text { font-size: var(--text-body-sm); color: var(--ink-2); text-wrap: pretty; }
</style>

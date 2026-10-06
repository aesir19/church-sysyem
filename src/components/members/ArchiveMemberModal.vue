<script setup>
import { computed, ref, watch } from 'vue'
import Modal from '../ui/Modal.vue'
import Button from '../ui/Button.vue'
import Input from '../ui/Input.vue'
import { archiveMember } from '../../lib/data/archives'
import { showToast } from '../../composables/useToast'

// Dialog 03 — archive member, the destructive confirm.
//
// ARCHIVING IS NOT DELETION and the copy is the only thing that says so, which
// is why it is spelled out rather than reduced to "Are you sure?". Giving
// history and attendance already recorded stay exactly where they are; the
// record leaves the active roll. A pastor can restore it.
//
// The mockup offers a checkbox — "Also remove from Youth Ministry and any small
// group". That is a second write, against `group_members`, that the app has
// never made, and it is not reversible by the restore path that makes archiving
// safe. New feature; deferred to planning rather than smuggled in under a
// repaint.
//
// The reason field is NOT in the mockup and stays anyway: `archived_reason` is
// a column the app has always written, and it is the only record of why
// somebody left the roll. Dropping a field people already use is not a
// redesign.

const props = defineProps({
  open: { type: Boolean, default: false },
  member: { type: Object, default: null }
})

const emit = defineEmits(['update:open', 'archived'])

const reason = ref('')
const saving = ref(false)
const errorMessage = ref('')

const fullName = computed(() => {
  const m = props.member
  if (!m) return ''
  const middle = m.middle_name ? `${m.middle_name.trim()[0]}. ` : ''
  return `${m.first_name} ${middle}${m.last_name}`.replace(/\s+/g, ' ').trim()
})

watch(() => props.open, (open) => {
  if (open) {
    reason.value = ''
    saving.value = false
    errorMessage.value = ''
  }
})

async function confirm () {
  if (!props.member) return
  saving.value = true
  errorMessage.value = ''

  const result = await archiveMember({ id: props.member.id, reason: reason.value })
  saving.value = false

  // The RPC archives the member and disables linked sign-in in one transaction.
  // The view changes only after both succeed.
  if (!result.ok) {
    errorMessage.value = result.message
    showToast('Could not archive that member.', 'error')
    return
  }

  emit('archived', props.member)
  emit('update:open', false)
  showToast({ title: 'Member archived.', body: `${fullName.value} has left the active roll.`, type: 'success' })
}
</script>

<template>
  <Modal
    :open="open"
    :title="`Archive ${fullName}?`"
    description="The record leaves the active roll; giving and attendance stay attached. Group assignments are kept. A linked account loses sign-in and current sessions stop on their next request. Pastor, Secretariat or SuperAdmin can restore the member later."
    width="sm"
    layout="stack"
    footer-layout="even"
    icon="archive"
    icon-tone="magenta"
    :close-on-outside-click="false"
    @update:open="$emit('update:open', $event)"
  >
    <Input
      v-model="reason"
      as="textarea"
      label="Reason"
      hint="optional"
      maxlength="500"
      :rows="3"
      placeholder="Moved away, transferred to another church…"
    />

    <p
      v-if="errorMessage"
      class="arch__error"
      role="alert"
    >
      {{ errorMessage }}
    </p>

    <template #footer>
      <!-- Equal halves, safe action first. The destructive one is not the
           default and is not where the eye lands. -->
      <Button
        block
        :disabled="saving"
        @click="$emit('update:open', false)"
      >
        Keep active
      </Button>
      <Button
        block
        variant="danger"
        :loading="saving"
        @click="confirm"
      >
        Archive member
      </Button>
    </template>
  </Modal>
</template>

<style scoped>
.arch__error {
  font-size: var(--text-body-sm);
  font-weight: 600;
  color: var(--magenta-deep);
}
</style>

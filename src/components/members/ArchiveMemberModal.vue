<script setup>
import { computed, ref, watch } from 'vue'
import Modal from '../ui/Modal.vue'
import Button from '../ui/Button.vue'
import Input from '../ui/Input.vue'
import { archive as archiveMember } from '../../lib/data/members'
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

  // RLS refuses an archive by FILTERING, so a refusal used to arrive as
  // `{ error: null, data: null }` and read as success — the row vanished from
  // the list until a reload brought it back. `archive()` selects the row it
  // wrote precisely so a refusal is a refusal; never patch the list from
  // anything but an accepted write.
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
    description="The record leaves the active roll and stops appearing in attendance and follow-up lists. Giving history and attendance already recorded are kept. A pastor can restore it at any time."
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

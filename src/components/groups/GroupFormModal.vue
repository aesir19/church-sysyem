<script setup>
import { computed, ref, watch } from 'vue'
import Modal from '../ui/Modal.vue'
import Button from '../ui/Button.vue'
import Input from '../ui/Input.vue'
import { supabase } from '../../lib/supabase'
import { write } from '../../lib/data/write'
import { GROUP_COLUMNS } from '../../lib/data/groups'
import { buildSmallGroupCreatePayload, buildSmallGroupUpdatePayload } from '../../utils/groupPayload'
import { showToast } from '../../composables/useToast'

// Dialog 04 — new small group, and the same form in edit mode.
//
// SMALL GROUPS ONLY, which is why there is no type chooser. The mockup offers
// "Small group / Ministry" as a pair of cards, but a Ministry is GLOBAL — the
// 0004 CHECK requires church_id IS NULL — so creating one is a cross-church act
// that no church-scoped role can perform, and the app has never exposed it.
// Rendering a choice that the database refuses is worse than rendering no
// choice. Ministry creation is future planning, together with the approval step
// the mockup's subtitle describes ("needs a pastor's approval before it appears
// on the roll"), which has no column, no queue and no notification behind it.

const props = defineProps({
  open: { type: Boolean, default: false },
  mode: { type: String, default: 'create' },
  group: { type: Object, default: null },
  churchId: { type: String, default: '' }
})

const emit = defineEmits(['update:open', 'saved'])

const name = ref('')
const saving = ref(false)
const errorMessage = ref('')
const submitted = ref(false)

const isEdit = computed(() => props.mode === 'edit')

const nameError = computed(() =>
  submitted.value && !name.value.trim() ? 'Give the group a name.' : ''
)

const dirty = computed(() => name.value.trim() !== (isEdit.value ? (props.group?.name || '') : ''))

watch(() => props.open, (open) => {
  if (!open) return
  name.value = isEdit.value ? (props.group?.name || '') : ''
  saving.value = false
  errorMessage.value = ''
  submitted.value = false
})

function requestClose () {
  if (saving.value) return
  emit('update:open', false)
}

async function submit () {
  submitted.value = true
  errorMessage.value = ''
  if (nameError.value) return

  saving.value = true

  // Both writes re-state the scope in the WHERE clause as well as relying on
  // RLS. Belt and braces, deliberately: an edit that reached the wrong church
  // would rename a group nobody in this church can see.
  const result = isEdit.value
    ? await write(
      supabase
        .from('groups')
        .update(buildSmallGroupUpdatePayload({ name: name.value }))
        .eq('id', props.group.id)
        .eq('church_id', props.churchId)
        .eq('type', 'Small Group'),
      { columns: GROUP_COLUMNS, messages: { blocked: 'That group could not be updated. It may belong to another church.' } }
    )
    : await write(
      supabase.from('groups').insert(buildSmallGroupCreatePayload({ name: name.value }, props.churchId)),
      { columns: GROUP_COLUMNS, messages: { blocked: 'That group could not be created. It may belong to another church.' } }
    )

  saving.value = false

  if (!result.ok) {
    errorMessage.value = result.message
    showToast(isEdit.value ? 'Could not save the group.' : 'Could not create the group.', 'error')
    return
  }

  emit('saved', { row: result.rows[0], mode: props.mode })
  emit('update:open', false)
  showToast({
    title: isEdit.value ? 'Group saved.' : 'Small group created.',
    body: result.rows[0]?.name,
    type: 'success'
  })
}
</script>

<template>
  <Modal
    :open="open"
    :title="isEdit ? 'Rename group' : 'New small group'"
    description="Small groups meet midweek, in homes. They belong to this church."
    width="sm"
    :close-on-outside-click="!dirty"
    @update:open="$event ? null : requestClose()"
  >
    <p
      v-if="errorMessage"
      class="gfm__error"
      role="alert"
    >
      {{ errorMessage }}
    </p>

    <Input
      v-model="name"
      label="Group name"
      required
      maxlength="80"
      placeholder="e.g. Thursday Group — Barangay Dos"
      :error="nameError"
      @keydown.enter.prevent="submit"
    />

    <template #footer>
      <Button
        :disabled="saving"
        @click="requestClose"
      >
        Cancel
      </Button>
      <Button
        variant="primary"
        :loading="saving"
        @click="submit"
      >
        {{ isEdit ? 'Save changes' : 'Create group' }}
      </Button>
    </template>
  </Modal>
</template>

<style scoped>
.gfm__error {
  padding: var(--sp-10) var(--sp-12);
  border-radius: var(--r-inset);
  background: var(--magenta-tint);
  border: 1px solid var(--magenta-border);
  font-size: var(--text-body-sm);
  color: var(--magenta-darkest);
}
</style>

<script setup>
import { ref, watch } from 'vue'
import Modal from '../ui/Modal.vue'
import Button from '../ui/Button.vue'
import MemberAutocomplete from '../MemberAutocomplete.vue'
import { supabase } from '../../lib/supabase'
import { write } from '../../lib/data/write'
import { attendeeLabel } from '../../utils/attendanceWindow'
import { buildGuestLinkPayload, isDuplicateMemberConflict } from '../../utils/attendanceLink'
import { showToast } from '../../composables/useToast'

// Repointing a guest row at the member it was really meant to be.
//
// No mockup draws this. It is kept because it is the only correction available
// for the most common check-in mistake — a member typing their own name into
// the guest field — and because losing it would leave "remove and re-add" as
// the workaround, which rewrites the provenance (see below).

const ATTENDANCE_COLUMNS =
  'id, member_id, guest_name, guest_contact, source, created_at, members(first_name, middle_name, last_name)'

const props = defineProps({
  open: { type: Boolean, default: false },
  row: { type: Object, default: null },
  members: { type: Array, default: () => [] }
})

const emit = defineEmits(['update:open', 'linked', 'removed'])

const memberId = ref('')
const saving = ref(false)
const errorMessage = ref('')

watch(() => props.open, (open) => {
  if (!open) return
  memberId.value = ''
  saving.value = false
  errorMessage.value = ''
})

async function submit () {
  const row = props.row
  if (!row) return

  const payload = buildGuestLinkPayload(memberId.value)
  if (!payload) {
    errorMessage.value = 'Choose a member from the list.'
    return
  }

  saving.value = true

  // An UPDATE rather than delete-and-re-add, on purpose: 0019 grants only the
  // three identity columns, so source, created_at and recorded_by come through
  // untouched and a corrected self check-in keeps saying it was self-asserted.
  // Delete-and-re-add would rewrite all three and claim staff had verified the
  // person.
  //
  // The policy rejects in two different ways: USING filters (member row,
  // viewer, another church's row) and returns zero rows; WITH CHECK raises
  // 42501. `write` classifies both — `blocked` and `denied` — so neither
  // reaches the user as raw Postgres text.
  const result = await write(
    supabase.from('attendance').update(payload).eq('id', row.id),
    {
      columns: ATTENDANCE_COLUMNS,
      messages: {
        blocked: 'That record could not be linked. It may belong to another church, or the member may no longer be active.',
        denied: 'That member cannot be linked to this record. They may belong to another church, or their record may have been archived.'
      }
    }
  )

  // The member already has a row for this service, so
  // attendance_service_member_key rejects the link. They are already counted —
  // the guest row IS the duplicate, and removing it is the correction the user
  // asked for. Checked against `cause` rather than the classification because
  // it drives a different ACTION, not merely a different message.
  if (isDuplicateMemberConflict(result.cause)) {
    const removal = await write(
      supabase.from('attendance').delete().eq('id', row.id),
      { columns: 'id', messages: { blocked: 'That duplicate entry could not be removed.' } }
    )
    saving.value = false

    if (!removal.ok) {
      errorMessage.value = removal.message
      return
    }

    emit('removed', row)
    emit('update:open', false)
    showToast('Already recorded as a member — the duplicate guest entry was removed.')
    return
  }

  saving.value = false

  if (!result.ok) {
    errorMessage.value = result.message
    return
  }

  emit('linked', result.rows[0])
  emit('update:open', false)
  showToast(`Linked to ${attendeeLabel(result.rows[0])}.`)
}
</script>

<template>
  <Modal
    :open="open"
    title="Link to a member"
    :description="row
      ? `Recorded as guest “${attendeeLabel(row)}”. If that is a registered member whose name was mistyped, choose them below — the time and how they were recorded stay as they are.`
      : ''"
    width="md"
    :close-on-outside-click="!memberId"
    @update:open="$emit('update:open', $event)"
  >
    <p
      v-if="errorMessage"
      class="lm__error"
      role="alert"
    >
      {{ errorMessage }}
    </p>

    <!-- A distinct input-id from the record-attendee picker: it drives the
         listbox id and aria-activedescendant, and duplicates break the combobox
         semantics. -->
    <MemberAutocomplete
      v-model="memberId"
      :members="members"
      input-id="link-member"
      label="Member"
    />

    <template #footer>
      <Button
        :disabled="saving"
        @click="$emit('update:open', false)"
      >
        Cancel
      </Button>
      <Button
        variant="primary"
        :loading="saving"
        @click="submit"
      >
        Link
      </Button>
    </template>
  </Modal>
</template>

<style scoped>
.lm__error {
  padding: var(--sp-10) var(--sp-12);
  border-radius: var(--r-inset);
  background: var(--magenta-tint);
  border: 1px solid var(--magenta-border);
  font-size: var(--text-body-sm);
  color: var(--magenta-darkest);
}
</style>

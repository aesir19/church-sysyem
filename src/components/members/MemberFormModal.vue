<script setup>
import { computed, ref, watch } from 'vue'
import Modal from '../ui/Modal.vue'
import Button from '../ui/Button.vue'
import Input from '../ui/Input.vue'
import Toggle from '../ui/Toggle.vue'
import Icon from '../ui/icons/Icon.vue'
import { create as createMember, update as updateMember } from '../../lib/data/members'
import { buildMemberPayload } from '../../utils/memberPayload'
import { isMemberFormDirty, snapshotMemberForm } from '../../utils/memberFormDirty'
import { validateMemberForm, errorsOnTab, FIELD_TAB } from '../../utils/memberValidation'
import { showToast } from '../../composables/useToast'

// Dialogs 01 (add member) and 02 (edit member, with validation errors).
//
// ONE COMPONENT FOR BOTH, because they are the same form. The mockups draw
// them differently — add leads with a plain title, edit leads with the member's
// avatar and a "last edited" line — and that difference is a header, not a
// second implementation. Two components would be two field lists to keep in
// step, and the field list is the part that must never drift from the payload
// builder.
//
// WHAT IS NOT HERE, DELIBERATELY:
//
// - The mockup's third tab, "Groups". Assigning a member to a group at create
//   time is dialog 05's job and the app has never done it — that is a new
//   feature, and new features go to future planning rather than into a
//   redesign.
//
// - `has_submitted_membership_form`. The redesign promoted it to the fourth
//   journey step and the detail panel renders it, but it has never been
//   editable here and no mockup draws a control for it. Making it editable is a
//   decision about who certifies membership, not a repaint. Deferred.
//
// - The mockup's "mobile number is required" validation. The app's required
//   set is the five NOT NULL columns, and inventing a sixth rule during a
//   redesign would start rejecting records that save fine today.

const props = defineProps({
  open: { type: Boolean, default: false },
  // 'create' | 'edit'
  mode: { type: String, default: 'create' },
  member: { type: Object, default: null },
  churchId: { type: String, default: '' },
  churchName: { type: String, default: '' },
  // "Bethel · record created by Grace Abad" — the subtitle on dialog 01.
  actorName: { type: String, default: '' }
})

const emit = defineEmits(['update:open', 'saved', 'request-archive'])

const TABS = [
  { key: 'personal', label: 'Personal' },
  { key: 'contact', label: 'Contact' },
  { key: 'journey', label: 'Journey' }
]

const GENDERS = ['Male', 'Female']
const MARITAL = ['Single', 'Married', 'Widowed']

// The three the app has always been able to set. The fourth journey step is
// rendered on the panel and is deliberately absent here — see the note above.
const JOURNEY_FIELDS = [
  { key: 'is_one_to_one_completed', label: 'One-to-one completed' },
  { key: 'is_turning_point_completed', label: 'Turning Point completed' },
  { key: 'is_baptized', label: 'Baptized' }
]

const blank = () => ({
  first_name: '',
  last_name: '',
  middle_name: '',
  birthdate: '',
  gender: '',
  address: '',
  date_joined: '',
  contact_number: '',
  email: '',
  marital_status: '',
  wedding_anniversarry: '',
  facebook_link: '',
  is_one_to_one_completed: false,
  is_turning_point_completed: false,
  is_baptized: false
})

const form = ref(blank())
const initial = ref(snapshotMemberForm(form.value))
const tab = ref('personal')
const saving = ref(false)
const saveError = ref('')
const discardWarning = ref('')
// Errors only appear once the form has been submitted. Marking a field invalid
// while somebody is still on their way to filling it in is how a form ends up
// shouting at a person who has done nothing wrong yet.
const submitted = ref(false)

const todayIso = computed(() => new Date().toISOString().slice(0, 10))

const isEdit = computed(() => props.mode === 'edit')
const isMarried = computed(() => form.value.marital_status === 'Married')

// The dialog's description — read out after the title, and shown under it.
//
// "Bethel · record created by Grace Abad" when adding. Editing says only which
// church the record belongs to: the mockup's second line there is "Last edited
// 12 July 2026 by Joel Delos Reyes", and `members` carries neither an edited-at
// nor an edited-by column, so that line would have to be invented. Naming the
// current user as the editor of a record they have not yet changed would be a
// small lie in an audit-shaped sentence, which is the worst kind.
//
// Either half is dropped rather than left as a dangling separator when the
// value has not resolved yet.
const subtitle = computed(() => {
  const parts = [props.churchName]
  if (!isEdit.value && props.actorName) parts.push(`record created by ${props.actorName}`)
  return parts.filter(Boolean).join(' · ')
})

const fullName = computed(() => {
  const m = props.member
  if (!m) return ''
  const middle = m.middle_name ? `${m.middle_name.trim()[0]}. ` : ''
  return `${m.first_name} ${middle}${m.last_name}`.replace(/\s+/g, ' ').trim()
})

// The rules live in utils/memberValidation.js — see the note there for why they
// are not inline.
const errors = computed(() =>
  submitted.value ? validateMemberForm(form.value, { today: todayIso.value }) : {}
)

const errorCount = computed(() => Object.keys(errors.value).length)

function errorsOn (tabKey) {
  return errorsOnTab(errors.value, tabKey)
}

const dirty = computed(() => isMemberFormDirty(form.value, initial.value))

// "marks 'Joined' today" — the toggle IS the date_joined field, not a second
// piece of state beside it. One source of truth, two affordances: flipping it
// writes today's date into the Date joined input, which stays editable.
const startsJourney = computed({
  get: () => form.value.date_joined === todayIso.value,
  set: (on) => { form.value.date_joined = on ? todayIso.value : '' }
})

function hydrate () {
  const m = props.member
  if (props.mode === 'edit' && m) {
    form.value = {
      first_name: m.first_name ?? '',
      last_name: m.last_name ?? '',
      middle_name: m.middle_name ?? '',
      birthdate: m.birthdate ?? '',
      gender: m.gender ?? '',
      address: m.address ?? '',
      date_joined: m.date_joined ?? '',
      contact_number: m.contact_number != null ? String(m.contact_number) : '',
      email: m.email ?? '',
      marital_status: m.marital_status ?? '',
      wedding_anniversarry: m.wedding_anniversarry ?? '',
      facebook_link: m.facebook_link ?? '',
      is_one_to_one_completed: m.is_one_to_one_completed ?? false,
      is_turning_point_completed: m.is_turning_point_completed ?? false,
      is_baptized: m.is_baptized ?? false
    }
  } else {
    form.value = blank()
  }
  initial.value = snapshotMemberForm(form.value)
  tab.value = 'personal'
  saving.value = false
  saveError.value = ''
  discardWarning.value = ''
  submitted.value = false
}

watch(() => props.open, (open) => { if (open) hydrate() })

/**
 * Every route out of this dialog arrives here — the × , Cancel, and Escape,
 * which Modal hands to the platform.
 *
 * `window.confirm` is deliberately not used. A browser-chrome dialog on top of
 * an application dialog steals focus without any of the guarantees the Dialog
 * primitive buys, and cannot be styled or dismissed consistently. The mockups
 * draw a separate "Leave without saving?" dialog (13) for this; a second
 * dialog over the first is two focus traps fighting for one Escape key, so the
 * warning renders INSIDE this one instead, where the typing is.
 */
function requestClose () {
  if (saving.value) return
  if (dirty.value) {
    discardWarning.value = 'You have unsaved entries. Use “Discard changes” if you meant to lose them.'
    return
  }
  emit('update:open', false)
}

function discard () {
  discardWarning.value = ''
  emit('update:open', false)
}

async function submit () {
  submitted.value = true
  saveError.value = ''
  if (errorCount.value) {
    // Land on the tab holding the first problem rather than leaving somebody
    // staring at a summary that names fields they cannot see.
    const firstBad = Object.keys(errors.value)[0]
    tab.value = FIELD_TAB[firstBad] || 'personal'
    return
  }

  saving.value = true
  const payload = buildMemberPayload(form.value)
  const result = isEdit.value
    ? await updateMember({ id: props.member.id, payload })
    : await createMember({ payload, churchId: props.churchId })
  saving.value = false

  if (!result.ok) {
    // The message is the one write.js classified, never error.message — a
    // Postgres constraint violation quotes the offending row verbatim, and
    // that row is member PII.
    saveError.value = result.message
    showToast(isEdit.value ? 'Could not save changes.' : 'Could not add the member.', 'error')
    return
  }

  emit('saved', result.rows[0])
  emit('update:open', false)
  showToast({
    title: isEdit.value ? 'Changes saved.' : 'Member added.',
    body: `${form.value.first_name} ${form.value.last_name}`.trim(),
    type: 'success'
  })
}
</script>

<template>
  <Modal
    :open="open"
    :title="isEdit ? `Edit ${fullName}` : 'Add member'"
    :description="subtitle"
    :avatar-name="isEdit ? fullName : ''"
    width="lg"
    :close-on-outside-click="false"
    @update:open="$event ? null : requestClose()"
  >
    <!-- Validation summary. Counts, then explains: the mockup's own
         "Two fields need attention." -->
    <div
      v-if="errorCount"
      class="mfm__summary"
      role="alert"
    >
      <span
        class="mfm__summary-mark"
        aria-hidden="true"
      >!</span>
      <p>
        <strong>{{ errorCount === 1 ? 'One field needs' : `${errorCount} fields need` }} attention.</strong>
        Fill in what is marked below and save again.
      </p>
    </div>

    <div
      v-if="saveError"
      class="mfm__summary"
      role="alert"
    >
      <span
        class="mfm__summary-mark"
        aria-hidden="true"
      >!</span>
      <p>{{ saveError }}</p>
    </div>

    <!-- Tabs -->
    <div
      class="mfm__tabs"
      role="tablist"
      aria-label="Member details"
    >
      <button
        v-for="t in TABS"
        :key="t.key"
        type="button"
        role="tab"
        class="mfm__tab"
        :class="{ 'is-on': tab === t.key }"
        :aria-selected="tab === t.key"
        @click="tab = t.key"
      >
        {{ t.label }}
        <span
          v-if="errorsOn(t.key)"
          class="mfm__tab-dot"
        >{{ errorsOn(t.key) }}</span>
      </button>
    </div>

    <!-- Personal -->
    <div
      v-show="tab === 'personal'"
      class="mfm__grid"
    >
      <Input
        v-model="form.last_name"
        label="Last name"
        required
        maxlength="100"
        autocomplete="family-name"
        :error="errors.last_name"
      />
      <Input
        v-model="form.first_name"
        label="First name"
        required
        maxlength="100"
        autocomplete="given-name"
        :error="errors.first_name"
      />
      <Input
        v-model="form.middle_name"
        label="Middle name"
        hint="optional"
        maxlength="100"
      />
      <Input
        v-model="form.birthdate"
        label="Birthdate"
        type="date"
        required
        :max="todayIso"
        :error="errors.birthdate"
      />
      <Input
        v-model="form.gender"
        label="Gender"
        as="select"
        required
        :error="errors.gender"
      >
        <option value="">
          Choose…
        </option>
        <option
          v-for="g in GENDERS"
          :key="g"
          :value="g"
        >
          {{ g }}
        </option>
      </Input>
      <Input
        v-model="form.marital_status"
        label="Marital status"
        as="select"
        required
        :error="errors.marital_status"
      >
        <option value="">
          Choose…
        </option>
        <option
          v-for="s in MARITAL"
          :key="s"
          :value="s"
        >
          {{ s }}
        </option>
      </Input>
      <!-- Shown only for a married member, which is the behaviour the app has
           always had and the panel still mirrors. -->
      <Input
        v-if="isMarried"
        v-model="form.wedding_anniversarry"
        label="Wedding anniversary"
        type="date"
        hint="optional"
      />
      <Input
        v-model="form.date_joined"
        label="Date joined"
        type="date"
        :max="todayIso"
        hint="optional"
      />

      <Toggle
        v-if="!isEdit"
        v-model="startsJourney"
        band
        class="mfm__span"
      >
        <strong>Start the discipleship journey</strong> — marks “Joined” today
      </Toggle>
    </div>

    <!-- Contact -->
    <div
      v-show="tab === 'contact'"
      class="mfm__grid"
    >
      <Input
        v-model="form.contact_number"
        label="Mobile number"
        type="tel"
        inputmode="tel"
        maxlength="32"
        placeholder="09XX XXX XXXX"
        hint="Used for follow-up."
      />
      <Input
        v-model="form.email"
        label="Email"
        type="email"
        maxlength="255"
        autocomplete="email"
      />
      <Input
        v-model="form.address"
        label="Address"
        class="mfm__span"
        maxlength="255"
        hint="Street and barangay, so the record is useful for visitation."
      />
      <Input
        v-model="form.facebook_link"
        label="Facebook"
        class="mfm__span"
        maxlength="255"
        placeholder="https://facebook.com/…"
        hint="Only a facebook.com address becomes a clickable link."
      />
    </div>

    <!-- Journey -->
    <div
      v-show="tab === 'journey'"
      class="mfm__journey"
    >
      <p class="mfm__note">
        These are recorded in whatever order they happened. Nothing here is
        blocked by an earlier step being open.
      </p>
      <Toggle
        v-for="f in JOURNEY_FIELDS"
        :key="f.key"
        v-model="form[f.key]"
      >
        {{ f.label }}
      </Toggle>
    </div>

    <template #footer>
      <!-- The unsaved-changes warning takes the whole footer row: it is a
           refusal to close, and it has to be read before the buttons beside it
           mean anything. -->
      <div
        v-if="discardWarning"
        class="mfm__discard"
        role="alert"
      >
        <Icon
          name="alert"
          :size="15"
          :width="2.2"
        />
        <p>{{ discardWarning }}</p>
        <Button
          size="sm"
          variant="dangerQuiet"
          @click="discard"
        >
          Discard changes
        </Button>
        <Button
          size="sm"
          @click="discardWarning = ''"
        >
          Keep editing
        </Button>
      </div>

      <template v-else>
        <!-- Dialog 02 puts "Archive record" at the far left of the edit footer,
             separated from the safe pair. Modal's .footer-left does the
             separating. -->
        <Button
          v-if="isEdit"
          class="footer-left"
          variant="dangerQuiet"
          :disabled="saving"
          @click="$emit('request-archive', member)"
        >
          Archive record
        </Button>
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
          {{ isEdit ? 'Save changes' : 'Save member' }}
        </Button>
      </template>
    </template>
  </Modal>
</template>

<style scoped>
/* --- Validation summary ----------------------------------------------- */
.mfm__summary {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-9);
  padding: 11px var(--sp-14);
  border-radius: var(--r-inset);
  background: var(--magenta-tint);
  border: 1px solid var(--magenta-border);
  font-size: var(--text-body-sm);
  color: var(--magenta-darkest);
  line-height: 1.45;
}
.mfm__summary strong { font-weight: 800; }

.mfm__summary-mark {
  display: inline-grid;
  place-items: center;
  width: 18px;
  height: 18px;
  flex: none;
  border-radius: var(--r-pill);
  background: var(--magenta);
  color: #fff;
  font-weight: 800;
  font-size: var(--text-meta-sm);
}

/* --- Tabs -------------------------------------------------------------- */
.mfm__tabs { display: flex; gap: var(--sp-6); flex-wrap: wrap; }

.mfm__tab {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-6);
  padding: var(--sp-7) var(--sp-12);
  border: 1px solid var(--border-strong);
  border-radius: var(--r-tag);
  background: var(--surface);
  font-family: var(--font-sans);
  font-size: var(--text-label);
  font-weight: 700;
  color: var(--ink-4);
  cursor: pointer;
  transition: background-color var(--dur-state) ease, color var(--dur-state) ease, border-color var(--dur-state) ease;
}
.mfm__tab:hover { background: var(--surface-subtle-2); }
.mfm__tab.is-on {
  background: var(--accent-tint);
  border-color: transparent;
  color: var(--accent-dark);
  font-weight: 800;
}
.mfm__tab:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

/* The count of unresolved fields hiding on a tab you are not looking at. */
.mfm__tab-dot {
  display: inline-grid;
  place-items: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: var(--r-pill);
  background: var(--magenta);
  color: #fff;
  font-size: var(--text-meta-sm);
  font-weight: 800;
}

/* --- Fields ------------------------------------------------------------ */
.mfm__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--sp-12);
  align-items: start;
}
.mfm__span { grid-column: 1 / -1; }

.mfm__journey { display: flex; flex-direction: column; gap: var(--sp-14); }
.mfm__note { font-size: var(--text-body-sm); color: var(--ink-4); line-height: 1.5; }

/* --- Discard warning --------------------------------------------------- */
.mfm__discard {
  display: flex;
  align-items: center;
  gap: var(--sp-9);
  width: 100%;
  padding: var(--sp-10) var(--sp-12);
  border-radius: var(--r-inset);
  background: var(--warning-tint);
  border: 1px solid var(--warning-border);
  color: var(--warning-deep);
}
.mfm__discard p { flex: 1; min-width: 0; font-size: var(--text-body-sm); line-height: 1.4; }
.mfm__discard :deep(.btn) { flex: none; }

@media (max-width: 620px) {
  .mfm__grid { grid-template-columns: 1fr; }
  .mfm__discard { flex-wrap: wrap; }
  .mfm__discard p { flex-basis: 100%; }
}
</style>

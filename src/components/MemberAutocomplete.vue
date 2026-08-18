<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import Avatar from './ui/Avatar.vue'
import Icon from './ui/icons/Icon.vue'
import { memberDisplayName, normalizeName } from '../utils/attendanceWindow'

/**
 * Member typeahead over a list the caller has already fetched.
 *
 * Filtering is in-memory on purpose. A query per keystroke would be the busiest
 * interaction in the app and burns egress against a 5 GB/month budget for a list
 * that is capped at a few hundred rows by CLAUDE.md's own 300-member threshold.
 * The caller fetches once with `.is('archived_at', null)` and passes the rows in.
 *
 * NOTE: this component is deliberately never rendered on the public check-in
 * page. A typeahead over member names there would publish the church directory
 * to anyone holding the QR link. See
 * docs/decisions/0007-public-checkin-endpoint.md.
 */
const props = defineProps({
  /** Selected member id, or '' when nothing is chosen. */
  modelValue: { type: String, default: '' },
  /** Raw member rows: { id, first_name, middle_name, last_name }. */
  members: { type: Array, default: () => [] },
  label: { type: String, default: 'Member' },
  inputId: { type: String, required: true },
  placeholder: { type: String, default: 'Search a registered member' },
  disabled: { type: Boolean, default: false },
  maxResults: { type: Number, default: 8 },
})

const emit = defineEmits(['update:modelValue'])

const query = ref('')
const open = ref(false)
const activeIndex = ref(-1)
const inputEl = ref(null)
const listEl = ref(null)
const anchorEl = ref(null)
const anchorRect = ref(null)
let blurTimer = null

// The listbox is teleported to <body> and positioned from the field's own
// rectangle.
//
// It has to be. This control is used inside ui/Modal, whose dialog is
// `max-height: calc(100vh - 48px); overflow-y: auto` — a scroll container, so
// an absolutely positioned list is CLIPPED at the dialog's edge and the
// remaining names can only be reached by scrolling the whole dialog. Moving the
// list out of that box and pinning it with position: fixed is what lets eight
// results open over a short dialog. The aria wiring is unaffected: aria-controls
// and aria-activedescendant are IDREFs and resolve document-wide.
function measure () {
  const el = anchorEl.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  anchorRect.value = { top: rect.bottom + 6, left: rect.left, width: rect.width }
}

const listStyle = computed(() => {
  const rect = anchorRect.value
  if (!rect) return { display: 'none' }
  return { top: `${rect.top}px`, left: `${rect.left}px`, width: `${rect.width}px` }
})

// Fixed positioning is relative to the viewport, so anything that moves the
// field underneath it — scrolling the page, scrolling the dialog, resizing —
// has to re-measure or the list detaches from its input. `capture` catches
// scrolls inside the dialog as well as on the window.
function watchViewport (on) {
  const method = on ? 'addEventListener' : 'removeEventListener'
  window[method]('scroll', measure, true)
  window[method]('resize', measure)
}

watch(open, (isOpen) => {
  watchViewport(isOpen)
  if (isOpen) nextTick(measure)
})

onBeforeUnmount(() => watchViewport(false))

const options = computed(() =>
  (props.members || []).map((member) => ({
    id: member.id,
    fullName: memberDisplayName(member),
  }))
)

// normalizeName rather than a bare toLowerCase so that searching behaves the
// same way the database's member match does — same whitespace collapsing, same
// case folding. One fewer thing that can surprise a user.
const filtered = computed(() => {
  const needle = normalizeName(query.value)
  const base = options.value
  const matches = needle
    ? base.filter((option) => normalizeName(option.fullName).includes(needle))
    : base
  return matches.slice(0, props.maxResults)
})

const selectedName = computed(
  () => options.value.find((option) => option.id === props.modelValue)?.fullName || ''
)

const listId = computed(() => `${props.inputId}-listbox`)
const optionId = (index) => `${props.inputId}-option-${index}`

function openList() {
  if (props.disabled) return
  open.value = true
}

function closeList() {
  open.value = false
  activeIndex.value = -1
}

function handleInput() {
  // Typing invalidates any prior selection — otherwise the parent would submit a
  // member id that no longer matches the text on screen.
  if (props.modelValue) emit('update:modelValue', '')
  openList()
  activeIndex.value = -1
}

function handleFocus() {
  openList()
}

function handleBlur() {
  // The 120ms delay lets a mousedown on an option land before the list unmounts.
  // Matches the existing pattern in CollectionsInputView.
  blurTimer = window.setTimeout(closeList, 120)
}

function selectOption(option) {
  if (!option) return
  query.value = option.fullName
  emit('update:modelValue', option.id)
  closeList()
}

function handleKeydown(event) {
  if (props.disabled) return

  if (event.key === 'ArrowDown') {
    event.preventDefault()
    openList()
    if (filtered.value.length === 0) return
    activeIndex.value = activeIndex.value >= filtered.value.length - 1 ? 0 : activeIndex.value + 1
    return
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault()
    openList()
    if (filtered.value.length === 0) return
    activeIndex.value = activeIndex.value <= 0 ? filtered.value.length - 1 : activeIndex.value - 1
    return
  }

  if (event.key === 'Enter') {
    if (open.value && activeIndex.value >= 0) {
      // Only swallow Enter when it is actually choosing something, so the key
      // still submits the surrounding form the rest of the time.
      event.preventDefault()
      selectOption(filtered.value[activeIndex.value])
    }
    return
  }

  if (event.key === 'Escape') {
    closeList()
    return
  }

  if (event.key === 'Tab') {
    closeList()
  }
}

function clearSelection() {
  if (blurTimer) window.clearTimeout(blurTimer)
  query.value = ''
  emit('update:modelValue', '')
  closeList()
  inputEl.value?.focus()
}

// Keep the highlighted option visible when arrowing past the fold.
watch(activeIndex, async (index) => {
  if (index < 0) return
  await nextTick()
  listEl.value?.querySelector(`#${CSS.escape(optionId(index))}`)?.scrollIntoView({ block: 'nearest' })
})

/**
 * The parent resets this after a successful submit. Exposed rather than driven
 * by a watcher on modelValue, because clearing the text whenever the id goes
 * empty would wipe what the user is halfway through typing.
 */
function reset() {
  query.value = ''
  emit('update:modelValue', '')
  closeList()
}

defineExpose({ reset, focus: () => inputEl.value?.focus() })
</script>

<template>
  <div class="mac">
    <label
      class="mac__label"
      :for="inputId"
    >{{ label }}</label>
    <div ref="anchorEl">
      <div
        class="mac__shell"
        :class="{ 'is-open': open }"
      >
        <!-- The chosen member's initials, the way dialog 06 draws the control.
           Only once something is actually chosen: while the field is being
           typed into there is no person to stand for. -->
        <Avatar
          v-if="selectedName"
          :name="selectedName"
          :size="26"
          class="mac__chip"
        />
        <input
          :id="inputId"
          ref="inputEl"
          v-model.trim="query"
          type="text"
          role="combobox"
          aria-autocomplete="list"
          :aria-controls="listId"
          :aria-expanded="open"
          :aria-activedescendant="open && activeIndex >= 0 ? optionId(activeIndex) : undefined"
          :placeholder="placeholder"
          :disabled="disabled"
          autocomplete="off"
          @focus="handleFocus"
          @input="handleInput"
          @blur="handleBlur"
          @keydown="handleKeydown"
        >
        <button
          v-if="query"
          type="button"
          class="mac__clear"
          aria-label="Clear member"
          @mousedown.prevent
          @click="clearSelection"
        >
          <Icon
            name="close"
            :size="12"
            :width="2.2"
          />
        </button>
      </div>
    </div>

    <Teleport to="body">
      <!-- @pointerdown.stop is load-bearing, not defensive. When this control is
           used inside ui/Modal, Reka's dialog is a "dismissable layer": while it
           is open it sets `body { pointer-events: none }` and re-enables pointer
           events only on its own subtree. This list is teleported to <body>,
           OUTSIDE that subtree, so (a) it needs `pointer-events: auto` below to
           be clickable at all, and (b) once clickable, a pointerdown on an option
           bubbles to Reka's document-level listener, which — seeing a target that
           is not part of the dialog layer — treats it as an outside click and
           dismisses the whole modal before the pick registers. Stopping the
           pointerdown here keeps the interaction the list's own. -->
      <ul
        v-if="open"
        :id="listId"
        ref="listEl"
        class="mac__list"
        :style="listStyle"
        role="listbox"
        @pointerdown.stop
      >
        <li
          v-for="(option, index) in filtered"
          :id="optionId(index)"
          :key="option.id"
          class="mac__option"
          :class="{ 'is-active': index === activeIndex }"
          role="option"
          :aria-selected="option.id === modelValue"
          @mousedown.prevent="selectOption(option)"
          @mousemove="activeIndex = index"
        >
          <Avatar
            :name="option.fullName"
            :size="26"
          />
          <span class="mac__name">{{ option.fullName }}</span>
        </li>
        <li
          v-if="filtered.length === 0"
          class="mac__empty"
          role="presentation"
        >
          No matching member found.
        </li>
      </ul>
    </Teleport>

    <p class="mac__note">
      <template v-if="selectedName">
        Selected: {{ selectedName }}
      </template>
      <template v-else>
        Start typing, then choose a name from the list.
      </template>
    </p>
  </div>
</template>

<style scoped>
/* Chrome deliberately identical to ui/Input.vue — same box, same focus ring,
   same label and message type. This control cannot BE an Input (it owns a
   listbox and a combobox input), but sitting next to one in a dialog it has to
   be indistinguishable from one. */
.mac { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: var(--sp-6); }

.mac__label {
  font-size: var(--text-field);
  font-weight: 700;
  color: var(--ink-2);
  letter-spacing: .01em;
}

.mac__shell {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--sp-8);
  min-height: 40px;
  padding: 0 var(--sp-12);
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: var(--r-control);
  transition: border-color var(--dur-state) ease, box-shadow var(--dur-state) ease;
}
.mac__shell:focus-within { border-color: var(--accent-border-hi); box-shadow: var(--ring-focus); }

.mac__chip { flex: none; }

.mac__shell input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  padding: 9px 0;
  font-family: var(--font-sans);
  font-size: var(--text-body);
  font-weight: 500;
  color: var(--ink);
}
.mac__shell input::placeholder { color: var(--ink-5); font-weight: 400; }
.mac__shell input:disabled { color: var(--ink-5); cursor: not-allowed; }

.mac__clear {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  flex: none;
  border: 0;
  border-radius: var(--r-pill);
  background: var(--divider);
  color: var(--ink-4);
  cursor: pointer;
  transition: background-color var(--dur-state) ease, color var(--dur-state) ease;
}
.mac__clear:hover { background: var(--border-strong); color: var(--ink); }
.mac__clear:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

/* Teleported to <body>, so it is positioned in viewport coordinates and needs
   to sit above ui/Modal's dialog (z-index 61) rather than above the page. */
.mac__list {
  list-style: none;
  position: fixed;
  z-index: 70;
  /* The dialog this can live inside disables pointer events on <body> while
     open (see the template note); without this the teleported list inherits
     that and none of the options can be clicked. */
  pointer-events: auto;
  padding: var(--sp-6);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-inset);
  box-shadow: var(--shadow-popover);
  max-height: 260px;
  overflow-y: auto;
}

.mac__option {
  display: flex;
  align-items: center;
  gap: var(--sp-10);
  padding: var(--sp-7) var(--sp-9);
  border-radius: var(--r-tag);
  cursor: pointer;
}
.mac__option:hover,
.mac__option.is-active { background: var(--accent-tint-2); }

.mac__name { font-size: var(--text-body-sm); font-weight: 600; color: var(--ink); }

.mac__empty { padding: var(--sp-10) var(--sp-9); font-size: var(--text-body-sm); color: var(--ink-5); }

.mac__note { font-size: var(--text-meta); color: var(--ink-5); }
</style>

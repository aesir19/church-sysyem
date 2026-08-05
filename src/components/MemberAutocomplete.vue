<script setup>
import { computed, nextTick, ref, watch } from 'vue'
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
let blurTimer = null

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
  <div class="form-group autocomplete-group">
    <label :for="inputId">{{ label }}</label>
    <div class="autocomplete-shell" :class="{ 'is-open': open }">
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
      />
      <button
        v-if="query"
        type="button"
        class="clear-btn"
        aria-label="Clear member"
        @mousedown.prevent
        @click="clearSelection"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
    <ul v-if="open" :id="listId" ref="listEl" class="suggestions-list" role="listbox">
      <li
        v-for="(option, index) in filtered"
        :id="optionId(index)"
        :key="option.id"
        class="suggestion-item"
        :class="{ 'is-active': index === activeIndex }"
        role="option"
        :aria-selected="option.id === modelValue"
        @mousedown.prevent="selectOption(option)"
        @mousemove="activeIndex = index"
      >
        <span class="suggestion-name">{{ option.fullName }}</span>
      </li>
      <li v-if="filtered.length === 0" class="suggestion-empty" role="presentation">
        No matching member found.
      </li>
    </ul>
    <p class="field-note">
      <template v-if="selectedName">Selected: {{ selectedName }}</template>
      <template v-else>Start typing, then choose a name from the list.</template>
    </p>
  </div>
</template>

<style scoped>
.autocomplete-group {
  position: relative;
  z-index: 2;
  flex: 1;
  min-width: 0;
}

.autocomplete-shell {
  position: relative;
}

.autocomplete-shell input {
  width: 100%;
  box-sizing: border-box;
  padding-right: 40px;
}

.clear-btn {
  position: absolute;
  top: 50%;
  right: 10px;
  transform: translateY(-50%);
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 999px;
  background: #e2e8f0;
  color: #64748b;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.clear-btn:hover {
  background: #cbd5e1;
  color: #334155;
}

.suggestions-list {
  list-style: none;
  margin: 8px 0 0;
  padding: 6px;
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: #ffffff;
  border: 1px solid #dbe3ef;
  border-radius: 12px;
  box-shadow: 0 18px 40px rgba(15, 23, 42, 0.12);
  max-height: 280px;
  overflow-y: auto;
  z-index: 3;
}

.suggestion-item,
.suggestion-empty {
  padding: 10px 12px;
  border-radius: 8px;
}

.suggestion-item {
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
}

.suggestion-item:hover,
.suggestion-item.is-active {
  background: #eff6ff;
}

.suggestion-name {
  font-size: 0.875rem;
  color: #0f172a;
  font-weight: 600;
}

.suggestion-empty {
  font-size: 0.875rem;
  color: #64748b;
}

.field-note {
  margin: 6px 0 0;
  font-size: 0.75rem;
  color: #64748b;
}
</style>

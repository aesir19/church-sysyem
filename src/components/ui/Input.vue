<script setup>
/**
 * The `.form-group` pattern — label, control, hint, error — repeated almost
 * identically across LoginView, SetPasswordView, CheckinView and
 * CollectionsInputView.
 *
 * A plain wrapper, no primitive needed. What it centralises is the wiring that
 * is easy to omit and invisible when omitted: `for`/`id` pairing, the hint and
 * error reaching the control through `aria-describedby`, and `aria-invalid`.
 * Every hand-rolled copy today gets at most the first of those.
 */
import { computed, useId } from 'vue'

const props = defineProps({
  label: { type: String, required: true },
  /** Native input type. `as="textarea"`/`as="select"` ignore it. */
  type: { type: String, default: 'text' },
  as: {
    type: String,
    default: 'input',
    validator: (value) => ['input', 'textarea', 'select'].includes(value),
  },
  /** Standing help. Shown whether or not there is an error. */
  hint: { type: String, default: '' },
  /** Message from the data module — never `error.message`. See CLAUDE.md. */
  error: { type: String, default: '' },
  required: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  placeholder: { type: String, default: '' },
})

const model = defineModel({ type: [String, Number], default: '' })

const uid = useId()
const controlId = computed(() => `field-${uid}`)
const hintId = computed(() => `${controlId.value}-hint`)
const errorId = computed(() => `${controlId.value}-error`)

const describedBy = computed(() => {
  const ids = []
  if (props.hint) ids.push(hintId.value)
  if (props.error) ids.push(errorId.value)
  return ids.length ? ids.join(' ') : undefined
})
</script>

<template>
  <div class="field" :class="{ 'has-error': !!error }">
    <label :for="controlId" class="field-label">
      {{ label }}
      <!-- The asterisk is decorative; `required` on the control is what a
           screen reader actually announces. -->
      <span v-if="required" class="field-required" aria-hidden="true">*</span>
    </label>

    <!--
      Three explicit branches rather than one `<component :is="as">`.
      Not a style choice: `v-model` on a dynamic component compiles to the
      COMPONENT protocol — a `modelValue` prop plus an `update:modelValue`
      listener — because the compiler cannot know statically that `as` will be
      an element. On a real <input> that lands as a stray `modelvalue`
      attribute and the field never binds at all: it renders empty however full
      the model is, and typing into it updates nothing. Naming the elements is
      what lets the compiler emit the native v-model directive for each.
    -->
    <textarea
      v-if="as === 'textarea'"
      :id="controlId"
      v-model="model"
      class="field-control"
      :required="required"
      :disabled="disabled"
      :placeholder="placeholder || undefined"
      :aria-describedby="describedBy"
      :aria-invalid="error ? 'true' : undefined"
    />
    <select
      v-else-if="as === 'select'"
      :id="controlId"
      v-model="model"
      class="field-control"
      :required="required"
      :disabled="disabled"
      :aria-describedby="describedBy"
      :aria-invalid="error ? 'true' : undefined"
    >
      <slot />
    </select>
    <input
      v-else
      :id="controlId"
      v-model="model"
      class="field-control"
      :type="type"
      :required="required"
      :disabled="disabled"
      :placeholder="placeholder || undefined"
      :aria-describedby="describedBy"
      :aria-invalid="error ? 'true' : undefined"
    />

    <p v-if="hint" :id="hintId" class="field-hint">{{ hint }}</p>
    <!-- role="alert" so a validation failure is announced when it appears,
         rather than only being found by someone who goes looking for it. -->
    <p v-if="error" :id="errorId" class="field-error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.field-label {
  font-size: var(--text-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
}

.field-required {
  color: var(--color-danger);
}

.field-control {
  width: 100%;
  /* 16px on mobile is what stops iOS Safari zooming the viewport on focus.
     Amendment 12's 14px floor is about body copy, not form controls. */
  font-size: var(--text-lg);
  font-family: inherit;
  color: var(--color-text-primary);
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  padding: var(--space-3) var(--space-4);
  min-height: 44px;
  transition:
    border-color var(--duration-fast) var(--ease-standard),
    box-shadow var(--duration-fast) var(--ease-standard);
}

.field-control::placeholder {
  color: var(--color-text-placeholder);
}

.field-control:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: var(--shadow-focus-ring);
}

.field-control:disabled {
  background: var(--color-bg-subtle);
  color: var(--color-text-muted);
  cursor: not-allowed;
}

.has-error .field-control {
  border-color: var(--color-danger);
}

.has-error .field-control:focus {
  box-shadow: 0 0 0 3px var(--color-danger-bg);
}

textarea.field-control {
  min-height: 96px;
  resize: vertical;
}

.field-hint {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  line-height: var(--leading-normal);
}

.field-error {
  font-size: var(--text-sm);
  color: var(--color-danger);
  font-weight: var(--font-weight-medium);
  line-height: var(--leading-normal);
}
</style>

<script>
// inheritAttrs: false, and it is load-bearing rather than tidiness.
//
// The root of this component is a wrapper <div>. With fallthrough left on, every
// attribute a caller writes that is not a declared prop — minlength, maxlength,
// pattern, autocomplete, name, step — lands on that DIV, where it is inert.
// Nothing errors, nothing warns, and the constraint simply never applies: a
// password field with minlength="12" accepts four characters. `$attrs` is bound
// to the <input> below instead, which is the only element any of them mean
// anything on.
export default { inheritAttrs: false }
</script>

<script setup>
import { computed, useId } from 'vue'
import Icon from './icons/Icon.vue'

// A labelled field with the three states the mockups draw: resting, invalid
// (1.5px magenta border, error ring, icon + message) and validated (green
// border, check + message).
//
// The message is wired with aria-describedby and the invalid state sets
// aria-invalid, so the error reaches a screen reader rather than only the eye.
// The mockups pair each inline error with a summary panel at the top of the
// modal when more than one field fails; that panel is the modal's job, not
// this component's.

const props = defineProps({
  modelValue: { type: [String, Number], default: '' },
  label: { type: String, default: '' },
  type: { type: String, default: 'text' },
  placeholder: { type: String, default: '' },
  required: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  readonly: { type: Boolean, default: false },
  error: { type: String, default: '' },
  valid: { type: String, default: '' },
  hint: { type: String, default: '' },
  // Marks the label "(optional)". Separate from `hint` because a field can be
  // optional AND carry guidance — the check-in contact number is both, and
  // overloading hint="optional" made them mutually exclusive.
  optional: { type: Boolean, default: false },
  // The ₱ on amount fields, or the magnifier on search. `prefixIcon` takes an
  // icon name; `prefix` takes literal text.
  prefix: { type: String, default: '' },
  prefixIcon: { type: String, default: '' },
  // The control this field wraps. Gender and Marital status are selects and
  // the archive reason is a textarea, and all three carry EXACTLY the same
  // label / hint / error / focus-ring chrome as a text input — so they are this
  // component with a different control rather than three components that have
  // to be kept looking alike.
  //
  // Rendered as three explicit branches below, NOT as `<component :is="as">`.
  // A dynamic component makes the compiler emit the COMPONENT v-model protocol
  // — it cannot know statically that `as` resolves to an element — so `:value`
  // became a `modelValue` prop on nothing, the field rendered empty however
  // full the model was, and typing updated nothing. It looked entirely correct
  // until the page was loaded. See the regression test in primitives.test.js.
  as: { type: String, default: 'input', validator: v => ['input', 'textarea', 'select'].includes(v) },
  // Textareas only.
  rows: { type: Number, default: 3 },
  // Amount fields render at 22px in the add-contribution modal.
  size: { type: String, default: 'md', validator: v => ['md', 'lg', 'amount'].includes(v) },
  autocomplete: { type: String, default: undefined },
  inputmode: { type: String, default: undefined }
})

const emit = defineEmits(['update:modelValue', 'blur', 'focus', 'keydown'])

// The select is bound with v-model, not with `:value` + `@change` like the
// other two controls.
//
// It is not a style choice. `:value` on a <select> is applied as a DOM property
// — `el.value = 'Female'` — which only selects an option if that option is
// already in the DOM. It happens to be, because Vue mounts children before it
// applies props, but that is an ordering detail of the runtime rather than a
// promise, and the failure mode is silent and specific: an edited member's
// gender resets to the first option the moment the dialog opens, and whoever
// saves the form writes "Male" over "Female" without noticing. Vue's
// `vModelSelect` sets the selection from a mounted/updated hook precisely so
// that ordering cannot matter.
const selectValue = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

const uid = useId()
const inputId = computed(() => `f-${uid}`)
const hintId = computed(() => `h-${uid}`)
const msgId = computed(() => `m-${uid}`)

// A hint and an error are DIFFERENT things and can coexist: "Pesos only." is
// still true while "Enter an amount greater than zero." is showing. Collapsing
// them to one slot loses the standing guidance at exactly the moment the user
// most needs it, so both render and aria-describedby names both.
const showHint = computed(() => !!props.hint && props.hint !== 'optional')
const statusMessage = computed(() => props.error || props.valid)

const describedBy = computed(() => {
  const ids = []
  if (showHint.value) ids.push(hintId.value)
  if (statusMessage.value) ids.push(msgId.value)
  return ids.length ? ids.join(' ') : undefined
})
</script>

<template>
  <div
    class="field"
    :class="{ 'is-error': !!error, 'is-valid': !!valid && !error }"
  >
    <label
      v-if="label"
      class="field__label"
      :for="inputId"
    >
      {{ label }}
      <span
        v-if="required"
        class="field__req"
        aria-hidden="true"
      >*</span>
      <span
        v-if="!required && (optional || hint === 'optional')"
        class="field__opt"
      >(optional)</span>
    </label>

    <div
      class="field__box"
      :class="`field__box--${size}`"
    >
      <Icon
        v-if="prefixIcon"
        :name="prefixIcon"
        :size="16"
        class="field__icon"
      />
      <span
        v-else-if="prefix"
        class="field__prefix"
        aria-hidden="true"
      >{{ prefix }}</span>

      <input
        v-if="as === 'input'"
        :id="inputId"
        v-bind="$attrs"
        class="field__input"
        :type="type"
        :value="modelValue"
        :placeholder="placeholder"
        :disabled="disabled"
        :readonly="readonly"
        :required="required"
        :autocomplete="autocomplete"
        :inputmode="inputmode"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="describedBy"
        @input="$emit('update:modelValue', $event.target.value)"
        @blur="$emit('blur', $event)"
        @focus="$emit('focus', $event)"
        @keydown="$emit('keydown', $event)"
      >

      <textarea
        v-else-if="as === 'textarea'"
        :id="inputId"
        v-bind="$attrs"
        class="field__input field__input--area"
        :value="modelValue"
        :placeholder="placeholder"
        :disabled="disabled"
        :readonly="readonly"
        :required="required"
        :rows="rows"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="describedBy"
        @input="$emit('update:modelValue', $event.target.value)"
        @blur="$emit('blur', $event)"
        @focus="$emit('focus', $event)"
        @keydown="$emit('keydown', $event)"
      />

      <!-- Native, deliberately. The mockups draw a plain box with a ▾, which is
           what a <select> already is — and a hand-rolled listbox on a phone
           loses the OS picker, which is the better control on every device this
           church actually uses. -->
      <select
        v-else
        :id="inputId"
        v-bind="$attrs"
        v-model="selectValue"
        class="field__input field__input--select"
        :disabled="disabled"
        :required="required"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="describedBy"
        @blur="$emit('blur', $event)"
        @focus="$emit('focus', $event)"
      >
        <slot />
      </select>

      <Icon
        v-if="as === 'select'"
        name="chevronDown"
        :size="14"
        class="field__chevron"
      />

      <slot name="suffix" />
    </div>

    <p
      v-if="showHint"
      :id="hintId"
      class="field__msg field__msg--hint"
    >
      {{ hint }}
    </p>

    <!-- role="alert" so a validation failure that appears on blur is announced
         rather than silently added to the page. Only the error takes it; a
         success message is confirmation, not an interruption. -->
    <p
      v-if="statusMessage"
      :id="msgId"
      class="field__msg"
      :role="error ? 'alert' : undefined"
    >
      <Icon
        v-if="error"
        name="alert"
        :size="13"
        :width="2.2"
      />
      <Icon
        v-else-if="valid"
        name="check"
        :size="13"
        :width="2.2"
      />
      {{ statusMessage }}
    </p>
  </div>
</template>

<style scoped>
.field { display: flex; flex-direction: column; gap: var(--sp-6); min-width: 0; }

.field__label {
  font-size: var(--text-field);
  font-weight: 700;
  color: var(--ink-2);
  letter-spacing: .01em;
}
.field__req { color: var(--magenta); margin-left: 2px; }
.field__opt { color: var(--ink-5); font-weight: 500; margin-left: 3px; }

.field__box {
  display: flex;
  align-items: center;
  gap: var(--sp-8);
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: var(--r-control);
  padding: 0 var(--sp-12);
  transition: border-color var(--dur-state) ease, box-shadow var(--dur-state) ease;
}

.field__box--md     { min-height: 40px; }
.field__box--lg     { min-height: 46px; }
.field__box--amount { min-height: 54px; }

.field__box:focus-within {
  border-color: var(--accent-border-hi);
  box-shadow: var(--ring-focus);
}

.field__icon   { color: var(--ink-5); }
.field__prefix { color: var(--ink-4); font-weight: 600; }

.field__input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  padding: 10px 0;
  font-family: var(--font-sans);
  font-size: var(--text-body);
  font-weight: 500;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}
.field__input::placeholder { color: var(--ink-5); font-weight: 400; }
.field__input:disabled { color: var(--ink-5); cursor: not-allowed; }

/* A textarea grows downward, so the box has to stop centring its contents and
   the padding moves onto the control. */
.field__box:has(.field__input--area) { align-items: stretch; padding-top: 0; padding-bottom: 0; }
.field__input--area { resize: vertical; min-height: 72px; line-height: 1.5; }

/* The chevron is ours, drawn in the field's ink; the native arrow is suppressed
   so the two do not both appear. `appearance: none` also strips the OS control
   frame, which is what lets a select sit in the same box as an input. */
.field__input--select {
  appearance: none;
  cursor: pointer;
  /* Room for the chevron sitting on top of it. */
  padding-right: var(--sp-18);
}
.field__input--select:disabled { cursor: not-allowed; }
.field__chevron { flex: none; margin-left: calc(var(--sp-18) * -1); color: var(--ink-5); pointer-events: none; }

.field__box--amount .field__input,
.field__box--amount .field__prefix {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.field__msg {
  display: flex;
  align-items: center;
  gap: var(--sp-6);
  font-size: var(--text-meta);
  font-weight: 600;
  color: var(--ink-4);
}

.field__msg--hint { color: var(--ink-5); font-weight: 500; }

.is-error .field__box {
  border-color: var(--magenta);
  border-width: 1.5px;
}
.is-error .field__box:focus-within { box-shadow: var(--ring-error); }
.is-error .field__msg { color: var(--magenta-deep); }

.is-valid .field__box { border-color: var(--success-border); }
.is-valid .field__msg { color: var(--success); }
</style>

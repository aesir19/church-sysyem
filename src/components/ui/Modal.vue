<script setup>
/**
 * The app's one dialog, wrapping Reka UI's Dialog primitive.
 *
 * WHY A LIBRARY HERE AND NOWHERE ELSE (ADR-0011). There are four hand-rolled
 * modals in this app — DashboardView, MinistrySmallGroupView ×3,
 * CollectionsInputView, AttendanceView ×2 — and not one of them traps focus.
 * A keyboard user can Tab straight out of an open dialog into the page behind
 * it, and Escape and return-focus behave differently depending on which view
 * they happen to be in. This component buys tested interaction logic — focus
 * trap, Escape, return-focus to the trigger, scroll lock, `aria-modal`, and
 * inert-ing the rest of the page — instead of a fifth hand-rolled attempt.
 *
 * It also retires the `<Teleport>`-versus-`<style scoped>` workaround visible
 * in AttendanceView, where modal CSS had to be moved into a second, UNSCOPED
 * `<style>` block because Teleported content escapes the host SFC's scoped
 * attribute. A dedicated component does not have that problem: these scoped
 * styles travel with the content this file Teleports. The `fadeIn`/`slideUp`
 * keyframes duplicated byte-for-byte in DashboardView and
 * MinistrySmallGroupView are hosted here, once.
 */
import { computed } from 'vue'
import { DialogClose, DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import Icon from './icons/Icon.vue'

const props = defineProps({
  /** Required. A dialog with no accessible name is not usable by a screen reader. */
  title: { type: String, required: true },
  /** Optional supporting line, wired to `aria-describedby`. */
  description: { type: String, default: '' },
  /** Matches the two widths already in the wild. */
  size: {
    type: String,
    default: 'default',
    validator: (value) => ['default', 'wide'].includes(value),
  },
  /**
   * Whether a click on the backdrop closes the dialog.
   *
   * Escape is deliberately NOT covered by this — a dialog that cannot be
   * dismissed from the keyboard is exactly the trap this component exists to
   * remove. Set false on form dialogs, where a stray click outside would
   * discard typing.
   */
  closeOnOutsideClick: { type: Boolean, default: true },
})

const open = defineModel('open', { type: Boolean, default: false })

/**
 * Whether to say anything at all about `aria-describedby`.
 *
 * This is a trap, and it bit once already. Reka's `DialogContent` sets
 * `aria-describedby` itself, to the id it will hand `<DialogDescription>`.
 * Vue's `mergeProps` gives fallthrough attrs priority over a child's internal
 * default whenever the key is PRESENT — and `:aria-describedby="undefined"`
 * counts as present, so binding it to `undefined` does not "leave it alone",
 * it deletes the association Reka just made. A dialog with a visible
 * description then announces none.
 *
 * So: bind nothing when there is a description, and let the primitive wire it.
 * The literal string `'undefined'` in the other branch is not a mistake — it is
 * Reka's own documented idiom for "this dialog intentionally has no
 * description", and it suppresses the dev warning that would otherwise fire.
 */
const describedBy = computed(() =>
  props.description ? {} : { 'aria-describedby': 'undefined' },
)
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="modal-overlay" />
      <DialogContent
        class="modal"
        :class="`modal-${size}`"
        v-bind="describedBy"
        @interact-outside="(event) => { if (!props.closeOnOutsideClick) event.preventDefault() }"
      >
        <header class="modal-header">
          <DialogTitle class="modal-title">{{ title }}</DialogTitle>
          <DialogClose class="modal-close" aria-label="Close">
            <Icon name="x" :size="18" />
          </DialogClose>
        </header>

        <DialogDescription v-if="description" class="modal-description">
          {{ description }}
        </DialogDescription>

        <div class="modal-body">
          <slot />
        </div>

        <footer v-if="$slots.footer" class="modal-footer">
          <slot name="footer" />
        </footer>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: var(--color-bg-overlay);
  z-index: var(--z-modal-backdrop);
  animation: modal-fade-in var(--duration-fast) var(--ease-out);
}

.modal {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: var(--z-modal);

  display: flex;
  flex-direction: column;
  width: calc(100vw - var(--space-8));
  max-width: 520px;
  max-height: 90vh;

  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xl);
  animation: modal-slide-up var(--duration-base) var(--ease-out);
}

.modal-wide {
  max-width: 580px;
}

.modal:focus {
  /* The primitive moves focus here on open. That is a programmatic move, not a
   * keyboard one, so a ring on the whole dialog would be noise — the ring
   * belongs on whatever the user Tabs to next. */
  outline: none;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-5) var(--space-6);
  border-bottom: 1px solid var(--color-border-subtle);
}

.modal-title {
  font-size: var(--text-xl);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
  line-height: var(--leading-tight);
}

.modal-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-standard);
}

.modal-close:hover {
  background: var(--color-bg-subtle);
  color: var(--color-text-primary);
}

.modal-close:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus-ring);
}

.modal-description {
  padding: var(--space-4) var(--space-6) 0;
  font-size: var(--text-base);
  color: var(--color-text-secondary);
  line-height: var(--leading-normal);
}

.modal-body {
  padding: var(--space-6);
  overflow-y: auto;
  color: var(--color-text-primary);
  font-size: var(--text-base);
  line-height: var(--leading-normal);
}

.modal-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
  padding: var(--space-4) var(--space-6);
  border-top: 1px solid var(--color-border-subtle);
}

@keyframes modal-fade-in {
  from {
    opacity: 0;
  }
}

@keyframes modal-slide-up {
  from {
    opacity: 0;
    transform: translate(-50%, calc(-50% + 20px));
  }
}

@media (max-width: 600px) {
  .modal {
    width: calc(100vw - var(--space-4));
  }

  .modal-header,
  .modal-footer {
    padding-left: var(--space-4);
    padding-right: var(--space-4);
  }

  .modal-body {
    padding: var(--space-4);
  }
}
</style>

<script setup>
import {
  DialogRoot, DialogPortal, DialogOverlay, DialogContent,
  DialogTitle, DialogDescription, DialogClose
} from 'reka-ui'
import Icon from './icons/Icon.vue'
import Avatar from './Avatar.vue'

// The one dialog in the app. Fifteen of these exist in the mockups and there
// used to be four divergent hand-rolled implementations here, none of which
// trapped focus — Escape, return-focus and scroll lock all behaved differently
// depending on which view you happened to be in.
//
// WHY A DEPENDENCY IS PAID FOR HERE AND NOWHERE ELSE. A focus trap is tested
// interaction logic, not styling: it has to handle the tab cycle, the initial
// focus target, restoring focus to whatever opened it, inert-ing the page
// behind, and `aria-modal` semantics. Reka UI supplies exactly that and nothing
// visual — every pixel below is this project's own tokens. The measured cost is
// recorded in the ADR alongside this component; the gate that matters is that
// the public /checkin bundle must not grow, since it is lazy-loaded and no
// attendee's phone should ever download dashboard dialog code.
//
// The library is scoped to Dialog. Combobox, Tabs and Select stay hand-rolled
// or native — see the ADR for why each.

defineProps({
  open: { type: Boolean, required: true },
  title: { type: String, required: true },
  // GIVE EVERY DIALOG ONE. Without it Reka still points `aria-describedby` at
  // an id it generated and never rendered, so a screen reader announces the
  // title and then resolves the description to nothing at all. Reka's
  // documented escape hatch — aria-describedby="undefined" — does not work in
  // the version pinned here: its check warns on any dangling value, empty or
  // not (node_modules/reka-ui/dist/Dialog/utils.js). A real sentence is the
  // only thing that satisfies it, and it was the right answer anyway. Every
  // call site in this app already had one on screen as body text.
  description: { type: String, default: '' },
  // The member's initials in the tile position, for dialog 02. It replaces
  // `icon` rather than sitting beside it — a dialog head has one mark.
  avatarName: { type: String, default: '' },
  // The mockups' modals are 22px-padded and sized to content, but the tabbed
  // add-member dialog and the assign-members list are noticeably wider.
  width: { type: String, default: 'md', validator: v => ['sm', 'md', 'lg'].includes(v) },
  // The destructive confirms lead with a magenta icon tile instead of a title
  // row; close-the-month leads with a warning one.
  icon: { type: String, default: '' },
  iconTone: { type: String, default: 'accent', validator: v => ['accent', 'magenta', 'warning', 'success'].includes(v) },
  // 'row' is the working dialogs: tile, title and close button on one line.
  // 'stack' is the two confirms — archive-member (03) and close-the-month (10)
  // — where the tile sits ABOVE the question and the title runs the full width.
  // That is not decoration: those dialogs ask something rather than collect
  // something, and the wider measure is what lets the consequence be read as a
  // paragraph.
  layout: { type: String, default: 'row', validator: v => ['row', 'stack'].includes(v) },
  // 'end' is the working dialogs — actions right-aligned, Cancel then the
  // primary. 'even' is the confirms, where the two choices are equal halves
  // across the full width because neither is a default.
  //
  // It is a prop rather than something the caller styles, because the footer is
  // inside DialogPortal and therefore teleported to <body> — a `:deep()` rule
  // written in the calling component's scoped CSS never reaches it.
  footerLayout: { type: String, default: 'end', validator: v => ['end', 'even'].includes(v) },
  // On by default, because dismissing a dialog by clicking away from it is what
  // people expect. Turn it OFF for anything holding work: a half-filled add-member
  // form, or a destructive confirm where a stray click landing on "yes" by way of
  // "the scrim" is the worst possible outcome. Escape is deliberately NOT covered
  // by this — a dialog that cannot be dismissed from the keyboard is exactly the
  // trap this component exists to remove.
  closeOnOutsideClick: { type: Boolean, default: true }
})

defineEmits(['update:open'])
</script>

<template>
  <DialogRoot
    :open="open"
    @update:open="$emit('update:open', $event)"
  >
    <DialogPortal>
      <DialogOverlay class="scrim" />
      <DialogContent
        class="modal"
        :class="`modal--${width}`"
        @pointer-down-outside="closeOnOutsideClick ? undefined : $event.preventDefault()"
        @interact-outside="closeOnOutsideClick ? undefined : $event.preventDefault()"
      >
        <div
          class="modal__head"
          :class="`modal__head--${layout}`"
        >
          <Avatar
            v-if="avatarName"
            :name="avatarName"
            :size="40"
            class="modal__avatar"
          />
          <div
            v-else-if="icon"
            class="modal__tile"
            :class="`modal__tile--${iconTone}`"
          >
            <Icon
              :name="icon"
              :size="18"
              :width="2.1"
            />
          </div>

          <div class="modal__heading">
            <DialogTitle class="modal__title">
              {{ title }}
            </DialogTitle>
            <DialogDescription
              v-if="description"
              class="modal__desc"
            >
              {{ description }}
            </DialogDescription>
          </div>

          <DialogClose
            class="modal__close"
            aria-label="Close"
          >
            <Icon
              name="close"
              :size="14"
              :width="2.2"
            />
          </DialogClose>
        </div>

        <div class="modal__body">
          <slot />
        </div>

        <div
          v-if="$slots.footer"
          class="modal__footer"
          :class="`modal__footer--${footerLayout}`"
        >
          <slot name="footer" />
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style scoped>
.scrim {
  position: fixed;
  inset: 0;
  background: var(--scrim);
  animation: fade var(--dur-state) ease both;
  z-index: 60;
}

.modal {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  gap: var(--sp-18);
  width: calc(100vw - 32px);
  max-height: calc(100vh - 48px);
  overflow-y: auto;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 16px;
  box-shadow: var(--shadow-modal);
  padding: var(--sp-22);
  z-index: 61;
  animation: modal-in var(--dur-slide) var(--ease-entrance) both;
}

.modal--sm { max-width: 400px; }
.modal--md { max-width: 520px; }
.modal--lg { max-width: 660px; }

@keyframes modal-in {
  from { opacity: 0; transform: translate(-50%, calc(-50% + 10px)); }
  to   { opacity: 1; transform: translate(-50%, -50%); }
}

.modal__head { display: flex; align-items: flex-start; gap: var(--sp-12); }

/* The confirm layout. The close button stays in the top-right corner rather
   than joining the stack — a dialog you cannot see how to leave is the thing
   this primitive exists to stop, and moving it below the question buries it. */
.modal__head--stack {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: var(--sp-14);
}
.modal__head--stack .modal__tile { grid-row: 1; grid-column: 1; }
.modal__head--stack .modal__close { grid-row: 1; grid-column: 2; }
.modal__head--stack .modal__heading { grid-row: 2; grid-column: 1 / -1; }
.modal__head--stack .modal__title { font-size: 19px; line-height: 1.3; }
.modal__head--stack .modal__desc { font-size: var(--text-body); color: var(--ink-3); line-height: 1.55; }

.modal__tile {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: var(--r-tag);
  flex: none;
}
.modal__tile--accent  { background: var(--accent-tint);    color: var(--accent); }
.modal__tile--magenta { background: var(--magenta-tint);   color: var(--magenta); }
.modal__tile--warning { background: var(--warning-tint-2); color: var(--warning); }
.modal__tile--success { background: var(--success-tint);   color: var(--success); }

.modal__avatar { flex: none; }

.modal__heading { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: var(--sp-3); }

.modal__title {
  font-size: var(--text-h3);
  font-weight: 800;
  letter-spacing: var(--tracking-h3);
  color: var(--ink);
}

.modal__desc { font-size: var(--text-body-sm); color: var(--ink-4); }

.modal__close {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  flex: none;
  border: 1px solid var(--border-strong);
  border-radius: var(--r-tag);
  background: var(--surface);
  color: var(--ink-4);
  cursor: pointer;
  transition: background-color var(--dur-state) ease, color var(--dur-state) ease;
}
.modal__close:hover { background: var(--surface-subtle-2); color: var(--ink); }
.modal__close:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.modal__body { display: flex; flex-direction: column; gap: var(--sp-16); }

.modal__footer {
  display: flex;
  align-items: center;
  gap: var(--sp-8);
}
.modal__footer--end { justify-content: flex-end; }
.modal__footer--even { display: grid; grid-template-columns: 1fr 1fr; }
/* The destructive action sits on the LEFT of the footer in edit-member and
   archive-member, separated from the safe pair on the right. */
.modal__footer :deep(.footer-left) { margin-right: auto; }

@media (prefers-reduced-motion: reduce) {
  .modal, .scrim { animation: none; }
}
</style>

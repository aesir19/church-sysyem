/**
 * The app's one toast queue.
 *
 * Replaces three near-duplicate per-view implementations (DashboardView,
 * MinistrySmallGroupView, AttendanceView), each owning its own `toast` ref,
 * its own timeout handle, and its own fixed-position CSS. This is the concrete
 * fix for backlog B10's toast-container half; its offline-banner and
 * error-boundary examples stay out of scope.
 *
 * Module-scoped reactive state with a single `<ToastHost />` mounted in
 * App.vue. A view calls `showToast(...)` and never renders anything itself,
 * which is what stops a toast from being clipped by the modal or the sidebar
 * that happens to be its ancestor.
 *
 * WHAT GOES IN A TOAST. Messages classified by src/lib/data/write.js, not
 * `error.message`. A Postgres constraint violation quotes the offending row
 * verbatim — `Key (first_name, last_name)=(Juan, Dela Cruz) already exists` —
 * which is member PII, and a toast is the most screenshot-able surface in the
 * app. See CLAUDE.md "Code conventions".
 */

import { readonly, ref } from 'vue'

/** Long enough to read a sentence, short enough not to sit over the next action. */
const DEFAULT_DURATION = 4000

/**
 * Bounds a burst — a loop that saves ten rows should not stack ten toasts off
 * the top of the viewport.
 */
const MAX_VISIBLE = 3

const toasts = ref([])
const timers = new Map()
let nextId = 0

/** @typedef {'success'|'error'|'info'} ToastType */

export function dismissToast(id) {
  const timer = timers.get(id)
  if (timer) {
    clearTimeout(timer)
    timers.delete(id)
  }
  toasts.value = toasts.value.filter((toast) => toast.id !== id)
}

/**
 * Show a message.
 *
 * @param {string} message already classified and safe to display
 * @param {ToastType} [type]
 * @returns {number} the id, so a caller can dismiss it early
 */
export function showToast(message, type = 'success', duration = DEFAULT_DURATION) {
  const id = ++nextId
  toasts.value = [...toasts.value, { id, message, type }].slice(-MAX_VISIBLE)

  // Anything dropped by the cap above still holds a live timer, and its entry
  // in `timers` would never be collected. Clear the orphans now.
  for (const [heldId, timer] of timers) {
    if (!toasts.value.some((toast) => toast.id === heldId)) {
      clearTimeout(timer)
      timers.delete(heldId)
    }
  }

  if (duration > 0) {
    timers.set(id, setTimeout(() => dismissToast(id), duration))
  }
  return id
}

export function useToast() {
  return {
    toasts: readonly(toasts),
    showToast,
    dismissToast,
  }
}

/**
 * The app's one toast queue.
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
 * app.
 *
 * THE SHAPE COMES FROM THE MOCKUPS. They draw four: success, error carrying a
 * Retry action, an undo toast on the dark panel, and an indeterminate progress
 * toast. All four are a title, an optional second line, and an optional single
 * action — so that is the payload. The original string-only signature still
 * works, because most call sites only ever want a sentence.
 */

import { readonly, ref } from 'vue'

/** The handoff specifies 5s. */
const DEFAULT_DURATION = 5000

/** Bounds a burst — a loop that saves ten rows must not stack ten toasts. */
const MAX_VISIBLE = 3

const toasts = ref([])
const timers = new Map()
let nextId = 0

/** @typedef {'success'|'error'|'info'|'undo'|'progress'} ToastType */

export function dismissToast (id) {
  const timer = timers.get(id)
  if (timer) {
    clearTimeout(timer)
    timers.delete(id)
  }
  toasts.value = toasts.value.filter(toast => toast.id !== id)
}

/**
 * Show a message.
 *
 * @param {string|object} input a sentence, or { title, body, type, action, duration }
 * @param {ToastType} [type]
 * @param {number} [duration] 0 keeps it up until dismissed — used by `progress`
 * @returns {number} the id, so a caller can dismiss it early
 */
export function showToast (input, type = 'success', duration = DEFAULT_DURATION) {
  const opts = typeof input === 'string' ? { title: input, type, duration } : input
  const id = ++nextId

  const toast = {
    id,
    title: opts.title ?? '',
    body: opts.body ?? '',
    type: opts.type ?? 'success',
    // { label, onClick }. The undo toast's token is held by the caller, not
    // here — this queue knows nothing about what is being undone.
    action: opts.action ?? null
  }

  // A progress toast has no natural lifetime; it is dismissed when the work it
  // describes finishes.
  const ttl = opts.duration ?? (toast.type === 'progress' ? 0 : DEFAULT_DURATION)

  toasts.value = [...toasts.value, toast].slice(-MAX_VISIBLE)

  // Anything dropped by the cap above still holds a live timer, and its entry
  // in `timers` would never be collected. Clear the orphans now.
  for (const [heldId, timer] of timers) {
    if (!toasts.value.some(t => t.id === heldId)) {
      clearTimeout(timer)
      timers.delete(heldId)
    }
  }

  if (ttl > 0) timers.set(id, setTimeout(() => dismissToast(id), ttl))
  return id
}

export function useToast () {
  return {
    toasts: readonly(toasts),
    showToast,
    dismissToast
  }
}

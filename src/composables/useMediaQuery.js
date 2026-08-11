/**
 * A CSS media query as a reactive boolean.
 *
 * Needed because two of Amendment 12's mobile decisions are not stylistic and
 * therefore cannot be CSS: below the breakpoint the members table becomes a
 * card list, and the member detail moves from a sticky panel into `ui/Modal`.
 * Doing either with `display: none` would leave the losing markup in the DOM —
 * two copies of a member's address on the page, one merely invisible, and a
 * `ui/Modal` cannot be hidden that way at all because it renders through a
 * portal.
 *
 * Guarded for a DOM-less environment: `vitest.config.js` runs
 * `environment: 'node'`, so a view rendered through `vue/server-renderer` has
 * no `window`. It resolves false there, which is the desktop branch.
 */

import { onBeforeUnmount, readonly, ref } from 'vue'

/**
 * @param {string} query e.g. '(min-width: 1024px)'
 * @returns {import('vue').Ref<boolean>}
 */
export function useMediaQuery(query) {
  const matches = ref(false)

  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return readonly(matches)
  }

  const list = window.matchMedia(query)
  matches.value = list.matches

  const onChange = (event) => {
    matches.value = event.matches
  }

  list.addEventListener('change', onChange)
  onBeforeUnmount(() => list.removeEventListener('change', onChange))

  return readonly(matches)
}

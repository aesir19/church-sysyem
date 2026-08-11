/**
 * Every glyph in the app, as static path data.
 *
 * WHY A FROZEN MODULE CONSTANT AND NOT A STRING OF MARKUP. `AppSidebar.vue`
 * injects its nav icons with `v-html` today, which ARCHITECTURE.md §4.7 and
 * SECURITY.md §4.1 both already flag as a latent sink — harmless only for as
 * long as nobody threads a value from the database or a prop into it. Icon.vue
 * renders these as real `<path>` elements with `d` bound from this map, so
 * there is no HTML parse step to hijack and the sink cannot be reopened by
 * someone adding a "just this one dynamic icon" later. Retiring the `v-html`
 * itself is Stage 1b work, when the sidebar is retouched; this is the
 * destination it moves to.
 *
 * Geometry is a 24×24 viewBox with a 2px stroke and no fill — the same
 * convention the existing hand-drawn glyphs already follow, so consolidating
 * them is a deduplication rather than a restyle. Consolidating is the point:
 * the close "X" alone is currently duplicated, with drift, across four files.
 *
 * REDESIGN.md Amendment 9 records why this is a local set and not
 * `lucide-vue-next`: an icon package buys convenience, where ADR-0011's
 * dependency buys a tested focus trap, and priority 1 is binding.
 */

export const ICON_PATHS = Object.freeze({
  x: Object.freeze(['M18 6 6 18', 'M6 6l12 12']),

  check: Object.freeze(['M20 6 9 17l-5-5']),

  'check-circle': Object.freeze([
    'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
    'M8.5 12.5l2.5 2.5 4.5-5',
  ]),

  'alert-circle': Object.freeze([
    'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
    'M12 7v5',
    'M12 16h.01',
  ]),

  'alert-triangle': Object.freeze([
    'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z',
    'M12 9v4',
    'M12 17h.01',
  ]),

  info: Object.freeze(['M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0', 'M12 16v-5', 'M12 8h.01']),

  'chevron-up': Object.freeze(['M18 15l-6-6-6 6']),
  'chevron-down': Object.freeze(['M6 9l6 6 6-6']),
  'chevron-left': Object.freeze(['M15 18l-6-6 6-6']),
  'chevron-right': Object.freeze(['M9 18l6-6-6-6']),

  /** The "sortable, not currently sorted" affordance on a table header. */
  'chevron-sort': Object.freeze(['M8 9l4-4 4 4', 'M16 15l-4 4-4-4']),

  search: Object.freeze(['M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0', 'M21 21l-4.35-4.35']),

  sun: Object.freeze([
    'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    'M12 2v2',
    'M12 20v2',
    'M4.93 4.93l1.41 1.41',
    'M17.66 17.66l1.41 1.41',
    'M2 12h2',
    'M20 12h2',
    'M6.34 17.66l-1.41 1.41',
    'M19.07 4.93l-1.41 1.41',
  ]),

  moon: Object.freeze(['M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z']),
})

/** @returns {readonly string[]} empty for an unknown name */
export function iconPaths(name) {
  return ICON_PATHS[name] ?? []
}

export const ICON_NAMES = Object.freeze(Object.keys(ICON_PATHS))

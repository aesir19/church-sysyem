/**
 * Every glyph in the app, as static path data.
 *
 * WHY A FROZEN MODULE CONSTANT AND NOT A STRING OF MARKUP. `AppSidebar.vue`
 * used to inject its nav icons with `v-html`, which SECURITY.md §4.1 flags as a
 * latent sink — harmless only for as long as nobody threads a value from the
 * database or a prop into it. Those glyphs moved here unchanged, and Icon.vue
 * renders them as real `<path>` elements with `d` bound from this map, so there
 * is no HTML parse step to hijack and the sink cannot be reopened by someone
 * adding a "just this one dynamic icon" later.
 *
 * Geometry is a 24×24 viewBox with a 2px stroke and no fill — the same
 * convention the existing hand-drawn glyphs already follow, so consolidating
 * them is a deduplication rather than a restyle. Consolidating is the point:
 * the close "X" alone is currently duplicated, with drift, across four files.
 *
 * This is a local set and not `lucide-vue-next`: an icon package buys convenience, where ADR-0011's
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

  plus: Object.freeze(['M12 5v14', 'M5 12h14']),

  pencil: Object.freeze([
    'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7',
    'M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z',
  ]),

  /** Soft delete, which is what "archive" means here — see CONTEXT.md. */
  archive: Object.freeze([
    'M3 8h18v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z',
    'M2 4h20v4H2z',
    'M10 12h4',
  ]),

  'external-link': Object.freeze([
    'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
    'M15 3h6v6',
    'M10 14 21 3',
  ]),

  search: Object.freeze(['M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0', 'M21 21l-4.35-4.35']),

  clock: Object.freeze(['M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0', 'M12 6v6l4 2']),

  /* ── The sidebar's nav set ────────────────────────────────────────────────
   * Carried across from AppSidebar's `v-html` strings unchanged, so retiring
   * that sink (SECURITY.md §4.1) is a deduplication and not a restyle: the
   * icons a user has been looking at are the same ones. */

  users: Object.freeze([
    'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2',
    'M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    'M23 21v-2a4 4 0 0 0-3-3.87',
    'M16 3.13a4 4 0 0 1 0 7.75',
  ]),

  layers: Object.freeze(['M12 2 2 7l10 5 10-5-10-5z', 'M2 17l10 5 10-5', 'M2 12l10 5 10-5']),

  'check-square': Object.freeze([
    'M9 11l3 3L22 4',
    'M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  ]),

  'dollar-sign': Object.freeze([
    'M12 1v22',
    'M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  ]),

  receipt: Object.freeze(['M6 2h12v20l-3-2-3 2-3-2-3 2V2z', 'M9.5 7.5h5', 'M9.5 12h5']),

  'pie-chart': Object.freeze(['M21.21 15.89A10 10 0 1 1 8 2.83', 'M22 12A10 10 0 0 0 12 2v10z']),

  menu: Object.freeze(['M3 6h18', 'M3 12h18', 'M3 18h18']),

  'log-out': Object.freeze([
    'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4',
    'M16 17l5-5-5-5',
    'M21 12H9',
  ]),

  user: Object.freeze([
    'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
    'M8 14s1.5 2 4 2 4-2 4-2',
    'M9 9h.01',
    'M15 9h.01',
  ]),

  /* The three nav slots that carry a "Soon" badge and no route:
   * the IA lands once and the sidebar stops churning as those screens arrive. */
  home: Object.freeze(['M3 10.5 12 3l9 7.5', 'M5.5 9.5V20h13V9.5']),
  'bar-chart': Object.freeze(['M4 20V11', 'M10 20V4', 'M16 20v-6', 'M3 20h18']),
  flag: Object.freeze(['M4 21V4', 'M4 4h13l-2.5 4L17 12H4']),

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

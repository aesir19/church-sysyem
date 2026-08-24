// The icon set, lifted from the design handoff.
//
// PROVENANCE. Every entry below was read out of the mockup markup in
// `UI mockups for form/design_handoff_church_dashboard/` by walking the rendered
// DOM and collecting each distinct <svg> child list — not redrawn by eye, and
// not substituted from a public icon set. The previous attempt approximated them
// and the drift was part of why the result stopped resembling the design. Where
// a glyph is marked DRAWN below, the mockups genuinely do not contain it and it
// was built to match the surrounding stroke style; those are the only ones that
// are not verbatim.
//
// SHAPE. Each icon is a list of [tag, attributes] tuples rather than a markup
// string, so Icon.vue can render them with a dynamic component and no `v-html`.
// Injecting HTML for a static asset is a habit worth not forming in an app that
// renders member-supplied names three screens over.
//
// All icons are on a 24×24 canvas, stroked (never filled), with round caps and
// joins. The handoff specifies stroke-width 1.9–2.4 depending on rendered size;
// Icon.vue defaults to 2 and takes a prop.

export const iconPaths = {
  // --- Brand ------------------------------------------------------------
  // The mark inside the cyan rounded tile in the nav and on the auth screens.
  logo: [
    ['path', { d: 'M18 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z' }],
    ['path', { d: 'M12 6v4' }],
    ['path', { d: 'M9 10h6' }],
    ['circle', { cx: 12, cy: 16, r: 2 }]
  ],

  // --- Navigation, in nav order ----------------------------------------
  overview: [
    ['rect', { x: 3, y: 3, width: 7, height: 9, rx: 1.5 }],
    ['rect', { x: 14, y: 3, width: 7, height: 5, rx: 1.5 }],
    ['rect', { x: 14, y: 12, width: 7, height: 9, rx: 1.5 }],
    ['rect', { x: 3, y: 16, width: 7, height: 5, rx: 1.5 }]
  ],
  members: [
    ['path', { d: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2' }],
    ['circle', { cx: 9, cy: 7, r: 4 }],
    ['path', { d: 'M23 21v-2a4 4 0 0 0-3-3.87' }],
    ['path', { d: 'M16 3.13a4 4 0 0 1 0 7.75' }]
  ],
  groups: [
    ['path', { d: 'M12 2L2 7l10 5 10-5-10-5z' }],
    ['path', { d: 'M2 17l10 5 10-5' }],
    ['path', { d: 'M2 12l10 5 10-5' }]
  ],
  attendance: [
    ['path', { d: 'M9 11l3 3L22 4' }],
    ['path', { d: 'M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11' }]
  ],
  collections: [
    ['rect', { x: 2, y: 8, width: 20, height: 4, rx: 1 }],
    ['path', { d: 'M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7' }],
    ['path', { d: 'M12 8v13' }],
    ['path', { d: 'M12 8H7.5a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8z' }],
    ['path', { d: 'M12 8h4.5a2.5 2.5 0 0 0 0-5C13 3 12 8 12 8z' }]
  ],
  expenses: [
    ['path', { d: 'M5 2v20l2-1.4L9 22l2-1.4L13 22l2-1.4L17 22l2-1.4V2H5z' }],
    ['path', { d: 'M9 7h6' }],
    ['path', { d: 'M9 11h6' }],
    ['path', { d: 'M9 15h4' }]
  ],
  funds: [
    ['line', { x1: 12, y1: 1, x2: 12, y2: 23 }],
    ['path', { d: 'M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6' }]
  ],
  statistics: [
    ['line', { x1: 18, y1: 20, x2: 18, y2: 10 }],
    ['line', { x1: 12, y1: 20, x2: 12, y2: 4 }],
    ['line', { x1: 6, y1: 20, x2: 6, y2: 14 }]
  ],
  // The gear on the account card. Verbatim from mockup 4c, which is the only frame
  // in the handoff that draws it.
  settings: [
    ['circle', { cx: 12, cy: 12, r: 3 }],
    ['path', { d: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6h.09A1.65 1.65 0 0 0 10 3.09V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z' }]
  ],
  // DRAWN. A church for the pastor assignment cards; the handoff uses two-letter
  // initials tiles there instead, but the nav and the empty states need a glyph.
  church: [
    ['path', { d: 'M12 2v6' }],
    ['path', { d: 'M9 5h6' }],
    ['path', { d: 'M4 21V12l8-4 8 4v9' }],
    ['path', { d: 'M10 21v-5a2 2 0 1 1 4 0v5' }],
    ['line', { x1: 2, y1: 21, x2: 22, y2: 21 }]
  ],
  // DRAWN. Marks the leader on a small group card and in its roster — deliberately
  // not the plain member avatar, because a leader is a different kind of thing.
  star: [
    ['path', { d: 'M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8L3.5 9.7l5.9-.9z' }]
  ],
  next: [
    ['path', { d: 'M4 21v-7' }],
    ['path', { d: 'M4 14V4' }],
    ['path', { d: 'M4 5h12l-2 3 2 3H4' }],
    ['circle', { cx: 4, cy: 21, r: 1 }]
  ],

  // ADDED for Calendar & Events (Stage 1). A plain month grid for the all-roles
  // Calendar nav item; the same frame with a star badge for the Events management
  // item, so the two read as related but not identical in the rail.
  calendar: [
    ['rect', { x: 3, y: 4, width: 18, height: 18, rx: 2 }],
    ['line', { x1: 16, y1: 2, x2: 16, y2: 6 }],
    ['line', { x1: 8, y1: 2, x2: 8, y2: 6 }],
    ['line', { x1: 3, y1: 10, x2: 21, y2: 10 }]
  ],
  events: [
    ['path', { d: 'M21 12V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h7' }],
    ['line', { x1: 16, y1: 2, x2: 16, y2: 6 }],
    ['line', { x1: 8, y1: 2, x2: 8, y2: 6 }],
    ['line', { x1: 3, y1: 10, x2: 21, y2: 10 }],
    ['path', { d: 'M18 14.5l1.3 2.6 2.9.4-2.1 2 .5 2.9-2.6-1.4-2.6 1.4.5-2.9-2.1-2 2.9-.4z' }]
  ],

  // --- Chevrons ---------------------------------------------------------
  // Down is verbatim; the other three are the same polyline reflected, which is
  // how the mockups' own month steppers read.
  chevronDown: [['polyline', { points: '6 9 12 15 18 9' }]],
  chevronUp: [['polyline', { points: '18 15 12 9 6 15' }]],
  chevronLeft: [['polyline', { points: '15 18 9 12 15 6' }]],
  chevronRight: [['polyline', { points: '9 18 15 12 9 6' }]],

  // --- Theme ------------------------------------------------------------
  moon: [['path', { d: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z' }]],
  // DRAWN. The mockups only ever render the light-mode state of the toggle, so
  // there is no sun glyph in the bundle to lift. Standard 24×24 sun at the same
  // stroke weight; replace if a dark-mode mockup ever shows otherwise.
  sun: [
    ['circle', { cx: 12, cy: 12, r: 4 }],
    ['path', { d: 'M12 2v2' }], ['path', { d: 'M12 20v2' }],
    ['path', { d: 'M4.9 4.9l1.4 1.4' }], ['path', { d: 'M17.7 17.7l1.4 1.4' }],
    ['path', { d: 'M2 12h2' }], ['path', { d: 'M20 12h2' }],
    ['path', { d: 'M4.9 19.1l1.4-1.4' }], ['path', { d: 'M17.7 6.3l1.4-1.4' }]
  ],

  // --- Confirmation and dismissal --------------------------------------
  check: [['path', { d: 'M20 6L9 17l-5-5' }]],
  checkThick: [['polyline', { points: '20 6 9 17 4 12' }]],
  checkList: [
    ['path', { d: 'M20 6 9 17l-5-5' }],
    ['path', { d: 'M4 6h5' }]
  ],
  close: [['path', { d: 'M18 6L6 18M6 6l12 12' }]],
  // DRAWN. No plus glyph appears alone in the bundle — the "+ Add member"
  // buttons render a literal "+" character rather than an icon.
  plus: [['path', { d: 'M12 5v14' }], ['path', { d: 'M5 12h14' }]],

  // --- Search -----------------------------------------------------------
  search: [
    ['circle', { cx: 11, cy: 11, r: 8 }],
    ['line', { x1: 21, y1: 21, x2: 16.65, y2: 16.65 }]
  ],
  searchEmpty: [
    ['circle', { cx: 11, cy: 11, r: 8 }],
    ['line', { x1: 21, y1: 21, x2: 16.65, y2: 16.65 }],
    ['line', { x1: 8, y1: 11, x2: 14, y2: 11 }]
  ],

  // --- States and status ------------------------------------------------
  lock: [
    ['rect', { x: 3, y: 11, width: 18, height: 10, rx: 2 }],
    ['path', { d: 'M7 11V7a5 5 0 0 1 10 0v4' }]
  ],
  clock: [
    ['circle', { cx: 12, cy: 12, r: 9 }],
    ['path', { d: 'M12 7v5l3 2' }]
  ],
  alert: [
    ['path', { d: 'M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z' }],
    ['path', { d: 'M12 9v4' }],
    ['path', { d: 'M12 17h.01' }]
  ],
  offline: [
    ['path', { d: 'M1 1l22 22' }],
    ['path', { d: 'M16.7 16.7A9 9 0 0 1 5 5' }],
    ['path', { d: 'M12 20h.01' }]
  ],
  spinner: [['path', { d: 'M21 12a9 9 0 1 1-6.2-8.6' }]],
  undo: [
    ['path', { d: 'M3 7v6h6' }],
    ['path', { d: 'M21 17a9 9 0 1 0-3-14.7L3 13' }]
  ],

  // --- Visibility -------------------------------------------------------
  eye: [
    ['path', { d: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z' }],
    ['circle', { cx: 12, cy: 12, r: 3 }]
  ],
  eyeWide: [
    ['path', { d: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z' }],
    ['circle', { cx: 12, cy: 12, r: 3 }]
  ],

  // --- Records ----------------------------------------------------------
  archive: [
    ['path', { d: 'M21 8v13H3V8' }],
    ['path', { d: 'M1 3h22v5H1z' }],
    ['path', { d: 'M10 12h4' }]
  ],
  paperclip: [
    ['path', { d: 'M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66L9.41 17.41a2 2 0 0 1-2.83-2.83l8.49-8.49' }]
  ],
  user: [
    ['path', { d: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2' }],
    ['circle', { cx: 9, cy: 7, r: 4 }]
  ],
  userPlus: [
    ['path', { d: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2' }],
    ['circle', { cx: 9, cy: 7, r: 4 }],
    ['path', { d: 'M19 8v6' }],
    ['path', { d: 'M22 11h-6' }]
  ],
  // DRAWN. The mockups never render sign-out as an icon — it is a text row on
  // the profile page and in the mobile menu, neither of which is built yet.
  // Standard 24×24 door-and-arrow at the same stroke weight; replace it if the
  // profile page ever ships one.
  signOut: [
    ['path', { d: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4' }],
    ['polyline', { points: '16 17 21 12 16 7' }],
    ['line', { x1: 21, y1: 12, x2: 9, y2: 12 }]
  ],

  dots: [
    ['circle', { cx: 5, cy: 12, r: 1.6 }],
    ['circle', { cx: 12, cy: 12, r: 1.6 }],
    ['circle', { cx: 19, cy: 12, r: 1.6 }]
  ]
}

export const ICON_NAMES = Object.freeze(Object.keys(iconPaths))

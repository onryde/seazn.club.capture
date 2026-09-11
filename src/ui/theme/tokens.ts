/**
 * Stadium night — the product's own console palette (AGENTS.md §5).
 *
 * Taken from `apps/web/src/app/globals.css`: the `--mk-*` "stadium night"
 * system and the `--sport-*` scoring-pad tokens derived from it. The scoring
 * pad is the closest analogue to this app — a dark operator surface with LED
 * digits, read at a glance — so the viewfinder inherits it rather than
 * inventing a second dark theme for the same company.
 *
 * Dark-only, as before. No light mode: this is a viewfinder used outdoors, and
 * a light UI on a tripod in daylight is a mirror.
 *
 * Two disciplines carried over from the web system, both load-bearing:
 *  - **Never violet text or plates on night.** `#7c3aed` sits at ~2.1:1 on
 *    `#150b36` and fails AA. The web flips primary buttons to a lime plate
 *    with night ink; so do we.
 *  - **Lime is the LED**, not a decoration — score digits, hairlines, ready
 *    signals. Never lime on a light ground (irrelevant here, but the rule
 *    travels with the token).
 */
export const colour = {
  /** --mk-night / --sport-board: the board. */
  ground: '#150b36',
  /** --mk-night-2 / --sport-board-2. */
  surface: '#1d1145',
  /** The web's night input fill. */
  surface2: '#241650',

  /** --mk-cream / --sport-ink. */
  ink: '#f5f0e8',
  /** Cream at 80%, matching .pad-ink-80. */
  ink2: '#f5f0e8cc',
  /** The system's muted violet-cream, from the night funnel labels. */
  ink3: '#b7aede',

  /** .app-crumbs hairline: cream at 8%. */
  rule: '#f5f0e814',
  ruleSoft: '#f5f0e80d',

  /** --sport-led. Tailwind lime-400 in sRGB, NOT the v3 --mk-lime hex. */
  lime: '#9ae600',
  /** --mk-live. Red is on-air here, which is why errors below are not red. */
  live: '#ef4444',
  /** --mk-orange: the night-legible caution. --sport-caution is the daylight one. */
  caution: '#fb923c',
  /** --mk-purple. Decorative only — never as text or a plate on night. */
  violet: '#7c3aed',
  /** Behind the camera frame. True black so the letterbox is not a grey slab. */
  stage: '#000000',
} as const;

/**
 * Ink for text sitting ON a status plate. Night, not cream: every plate colour
 * (lime 12.5:1, caution 9:1, live 5.8:1) carries night ink at or above AA for
 * large text, and cream on lime would fail outright.
 */
export const plateInk = colour.ground;

/**
 * What each colour means.
 *
 * Note `live` is red and `degraded` is orange, with nothing red left over for
 * failures — in this app red means ON AIR, the broadcast tally convention the
 * product's own `--mk-live` already follows. A crash therefore reads orange,
 * not red, so it can never be mistaken for a live indicator.
 */
export const status = {
  live: colour.live,
  healthy: colour.lime,
  degraded: colour.caution,
  failure: colour.caution,
  inert: colour.ink3,
} as const;

/**
 * The state plate — state as an area, which is the only thing readable
 * unfocused at two metres. This replaced a 10–12% tint of the whole column
 * whose four fields differed in luminance by roughly 0.01, with live darker
 * than ready: a distinction outdoor reflection erases completely.
 */
export const plate = {
  live: colour.live,
  healthy: colour.lime,
  degraded: colour.caution,
  inert: colour.surface,
} as const;

/**
 * The product's own three faces, from `apps/web/src/app/globals.css`.
 *
 * Barlow Condensed is the display face (`.app-display`, `.page-title`,
 * `.mk-display`), always uppercase and letterspaced — the house convention,
 * and a scoreboard idiom. It also earns its place functionally here: condensed
 * fits noticeably more legible characters into a 150px column than a normal
 * grotesk.
 *
 * Geist carries body text. Geist Mono carries numerals only, never labels —
 * the justification is tabular figures holding a jittering clock still, not
 * texture.
 *
 * React Native does not synthesise weights, so each weight is its own family.
 */
export const font = {
  displaySemibold: 'BarlowCondensed_600SemiBold',
  displayBold: 'BarlowCondensed_700Bold',
  body: 'Geist_400Regular',
  bodyMedium: 'Geist_500Medium',
  numeric: 'GeistMono_400Regular',
  numericMedium: 'GeistMono_500Medium',
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 40,
} as const;

/**
 * A correctly uncropped 720p preview is 16:9; a phone in landscape is roughly
 * 19.5:9. The column is the width that geometry leaves over, which is why it
 * never occludes the shot.
 */
export const layout = {
  columnWidth: 150,
  tallyStripe: 4,
  previewAspect: 16 / 9,
} as const;

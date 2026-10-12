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
  /** A QR needs a white quiet zone to scan; the only white in the app. */
  qrGround: '#ffffff',
  /**
   * The Remote scoring panel's countdown track on its cream ground: the night ink at 15% (the owner's board, "ink at
   * 15 %"). The panel's ground is `ink` (cream, #f5f0e8) and its text and bar fill are `ground` (night, #150b36).
   */
  panelTrack: '#150b3626',
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
 * `.mk-display`), uppercase and letterspaced — the house convention, and a
 * scoreboard idiom — except the match label's names, which are mixed case
 * (AGENTS §5). It also earns its place functionally here: condensed fits
 * noticeably more legible characters into a narrow column than a normal
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

/** The viewfinder's measures, before `layout` adds the one it derives from them (`controlsHalf`). */
const base = {
  tallyStripe: 4,
  previewAspect: 16 / 9,
  /** Spec §1: the hold button is 72 dp tall. */
  holdHeight: 72,
  /** Spec §3: readiness chips are 44 dp square. */
  chip: 44,
  /** Spec §3, the board's chip outline; today's PreflightChips border. */
  chipBorder: 2,
  /** Spec §3: icon-row buttons are 48 dp square. */
  iconButton: 48,
  /** The icon button's hairline outline, GhostButton's and the peek control's. */
  iconBorder: 1,
  /** B5 (owner's board): an icon button whose panel is open has a 2 dp lime outline, in place of the hairline. */
  iconBorderOn: 2,
  /** Home's cards are outlined by a hairline: the Stream ended card's (spec §5). */
  cardBorder: 1,
  /** The tally plate's floor (TallyPlate), unchanged. */
  plateHeight: 56,
  /** AudioMeter's bar, unchanged. */
  meterHeight: 12,
  /** Board "Before": the controls half's padding and gap. The scoring panel over the camera half keeps both. */
  controlsPad: 16,
  controlsGap: 12,
  /**
   * The controls half's column rhythm, vertical only (owner, 2026-10-08: every control fully on screen at 804 x 332).
   * Before air, with the AUTO start line and a hold reason up, the column's five rows are 56 + 64 + 16 + 48 + 92 = 276
   * dp and the board's 16 padding and 12 gaps (32 + 4 x 12 = 80) made 356 of a 332 dp app area: 24 over. 8 and 8 are
   * 16 + 32 = 48, so the worst state is 324 with the photo line's 16 dp still in place: 4 dp to spare on the owner's
   * phone as laid out, 728 x 328 (N35). The horizontal padding (`controlsPad`) is the half's WIDTH and stays: 310 is
   * unchanged. Every control keeps its size.
   */
  controlsPadV: 8,
  controlsColumnGap: 8,
  /**
   * The three cells of the controls half that hold text, each the least whole dp that holds its words in all four
   * languages, measured from the shipped fonts and the dictionaries by controlsFit.test.ts (which fails by the new
   * number when a string or a type role changes):
   *  - the clock's cell, in the plate row: HH:MM:SS at Barlow Condensed 700 38 in the font's TABULAR figures, which
   *    `tabular-nums` selects and which are wider than its proportional ones (a clock sized from those wrapped in a
   *    browser). The plate beside it (a word of up to 98.5 dp) is narrower.
   *  - the peek's cell, on air, the icon row's fourth cell when What viewers see is built in (it is hidden as
   *    shipped, the owner's ruling of 2026-10-09: `FEATURES.viewerCheck`): the label in two lines (`peekLabelLines`)
   *    and the reason in two (`peekReasonLines`), every word whole.
   *  - the AUTO chip: its word at `control`, 8 dp of padding and a 2 dp border either side.
   */
  clockCell: 135,
  peekCell: 101,
  autoChip: 52,
  /** Board "Before": the status strip's padding and gap (Q4 A: vertical 8, not the board's 10). */
  stripPadV: 8,
  stripPadH: 16,
  stripGap: 6,
  /**
   * C2 (D2 §4.4): each side wraps to at most 2 lines and ends in an ellipsis beyond that. The strip's worst label is two
   * sides of this many lines (`cameraBox.ts`), so this cap is what the reserve is made of.
   */
  labelSideLines: 2,
  /** C2: the left margin the decorative v sits in, outside both rows. */
  labelMargin: 14,
  /** C2: each side's bar, at its row's left edge. */
  labelBar: 3,
  /** C2: the gap between a side's bar and its names. */
  labelBarGap: 5,
  /**
   * The strip's message: ONE line of the body role, always (owner, 2026-10-08, "one single line all the time"). It says
   * the caption when one is up, else the status line, and a string wider than the strip's text is cut with an ellipsis,
   * never wrapped. stripTextFit.test.ts measures which of the four languages' strings that is at each width.
   */
  messageLines: 1,
  /** Spec §2 round line: one line above the label, always shown (owner, 2026-10-08, option B): in the strip's reserve. */
  stageLines: 1,
  /** Board "Settings, landscape": the screen's vertical padding (the board's 12, under the portrait 16). */
  settingsPadV: 12,
  /** Spec §7: Home's title is the Seazn Club night logo, 200 × 70 (its 800 × 280 file's own 20:7). */
  logo: { width: 200, height: 70 },
  /** Q2 (owner, 2026-10-06): the logo is 160 × 56 in landscape, the board's "Home, landscape". */
  logoLandscape: { width: 160, height: 56 },
  /**
   * The PNG's own empty left edge (63 of its 800 px), which the board hangs outside the column so the wordmark
   * sits on the screen's margin: 16 at 200 wide, 12 at 160 (Main.dc.html, Home-landscape.dc.html).
   */
  logoInset: 16,
  logoInsetLandscape: 12,
  /** Board "Home, landscape": the screen's padding above and below (the sides are `space.md`) and the gap between its rows. */
  homePadTop: 12,
  homePadBottom: 16,
  homeGap: 12,
  /** Board "After-you-stopped-landscape": a card laid out as one row has 10 above and below and 12 at its end (16 at its start). */
  rowCardPadV: 10,
  rowCardPadEnd: 12,
  /** ModeIcon's side: it is drawn this square, and the tile fit (homeFit.test.ts) reads it from here. */
  modeIcon: 28,
  /** The lines StatusLine reserves on Home (the `status` role's three), which the top row's fit reads from here. */
  homeStatusLines: 3,
  /**
   * A Tile's padding in landscape (fix round 1, coordinator ruling): 12 against portrait's `space.md` 16, so that
   * Continue alone, or the ended card alone, leaves the tiles room at 800 × 360 (homeFit.test.ts). Portrait is unchanged.
   */
  tileLandscapePad: 12,
  /**
   * N31 (item A2 of the D3 findings design, §10): a tile's title shrinks to the room beside its icon and wraps to at
   * most this many lines, then an ellipsis. homeFit.test.ts measures every title in four languages against it, and
   * bounds the tiles' heights with every title at this many lines.
   */
  tileTitleLines: 2,
  /**
   * N31, fix round 1: the room a tile's title needs beside its icon to stay at `title`, the widest word of any title in
   * the four languages at that size (nl LIVESTREAM, 123.3 dp), to the whole dp. Narrower, `tileTitleRole` steps the
   * title down to `action`. homeFit.test.ts derives it from the font.
   */
  tileTitleRoom: 124,
  /**
   * Spec §10, Q-C2: the Remote scoring code, drawn at a whole number of dp per module so every module edge lands on a
   * pixel (D13): 3 x the 57-unit symbol (49 modules + a quiet zone of 4 each side). The largest such multiple that
   * fits the smallest half with the title, the hint, Hide and 4 dp to spare (scoringFit.test.ts derives it).
   */
  qrSize: 171,
  /**
   * The lines the peek's label and its reason may take in the 120 dp cell at 640 once Remote scoring joined the row:
   * measured by scoringFit.test.ts, read by it and by viewfinderFit.test.ts.
   */
  peekLabelLines: 2,
  peekReasonLines: 2,
  /** B3 (owner's board): the Remote scoring countdown's track is 6 dp high. */
  scoringBar: 6,
  /** Board "Settings": the Diagnostics card's section column (the section name sits in it). */
  diagSection: 84,
  /**
   * A Diagnostics row's least height: the board's 24, cut to 22 so the card fits a 640 x 360 half (spec §6;
   * settingsFit.test.ts). The tallest line in it is 16: the item, the value and the section name.
   */
  diagRow: 22,
  /** Board "Settings": the Diagnostics card's side padding, and the gutter between its columns. */
  diagPad: 12,
  /** Board "Settings, landscape": the card's vertical padding (10; the portrait board's 12 is 4 dp taller). */
  diagPadV: 10,
  /** Board "Settings": the gap between the card's header row and its rows. */
  diagGap: 6,
  /** Board "Settings" (2026-10-08, 1.436 px per dp): the pulse beside the Diagnostics heading is drawn in an 18 dp box. */
  pulseGlyph: 18,
  /** The least height of anything a thumb must hit on a tripod: a switch row, a side segment. */
  touch: 48,
  /**
   * Board "Settings": the Share record button's drawn box is 37 dp tall (its outline's two rules are 35.9 dp apart on
   * the board, plus the 1 dp stroke). The button around it stays `touch` tall: the box is drawn inside the target.
   */
  ghostCompact: 37,
  /** Board "Settings": that box's side padding (measured 11.2 dp at the board's 12 dp text). */
  ghostCompactPadX: 11,
  /** Board "Settings": a switch row's side padding (the label's left edge and the switch's right). */
  switchRowPadX: 12,
  /** Board "Settings": the pill switch, 40 x 24, its knob 18, the knob 3 in from the track's edge on every side. */
  switchTrackW: 40,
  switchTrackH: 24,
  switchKnob: 18,
  switchInset: 3,
  /** Board "Settings": the off switch's lilac outline (measured 1.4 dp; drawn inside the 40 x 24, so on and off are one size). */
  switchBorder: 1.5,
  /** Board "Settings": a "Controls on the" segment is at least 66 dp wide (the board's Left and Right are 67 and 66). */
  segmentMin: 66,
  /** A segment's side padding: the board's English segments sit on the 66 floor, so this only matters to longer words (Linkerkant). */
  segmentPadX: 12,
} as const;

/** The cells the controls half's width is made of (`base` holds the shipped ones). */
type ControlsCells = Readonly<
  Record<'iconButton' | 'chip' | 'peekCell' | 'autoChip' | 'clockCell' | 'controlsPad', number>
>;

/**
 * The controls half's width (owner, 2026-10-08, option "A": the controls half takes the width its content needs and
 * the camera half takes the rest). It is the WIDEST ROW of the half, in any state, plus the half's padding either side:
 *  - icons before air: Settings, Home, Take photo, Remote scoring, four 48 dp buttons and three gaps (216);
 *  - icons on air: Settings, Take photo, Remote scoring and the peek, three buttons, three gaps and the peek's cell (269),
 *    with What viewers see built in. Hidden, as shipped (the owner's ruling, 2026-10-09), the row is the three buttons
 *    and two gaps (160), narrower than the row before air, so it is not counted; the peek's row is, so the switch can
 *    be turned on with no change of layout;
 *  - chips: camera, sound, network and AUTO, four boxes and three gaps, on ONE line (208);
 *  - the plate row: the tally plate and the clock, a cell each and a gap (278), which governs. The two cells are kept
 *    EQUAL on purpose (the balanced look): the plate's word is narrower than the clock (98.5
 *    against 135), so the content's real need is 269, the icon row on air, and the equal cells cost 9 dp of it (278 - 269).
 * Each row's gap is `space.sm`, as the icon row, the chip row and the plate row set it. Every other line of text in
 * the half (the hold label, its reason, the start line, the photo line, the plate's words) is narrower than the content
 * (controlsFit.test.ts measures each), so it can wrap or not as the vertical budget (viewfinderFit.test.ts) already
 * counts it, and nothing is clipped. controlsFit.test.ts writes the four rows out again from the same atoms and pins the
 * sum, and makes each row the widest in turn, so a dropped term fails even while another row governs.
 */
export function controlsHalfWidth(cells: ControlsCells): number {
  const widest = Math.max(
    4 * cells.iconButton + 3 * space.sm,
    3 * cells.iconButton + 3 * space.sm + cells.peekCell,
    3 * cells.chip + 3 * space.sm + cells.autoChip,
    2 * cells.clockCell + space.sm,
  );
  return widest + 2 * cells.controlsPad;
}

/**
 * The viewfinder is two halves (spec §1): the camera half holds a 16:9
 * box, a correctly uncropped 720p preview, with the status strip under it; the
 * controls half holds the rest. The box is as wide as its half where the screen
 * is tall enough, and narrower where it is not (`cameraBoxSize`), so the strip
 * gets what the phone's height leaves.
 *
 * The halves are NOT equal. Owner, 2026-10-08 (design follow-up §1, amended): the
 * controls half takes the width its content needs (`controlsHalf`) and the camera
 * half takes everything else. The picture in it is sized from this match's label,
 * as measured, and not from the strip's worst case (owner, 2026-10-08, option A;
 * `stripReserve`, which holds the round line's room): a two-line label on an
 * 804 × 360 phone gives a box of about 444 × 250 where the worst case, which is
 * what it is until the label has been measured, gives 366 × 206 (C2, D2 §4.4).
 */
export const layout = { ...base, controlsHalf: controlsHalfWidth(base) } as const;

/**
 * Cards and tiles are rounded, as in the owner-approved Home layout A; plates
 * (Button, the state plate) stay square, because a plate is an area of signal.
 */
export const radius = {
  card: 12,
} as const;

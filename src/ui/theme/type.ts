import type { TextStyle } from 'react-native';
import { colour, font } from '@/ui/theme/tokens';

/**
 * The scale (AGENTS.md §5). Sized for arm's length, outdoors, on a tripod —
 * not for a phone held 30cm from the face.
 *
 * Display roles are uppercase and letterspaced, which is the web product's own
 * convention for Barlow Condensed (`.app-display` at 0.03em, `.page-title` at
 * 0.035em); the match label's names are the one exception (`label`, AGENTS §5).
 * Body roles stay sentence case in Geist.
 *
 * Everything is left-aligned: a narrow column would ragged badly centred, and
 * numbers must share a left edge to be scannable at a glance.
 */
export const typeScale = {
  /**
   * The number read fastest from a tripod, so it gets the most size available.
   *
   * Barlow Condensed rather than Geist Mono: a mono's colon advance opened
   * visible gaps that broke `00:00` into three groups instead of one time, and
   * condensed digits fit ~38px into the 150px column's 118px of content (the
   * column this was sized in, before the controls half) where a mono capped out
   * at 28px. `tabular-nums` is what keeps the digits from jittering
   * — the reason a mono was there in the first place.
   */
  elapsed: {
    fontFamily: font.displayBold,
    fontSize: 38,
    lineHeight: 40,
    fontVariant: ['tabular-nums'],
    // Lime, because this is the app's LED. The scoring pad paints its score
    // digits with the same token (`.pad-led` / --sport-led).
    color: colour.lime,
  },
  /**
   * LIVE / READY. Caps is the house display convention, not an eyebrow label.
   * Deliberately smaller than the clock: it labels the clock rather than
   * competing with it, which is what stopped the two lime elements merging
   * into one undifferentiated block.
   */
  state: {
    fontFamily: font.displayBold,
    fontSize: 15,
    lineHeight: 17,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  metricValue: {
    fontFamily: font.numeric,
    fontSize: 16,
    lineHeight: 20,
    color: colour.ink,
  },
  /** Inert labels only — units, captions. Never a tappable thing. */
  metricUnit: {
    fontFamily: font.bodyMedium,
    fontSize: 12,
    lineHeight: 16,
    color: colour.ink3,
  },
  /**
   * Anything tappable or anything the operator must read outdoors. Separate
   * from `metricUnit` because that role had grown to carry four different
   * meanings at once — inert state, disabled label, disabled reason, AND live
   * navigation — so a dead control and a working link looked identical.
   */
  control: {
    fontFamily: font.bodyMedium,
    fontSize: 14,
    lineHeight: 18,
    color: colour.ink2,
  },
  /**
   * Board "Settings": a switch row's label and the side control's label are full cream, where `control` is cream at
   * 80 % (the board's pixels: (244,240,232), the ink token, against (200,196,197) for the words in the segments).
   */
  controlInk: {
    fontFamily: font.bodyMedium,
    fontSize: 14,
    lineHeight: 18,
    color: colour.ink,
  },
  /**
   * Board "Settings": the small outlined button's label (Share record), Geist 500 at 12 in ink2 (the board's
   * pixels are cream at 80 %, its text 12 dp). Smaller than `control`, which the regular GhostButton keeps.
   */
  controlSmall: {
    fontFamily: font.bodyMedium,
    fontSize: 12,
    lineHeight: 16,
    color: colour.ink2,
  },
  /**
   * Condensed buys "HOLD TO STOP" on fewer lines in the controls half. Also a sub-screen's title (Settings): the board's
   * "STREAM SETTINGS" is 165.7 dp of ink, which Barlow Condensed 700 sets at 24 with this role's 0.7 letterspacing
   * (`title`'s 26 would be 181, and Home's tiles and the code panel read that one).
   */
  action: {
    fontFamily: font.displayBold,
    fontSize: 24,
    lineHeight: 27,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    color: colour.ink,
  },
  /**
   * The secondary action — today only the peek control. Same face, caps and
   * letterspacing as `action`, so a column holding "HOLD TO PREVIEW" above
   * "HOLD TO STOP" reads as one pair of controls rather than a link above a
   * button. Smaller because it is subordinate, and because 24px condensed sets
   * "HOLD TO PREVIEW SCORE" on three lines in the 150px column it was sized in.
   */
  actionSecondary: {
    fontFamily: font.displaySemibold,
    fontSize: 16,
    lineHeight: 19,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colour.ink2,
  },
  /**
   * Board "Settings": a Diagnostics section's name in its 84 dp column. Barlow Condensed
   * 600, caps and letterspaced like `actionSecondary`, at 14 so the longest name in the
   * four languages ("Verbinding") fits the column.
   */
  diagSection: {
    fontFamily: font.displaySemibold,
    fontSize: 14,
    lineHeight: 16,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colour.ink2,
  },
  /**
   * Board "Settings, landscape": a Diagnostics row's item, Geist 500 at 13 (the board's, in ink3 like
   * `metricUnit`). 16 dp lines, so a row of `layout.diagRow` holds one.
   */
  diagLabel: {
    fontFamily: font.bodyMedium,
    fontSize: 13,
    lineHeight: 16,
    color: colour.ink3,
  },
  /**
   * Board "Settings, landscape": a Diagnostics row's value, Geist Mono at 13 (the board's; the brief's 16/20
   * came from the plan). Monospaced, so a value's width is its code points x 0.6 x 13 (settingsFit.test.ts
   * measures every shipped one against its row).
   */
  diagValue: {
    fontFamily: font.numeric,
    fontSize: 13,
    lineHeight: 16,
    color: colour.ink,
  },
  /**
   * Board "Settings": the Diagnostics card's heading, Barlow Condensed 700 in caps (the board's "DIAGNOSTICS" is 90 dp
   * wide: 18 at the 0.6 letterspacing `diagSection` has), ink. Between `actionSecondary` (16, semibold, ink2) and
   * `panelTitle` (22), which is 22 % too wide to leave the Share button its line at 640.
   */
  diagTitle: {
    fontFamily: font.displayBold,
    fontSize: 18,
    lineHeight: 20,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colour.ink,
  },
  /**
   * Board "Remote scoring": the code panel's title, Barlow Condensed 700 at 22/24, caps and letterspaced like `action`
   * (the board names the face, size and caps only; 0.7 is `action`'s, 0.03em of 22). Left-aligned, as every role is.
   */
  panelTitle: {
    fontFamily: font.displayBold,
    fontSize: 22,
    lineHeight: 24,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    color: colour.ink,
  },
  status: {
    fontFamily: font.body,
    fontSize: 13.5,
    lineHeight: 19,
    color: colour.ink2,
  },
  title: {
    fontFamily: font.displayBold,
    fontSize: 26,
    lineHeight: 29,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colour.ink,
  },
  body: {
    fontFamily: font.body,
    fontSize: 15,
    lineHeight: 22,
    color: colour.ink2,
  },
  /**
   * The match label in the status strip (spec §2): Barlow Condensed 600 at
   * 20 sp. No caps or letterspacing, unlike the other display roles: the names
   * are shown mixed case, as the organiser typed them (AGENTS §5). C2 (D2 §4.4)
   * draws every label at this one size, at most 2 lines a side.
   */
  label: {
    fontFamily: font.displaySemibold,
    fontSize: 20,
    lineHeight: 22,
    color: colour.ink,
  },
  /**
   * The sides in Match details (owner, 2026-11-01, option A: "we need a proper format"): the match label's face, mixed
   * case as typed, a step up, since the card is read at arm's length before the match and has the room. Partners wrap,
   * never cut; the doubles sample is one line at 320 in the card (padFit.test.ts).
   */
  matchName: {
    fontFamily: font.displaySemibold,
    fontSize: 26,
    lineHeight: 30,
    color: colour.ink,
  },
  /**
   * The scoring pad's score (S2): the LED digits read across a court, so the most size a half can hold. Barlow
   * Condensed 700 in lime, as the elapsed clock (the web pad's `.pad-led`), and `tabular-nums` so a 9 becoming 10 does
   * not jump. padFit.test.ts holds it, the names and the games line in a half on a small phone.
   */
  /**
   * The score a step up (owner ruling 14, 2026-10-31: "score centred and larger"), for a half tall enough to hold it
   * (`scoreRole.ts`): the owner's phone without the preview row. The controller's size; the same face, tabular, lime.
   */
  scoreLarge: {
    fontFamily: font.displayBold,
    fontSize: 128,
    lineHeight: 132,
    fontVariant: ['tabular-nums'],
    color: colour.lime,
  },
  score: {
    fontFamily: font.displayBold,
    fontSize: 96,
    lineHeight: 100,
    fontVariant: ['tabular-nums'],
    color: colour.lime,
  },
  /**
   * A finished game's score in its box on the pad's bottom row (owner ruling 16, 2026-10-31: a TV scoreboard's boxes):
   * the score's face, tabular so the boxes keep one width, at `state`'s size on a 16 dp line, so a box and its two
   * hairlines are the bottom row's own 18 (`halfNeeds`). Its colour is the box's: lime for a game won.
   */
  periodScore: {
    fontFamily: font.displayBold,
    fontSize: 15,
    lineHeight: 16,
    fontVariant: ['tabular-nums'],
  },
  /**
   * The games tally in the pad's header (owner, 2026-11-01: "0:0 with lime light in place of preview"; larger, owner,
   * 2026-11-02, into the room the badge gave back): the score's face, lime and tabular, at 46 on the header's own 48 dp
   * line, so "1:0" (58.5 dp) stands whole in the 72 dp the row leaves it at 320 and the header stays one 48 dp row
   * (padFit.test.ts: the row's height, not its room, is what stops it growing). Also the cricket board's score on its last
   * rung (T19 fix 6, `scorePanelCompact`), where `scoreCompact`'s 68 dp line does not fit.
   */
  tally: {
    fontFamily: font.displayBold,
    fontSize: 46,
    lineHeight: 48,
    fontVariant: ['tabular-nums'],
    color: colour.lime,
  },
  /**
   * The tally a step down, for a compact board on a short phone (S2-5 fix round 2, the controller's ruling R1): the match
   * clock's time over its period in one 48 dp row (32 + 16), and a team's score, so a column of three keeps its touch
   * targets at a 556 dp window (`columnBoard.ts`, footballFit.test.ts). The same face, tabular, lime.
   */
  tallyCompact: {
    fontFamily: font.displayBold,
    fontSize: 30,
    lineHeight: 32,
    fontVariant: ['tabular-nums'],
    color: colour.lime,
  },
  /**
   * The football pad's match clock, the biggest thing on it (owner ruling 130, "Clock hero"): the LED lime in Barlow
   * Condensed, tabular, at 80 on an 84 dp line. "120+15:00" is the widest reading and needs 0.86 of it in a 320 dp
   * face, so it never grows with the phone's font scale (`maxFontScale`) and shrinks no further than `clockFloor`
   * (footballFit.test.ts). A compact board takes `tallyCompact` instead.
   */
  clockHero: {
    fontFamily: font.displayBold,
    fontSize: 80,
    lineHeight: 84,
    fontVariant: ['tabular-nums'],
    color: colour.lime,
  },
  /**
   * The count in the pad's send badge (owner, 2026-11-02): the score's face, tabular so 9 to 10 does not jump, at 18 on
   * a 20 dp line. "99+" (25.8 dp) is the widest it draws (padFit.test.ts). Cream; the badge sets caution in trouble.
   */
  syncCount: {
    fontFamily: font.displayBold,
    fontSize: 18,
    lineHeight: 20,
    fontVariant: ['tabular-nums'],
    color: colour.ink,
  },
  /** The score a step down, for a half too short for `score` (`scoreRole.ts` picks it from the half's own height). */
  scoreCompact: {
    fontFamily: font.displayBold,
    fontSize: 64,
    lineHeight: 68,
    fontVariant: ['tabular-nums'],
    color: colour.lime,
  },
} satisfies Record<string, TextStyle>;

export type TypeRole = keyof typeof typeScale;

/**
 * The most a phone's font scale may grow a role's text, for the roles set in a room measured at their own size (review
 * minor 4 of round 2, 2026-11-02). Every other role follows the phone's scale, as the rest of the app does.
 * - `tally`: "1:0" never shrinks and has 72 dp at 320 beside Rules, History and the badge; at 1.15 it is 67.2 dp, where a 1.3
 *   scale would make it 76.1 and push the row out of the screen (`padFit.test.ts`).
 * - `tallyCompact`: the tally's cap, so the compact board's time and scores grow no more than the full board's (the
 *   final review's fix-now, 2026-11-08); the time still shrinks to its one line as the full one does (`clockFloor`).
 * - `clockHero`: the football clock's 80 dp digits fill a 320 dp face at 0.86 for the widest reading; a larger font
 *   scale would take it under `clockFloor`, and the time is read at a glance, not by its size setting.
 * - `syncCount`: the badge's slot is 56 dp and the widest count, "99+", is 55.8 in it, so it does not grow at all. The
 *   badge's words are the screen reader's and are not drawn, so nothing is lost to a larger setting.
 */
export const maxFontScale: Partial<Record<TypeRole, number>> = {
  tally: 1.15,
  tallyCompact: 1.15,
  clockHero: 1,
  syncCount: 1,
};

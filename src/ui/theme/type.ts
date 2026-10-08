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
  /** Condensed buys "HOLD TO STOP" on fewer lines in the controls half. */
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
  /**
   * Board "Settings": a sub-screen's title. "STREAM SETTINGS" is 165.7 dp of ink on the board, which Barlow Condensed
   * 700 sets at 24 with `action`'s 0.7 letterspacing (26 at `title`'s would be 181). `title` stays: Home's tiles
   * and the code panel read it.
   */
  screenTitle: {
    fontFamily: font.displayBold,
    fontSize: 24,
    lineHeight: 27,
    letterSpacing: 0.7,
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
   * 20 sp. No caps or letterspacing, unlike the other display roles: §2 names
   * the face and the size only, and its 26-character rule counts the names as
   * the organiser typed them.
   */
  label: {
    fontFamily: font.displaySemibold,
    fontSize: 20,
    lineHeight: 22,
    color: colour.ink,
  },
  /** Spec §2: 17 sp when the longest line is over 26 characters; doubles too (Q4 option A). */
  labelLong: {
    fontFamily: font.displaySemibold,
    fontSize: 17,
    lineHeight: 19,
    color: colour.ink,
  },
} satisfies Record<string, TextStyle>;

export type TypeRole = keyof typeof typeScale;

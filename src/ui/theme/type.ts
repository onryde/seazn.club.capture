import type { TextStyle } from 'react-native';
import { colour, font } from '@/ui/theme/tokens';

/**
 * The scale (AGENTS.md §5). Sized for arm's length, outdoors, on a tripod —
 * not for a phone held 30cm from the face.
 *
 * Display roles are uppercase and letterspaced, which is the web product's own
 * convention for Barlow Condensed (`.app-display` at 0.03em, `.page-title` at
 * 0.035em). Body roles stay sentence case in Geist.
 *
 * Everything is left-aligned: a 150px column would ragged badly centred, and
 * numbers must share a left edge to be scannable at a glance.
 */
export const typeScale = {
  /**
   * The number read fastest from a tripod, so it gets the most size available.
   *
   * Barlow Condensed rather than Geist Mono: a mono's colon advance opened
   * visible gaps that broke `00:00` into three groups instead of one time, and
   * condensed digits fit ~38px into the column's 118px of content where a mono
   * capped out at 28px. `tabular-nums` is what keeps the digits from jittering
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
  /** Condensed buys "HOLD TO STOP" on fewer lines in a 150px column. */
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
   * "HOLD TO PREVIEW SCORE" on three lines in a 150px column.
   */
  actionSecondary: {
    fontFamily: font.displaySemibold,
    fontSize: 16,
    lineHeight: 19,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colour.ink2,
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
} satisfies Record<string, TextStyle>;

export type TypeRole = keyof typeof typeScale;

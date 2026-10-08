/**
 * The match label as the viewfinder's status strip shows it (spec §2). The
 * descriptor carries one joined string, `"{side A} v {side B}"` or
 * `"Match {n}"`; there are no side or partner fields, so the split is here.
 */

/** Sides split on the first of these. */
export const SIDES = ' v ';
/** Partners within a side split on every one of these. */
export const PARTNERS = ' / ';
/** Spec §2: 17 sp "when the longest line is over 26 chars", counted in code points. */
export const LONG_LINE_OVER = 26;
/** Doubles: the one partner count shown one partner a line. */
const PAIR = 2;

/**
 * One side, or the whole block. `wrap` is each line's `numberOfLines`: 1 for a
 * partner line, which ends in an ellipsis, and 2 for a side or block that wraps.
 * So a side is never more than two lines tall.
 */
export type LabelPart = { readonly lines: readonly string[]; readonly wrap: 1 | 2 };
export type MatchLabel =
  | { readonly kind: 'block'; readonly block: LabelPart }
  | { readonly kind: 'sides'; readonly a: LabelPart; readonly b: LabelPart };

/** A side's names, split on every `" / "`, an empty piece dropped. */
function partnersOf(text: string): string[] {
  return text
    .split(PARTNERS)
    .map((name) => name.trim())
    .filter((name) => name !== '');
}

/**
 * Two partners are one per line. Anything else is the side as typed, wrapping
 * to two lines: one name, or three or more partners (a team the organiser
 * typed), which one a line would push past two lines and out of the strip.
 */
function side(text: string): LabelPart {
  const partners = partnersOf(text);
  return partners.length === PAIR
    ? { lines: partners, wrap: 1 }
    : { lines: [text.trim()], wrap: 2 };
}

/** Whether a part names partners, one a line or typed in one line. */
const hasPartners = (part: LabelPart) => part.lines.flatMap(partnersOf).length > 1;

/** §2's "chars" are code points (as `destination.ts` counts): an emoji is one, not two. */
const characters = (line: string) => [...line].length;

/**
 * Split on the first `" v "`. A label with none, or with nothing on one side
 * of it, is one block: a side is never shown empty.
 */
export function splitMatchLabel(label: string): MatchLabel {
  const at = label.indexOf(SIDES);
  const a = at < 0 ? '' : label.slice(0, at).trim();
  const b = at < 0 ? '' : label.slice(at + SIDES.length).trim();
  if (a === '' || b === '') return { kind: 'block', block: { lines: [label.trim()], wrap: 2 } };
  return { kind: 'sides', a: side(a), b: side(b) };
}

/** 20 sp (`regular`) or 17 sp (`long`): spec §2's rule, and the owner's Q4 answer for doubles. */
export function labelSize(label: MatchLabel): 'regular' | 'long' {
  const parts = label.kind === 'block' ? [label.block] : [label.a, label.b];
  // Q4 option A (owner, 2026-10-07): a doubles label, either side with partners, is long.
  // A side's rule only: a block has no sides, so it is sized by its line alone.
  if (label.kind === 'sides' && parts.some(hasPartners)) return 'long';
  const longest = Math.max(...parts.flatMap((part) => part.lines.map(characters)));
  // Written assumption (F9): a side of 26 characters or fewer, at 20 sp Barlow
  // Condensed 600, does not wrap in the status strip's width (about 9 dp a
  // character: 234 dp, inside the strip's 288 dp). So a regular label sets each
  // side on one line and only a long one wraps. Nothing here sees a width:
  // Task 9 checks a 26-character side on the phone.
  return longest > LONG_LINE_OVER ? 'long' : 'regular';
}

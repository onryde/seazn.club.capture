/**
 * The Next line's match label is cut by how wide it draws, not by how many characters it has (court stream spec
 * 2026-11-14 §6.2, I4; P3 review m2). "Next: {label} · {time}" is ONE line of the status font at the owner's phone's 386 dp
 * (728 × 328), and the time is the part the operator reads for, so the label must be the part an ellipsis eats. A count of
 * 24 characters cannot promise that: 24 capitals are half as wide again as 24 lower-case letters, and organisers do type
 * team names in capitals.
 *
 * The domain cannot measure a font, so the advances are written down here: Geist 400 at the body role, in thousandths
 * of its size, rounded up (so a sum ignoring kerning is an upper bound, as `stripTextFit.test.ts` takes it). That test
 * sweeps U+0020 to U+017F against the shipped font file, so a new font or size that moves a glyph past its entry reds it.
 */
const ASCII_ADVANCES: readonly number[] = [
  250, 213, 346, 478, 629, 802, 620, 178, 274, 274, 430, 558, 201, 419, 201, 480, 663, 384, 619,
  613, 615, 626, 593, 524, 604, 593, 297, 297, 544, 541, 544, 559, 906, 668, 680, 703, 695, 603,
  590, 700, 713, 271, 597, 640, 580, 877, 743, 739, 650, 733, 672, 640, 552, 689, 667, 945, 606,
  576, 544, 348, 455, 348, 426, 557, 248, 551, 595, 546, 595, 561, 396, 594, 581, 245, 260, 590,
  267, 877, 581, 573, 595, 595, 380, 520, 392, 575, 536, 820, 585, 537, 537, 389, 264, 389, 523,
];

/** An accented Latin-1 letter is its base letter and this much (the widest of U+00C0 to U+00FF is Å, at +1). */
const ACCENT_ALLOWANCE = 70;
/** Anything else (Æ and Œ at 1088, a glyph the font lacks, a script it does not have) is counted as one wide letter. */
const OTHER_ADVANCE = 1100;
/** The ellipsis, rounded up. */
const ELLIPSIS_ADVANCE = 571;

/**
 * The room the label has, in the same thousandths of the body size: 14.7 em, 220.5 dp at 15. The tightest language's line,
 * Dutch "Volgende: … · 14:32 CEST", leaves 222.2 dp of the 386 the owner's phone gives the strip's text.
 */
export const NEXT_LABEL_ROOM = 14700;

/** One character's advance, in thousandths of the body size, rounded up. */
export function advanceOf(letter: string): number {
  const code = letter.codePointAt(0) ?? 0;
  if (code >= 0x20 && code <= 0x7e) return ASCII_ADVANCES[code - 0x20] ?? OTHER_ADVANCE;
  if (code >= 0xc0 && code <= 0xff) {
    const base = letter.normalize('NFD')[0] ?? letter;
    const baseCode = base.codePointAt(0) ?? 0;
    if (baseCode >= 0x20 && baseCode <= 0x7e && base !== letter) {
      return (ASCII_ADVANCES[baseCode - 0x20] ?? OTHER_ADVANCE) + ACCENT_ALLOWANCE;
    }
  }
  return OTHER_ADVANCE;
}

/**
 * The next streamed match's label as the status line shows it: past `NEXT_LABEL_ROOM`, cut to what fits beside "…", with
 * no space left before it. Counted in code points, as `cutDestination` does, so an emoji is one character and a
 * surrogate pair is never split.
 */
export function cutNextLabel(label: string): string {
  const letters = [...label];
  const total = letters.reduce((sum, letter) => sum + advanceOf(letter), 0);
  if (total <= NEXT_LABEL_ROOM) return label;
  let used = ELLIPSIS_ADVANCE;
  let kept = 0;
  for (const letter of letters) {
    used += advanceOf(letter);
    if (used > NEXT_LABEL_ROOM) break;
    kept += 1;
  }
  return `${letters.slice(0, kept).join('').trimEnd()}…`;
}

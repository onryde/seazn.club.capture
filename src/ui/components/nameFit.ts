/**
 * Where a line may end: a space, a tab, a line end or any of the Unicode spaces that break. Not the no-break spaces
 * (U+00A0, U+2007, U+202F), which hold "A. Sharma" together on purpose, and not a hyphen, which is a place to break but
 * not one a name can be relied on to have.
 */
const GAP = '[ \\t\\n\\r\\f\\v\\u1680\\u2000-\\u2006\\u2008-\\u200a\\u205f\\u3000]';
const EDGE_GAPS = new RegExp(`^${GAP}+|${GAP}+$`, 'g');
const INNER_GAP = new RegExp(GAP);

/**
 * Whether a name has nowhere to end a line but inside a word. React Native on Android breaks a word that is wider than
 * its line at the letter, whatever `numberOfLines` says, and its `adjustsFontSizeToFit` shrinks only a text that is
 * one line (RN 0.86.3 `TextLayoutManager.adjustSpannableFontToFit` measures with no line cap and shrinks while the
 * lines exceed `numberOfLines`), so a name of this kind is shrunk to one line (`NameText`). A name with a gap in it
 * wraps at its gaps, as before.
 * Limit, left as it is: Chinese, Japanese and Thai have no spaces, so a long name in them counts as one word here.
 */
export function isOneWord(name: string): boolean {
  return !INNER_GAP.test(name.replace(EDGE_GAPS, ''));
}

const ENDS_AT_BREAK = new RegExp(`(${GAP}|-)$`);

/**
 * Whether the phone broke a word at a letter: a line, short of the last, that ends inside a word (not at a gap and not
 * after a hyphen). `lines` are the line texts `onTextLayout` hands back; Android keeps the gap a line breaks at on the
 * line before. The last line is never a break: its end is the text's, or its ellipsis.
 */
export function breaksInsideWord(lines: readonly string[]): boolean {
  return lines.slice(0, -1).some((line) => !ENDS_AT_BREAK.test(line));
}

const GAPS = new RegExp(`${GAP}+`);

/**
 * A name set on two lines at a gap (a line feed in its place): the gap that leaves the longer line shortest, counted in
 * characters. A name with no gap is returned as it is. Android's shrink then sees a word wider than its line, which
 * makes a third line, and shrinks the name until it does not (`NameText`'s `floor`).
 */
export function splitInTwo(name: string): string {
  const words = name.replace(EDGE_GAPS, '').split(GAPS);
  if (words.length < 2) return name;
  const lengthOf = (part: readonly string[]) => part.join(' ').length;
  let best = 1;
  for (let at = 2; at < words.length; at += 1) {
    const longer = (cut: number) =>
      Math.max(lengthOf(words.slice(0, cut)), lengthOf(words.slice(cut)));
    if (longer(at) < longer(best)) best = at;
  }
  return `${words.slice(0, best).join(' ')}\n${words.slice(best).join(' ')}`;
}

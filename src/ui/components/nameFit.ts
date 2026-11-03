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

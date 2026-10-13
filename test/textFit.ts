/**
 * Lines a text takes in a width, breaking at plain spaces (a no-break space does not break, as in French typography)
 * with no kerning, which can only over-state a width slightly. At least one word per line. The fit tests' one copy
 * (ledger P15): `measure` is a shipped font's width at the size the test names (`test/fontMetrics.ts`).
 */
export function linesOf(text: string, width: number, measure: (text: string) => number): number {
  return linesIn(text, width, measure).length;
}

/** The lines themselves, broken as `linesOf` counts them: for a fit that needs a line's own width. */
export function linesIn(
  text: string,
  width: number,
  measure: (text: string) => number,
): readonly string[] {
  const lines: string[] = [];
  let current = '';
  for (const piece of text.split(' ')) {
    const next = current === '' ? piece : `${current} ${piece}`;
    if (current === '' || measure(next) <= width) current = next;
    else {
      lines.push(current);
      current = piece;
    }
  }
  lines.push(current);
  return lines;
}

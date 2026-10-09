/**
 * Lines a text takes in a width, breaking at plain spaces (a no-break space does not break, as in French typography)
 * with no kerning, which can only over-state a width slightly. At least one word per line. The fit tests' one copy
 * (ledger P15): `measure` is a shipped font's width at the size the test names (`test/fontMetrics.ts`).
 */
export function linesOf(text: string, width: number, measure: (text: string) => number): number {
  let lines = 1;
  let current = '';
  for (const piece of text.split(' ')) {
    const next = current === '' ? piece : `${current} ${piece}`;
    if (current === '' || measure(next) <= width) current = next;
    else {
      lines += 1;
      current = piece;
    }
  }
  return lines;
}

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StageLine } from '@/ui/components/StageLine';
import { Text } from '@/ui/components/Text';

/**
 * How many lines react-native-web lets a Text show, read from what it rendered (MatchLabel.test.tsx's
 * reading): `numberOfLines={1}` is no clamp at all but one unwrapped line that ends in an ellipsis.
 */
function linesAllowed(element: Element): number {
  const style = getComputedStyle(element);
  const clamp = style.getPropertyValue('-webkit-line-clamp');
  if (clamp !== '') return Number(clamp);
  if (style.whiteSpace === 'nowrap' && style.textOverflow === 'ellipsis') return 1;
  return Infinity;
}

// The server's text, shown verbatim (spec §2): a short code, the 40-character limit, and an emoji (a 🏏 is
// one character to the contract and two UTF-16 units).
const TEXTS = [
  ['a short code', 'QF'],
  ['40 characters, the contract’s most', 'Semi-final · Court 3 · Group A · Match 1'],
  ['an emoji', '🏏 Final'],
] as const;
let run = 0;

describe('StageLine (spec §2)', () => {
  it.each(TEXTS)('%s: its text verbatim, in one element, on one line', (_why, text) => {
    render(<StageLine text={text} />);
    const line = screen.getByTestId('stage-line');
    expect(screen.getAllByTestId('stage-line')).toHaveLength(1);
    expect(line.textContent).toBe(text);
    expect(linesAllowed(line)).toBe(1);
    run += 1;
  });

  it.each(TEXTS)('%s: the same size and colour as the label’s own small grey v', (_why, text) => {
    render(
      <>
        <StageLine text={text} />
        <Text variant="metricUnit" testID="reference-v">
          v
        </Text>
      </>,
    );
    const line = getComputedStyle(screen.getByTestId('stage-line'));
    const reference = getComputedStyle(screen.getByTestId('reference-v'));
    // Read from the rendered cascade, both sides: a hard-coded 12px or a grey would not move with the role.
    expect(reference.fontSize).not.toBe('');
    expect(line.fontSize).toBe(reference.fontSize);
    expect(line.color).not.toBe('');
    expect(line.color).toBe(reference.color);
    expect(line.lineHeight).toBe(reference.lineHeight);
    run += 1;
  });

  it('swept three texts, twice each, and the forty-character one really is forty (anti-vacuity)', () => {
    expect(TEXTS).toHaveLength(3);
    expect([...TEXTS[1][1]]).toHaveLength(40);
    expect([...TEXTS[2][1]].length).toBeLessThan(TEXTS[2][1].length);
    expect(run).toBe(TEXTS.length * 2);
  });
});

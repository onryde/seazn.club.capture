import { render, screen } from '@testing-library/react';
import { StyleSheet } from 'react-native';
import { describe, expect, it } from 'vitest';
import { StageLine } from '@/ui/components/StageLine';
import { Text } from '@/ui/components/Text';
import { colour } from '@/ui/theme/tokens';
import { linesAllowed } from '../../../test/linesAllowed';

/** The spec's colour for the round line (C2, D2 §4.4): lime, as the token paints it. */
const PAINT = StyleSheet.create({ lime: { color: colour.lime } });

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

  // C2 (D2 §4.4): restyled, not resized. The metricUnit role's size and line, so the strip's fixed 66 dp holds, in lime
  // and caps. jsdom reports the CSS `text-transform`, not the drawn capitals; the text itself stays the server's.
  it.each(TEXTS)('%s: the metricUnit size and line, in lime and caps', (_why, text) => {
    render(
      <>
        <StageLine text={text} />
        <Text variant="metricUnit" testID="reference-size">
          v
        </Text>
        <Text variant="metricUnit" testID="reference-lime" style={PAINT.lime}>
          v
        </Text>
      </>,
    );
    const line = getComputedStyle(screen.getByTestId('stage-line'));
    const size = getComputedStyle(screen.getByTestId('reference-size'));
    const lime = getComputedStyle(screen.getByTestId('reference-lime'));
    // Read from the rendered cascade, both sides: a hard-coded 12px or a colour would not move with the role.
    expect(size.fontSize).not.toBe('');
    expect(line.fontSize).toBe(size.fontSize);
    expect(line.lineHeight).toBe(size.lineHeight);
    expect(lime.color).not.toBe(size.color);
    expect(line.color).toBe(lime.color);
    expect(line.textTransform).toBe('uppercase');
    expect(screen.getByTestId('stage-line').textContent).toBe(text);
    run += 1;
  });

  it('swept three texts, twice each, and the forty-character one really is forty (anti-vacuity)', () => {
    expect(TEXTS).toHaveLength(3);
    expect([...TEXTS[1][1]]).toHaveLength(40);
    expect([...TEXTS[2][1]].length).toBeLessThan(TEXTS[2][1].length);
    expect(run).toBe(TEXTS.length * 2);
  });
});

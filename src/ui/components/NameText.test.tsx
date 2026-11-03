import { render, screen } from '@testing-library/react';
import type { TextProps } from 'react-native';
import { describe, expect, it, vi } from 'vitest';
import { NameText } from '@/ui/components/NameText';
import { layout } from '@/ui/theme/tokens';

// The props a name reaches React Native's Text with. react-native-web drops `adjustsFontSizeToFit` and
// `minimumFontScale`, so the real Text cannot show them: this stands in for it and writes what it was given where a test
// can read it. Whether a phone then shrinks the name rather than breaking it is a device check.
vi.mock('@/ui/components/Text', () => ({
  Text: (props: TextProps & { variant: string }) => (
    <span
      data-testid="text"
      data-variant={props.variant}
      data-lines={String(props.numberOfLines)}
      data-fit={String(props.adjustsFontSizeToFit)}
      data-floor={String(props.minimumFontScale)}
      data-ellipsis={String(props.ellipsizeMode)}
      data-id={props.testID}
    >
      {props.children}
    </span>
  ),
}));

const read = () => {
  const text = screen.getByTestId('text');
  return {
    words: text.textContent,
    variant: text.dataset.variant,
    lines: text.dataset.lines,
    fit: text.dataset.fit,
    floor: text.dataset.floor,
    ellipsis: text.dataset.ellipsis,
    id: text.dataset.id,
  };
};

describe('NameText', () => {
  it('shrinks a name with no gap in it to one line, down to the floor, and ends it with an ellipsis beyond', () => {
    render(
      <NameText variant="label" lines={2}>
        TEest002ashokashTEest002
      </NameText>,
    );
    expect(read()).toEqual({
      words: 'TEest002ashokashTEest002',
      variant: 'label',
      lines: '1',
      fit: 'true',
      floor: String(layout.nameFloor),
      ellipsis: 'tail',
      id: undefined,
    });
  });

  it('keeps one line for a short single word too, however many lines the place allows', () => {
    render(
      <NameText variant="label" lines={2}>
        Ashok
      </NameText>,
    );
    expect(read().lines).toBe('1');
  });

  it('wraps a name with a gap in it at its gaps, to the lines the place allows, at full size', () => {
    render(
      <NameText variant="label" lines={2}>
        A. Sharma / R. Iyer
      </NameText>,
    );
    expect(read()).toEqual({
      words: 'A. Sharma / R. Iyer',
      variant: 'label',
      lines: '2',
      fit: 'undefined',
      floor: 'undefined',
      ellipsis: 'undefined',
      id: undefined,
    });
  });

  it('wraps with no cap where the place gives none: a name is never cut there', () => {
    render(<NameText variant="matchName">A. Sharma / R. Iyer</NameText>);
    expect(read()).toMatchObject({ variant: 'matchName', lines: 'undefined', fit: 'undefined' });
  });

  it('passes the rest of what it was given on to the Text, on either path', () => {
    render(
      <>
        <NameText variant="label" testID="short">
          Ashok
        </NameText>
        <NameText variant="label" testID="doubles">
          A. Sharma / R. Iyer
        </NameText>
      </>,
    );
    expect(screen.getAllByTestId('text').map((text) => text.dataset.id)).toEqual([
      'short',
      'doubles',
    ]);
  });
});

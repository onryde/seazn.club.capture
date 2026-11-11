import { act, render, screen } from '@testing-library/react';
import type { TextLayoutEventData, TextProps } from 'react-native';
import { describe, expect, it, vi } from 'vitest';
import { NameText } from '@/ui/components/NameText';
import { layout } from '@/ui/theme/tokens';

// The props a name reaches React Native's Text with. react-native-web drops `adjustsFontSizeToFit` and
// `minimumFontScale`, so the real Text cannot show them: this stands in for it and writes what it was given where a test
// can read it. Whether a phone then shrinks the name rather than breaking it is a device check.
// The phone's own lines after a layout (`onTextLayout`): jsdom lays nothing out, so a test hands them in by hand.
const laidOut = vi.hoisted(() => ({ handler: undefined as TextProps['onTextLayout'] }));
vi.mock('@/ui/components/Text', () => ({
  Text: (props: TextProps & { variant: string }) => {
    laidOut.handler = props.onTextLayout;
    return (
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
    );
  },
}));

/** Android's lines for the last Text drawn, as `onTextLayout` would hand them back. */
function linesAre(...texts: string[]) {
  const lines = texts.map((text) => ({ text })) as unknown as TextLayoutEventData['lines'];
  const handler = laidOut.handler;
  if (handler === undefined || handler === null)
    throw new Error('the Text was given no onTextLayout');
  act(() =>
    handler({ nativeEvent: { lines } } as Parameters<NonNullable<TextProps['onTextLayout']>>[0]),
  );
}

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
  // The controller's fix-round ruling (a): a team's name shrinks to fit before its two-line ellipsis, and no word of it
  // breaks at a letter. Whether the phone then shrinks it is the device check's; these are what it is given.
  it('with a floor, shrinks a name with gaps to fit its lines, down to the floor, then an ellipsis', () => {
    render(
      <NameText variant="matchName" lines={2} floor={0.75}>
        Wolverhampton Wanderers
      </NameText>,
    );
    expect(read()).toEqual({
      words: 'Wolverhampton Wanderers',
      variant: 'matchName',
      lines: '2',
      fit: 'true',
      floor: '0.75',
      ellipsis: 'tail',
      id: undefined,
    });
  });

  it('with a floor, a name the phone broke at a letter is set again on two lines at its gap, and shrunk the same', () => {
    render(
      <NameText variant="matchName" lines={2} floor={0.75}>
        Wolverhampton Wanderers
      </NameText>,
    );
    linesAre('Wolverhampto', 'n Wanderers');
    expect(read()).toMatchObject({
      words: 'Wolverhampton\nWanderers',
      lines: '2',
      fit: 'true',
      floor: '0.75',
    });
    linesAre('Wolverhampton\n', 'Wanderers');
    expect(read().words).toBe('Wolverhampton\nWanderers');
  });

  it('with a floor, a name the phone broke only at its gaps stays as typed', () => {
    render(
      <NameText variant="matchName" lines={2} floor={0.75}>
        Northgate United
      </NameText>,
    );
    linesAre('Northgate ', 'United');
    expect(read().words).toBe('Northgate United');
  });

  it('a new name after a split is set as typed until its own lines break a word', () => {
    const view = render(
      <NameText variant="matchName" lines={2} floor={0.75}>
        Wolverhampton Wanderers
      </NameText>,
    );
    linesAre('Wolverhampto', 'n Wanderers');
    view.rerender(
      <NameText variant="matchName" lines={2} floor={0.75}>
        Borussia Mönchengladbach
      </NameText>,
    );
    expect(read().words).toBe('Borussia Mönchengladbach');
  });

  // The controller's fix-round 2 ruling (N1): a split is for a place of two lines or more, and is forgotten when the
  // place's lines change. A split name in a one-line place would be a hard break Android shrinks to 4 dp.
  it('a split name set again in one line is whole on it, with no line feed', () => {
    const name = (lines: number) => (
      <NameText variant="matchName" lines={lines} floor={0.75}>
        Wolverhampton Wanderers
      </NameText>
    );
    const view = render(name(2));
    linesAre('Wolverhampto', 'n Wanderers');
    expect(read().words).toBe('Wolverhampton\nWanderers');
    view.rerender(name(1));
    expect(read()).toMatchObject({ words: 'Wolverhampton Wanderers', lines: '1' });
    expect(read().words).not.toContain('\n');
  });

  it('back at two lines, the name is whole until its own lines break a word there again', () => {
    const name = (lines: number) => (
      <NameText variant="matchName" lines={lines} floor={0.75}>
        Wolverhampton Wanderers
      </NameText>
    );
    const view = render(name(2));
    linesAre('Wolverhampto', 'n Wanderers');
    view.rerender(name(1));
    view.rerender(name(2));
    expect(read().words).toBe('Wolverhampton Wanderers');
    linesAre('Wolverhampto', 'n Wanderers');
    expect(read().words).toBe('Wolverhampton\nWanderers');
  });

  it('in a one-line place a name is never split, whatever lines the phone reports', () => {
    render(
      <NameText variant="matchName" lines={1} floor={0.75}>
        Wolverhampton Wanderers
      </NameText>,
    );
    linesAre('Wolverhampto', 'n Wanderers');
    expect(read()).toMatchObject({ words: 'Wolverhampton Wanderers', lines: '1' });
  });

  it('with no floor, a name with gaps is never fitted and nothing asks for its lines', () => {
    render(
      <NameText variant="label" lines={2}>
        Wolverhampton Wanderers
      </NameText>,
    );
    expect(read()).toMatchObject({ fit: 'undefined', floor: 'undefined' });
    expect(laidOut.handler).toBeUndefined();
  });

  it('with a floor, a name of one word keeps the one-word rule: one line, down to the name floor', () => {
    render(
      <NameText variant="matchName" lines={2} floor={0.75}>
        Wolverhampton
      </NameText>,
    );
    expect(read()).toMatchObject({ lines: '1', fit: 'true', floor: String(layout.nameFloor) });
  });
});

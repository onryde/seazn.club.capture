import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PadSide } from '@/domain/scoring/padView';
import en from '@/i18n/en.json';
import { TossPicker, type TossOption } from '@/ui/components/TossPicker';
import { colour, layout, plateInk, space } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';
import { edgeOf, fillOf } from '../../../test/pressState';
import { linesAllowed } from '../../../test/linesAllowed';
import { renderWithPorts } from '../../../test/renderWithPorts';

// Owner, 2026-11-01, option A: "Who serves first?" with the two sides as two big buttons, the names as typed, one
// choice; the picked one drawn as selected (lime, AGENTS §5). A radio group to a screen reader.
const SIDES: readonly [TossOption<PadSide>, TossOption<PadSide>] = [
  { id: 'first', label: 'A. Sharma / R. Iyer' },
  { id: 'second', label: 'L. Chen / M. Wong' },
];

function renderToss(
  picked: PadSide | null,
  more: { fill?: boolean; disabled?: boolean; big?: boolean } = {},
) {
  const onPick = vi.fn();
  renderWithPorts(
    <TossPicker
      ask={en['scoring.badminton.start.ask']}
      options={SIDES}
      picked={picked}
      onPick={onPick}
      {...more}
    />,
  );
  return { onPick };
}

const radio = (name: string) => screen.getByRole('radio', { name });

describe('TossPicker', () => {
  it('asks, as a heading, then offers the two sides, top first, as a radio group the question names', () => {
    renderToss(null);
    expect(screen.getByRole('heading').textContent).toBe(en['scoring.badminton.start.ask']);
    const group = screen.getByRole('radiogroup');
    expect(group.getAttribute('aria-label')).toBe(en['scoring.badminton.start.ask']);
    expect(screen.getAllByRole('radio').map((side) => side.textContent)).toEqual([
      'A. Sharma / R. Iyer',
      'L. Chen / M. Wong',
    ]);
    expect(screen.getAllByRole('radio').map((side) => side.getAttribute('aria-checked'))).toEqual([
      'false',
      'false',
    ]);
  });

  it('says which side a tap picked, each tap once', () => {
    const { onPick } = renderToss(null);
    act(() => fireEvent.click(radio('L. Chen / M. Wong')));
    act(() => fireEvent.click(radio('A. Sharma / R. Iyer')));
    expect(onPick.mock.calls).toEqual([['second'], ['first']]);
  });

  // Batch 3 fix round 1, the controller's ruling on I1 (rulings 83, 85): a button that takes a tap has the lime border,
  // in every sport, at the width every look shares, so a pick or the pair enabled moves no name.
  it('draws the picked side as the lime plate with night ink, and the other as the board with the lime border', () => {
    renderToss('second');
    const picked = radio('L. Chen / M. Wong');
    const other = radio('A. Sharma / R. Iyer');
    expect([picked.getAttribute('aria-checked'), other.getAttribute('aria-checked')]).toEqual([
      'true',
      'false',
    ]);
    expect(getComputedStyle(picked).backgroundColor).toBe(fillOf(colour.lime));
    expect(getComputedStyle(picked).borderTopColor).toBe(edgeOf(colour.lime));
    expect(getComputedStyle(other).backgroundColor).toBe(fillOf(colour.surface));
    expect(getComputedStyle(other).borderTopColor).toBe(edgeOf(colour.lime));
    expect([picked, other].map((side) => getComputedStyle(side).borderTopWidth)).toEqual([
      `${layout.iconBorder}px`,
      `${layout.iconBorder}px`,
    ]);
    const name = (side: HTMLElement) => side.firstElementChild as HTMLElement;
    expect(getComputedStyle(name(picked)).color).toBe(edgeOf(plateInk));
    expect(getComputedStyle(name(other)).color).toBe(edgeOf(colour.ink));
  });

  // padFit.test.ts: two of `padTossMin` and the gap fit the column at 320, and every word of the doubles names fits a
  // button's text at 320 and 360. The names have no line limit: they wrap, never cut.
  it('stands the sides side by side, wrapping onto a second row when two do not fit, and never cuts a name', () => {
    renderToss(null);
    const row = screen.getByRole('radiogroup');
    expect([
      getComputedStyle(row).flexDirection,
      getComputedStyle(row).flexWrap,
      getComputedStyle(row).gap,
    ]).toEqual(['row', 'wrap', `${space.sm}px`]);
    for (const side of screen.getAllByRole('radio')) {
      const style = getComputedStyle(side);
      expect([style.flexGrow, style.flexBasis, style.minHeight]).toEqual([
        '1',
        `${layout.padTossMin}px`,
        `${layout.padTossHeight}px`,
      ]);
      const name = side.firstElementChild as HTMLElement;
      expect(getComputedStyle(name).whiteSpace).not.toBe('nowrap');
    }
  });
});

// Device finding, 2026-11-13 (S2-7): "Maximiliane Oberhauser-Lindqvist" broke inside a word ("Oberha" / "user-Lindqvist"):
// a name with a gap wrapped with no floor, and a hyphen is not a gap, so Android broke the long second word at a letter.
// A name with gaps now goes through `FittedName` (floor and a three-line cap): the phone's own lines say a word broke,
// and the name is set again at its gap, so the break falls between words, then at the hyphen. Where the break falls is
// the phone's (device-only); jsdom can see the whole name drawn in one piece and its cap of three lines.
describe('TossPicker, a long name with gaps and a hyphen', () => {
  const NAME = 'Maximiliane Oberhauser-Lindqvist';
  const SIDES_LONG: readonly [TossOption<PadSide>, TossOption<PadSide>] = [
    { id: 'first', label: NAME },
    { id: 'second', label: 'L. Chen / M. Wong' },
  ];

  it.each([null, 'first' as const])(
    'draws the whole name, wrapping to three lines, picked %s',
    (picked) => {
      renderWithPorts(
        <TossPicker
          ask="Who serves first?"
          options={SIDES_LONG}
          picked={picked}
          onPick={vi.fn()}
        />,
      );
      const name = screen.getByText(NAME);
      expect(name.textContent).toBe(NAME);
      expect(linesAllowed(name)).toBe(3);
    },
  );
});

// Device finding, 2026-11-02: a long single-word name broke inside its word on the serving pick ("TEest002ashokash" over
// "ok"). A name with no space is one line the phone shrinks to fit (NameText); a doubles name still wraps at its gaps.
describe('TossPicker, a name that is one long word', () => {
  const WORD = 'TEest002ashokashTEest002';
  const LONG_SIDES: readonly [TossOption<PadSide>, TossOption<PadSide>] = [
    { id: 'first', label: WORD },
    { id: 'second', label: 'L. Chen / M. Wong' },
  ];

  it.each([null, 'first' as const])(
    'is one line, never wrapped inside its word, picked %s',
    (picked) => {
      renderWithPorts(
        <TossPicker
          ask="Who serves first?"
          options={LONG_SIDES}
          picked={picked}
          onPick={vi.fn()}
        />,
      );
      expect(linesAllowed(screen.getByText(WORD))).toBe(1);
    },
  );

  it('leaves the doubles name beside it wrapping at its gaps, to three lines', () => {
    renderWithPorts(
      <TossPicker ask="Who serves first?" options={LONG_SIDES} picked={null} onPick={vi.fn()} />,
    );
    expect(linesAllowed(screen.getByText('L. Chen / M. Wong'))).toBe(3);
  });
});

// Owner ruling 83 (2026-11-07): cricket's toss uses the whole screen, in two halves, the second greyed until the first is
// answered, so nothing moves. The picker is generic (spec §6's kit): `fill` grows the pair to its parent's height and
// keeps the question's lines, `disabled` greys it at the same size and takes no press. Without either it is as above.
describe('TossPicker, filling and disabled (ruling 83)', () => {
  const group = () => screen.getByRole('radiogroup');
  const block = () => group().parentElement as HTMLElement;
  const ask = () => screen.getByRole('heading');

  // Batch 3 fix round 1, M7: the whole-screen toss asks in `title`, the size of the preview the owner tested (ruling 83).
  it('fill grows the pair, its buttons never below their token, and asks in title, kept to two lines', () => {
    renderToss(null, { fill: true });
    expect([getComputedStyle(block()).flexGrow, getComputedStyle(group()).flexGrow]).toEqual([
      '1',
      '1',
    ]);
    expect(getComputedStyle(group()).alignContent).toBe('stretch');
    for (const side of screen.getAllByRole('radio')) {
      expect(getComputedStyle(side).minHeight).toBe(`${layout.padTossHeight}px`);
    }
    expect([getComputedStyle(ask()).fontSize, getComputedStyle(ask()).minHeight]).toEqual([
      `${typeScale.title.fontSize}px`,
      `${layout.padTossAskLines * typeScale.title.lineHeight}px`,
    ]);
    expect(getComputedStyle(ask()).webkitLineClamp).toBe(String(layout.padTossAskLines));
  });

  it('without fill the pair takes only its own height, and the question is the state line, not held to lines', () => {
    renderToss(null);
    expect(getComputedStyle(block()).flexGrow).toBe('0');
    expect(getComputedStyle(group()).flexGrow).toBe('0');
    expect([getComputedStyle(ask()).fontSize, getComputedStyle(ask()).minHeight]).toEqual([
      `${typeScale.state.fontSize}px`,
      'auto',
    ]);
  });

  // M7: short words (Bat and Bowl) are drawn at `tally`, the preview's; a name never is (cricketFit.test.ts).
  it('big draws the choices at tally, in ink on the board and night ink on the plate; without it at label', () => {
    renderToss('second', { big: true });
    const words = screen.getAllByRole('radio').map((side) => side.firstElementChild as HTMLElement);
    expect(words.map((word) => getComputedStyle(word).fontSize)).toEqual([
      `${typeScale.tally.fontSize}px`,
      `${typeScale.tally.fontSize}px`,
    ]);
    expect(words.map((word) => getComputedStyle(word).color)).toEqual([
      edgeOf(colour.ink),
      edgeOf(plateInk),
    ]);
  });

  it('without big the choices are at label', () => {
    renderToss(null);
    for (const side of screen.getAllByRole('radio')) {
      expect(getComputedStyle(side.firstElementChild as HTMLElement).fontSize).toBe(
        `${typeScale.label.fontSize}px`,
      );
    }
  });

  it('disabled ignores a press and says so, greyed at the same size', () => {
    const { onPick } = renderToss(null, { disabled: true });
    act(() => fireEvent.click(radio('L. Chen / M. Wong')));
    expect(onPick).not.toHaveBeenCalled();
    for (const side of screen.getAllByRole('radio')) {
      const style = getComputedStyle(side);
      expect(side.getAttribute('aria-disabled')).toBe('true');
      expect([style.borderTopColor, style.flexBasis, style.minHeight]).toEqual([
        edgeOf(colour.ink3),
        `${layout.padTossMin}px`,
        `${layout.padTossHeight}px`,
      ]);
      expect(getComputedStyle(side.firstElementChild as HTMLElement).color).toBe(
        edgeOf(colour.ink3),
      );
    }
    expect(getComputedStyle(ask()).color).toBe(edgeOf(colour.ink3));
  });

  it('enabled, a side is not said disabled, has the lime border, and its name is in ink', () => {
    renderToss(null, { disabled: false });
    for (const side of screen.getAllByRole('radio')) {
      expect(side.getAttribute('aria-disabled')).not.toBe('true');
      expect(getComputedStyle(side).borderTopColor).toBe(edgeOf(colour.lime));
    }
    expect(getComputedStyle(ask()).color).toBe(edgeOf(colour.ink2));
  });
});

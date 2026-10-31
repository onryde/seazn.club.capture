import { act, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PadHalf } from '@/domain/scoring/padView';
import en from '@/i18n/en.json';
import fr from '@/i18n/fr.json';
import type { MessageKey } from '@/i18n/messages';
import { ScoreHalf } from '@/ui/components/ScoreHalf';
import { colour } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';
import { layOut } from '../../../test/layOut';
import { linesAllowed } from '../../../test/linesAllowed';
import { edgeOf } from '../../../test/pressState';
import { renderWithPorts } from '../../../test/renderWithPorts';

const top: PadHalf<MessageKey> = {
  side: 'first',
  label: 'A. Sharma',
  value: '11',
  sub: { key: 'scoring.badminton.games', vars: { count: 1 } },
  serving: true,
  hint: { key: 'scoring.badminton.hint' },
  hintLine: { key: 'scoring.badminton.hintLine', vars: { side: 'A. Sharma' } },
  tappable: true,
};

const games = (count: number) => en['scoring.badminton.games'].replace('{count}', String(count));
const games1 = () => games(1);
const hintFor = (side: string) => en['scoring.badminton.hintLine'].replace('{side}', side);

describe('ScoreHalf', () => {
  it('shows the names, the big value, the games line and the serving plate', () => {
    renderWithPorts(<ScoreHalf half={top} flash={0} onTap={vi.fn()} />);
    expect(screen.getByText('A. Sharma')).toBeTruthy();
    expect(screen.getByText('11')).toBeTruthy();
    expect(screen.getByText(games(1))).toBeTruthy();
    expect(screen.getByTestId('serving').textContent).toBe(en['scoring.pad.serving']);
  });

  it('is one button a screen reader names by side, value, games and serving', () => {
    renderWithPorts(<ScoreHalf half={top} flash={0} onTap={vi.fn()} />);
    const name = ['A. Sharma', '11', games(1), en['scoring.pad.serving']].join(', ');
    expect(screen.getByRole('button', { name })).toBeTruthy();
  });

  it('gives its side the tap', () => {
    const onTap = vi.fn();
    renderWithPorts(<ScoreHalf half={{ ...top, side: 'second' }} flash={0} onTap={onTap} />);
    act(() => fireEvent.click(screen.getByTestId('half-second')));
    expect(onTap).toHaveBeenCalledExactlyOnceWith('second');
  });

  it('takes no tap when it is not tappable', () => {
    const onTap = vi.fn();
    renderWithPorts(<ScoreHalf half={{ ...top, tappable: false }} flash={0} onTap={onTap} />);
    act(() => fireEvent.click(screen.getByTestId('half-first')));
    expect(onTap).not.toHaveBeenCalled();
    expect(screen.getByTestId('half-first').getAttribute('aria-disabled')).toBe('true');
  });

  it('draws no plate for the receiving side, and no line when there is none', () => {
    renderWithPorts(
      <ScoreHalf half={{ ...top, serving: false, sub: null }} flash={0} onTap={vi.fn()} />,
    );
    expect(screen.queryByTestId('serving')).toBeNull();
    expect(screen.queryByText(games(1))).toBeNull();
    expect(screen.getByRole('button', { name: 'A. Sharma, 11' })).toBeTruthy();
  });

  it('marks the first side lime and the second lilac at its left edge', () => {
    renderWithPorts(
      <>
        <ScoreHalf half={top} flash={0} onTap={vi.fn()} />
        <ScoreHalf half={{ ...top, side: 'second' }} flash={0} onTap={vi.fn()} />
      </>,
    );
    const left = (testID: string) => getComputedStyle(screen.getByTestId(testID)).borderLeftColor;
    expect(left('half-first')).toBe(edgeOf(colour.lime));
    expect(left('half-second')).toBe(edgeOf(colour.ink3));
  });

  it('sets the value in the score role: tabular, so 9 to 10 does not jump', () => {
    renderWithPorts(<ScoreHalf half={top} flash={0} onTap={vi.fn()} />);
    expect(getComputedStyle(screen.getByText('11')).fontVariant).toContain('tabular-nums');
  });

  // A half 194 tall holds the names' two lines, the score at 96 and the games line in its padding (padFit.test.ts);
  // one dp shorter, the score steps down a size rather than run into the other half.
  // 226 holds it at 128 (owner ruling 14: "score centred and larger"); the owner's phone's halves are 209 with the
  // preview row and 233 without (the controller's brief, 2026-10-31).
  it.each([
    [null, typeScale.score.fontSize],
    [233, typeScale.scoreLarge.fontSize],
    [226, typeScale.scoreLarge.fontSize],
    [225, typeScale.score.fontSize],
    [209, typeScale.score.fontSize],
    [194, typeScale.score.fontSize],
    [193, typeScale.scoreCompact.fontSize],
  ] as const)('sets the score for a half %s tall at %i', (height, size) => {
    renderWithPorts(<ScoreHalf half={top} flash={0} onTap={vi.fn()} />);
    if (height !== null) layOut(screen.getByTestId('half-first'), { width: 288, height });
    expect(getComputedStyle(screen.getByText('11')).fontSize).toBe(`${size}px`);
  });

  // Owner ruling 14: the score centred in the space between the name row and the bottom row.
  it('centres the score, across and down, in the space between the names and the bottom row', () => {
    renderWithPorts(<ScoreHalf half={top} flash={0} onTap={vi.fn()} />);
    const middle = screen.getByText('11').parentElement;
    if (middle === null) throw new Error('no score box');
    const style = getComputedStyle(middle);
    expect([style.flexGrow, style.alignItems, style.justifyContent]).toEqual([
      '1',
      'center',
      'center',
    ]);
    const names = screen.getByText('A. Sharma');
    const games = screen.getByText(games1());
    const follows = (a: Node, b: Node) =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect([follows(names, middle), follows(middle, games)]).toEqual([true, true]);
  });

  // Owner ruling 14: "a one-line hint at the bottom of each half", on the games line's row so it costs no height.
  it('shows the hint on the games line’s row, at its right, on one line, hidden from a screen reader', () => {
    renderWithPorts(<ScoreHalf half={top} flash={0} onTap={vi.fn()} />);
    const hint = screen.getByText(hintFor('A. Sharma'));
    expect(hint.parentElement).toBe(screen.getByText(games1()).parentElement);
    const row = hint.parentElement;
    if (row === null) throw new Error('no bottom row');
    expect(getComputedStyle(row).flexDirection).toBe('row');
    expect(getComputedStyle(hint).textAlign).toBe('right');
    expect(linesAllowed(hint)).toBe(1);
    expect(getComputedStyle(hint).fontSize).toBe(`${typeScale.metricUnit.fontSize}px`);
    expect(hint.getAttribute('aria-hidden')).toBe('true');
    // The button's name is as it was: the hint is not read with it.
    const name = ['A. Sharma', '11', games1(), en['scoring.pad.serving']].join(', ');
    expect(screen.getByRole('button', { name })).toBeTruthy();
  });

  it('shows no hint on a half that takes no tap', () => {
    renderWithPorts(<ScoreHalf half={{ ...top, tappable: false }} flash={0} onTap={vi.fn()} />);
    expect(screen.queryByText(hintFor('A. Sharma'))).toBeNull();
    expect(screen.getByText(games1())).toBeTruthy();
  });

  it('hands its flash the cue it is given (`flashCue`), and the flash takes no touch from the half', () => {
    const onTap = vi.fn();
    renderWithPorts(<ScoreHalf half={top} flash={3} onTap={onTap} />);
    const flash = within(screen.getByTestId('half-first')).getByTestId('tap-flash');
    expect(flash.dataset.cue).toBe('3');
    act(() => fireEvent.click(screen.getByTestId('half-first')));
    expect(onTap).toHaveBeenCalledExactlyOnceWith('first');
  });

  it('says it in French', () => {
    renderWithPorts(<ScoreHalf half={top} flash={0} onTap={vi.fn()} />, {
      deviceLanguages: ['fr'],
    });
    expect(screen.getByText(fr['scoring.badminton.games'].replace('{count}', '1'))).toBeTruthy();
    expect(screen.getByTestId('serving').textContent).toBe(fr['scoring.pad.serving']);
    // getByText normalises the node's no-break space to a plain one, not the matcher's (docs/i18n-glossary.md).
    const hint = fr['scoring.badminton.hintLine']
      .replace('{side}', 'A. Sharma')
      .split(String.fromCodePoint(0x00a0))
      .join(' ');
    expect(screen.getByText(hint)).toBeTruthy();
  });
});

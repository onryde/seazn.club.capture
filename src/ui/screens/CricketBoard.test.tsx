import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CricketBoardView } from '@/domain/scoring/cricketPad';
import type { OverChip } from '@/domain/scoring/cricketTypes';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { CricketBoard } from '@/ui/screens/CricketBoard';
import { layout } from '@/ui/theme/tokens';
import { renderWithPorts } from '../../../test/renderWithPorts';

// The cricket board (S2-4 spec §5 rows 2 to 4; plan Task 8): what the scorer reads, from a board written out here, never
// computed by the fold. jsdom cannot see the lime, the caution chips or whether a long name is cut with an ellipsis on the
// phone: those are the device check's (Batch 2's). Heights are the declared ones; that nothing moves on the phone as an
// over fills is Task 19's, on the device.

const BOARD: CricketBoardView = {
  score: {
    team: 'Home CC',
    runs: 25,
    wickets: 3,
    overs: '2',
    innings: { key: 'scoring.cricket.board.innings', vars: { number: 1 } },
    chase: null,
  },
  result: null,
  crease: [
    { id: 'H-p4', name: 'Home Player 4', runs: 12, balls: 7, striker: true },
    { id: 'H-p5', name: 'Home Player 5', runs: 3, balls: 4, striker: false },
  ],
  bowler: { id: 'A-p11', name: 'Away Player 11', figures: '2-0-25-3' },
  over: { number: 3, chips: [] },
  status: null,
};

const chip = (text: string, tone: OverChip['tone']): OverChip => ({ text, tone });

/** Six legal balls and two extras: a wide and a no-ball with a four. */
const EIGHT_CHIPS: readonly OverChip[] = [
  chip('1', 'run'),
  chip('wd', 'extra'),
  chip('·', 'dot'),
  chip('5nb', 'extra'),
  chip('4', 'boundary'),
  chip('W', 'wicket'),
  chip('2', 'run'),
  chip('6', 'boundary'),
];

const CHASING: CricketBoardView = {
  ...BOARD,
  score: {
    team: 'Away CC',
    runs: 8,
    wickets: 0,
    overs: '0.1',
    innings: { key: 'scoring.cricket.board.innings', vars: { number: 2 } },
    chase: { key: 'scoring.cricket.board.chase.other', count: 11, vars: { runs: 1 } },
  },
  status: { key: 'scoring.cricket.board.freeHit' },
};

const heightOf = (testID: string) => getComputedStyle(screen.getByTestId(testID)).height;

describe('CricketBoard', () => {
  it('the board shows 25/3 (2 ov) and the crease with the striker marked', () => {
    renderWithPorts(<CricketBoard view={BOARD} />);
    expect(screen.getByTestId('board-runs').textContent).toBe('25/3');
    expect(screen.getByTestId('board-overs').textContent).toBe('(2 ov)');
    expect(screen.getByTestId('board-team').textContent).toBe('Home CC');
    expect(screen.getByTestId('board-innings').textContent).toBe('Innings 1');
    const striker = screen.getByTestId('board-batter-first');
    expect(within(striker).getByText('Home Player 4')).toBeTruthy();
    expect(within(striker).getByText('12 (7)')).toBeTruthy();
    expect(within(striker).getByLabelText(en['scoring.cricket.board.onStrike'])).toBeTruthy();
    const other = screen.getByTestId('board-batter-second');
    expect(within(other).getByText('Home Player 5')).toBeTruthy();
    expect(within(other).getByText('3 (4)')).toBeTruthy();
    expect(within(other).queryByTestId('on-strike')).toBeNull();
    const bowler = screen.getByTestId('board-bowler');
    expect(within(bowler).getByText('Away Player 11')).toBeTruthy();
    expect(within(bowler).getByText('2-0-25-3')).toBeTruthy();
    expect(screen.getByText('Over 3')).toBeTruthy();
    expect(screen.queryAllByTestId('over-chip')).toHaveLength(0);
  });

  // T19 D6: at a result the crease holds the batters left not out, none on strike; an all-out side leaves one, so the
  // second row is the same empty row as before a pair is picked.
  it('a result board names both not-out batters with no striker mark, and the bowler beside them', () => {
    const view: CricketBoardView = {
      ...BOARD,
      crease: [
        { id: 'A-p1', name: 'Away Player 1', runs: 5, balls: 2, striker: false },
        { id: 'A-p2', name: 'Away Player 2', runs: 4, balls: 1, striker: false },
      ],
    };
    renderWithPorts(<CricketBoard view={view} />);
    const first = screen.getByTestId('board-batter-first');
    expect(within(first).getByText('Away Player 1')).toBeTruthy();
    expect(within(first).getByText('5 (2)')).toBeTruthy();
    const second = screen.getByTestId('board-batter-second');
    expect(within(second).getByText('Away Player 2')).toBeTruthy();
    expect(within(second).getByText('4 (1)')).toBeTruthy();
    expect(screen.queryByTestId('on-strike')).toBeNull();
    expect(within(screen.getByTestId('board-bowler')).getByText('Away Player 11')).toBeTruthy();
  });

  it('a lone not-out batter fills the first row and leaves the second empty', () => {
    const view: CricketBoardView = {
      ...BOARD,
      crease: [{ id: 'A-p1', name: 'Away Player 1', runs: 2, balls: 2, striker: false }, null],
    };
    renderWithPorts(<CricketBoard view={view} />);
    expect(within(screen.getByTestId('board-batter-first')).getByText('2 (2)')).toBeTruthy();
    expect(screen.getByTestId('board-batter-second').textContent).toBe('');
    expect(screen.queryByTestId('on-strike')).toBeNull();
    expect(heightOf('board-batter-second')).toBe(`${layout.creaseRow}px`);
  });

  it('this over’s deliveries in order, a free hit and the chase', () => {
    renderWithPorts(
      <CricketBoard view={{ ...CHASING, over: { number: 1, chips: EIGHT_CHIPS } }} />,
    );
    expect(screen.getAllByTestId('over-chip').map((one) => one.textContent)).toEqual([
      '1',
      'wd',
      '·',
      '5nb',
      '4',
      'W',
      '2',
      '6',
    ]);
    expect(screen.getByTestId('board-chase').textContent).toBe('Need 1 off 11 balls');
    expect(screen.getByTestId('board-status').textContent).toBe('Free hit');
  });

  it.each([
    ['an empty over', BOARD],
    ['a six-ball over with two extras', { ...CHASING, over: { number: 1, chips: EIGHT_CHIPS } }],
    ['no innings and nobody at the crease', { ...BOARD, score: null, crease: null, bowler: null }],
  ] as const)('each board region’s height is its token, with %s', (_, view) => {
    renderWithPorts(<CricketBoard view={view} />);
    expect(heightOf('board-score')).toBe(`${layout.scorePanel}px`);
    expect(heightOf('board-batter-first')).toBe(`${layout.creaseRow}px`);
    expect(heightOf('board-batter-second')).toBe(`${layout.creaseRow}px`);
    expect(heightOf('board-bowler')).toBe(`${layout.creaseRow}px`);
    expect(heightOf('board-over')).toBe(`${layout.overStrip}px`);
    for (const one of screen.queryAllByTestId('over-chip')) {
      expect(getComputedStyle(one).width).toBe(`${layout.overChip}px`);
    }
  });

  // T19 device run D1 (device-only): on the phone the overs read "(1", "(2", "(10" at every whole over, the rest of the
  // line cut, while "(0.5 ov)" read whole. The label now takes a fixed box at least as wide as the widest overs
  // (`layout.boardOvers`, cricketFit.test.ts) and never shrinks, so its width does not hang on how a whole over's
  // shorter text is measured; it keeps the score's baseline. That the cut is gone is the device check's.
  it.each(['0.5', '1', '10', '189.5'])(
    'the overs (%s) sit in their fixed box, which never shrinks',
    (overs) => {
      renderWithPorts(<CricketBoard view={{ ...BOARD, score: { ...BOARD.score!, overs } }} />);
      const label = getComputedStyle(screen.getByTestId('board-overs'));
      expect([label.minWidth, label.flexShrink]).toEqual([`${layout.boardOvers}px`, '0']);
    },
  );

  it.each([
    ['en', en],
    ['es', es],
    ['fr', fr],
    ['nl', nl],
  ] as const)('the four languages render the board: %s', (language, words) => {
    renderWithPorts(<CricketBoard view={CHASING} />, { deviceLanguages: [language] });
    const fill = (key: string, vars: Record<string, string | number>) =>
      Object.entries(vars).reduce(
        (out, [name, value]) => out.replace(`{${name}}`, String(value)),
        (words as Record<string, string>)[key] ?? key,
      );
    expect(screen.getByTestId('board-chase').textContent).toBe(
      fill('scoring.cricket.board.chase.other', { runs: 1, count: 11 }),
    );
    expect(screen.getByTestId('board-innings').textContent).toBe(
      fill('scoring.cricket.board.innings', { number: 2 }),
    );
    expect(screen.getByTestId('board-overs').textContent).toBe(
      fill('scoring.cricket.board.overs', { overs: '0.1' }),
    );
    expect(screen.getByTestId('board-status').textContent).toBe(
      words['scoring.cricket.board.freeHit'],
    );
    expect(screen.getByLabelText(words['scoring.cricket.board.onStrike'])).toBeTruthy();
    expect(screen.getByText(fill('scoring.cricket.board.over', { number: 3 }))).toBeTruthy();
  });

  it('a tap on the crease opens Players when the screen offers it, and is no button otherwise', () => {
    const open = vi.fn<() => void>();
    const { unmount } = renderWithPorts(<CricketBoard view={BOARD} onOpenPlayers={open} />);
    fireEvent.click(
      screen.getByRole('button', { name: en['scoring.cricket.rules.players.label'] }),
    );
    expect(open).toHaveBeenCalledTimes(1);
    unmount();
    renderWithPorts(<CricketBoard view={BOARD} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('a tap on the score opens Players too; a screen reader still reads the score, and names one button', () => {
    const open = vi.fn<() => void>();
    renderWithPorts(<CricketBoard view={BOARD} onOpenPlayers={open} />);
    fireEvent.click(screen.getByTestId('board-runs'));
    expect(open).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByTestId('board-score').getAttribute('role')).toBeNull();
  });
});

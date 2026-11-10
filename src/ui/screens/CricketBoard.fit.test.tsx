import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CricketBoardView } from '@/domain/scoring/cricketPad';
import type { OverChip } from '@/domain/scoring/cricketTypes';
import { CricketBoard } from '@/ui/screens/CricketBoard';
import { layOut } from '../../../test/layOut';
import { renderWithPorts } from '../../../test/renderWithPorts';

// The board gives way above the keys (T19 fix 5, Part 3): the room is measured (onLayout), never the screen's class. The
// heights below are the rungs' own needs from the ruling's order: 285 as designed, 277 with the gaps tight, 213 without
// the chip strip, 191 with the chase joined to the innings line. jsdom lays nothing out, so the pixels, and that no row
// is drawn over the keys on the phone, are the device check's.

const chip = (text: string): OverChip => ({ text, tone: 'run' });
const SIX = ['1', '·', '4', '2', '·', '1'].map(chip);
const TEN = [...SIX, ...['wd', '1', '5nb', 'W'].map(chip)];

const BOARD: CricketBoardView = {
  score: {
    team: 'Away CC',
    runs: 8,
    wickets: 0,
    overs: '0.1',
    innings: { key: 'scoring.cricket.board.innings', vars: { number: 2 } },
    chase: { key: 'scoring.cricket.board.chase.other', count: 11, vars: { runs: 1 } },
  },
  result: null,
  crease: [
    { id: 'a', name: 'Away Player 1', runs: 2, balls: 3, striker: true },
    { id: 'b', name: 'Away Player 2', runs: 0, balls: 0, striker: false },
  ],
  bowler: { id: 'h', name: 'Christopher Alexander Fitzwilliam-Montague', figures: '0.2-0-1-0' },
  over: { number: 1, chips: SIX },
  status: null,
};

function measured(view: CricketBoardView, size: { width: number; height: number } | null) {
  renderWithPorts(<CricketBoard view={view} />);
  if (size !== null) layOut(screen.getByTestId('cricket-board'), size);
}
const stripShown = () => screen.queryByTestId('board-over') !== null;
const joined = () => screen.queryByTestId('board-chase') === null;
const gap = () => getComputedStyle(screen.getByTestId('cricket-board')).getPropertyValue('gap');

describe('the board gives way to the room the keys leave', () => {
  it('draws as designed before it is measured, and with all the room it needs', () => {
    measured(BOARD, null);
    expect([stripShown(), joined(), gap()]).toEqual([true, false, '8px']);
  });

  it('285 dp: everything, gaps of 8', () => {
    measured(BOARD, { width: 288, height: 285 });
    expect([stripShown(), joined(), gap()]).toEqual([true, false, '8px']);
  });

  it('284 to 277 dp: the gaps tighten first, and nothing else', () => {
    measured(BOARD, { width: 288, height: 284 });
    expect([stripShown(), joined(), gap()]).toEqual([true, false, '4px']);
  });

  it('276 to 213 dp: the chip strip hides next, the chase line still its own', () => {
    measured(BOARD, { width: 288, height: 276 });
    expect([stripShown(), joined(), gap()]).toEqual([false, false, '4px']);
  });

  it('below 213 dp: the chase joins the innings line, and the score, team and crease stay', () => {
    measured(BOARD, { width: 288, height: 212 });
    expect([stripShown(), joined()]).toEqual([false, true]);
    expect(screen.getByTestId('board-innings').textContent).toBe('Innings 2 · Need 1 off 11 balls');
    expect(screen.getByTestId('board-team').textContent).toBe('Away CC');
    expect(screen.getByTestId('board-runs').textContent).toBe('8/0');
    expect(screen.getByTestId('board-batter-first')).toBeTruthy();
    expect(screen.getByTestId('board-batter-second')).toBeTruthy();
    expect(screen.getByTestId('board-bowler')).toBeTruthy();
  });

  it('with no chase the joined line is the innings alone', () => {
    measured({ ...BOARD, score: { ...BOARD.score!, chase: null } }, { width: 288, height: 100 });
    expect(screen.getByTestId('board-innings').textContent).toBe('Innings 2');
  });

  it('an over of ten deliveries needs two rows: at 300 dp the strip is the first thing to go', () => {
    measured({ ...BOARD, over: { number: 1, chips: TEN } }, { width: 288, height: 300 });
    expect(stripShown()).toBe(false);
  });

  it('a board that regains room draws the strip again', () => {
    measured(BOARD, { width: 288, height: 200 });
    expect(stripShown()).toBe(false);
    layOut(screen.getByTestId('cricket-board'), { width: 288, height: 300 });
    expect([stripShown(), joined()]).toEqual([true, false]);
  });

  it('is clipped at its own edge, so nothing of it is drawn past it and over the keys', () => {
    measured(BOARD, { width: 288, height: 100 });
    expect(
      getComputedStyle(screen.getByTestId('cricket-board')).getPropertyValue('overflow-x'),
    ).toBe('hidden');
  });
});

import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CricketBoardView } from '@/domain/scoring/cricketPad';
import type { OverChip } from '@/domain/scoring/cricketTypes';
import { CricketBoard } from '@/ui/screens/CricketBoard';
import { layOut } from '../../../test/layOut';
import { renderWithPorts } from '../../../test/renderWithPorts';

// The board gives way above the keys (T19 fix 5, Part 3): the room is measured (onLayout), never the screen's class. The
// heights below are the rungs' own needs from the order of T19 fix 6: 285 as designed, 277 with the gaps tight, 255 with
// the chase joined to the innings line, 191 without the chip strip, 171 with the score compact. jsdom lays nothing out, so the pixels, and that no row
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
  summary: null,
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

  it('276 to 255 dp: the chase joins the innings line next, and the over’s chips stay', () => {
    measured(BOARD, { width: 288, height: 276 });
    expect([stripShown(), joined(), gap()]).toEqual([true, true, '4px']);
  });

  // The owner's phone (NE2211, 360 × 804, uiautomator): the board had 269 dp and drew no chips.
  it('269 dp at 328 wide: the owner’s phone shows its chips, with the chase joined', () => {
    measured(BOARD, { width: 328, height: 269 });
    expect([stripShown(), joined()]).toEqual([true, true]);
    expect(screen.getAllByTestId('over-chip')).toHaveLength(6);
    expect(screen.getByTestId('board-innings').textContent).toBe('Innings 2 (Need 1 off 11 balls)');
    expect(screen.getByTestId('board-runs').textContent).toBe('8/0');
  });

  it('below 255 dp: the chip strip hides, the chase still joined, and the score, team and crease stay', () => {
    measured(BOARD, { width: 288, height: 212 });
    expect([stripShown(), joined()]).toEqual([false, true]);
    expect(screen.getByTestId('board-innings').textContent).toBe('Innings 2 (Need 1 off 11 balls)');
    expect(screen.getByTestId('board-team').textContent).toBe('Away CC');
    expect(screen.getByTestId('board-runs').textContent).toBe('8/0');
    expect(screen.getByTestId('board-batter-first')).toBeTruthy();
    expect(screen.getByTestId('board-batter-second')).toBeTruthy();
    expect(screen.getByTestId('board-bowler')).toBeTruthy();
  });

  it('180 dp (320 wide): the compact rung (171 dp) draws the score in the smaller face, and the crease stays', () => {
    measured(BOARD, { width: 288, height: 180 });
    expect([stripShown(), joined()]).toEqual([false, true]);
    expect(screen.getByTestId('board-runs').textContent).toBe('8/0');
    // The role's size is the proof the smaller face is drawn: tally's 46 against scoreCompact's 64.
    expect(getComputedStyle(screen.getByTestId('board-runs')).fontSize).toBe('46px');
    expect(screen.getByTestId('board-bowler')).toBeTruthy();
  });

  it('191 dp keeps the full-size score; the compact rung is for 190 and below', () => {
    measured(BOARD, { width: 288, height: 191 });
    expect(getComputedStyle(screen.getByTestId('board-runs')).fontSize).toBe('64px');
  });

  it('with no chase the joined line is the innings alone', () => {
    measured({ ...BOARD, score: { ...BOARD.score!, chase: null } }, { width: 288, height: 100 });
    expect(screen.getByTestId('board-innings').textContent).toBe('Innings 2');
  });

  // The owner's phone (build 982, NE2211 at 360 x 804): ten deliveries, 269 dp. One row above the keys: the last six.
  it('ten deliveries on a live board: exactly the last six, in order, labelled, and the strip stays at 269 dp', () => {
    measured({ ...BOARD, over: { number: 1, chips: TEN } }, { width: 328, height: 269 });
    expect(stripShown()).toBe(true);
    expect(screen.getAllByTestId('over-chip-text').map((one) => one.textContent)).toEqual([
      '·',
      '1',
      'wd',
      '1',
      '5nb',
      'W',
    ]);
    expect(screen.getByTestId('board-over').textContent).toContain('Over 1 · last 6 of 10');
  });

  it('seven deliveries at 328 dp wide fit one row (7 x 40 + 6 x 4 = 304): all seven, the plain label', () => {
    const seven = [...SIX, chip('wd')];
    measured({ ...BOARD, over: { number: 1, chips: seven } }, { width: 328, height: 269 });
    expect(screen.getAllByTestId('over-chip')).toHaveLength(7);
    expect(screen.getByTestId('board-over').textContent).not.toContain('last');
    expect(screen.getByTestId('board-over').textContent).toContain('Over 1');
  });

  it('seven deliveries at 288 dp do not fit (6 a row): the last six', () => {
    const seven = [...SIX, chip('wd')];
    measured({ ...BOARD, over: { number: 1, chips: seven } }, { width: 288, height: 269 });
    expect(screen.getAllByTestId('over-chip')).toHaveLength(6);
    expect(screen.getByTestId('board-over').textContent).toContain('last 6 of 7');
  });

  it('a result board keeps every chip, wrapping, and the plain label', () => {
    measured(
      {
        ...BOARD,
        over: { number: 1, chips: TEN },
        result: [
          { team: 'A', figures: '1/0', overs: '1' },
          { team: 'B', figures: '2/0', overs: '1' },
        ],
      },
      { width: 328, height: 400 },
    );
    expect(screen.getAllByTestId('over-chip')).toHaveLength(10);
    expect(screen.getByTestId('board-over').textContent).not.toContain('last');
  });

  it('the label follows the language', () => {
    renderWithPorts(<CricketBoard view={{ ...BOARD, over: { number: 1, chips: TEN } }} />, {
      deviceLanguages: ['nl'],
    });
    layOut(screen.getByTestId('cricket-board'), { width: 328, height: 300 });
    expect(screen.getByTestId('board-over').textContent).toContain('Over 1 · laatste 6 van 10');
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

  // Round 1 of the review: the Free hit cue is not the strip's. At 640 dp the strip is gone (194 left for the board), and
  // the caption still shows.
  it('a free hit still shows when the strip hides, at 320 × 640 and 360 × 640', () => {
    for (const width of [288, 328]) {
      const { unmount } = renderWithPorts(
        <CricketBoard view={{ ...BOARD, status: { key: 'scoring.cricket.board.freeHit' } }} />,
      );
      layOut(screen.getByTestId('cricket-board'), { width, height: 640 - 446 });
      expect(stripShown()).toBe(false);
      expect(screen.getByTestId('board-status').textContent).toBe('Free hit');
      unmount();
    }
  });

  it('the caption costs height only while a free hit is due: 277 dp keeps the strip without one, not with', () => {
    measured(BOARD, { width: 288, height: 277 });
    expect(stripShown()).toBe(true);
    expect(screen.queryByTestId('board-status')).toBeNull();
  });

  it('a result’s board keeps its strip however short the measured room', () => {
    measured(
      {
        ...BOARD,
        result: [
          { team: 'A', figures: '1/0', overs: '1' },
          { team: 'B', figures: '2/0', overs: '1' },
        ],
      },
      { width: 288, height: 60 },
    );
    expect(stripShown()).toBe(true);
  });

  // Owner, 2026-11-10: "may be use some space between undone message, just keep the scoring number little bit below?"
  describe('spare height goes under the strip, against the keys (T20 fix 12)', () => {
    const spacer = () => screen.queryByTestId('board-spare-end') !== null;
    const top = () => screen.queryByTestId('board-spare') !== null;

    it('300 dp (285 needed): the content sits against the keys', () => {
      measured(BOARD, { width: 288, height: 300 });
      expect(spacer()).toBe(true);
    });

    it('exactly what it needs, or less: the score stays at the top and the bottom clips', () => {
      measured(BOARD, { width: 288, height: 285 });
      expect(spacer()).toBe(false);
      layOut(screen.getByTestId('cricket-board'), { width: 288, height: 100 });
      expect(spacer()).toBe(false);
    });

    // A free hit due adds 16 and a gap: rung 2 asks 255 + 20 = 275.
    it('a free hit due is counted in the spare: 295 dp has 20 over, 275 none', () => {
      const view = { ...BOARD, status: { key: 'scoring.cricket.board.freeHit' } } as const;
      measured(view, { width: 288, height: 295 });
      expect(spacer()).toBe(true);
      layOut(screen.getByTestId('cricket-board'), { width: 288, height: 275 });
      expect(spacer()).toBe(false);
    });

    // The strip-less joined rung needs 191 with a gap of 4: the spacer comes with a spare of 4, not 3.
    it('a spare under the board’s gap draws no spacer (194 dp: 3), the gap itself does (195 dp: 4)', () => {
      measured(BOARD, { width: 288, height: 194 });
      expect(spacer()).toBe(false);
      layOut(screen.getByTestId('cricket-board'), { width: 288, height: 195 });
      expect(spacer()).toBe(true);
    });

    // Owner, 2026-11-10, build 1002: the score is the board's first row; no spacer ever stands above it.
    it('a large spare goes below the strip and none above the score', () => {
      measured(BOARD, { width: 288, height: 363 });
      expect(spacer()).toBe(true);
      expect(top()).toBe(false);
      const board = screen.getByTestId('cricket-board');
      expect(board.firstElementChild?.getAttribute('data-testid')).toBe('board-score');
    });

    it('14 dp spare is drawn below too, and still none above', () => {
      measured(BOARD, { width: 288, height: 269 });
      expect([spacer(), top()]).toEqual([true, false]);
    });

    // The NE2211 after fix 12: 269.3 + 16 + 8 = 293.3 dp, rung 1 with 8.3 spare.
    it('293.3 dp, the owner’s phone with no strip above: the score first, the spare below', () => {
      measured(BOARD, { width: 288, height: 293.3 });
      expect([spacer(), top()]).toEqual([true, false]);
    });

    it('unmeasured, and a result’s board, keep their top alignment', () => {
      measured(BOARD, null);
      expect(spacer()).toBe(false);
    });

    it('a result’s board keeps its top alignment however tall the room', () => {
      measured(
        {
          ...BOARD,
          result: [
            { team: 'A', figures: '1/0', overs: '1' },
            { team: 'B', figures: '2/0', overs: '1' },
          ],
        },
        { width: 288, height: 400 },
      );
      expect(spacer()).toBe(false);
    });
  });
});

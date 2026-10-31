import { describe, expect, it, vi } from 'vitest';
import type { PadSide } from '@/domain/scoring/padView';
import {
  createFakeBadmintonPad,
  DOUBLES_SAMPLE,
  SINGLES_SAMPLE,
  type FakeBadmintonPad,
} from '@/services/fakeBadmintonPad';

const display = (pad: FakeBadmintonPad) => pad.snapshot().display;
const points = (pad: FakeBadmintonPad) => display(pad).points;
const rallies = (pad: FakeBadmintonPad, ...sides: PadSide[]) => {
  for (const side of sides) expect(pad.rally(side)).toEqual({ ok: true });
};
const times = (count: number, side: PadSide): PadSide[] =>
  Array.from({ length: count }, () => side);
/** Game 1 to the first side, 21-0, through the fake's own rallies. */
const firstWinsAGame = (pad: FakeBadmintonPad) => rallies(pad, ...times(21, 'first'));

describe('the fake badminton pad: a preview of the S2 design, not scoring rules', () => {
  it('starts game 1 of a best of 3 at 0-0, the first side serving from the right, nothing to undo', () => {
    const pad = createFakeBadmintonPad(SINGLES_SAMPLE);
    expect(display(pad)).toEqual({
      sides: { first: { players: ['A. Sharma'] }, second: { players: ['L. Chen'] } },
      points: { first: 0, second: 0 },
      finished: [],
      server: 'first',
      court: 'right',
      game: 1,
      // The preview's rules (the controller's brief, 2026-10-31): best of 3, 21 won by 2, capped at 30, interval at 11.
      rules: { bestOf: 3, points: 21, winBy: 2, cap: 30, intervalPoint: 11 },
      phase: 'pre',
      sanctions: [],
      lastTap: null,
      undoable: false,
      awaitingEnding: false,
    });
    expect(pad.snapshot().card).toBeNull();
    expect(pad.snapshot().sync).toEqual({ kind: 'synced' });
  });

  it('gives a rally to its side, makes it the server, and starts the game', () => {
    const pad = createFakeBadmintonPad(SINGLES_SAMPLE);
    rallies(pad, 'second');
    expect(display(pad)).toMatchObject({
      points: { first: 0, second: 1 },
      server: 'second',
      phase: 'live',
      lastTap: { kind: 'rally', side: 'second', won: 'none', game: 1 },
      undoable: true,
    });
  });

  it('serves from the right on the server’s even score and the left on its odd one', () => {
    const pad = createFakeBadmintonPad(SINGLES_SAMPLE);
    const courts: string[] = [];
    for (const side of ['first', 'first', 'second', 'second', 'second', 'first'] as const) {
      rallies(pad, side);
      courts.push(
        `${display(pad).server}:${points(pad)[display(pad).server]}:${display(pad).court}`,
      );
    }
    expect(courts).toEqual([
      'first:1:left',
      'first:2:right',
      'second:1:left',
      'second:2:right',
      'second:3:left',
      'first:3:left',
    ]);
  });

  it('wins a game only by two clear points', () => {
    const pad = createFakeBadmintonPad(SINGLES_SAMPLE);
    expect(pad.setScore(20, 20)).toEqual({ ok: true });
    rallies(pad, 'first');
    expect(display(pad)).toMatchObject({
      points: { first: 21, second: 20 },
      phase: 'live',
      game: 1,
    });
    rallies(pad, 'second', 'first', 'first');
    expect(display(pad)).toMatchObject({
      points: { first: 0, second: 0 },
      // 20-20, then 21-20, 21-21, 22-21 and 23-21.
      finished: [{ points: { first: 23, second: 21 }, winner: 'first' }],
      game: 2,
      phase: 'betweenGames',
      server: 'first',
      lastTap: { kind: 'rally', side: 'first', won: 'game', game: 1 },
    });
  });

  it('caps a game at 30: 30-29 wins it', () => {
    const pad = createFakeBadmintonPad(SINGLES_SAMPLE);
    pad.setScore(29, 29);
    rallies(pad, 'second');
    expect(display(pad)).toMatchObject({
      finished: [{ points: { first: 29, second: 30 }, winner: 'second' }],
      phase: 'betweenGames',
    });
  });

  it('lets the winner of a game serve first in the next', () => {
    const pad = createFakeBadmintonPad(SINGLES_SAMPLE);
    pad.setScore(19, 20);
    rallies(pad, 'second');
    expect(display(pad)).toMatchObject({ server: 'second', court: 'right', game: 2 });
  });

  it('decides a best of 3 at two games, keeping the final score, and takes no more rallies', () => {
    const pad = createFakeBadmintonPad(SINGLES_SAMPLE);
    firstWinsAGame(pad);
    pad.setScore(20, 15);
    rallies(pad, 'first');
    expect(display(pad)).toMatchObject({
      points: { first: 21, second: 15 },
      finished: [
        { points: { first: 21, second: 0 }, winner: 'first' },
        { points: { first: 21, second: 15 }, winner: 'first' },
      ],
      game: 2,
      phase: 'decided',
      lastTap: { kind: 'rally', side: 'first', won: 'match', game: 2 },
    });
    expect(pad.rally('second')).toEqual({ ok: false, refusal: 'notNow' });
    expect(points(pad)).toEqual({ first: 21, second: 15 });
  });

  it('plays a third game at one game all', () => {
    const pad = createFakeBadmintonPad(SINGLES_SAMPLE);
    firstWinsAGame(pad);
    rallies(pad, ...times(21, 'second'));
    expect(display(pad)).toMatchObject({
      finished: [
        { points: { first: 21, second: 0 }, winner: 'first' },
        { points: { first: 0, second: 21 }, winner: 'second' },
      ],
      game: 3,
      phase: 'betweenGames',
    });
  });
});

// Owner ruling 16 (2026-10-31): each half's bottom row shows its side's score in every finished game. The fake keeps
// them as it replays, so an Undo that reopens a game takes its score away.
describe('the finished games’ scores', () => {
  const finished = (pad: FakeBadmintonPad) => display(pad).finished;

  it('has none in game 1, and never counts the game under way', () => {
    const pad = createFakeBadmintonPad(SINGLES_SAMPLE);
    rallies(pad, ...times(20, 'first'));
    expect(finished(pad)).toEqual([]);
  });

  it('keeps a set score’s game as it finished, not as it was set', () => {
    const pad = createFakeBadmintonPad(SINGLES_SAMPLE);
    pad.setScore(19, 15);
    rallies(pad, 'second', 'first', 'first');
    expect(finished(pad)).toEqual([{ points: { first: 21, second: 16 }, winner: 'first' }]);
    expect(pad.setScore(4, 2)).toEqual({ ok: true });
    expect(finished(pad)).toEqual([{ points: { first: 21, second: 16 }, winner: 'first' }]);
  });

  it('takes a game’s score away when Undo reopens it across the game boundary', () => {
    const pad = createFakeBadmintonPad(SINGLES_SAMPLE);
    firstWinsAGame(pad);
    rallies(pad, ...times(21, 'second'));
    expect(finished(pad)).toHaveLength(2);
    expect(pad.undo()).toEqual({ ok: true });
    expect(display(pad)).toMatchObject({
      points: { first: 0, second: 20 },
      finished: [{ points: { first: 21, second: 0 }, winner: 'first' }],
      game: 2,
      phase: 'live',
    });
    rallies(pad, 'second');
    expect(finished(pad)).toEqual([
      { points: { first: 21, second: 0 }, winner: 'first' },
      { points: { first: 0, second: 21 }, winner: 'second' },
    ]);
  });

  it('shows every game once the match is decided, and takes the last away when Undo reopens it', () => {
    const pad = createFakeBadmintonPad(SINGLES_SAMPLE);
    firstWinsAGame(pad);
    rallies(pad, ...times(21, 'second'));
    pad.setScore(20, 19);
    rallies(pad, 'first');
    expect(display(pad)).toMatchObject({
      points: { first: 21, second: 19 },
      finished: [
        { points: { first: 21, second: 0 }, winner: 'first' },
        { points: { first: 0, second: 21 }, winner: 'second' },
        { points: { first: 21, second: 19 }, winner: 'first' },
      ],
      game: 3,
      phase: 'decided',
    });
    pad.undo();
    expect(display(pad)).toMatchObject({
      points: { first: 20, second: 19 },
      phase: 'betweenGames',
    });
    expect(finished(pad)).toHaveLength(2);
  });

  it('gives a game a disqualification ended no score: it was not finished', () => {
    const pad = createFakeBadmintonPad(SINGLES_SAMPLE);
    firstWinsAGame(pad);
    rallies(pad, 'second', 'second');
    pad.sanction({ side: 'second', level: 'disqualification', person: 'L. Chen' });
    expect(pad.recordEnding()).toEqual({ ok: true });
    expect(display(pad)).toMatchObject({
      points: { first: 0, second: 2 },
      finished: [{ points: { first: 21, second: 0 }, winner: 'first' }],
      phase: 'decided',
    });
  });

  it('counts the doubles sample’s rallies from someone else in the game under way, not as a finished one', () => {
    const pad = createFakeBadmintonPad(DOUBLES_SAMPLE);
    expect(finished(pad)).toEqual([]);
    rallies(pad, ...times(18, 'first'));
    expect(finished(pad)).toEqual([{ points: { first: 21, second: 1 }, winner: 'first' }]);
  });
});

describe('Set score: only between games, before a game’s first rally', () => {
  it('sets the points before the match’s first rally, which stays the next tap', () => {
    const pad = createFakeBadmintonPad(SINGLES_SAMPLE);
    expect(pad.setScore(5, 3)).toEqual({ ok: true });
    expect(display(pad)).toMatchObject({
      points: { first: 5, second: 3 },
      phase: 'pre',
      lastTap: { kind: 'setScore', first: 5, second: 3 },
    });
  });

  it('sets the points between games', () => {
    const pad = createFakeBadmintonPad(SINGLES_SAMPLE);
    firstWinsAGame(pad);
    expect(pad.setScore(4, 6)).toEqual({ ok: true });
    expect(display(pad)).toMatchObject({ points: { first: 4, second: 6 }, game: 2 });
  });

  it('is refused once a game is under way, and changes nothing', () => {
    const pad = createFakeBadmintonPad(SINGLES_SAMPLE);
    rallies(pad, 'first');
    expect(pad.setScore(5, 3)).toEqual({ ok: false, refusal: 'notNow' });
    expect(points(pad)).toEqual({ first: 1, second: 0 });
  });

  it.each([
    [Number.NaN, 0],
    [-1, 0],
    [3.5, 2],
    [31, 0],
    [21, 15],
    [15, 21],
    [30, 29],
    [22, 20],
    [Number.POSITIVE_INFINITY, 0],
  ])('refuses %d-%d, which no game in progress can have', (first, second) => {
    const pad = createFakeBadmintonPad(SINGLES_SAMPLE);
    expect(pad.setScore(first, second)).toEqual({ ok: false, refusal: 'invalidScore' });
    expect(display(pad)).toMatchObject({ points: { first: 0, second: 0 }, lastTap: null });
  });

  it.each([
    [0, 0],
    [20, 20],
    [21, 20],
    [29, 29],
    [0, 20],
  ])('takes %d-%d', (first, second) => {
    expect(createFakeBadmintonPad(SINGLES_SAMPLE).setScore(first, second)).toEqual({ ok: true });
  });
});

describe('Undo: steps back through this phone’s own taps', () => {
  it('takes a rally back and says so', () => {
    const pad = createFakeBadmintonPad(SINGLES_SAMPLE);
    rallies(pad, 'first');
    expect(pad.undo()).toEqual({ ok: true });
    expect(display(pad)).toMatchObject({
      points: { first: 0, second: 0 },
      phase: 'pre',
      lastTap: { kind: 'undone', tap: { kind: 'rally', side: 'first' } },
      undoable: false,
    });
  });

  it('goes further back on each press', () => {
    const pad = createFakeBadmintonPad(SINGLES_SAMPLE);
    rallies(pad, 'first', 'second', 'second');
    pad.undo();
    expect(points(pad)).toEqual({ first: 1, second: 1 });
    pad.undo();
    expect(points(pad)).toEqual({ first: 1, second: 0 });
    expect(display(pad).server).toBe('first');
  });

  it('takes back a game-winning rally into the game it won', () => {
    const pad = createFakeBadmintonPad(SINGLES_SAMPLE);
    pad.setScore(20, 18);
    rallies(pad, 'first');
    pad.undo();
    expect(display(pad)).toMatchObject({
      points: { first: 20, second: 18 },
      finished: [],
      game: 1,
      phase: 'pre',
    });
  });

  it('refuses with nothing of this phone’s to take back', () => {
    const pad = createFakeBadmintonPad(SINGLES_SAMPLE);
    expect(pad.undo()).toEqual({ ok: false, refusal: 'nothingToUndo' });
  });

  it('never takes back a tap already on the sheet from someone else', () => {
    const pad = createFakeBadmintonPad(DOUBLES_SAMPLE);
    const seeded = points(pad);
    expect(seeded).toEqual({ first: 3, second: 1 });
    expect(display(pad).undoable).toBe(false);
    expect(pad.undo()).toEqual({ ok: false, refusal: 'nothingToUndo' });
    rallies(pad, 'second');
    expect(display(pad).undoable).toBe(true);
    expect(pad.undo()).toEqual({ ok: true });
    expect(pad.undo()).toEqual({ ok: false, refusal: 'nothingToUndo' });
    expect(points(pad)).toEqual(seeded);
  });

  it('a new tap after an undo replaces the undone line', () => {
    const pad = createFakeBadmintonPad(SINGLES_SAMPLE);
    rallies(pad, 'first');
    pad.undo();
    rallies(pad, 'second');
    expect(display(pad).lastTap).toEqual({ kind: 'rally', side: 'second', won: 'none', game: 1 });
  });
});

describe('sanctions and the disqualification’s ending', () => {
  it('records a sanction on the person and says so', () => {
    const pad = createFakeBadmintonPad(DOUBLES_SAMPLE);
    expect(pad.sanction({ side: 'first', level: 'warning', person: 'R. Iyer' })).toEqual({
      ok: true,
    });
    expect(display(pad)).toMatchObject({
      sanctions: [{ side: 'first', level: 'warning', person: 'R. Iyer' }],
      lastTap: { kind: 'sanction', side: 'first', level: 'warning', person: 'R. Iyer' },
      awaitingEnding: false,
      undoable: true,
    });
  });

  it('refuses a person who does not play for that side', () => {
    const pad = createFakeBadmintonPad(DOUBLES_SAMPLE);
    expect(pad.sanction({ side: 'first', level: 'warning', person: 'L. Chen' })).toEqual({
      ok: false,
      refusal: 'notNow',
    });
    expect(pad.sanction({ side: 'first', level: 'warning', person: '' })).toEqual({
      ok: false,
      refusal: 'notNow',
    });
    expect(display(pad).sanctions).toEqual([]);
  });

  it('waits for the ending after a disqualification, taking no rally or score', () => {
    const pad = createFakeBadmintonPad(SINGLES_SAMPLE);
    pad.sanction({ side: 'second', level: 'disqualification', person: 'L. Chen' });
    expect(display(pad).awaitingEnding).toBe(true);
    expect(pad.rally('first')).toEqual({ ok: false, refusal: 'notNow' });
    expect(pad.setScore(1, 0)).toEqual({ ok: false, refusal: 'notNow' });
    expect(pad.sanction({ side: 'first', level: 'warning', person: 'A. Sharma' })).toEqual({
      ok: false,
      refusal: 'notNow',
    });
  });

  it('records the ending: the match is decided', () => {
    const pad = createFakeBadmintonPad(SINGLES_SAMPLE);
    rallies(pad, 'first');
    pad.sanction({ side: 'second', level: 'disqualification', person: 'L. Chen' });
    expect(pad.recordEnding()).toEqual({ ok: true });
    expect(display(pad)).toMatchObject({
      phase: 'decided',
      awaitingEnding: false,
      points: { first: 1, second: 0 },
      lastTap: { kind: 'ending', side: 'second', person: 'L. Chen' },
    });
  });

  it('voids the sanction: play goes on as before it', () => {
    const pad = createFakeBadmintonPad(SINGLES_SAMPLE);
    rallies(pad, 'first');
    pad.sanction({ side: 'second', level: 'disqualification', person: 'L. Chen' });
    expect(pad.voidSanction()).toEqual({ ok: true });
    expect(display(pad)).toMatchObject({
      phase: 'live',
      awaitingEnding: false,
      sanctions: [],
      lastTap: {
        kind: 'undone',
        tap: { kind: 'sanction', side: 'second', level: 'disqualification', person: 'L. Chen' },
      },
    });
    rallies(pad, 'second');
  });

  it('has no ending to record or sanction to void without a disqualification waiting', () => {
    const pad = createFakeBadmintonPad(SINGLES_SAMPLE);
    pad.sanction({ side: 'first', level: 'penalty', person: 'A. Sharma' });
    expect(pad.recordEnding()).toEqual({ ok: false, refusal: 'notNow' });
    expect(pad.voidSanction()).toEqual({ ok: false, refusal: 'notNow' });
    expect(display(pad).sanctions).toHaveLength(1);
  });
});

describe('the preview switches and the listeners', () => {
  it('shows a state card and a sync status the dev row picks, over the same match', () => {
    const pad = createFakeBadmintonPad(SINGLES_SAMPLE);
    rallies(pad, 'first');
    pad.preview({ kind: 'updateNeeded', unsent: 2 });
    pad.setSync({ kind: 'offline', count: 2 });
    expect(pad.snapshot()).toMatchObject({
      card: { kind: 'updateNeeded', unsent: 2 },
      sync: { kind: 'offline', count: 2 },
      display: { points: { first: 1, second: 0 } },
    });
    pad.preview(null);
    expect(pad.snapshot().card).toBeNull();
  });

  it('tells its listeners of a change, keeps one snapshot between changes, and stops on unsubscribe', () => {
    const pad = createFakeBadmintonPad(SINGLES_SAMPLE);
    const heard = vi.fn();
    const stop = pad.subscribe(heard);
    const before = pad.snapshot();
    expect(pad.snapshot()).toBe(before);
    rallies(pad, 'first');
    expect(heard).toHaveBeenCalledTimes(1);
    expect(pad.snapshot()).not.toBe(before);
    pad.undo();
    pad.undo();
    expect(heard).toHaveBeenCalledTimes(2);
    stop();
    rallies(pad, 'first');
    expect(heard).toHaveBeenCalledTimes(2);
  });
});

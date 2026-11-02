import { describe, expect, it, vi } from 'vitest';
import type { PadSide } from '@/domain/scoring/padView';
import {
  createFakeBadmintonPad,
  DOUBLES_SAMPLE,
  SINGLES_SAMPLE,
  type FakeBadmintonPad,
} from '@/services/fakeBadmintonPad';

const display = (pad: FakeBadmintonPad) => pad.snapshot().display;
/** The singles sample started as the Start screen starts it, `server` serving first (owner, 2026-11-01, option A). */
const started = (server: PadSide = 'first') => {
  const pad = createFakeBadmintonPad(SINGLES_SAMPLE);
  expect(pad.start(server)).toEqual({ ok: true });
  return pad;
};
/** The start's entry, as the fake records it: this phone's, game 1, at 0-0. */
const START_ENTRY = {
  did: { kind: 'start', server: 'first' },
  game: 1,
  after: { first: 0, second: 0 },
  own: true,
  undone: false,
  sending: false,
} as const;
const points = (pad: FakeBadmintonPad) => display(pad).points;
const rallies = (pad: FakeBadmintonPad, ...sides: PadSide[]) => {
  for (const side of sides) expect(pad.rally(side)).toEqual({ ok: true });
};
const times = (count: number, side: PadSide): PadSide[] =>
  Array.from({ length: count }, () => side);
/** Game 1 to the first side, 21-0, through the fake's own rallies. */
const firstWinsAGame = (pad: FakeBadmintonPad) => rallies(pad, ...times(21, 'first'));

describe('the fake badminton pad: a preview of the S2 design, not scoring rules', () => {
  it('begins not started: game 1 of a best of 3 at 0-0, nothing to undo (owner, 2026-11-01)', () => {
    const NOT_STARTED = createFakeBadmintonPad(SINGLES_SAMPLE);
    const pad = NOT_STARTED;
    expect(display(pad)).toEqual({
      sides: { first: { players: ['A. Sharma'] }, second: { players: ['L. Chen'] } },
      context: {
        competition: 'Spring Open 2026',
        division: 'U15 Boys Singles',
        round: 'Round 1',
        match: 'Match 4',
        sides: ['A. Sharma', 'L. Chen'],
      },
      points: { first: 0, second: 0 },
      finished: [],
      server: 'first',
      court: 'right',
      game: 1,
      // The preview's rules (the controller's brief, 2026-10-31): best of 3, 21 won by 2, capped at 30, interval at 11.
      rules: { bestOf: 3, points: 21, winBy: 2, cap: 30, intervalPoint: 11 },
      phase: 'notStarted',
      sanctions: [],
      lastTap: null,
      undoable: false,
      awaitingEnding: false,
    });
    expect(pad.snapshot().card).toBeNull();
    expect(pad.snapshot().sync).toEqual({ kind: 'synced' });
  });

  it('gives a rally to its side, makes it the server, and starts the game', () => {
    const pad = started();
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
    const pad = started();
    const courts: string[] = [];
    for (const side of ['first', 'first', 'second', 'second', 'second', 'first'] as const) {
      rallies(pad, side);
      const { server, court } = display(pad);
      courts.push(`${server}:${server === null ? '-' : points(pad)[server]}:${court}`);
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
    const pad = started();
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
    const pad = started();
    pad.setScore(29, 29);
    rallies(pad, 'second');
    expect(display(pad)).toMatchObject({
      finished: [{ points: { first: 29, second: 30 }, winner: 'second' }],
      phase: 'betweenGames',
    });
  });

  it('lets the winner of a game serve first in the next', () => {
    const pad = started();
    pad.setScore(19, 20);
    rallies(pad, 'second');
    expect(display(pad)).toMatchObject({ server: 'second', court: 'right', game: 2 });
  });

  it('decides a best of 3 at two games, keeping the final score, and takes no more rallies', () => {
    const pad = started();
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
    const pad = started();
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
    const pad = started();
    rallies(pad, ...times(20, 'first'));
    expect(finished(pad)).toEqual([]);
  });

  it('keeps a set score’s game as it finished, not as it was set', () => {
    const pad = started();
    pad.setScore(19, 15);
    rallies(pad, 'second', 'first', 'first');
    expect(finished(pad)).toEqual([{ points: { first: 21, second: 16 }, winner: 'first' }]);
    expect(pad.setScore(4, 2)).toEqual({ ok: true });
    expect(finished(pad)).toEqual([{ points: { first: 21, second: 16 }, winner: 'first' }]);
  });

  it('takes a game’s score away when Undo reopens it across the game boundary', () => {
    const pad = started();
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
    const pad = started();
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

  // Owner ruling 18 (2026-10-31, "box with DQ"): the game in play when a disqualification ends the match gets a box,
  // its points then, naming the side disqualified; no side won it on points.
  it('gives the game a disqualification ended a box: its points then, and the side disqualified', () => {
    const pad = started();
    firstWinsAGame(pad);
    rallies(pad, 'second', 'second');
    pad.sanction({ side: 'second', level: 'disqualification', person: 'L. Chen' });
    expect(finished(pad)).toHaveLength(1);
    expect(pad.recordEnding()).toEqual({ ok: true });
    expect(display(pad)).toMatchObject({
      points: { first: 0, second: 2 },
      finished: [
        { points: { first: 21, second: 0 }, winner: 'first' },
        { points: { first: 0, second: 2 }, disqualified: 'second' },
      ],
      game: 2,
      phase: 'decided',
    });
  });

  it('gives game 1 the box when the match ends in it', () => {
    const pad = started();
    rallies(pad, ...times(9, 'first'), ...times(4, 'second'));
    pad.sanction({ side: 'first', level: 'disqualification', person: 'A. Sharma' });
    pad.recordEnding();
    expect(finished(pad)).toEqual([{ points: { first: 9, second: 4 }, disqualified: 'first' }]);
  });

  it('gives no box while the ending waits, none when the sanction is voided, and takes it away on Undo', () => {
    const pad = started();
    rallies(pad, 'first');
    pad.sanction({ side: 'second', level: 'disqualification', person: 'L. Chen' });
    expect(pad.voidSanction()).toEqual({ ok: true });
    expect(finished(pad)).toEqual([]);
    pad.sanction({ side: 'second', level: 'disqualification', person: 'L. Chen' });
    pad.recordEnding();
    expect(finished(pad)).toHaveLength(1);
    expect(pad.undo()).toEqual({ ok: true });
    expect(display(pad)).toMatchObject({ finished: [], awaitingEnding: true, phase: 'live' });
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
    const pad = started();
    expect(pad.setScore(5, 3)).toEqual({ ok: true });
    expect(display(pad)).toMatchObject({
      points: { first: 5, second: 3 },
      phase: 'pre',
      lastTap: { kind: 'setScore', first: 5, second: 3 },
    });
  });

  it('sets the points between games', () => {
    const pad = started();
    firstWinsAGame(pad);
    expect(pad.setScore(4, 6)).toEqual({ ok: true });
    expect(display(pad)).toMatchObject({ points: { first: 4, second: 6 }, game: 2 });
  });

  it('is refused once a game is under way, and changes nothing', () => {
    const pad = started();
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
    const pad = started();
    expect(pad.setScore(first, second)).toEqual({ ok: false, refusal: 'invalidScore' });
    expect(display(pad)).toMatchObject({
      points: { first: 0, second: 0 },
      lastTap: { kind: 'start', server: 'first' },
    });
  });

  it.each([
    [0, 0],
    [20, 20],
    [21, 20],
    [29, 29],
    [0, 20],
  ])('takes %d-%d', (first, second) => {
    expect(started().setScore(first, second)).toEqual({ ok: true });
  });
});

describe('Undo: steps back through this phone’s own taps', () => {
  it('takes a rally back and says so', () => {
    const pad = started();
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
    const pad = started();
    rallies(pad, 'first', 'second', 'second');
    pad.undo();
    expect(points(pad)).toEqual({ first: 1, second: 1 });
    pad.undo();
    expect(points(pad)).toEqual({ first: 1, second: 0 });
    expect(display(pad).server).toBe('first');
  });

  it('takes back a game-winning rally into the game it won', () => {
    const pad = started();
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
    expect(pad.start('first')).toEqual({ ok: true });
    rallies(pad, 'first');
    expect(pad.undo()).toEqual({ ok: true });
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
    const pad = started();
    rallies(pad, 'first');
    pad.undo();
    rallies(pad, 'second');
    expect(display(pad).lastTap).toEqual({ kind: 'rally', side: 'second', won: 'none', game: 1 });
  });
});

describe('sanctions and the disqualification’s ending', () => {
  // Review M5 (2026-11-01): Void takes back the disqualification waiting, and only when this phone recorded it.
  it('refuses to void a disqualification another scorer recorded, and leaves it waiting', () => {
    const pad = createFakeBadmintonPad({
      ...SINGLES_SAMPLE,
      others: [
        { kind: 'start', server: 'first' },
        { kind: 'sanction', side: 'second', level: 'disqualification', person: 'L. Chen' },
      ],
    });
    expect(display(pad).awaitingEnding).toBe(true);
    expect(pad.voidSanction()).toEqual({ ok: false, refusal: 'nothingToUndo' });
    expect(display(pad).awaitingEnding).toBe(true);
    expect(pad.snapshot().history.map((entry) => entry.undone)).toEqual([false, false]);
  });

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
    const pad = started();
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
    const pad = started();
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
    const pad = started();
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
    const pad = started();
    pad.sanction({ side: 'first', level: 'penalty', person: 'A. Sharma' });
    expect(pad.recordEnding()).toEqual({ ok: false, refusal: 'notNow' });
    expect(pad.voidSanction()).toEqual({ ok: false, refusal: 'notNow' });
    expect(display(pad).sanctions).toHaveLength(1);
  });
});

describe('the preview switches and the listeners', () => {
  it('shows a state card and a sync status the dev row picks, over the same match', () => {
    const pad = started();
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
    const pad = started();
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

// Owner ruling 21 (2026-10-31): History lists every entry on the sheet, an entry Undo voided in its place, with what it
// did when it was recorded. The fake keeps each entry's outcome as recorded; `badmintonHistory` draws it.
describe('the sheet History reads', () => {
  const history = (pad: FakeBadmintonPad) => pad.snapshot().history;

  it('holds nothing before the start', () => {
    expect(history(createFakeBadmintonPad(SINGLES_SAMPLE))).toEqual([]);
  });

  it('records each rally with what it did, its game, the points after it and that this phone recorded it', () => {
    const pad = started();
    rallies(pad, 'first', 'second');
    expect(history(pad)).toEqual([
      START_ENTRY,
      {
        did: { kind: 'rally', side: 'first', won: 'none', game: 1 },
        game: 1,
        after: { first: 1, second: 0 },
        own: true,
        undone: false,
        sending: false,
      },
      {
        did: { kind: 'rally', side: 'second', won: 'none', game: 1 },
        game: 1,
        after: { first: 1, second: 1 },
        own: true,
        undone: false,
        sending: false,
      },
    ]);
  });

  it('keeps a game-winning rally in the game it won, at the game’s final points; the next game’s taps in game 2', () => {
    const pad = started();
    firstWinsAGame(pad);
    expect(pad.setScore(3, 2)).toEqual({ ok: true });
    rallies(pad, 'second');
    expect(history(pad).slice(-3)).toEqual([
      expect.objectContaining({
        did: { kind: 'rally', side: 'first', won: 'game', game: 1 },
        game: 1,
        after: { first: 21, second: 0 },
      }),
      expect.objectContaining({ did: { kind: 'setScore', first: 3, second: 2 }, game: 2 }),
      expect.objectContaining({ game: 2, after: { first: 3, second: 3 } }),
    ]);
  });

  it('leaves an entry Undo voided in its place, as it was recorded, and twice back keeps both', () => {
    const pad = started();
    rallies(pad, 'first', 'first');
    expect(pad.undo()).toEqual({ ok: true });
    expect(pad.undo()).toEqual({ ok: true });
    rallies(pad, 'second');
    expect(history(pad).map((entry) => [entry.after, entry.undone])).toEqual([
      [{ first: 0, second: 0 }, false],
      [{ first: 1, second: 0 }, true],
      [{ first: 2, second: 0 }, true],
      [{ first: 0, second: 1 }, false],
    ]);
  });

  it('marks the doubles sample’s four taps as someone else’s, and this phone’s after them as its own', () => {
    const pad = createFakeBadmintonPad(DOUBLES_SAMPLE);
    rallies(pad, 'second');
    expect(history(pad).map((entry) => [entry.own, entry.after])).toEqual([
      [false, { first: 0, second: 0 }],
      [false, { first: 1, second: 0 }],
      [false, { first: 1, second: 1 }],
      [false, { first: 2, second: 1 }],
      [false, { first: 3, second: 1 }],
      [true, { first: 3, second: 2 }],
    ]);
  });

  it('records a disqualification, its ending, and a voided disqualification in place', () => {
    const pad = started();
    rallies(pad, 'first');
    const sanction = { side: 'second', level: 'disqualification', person: 'L. Chen' } as const;
    expect(pad.sanction(sanction)).toEqual({ ok: true });
    expect(pad.voidSanction()).toEqual({ ok: true });
    expect(pad.sanction(sanction)).toEqual({ ok: true });
    expect(pad.recordEnding()).toEqual({ ok: true });
    expect(history(pad).map((entry) => [entry.did.kind, entry.undone])).toEqual([
      ['start', false],
      ['rally', false],
      ['sanction', true],
      ['sanction', false],
      ['ending', false],
    ]);
    expect(history(pad)[4]).toEqual({
      did: { kind: 'ending', side: 'second', person: 'L. Chen' },
      game: 1,
      after: { first: 1, second: 0 },
      own: true,
      undone: false,
      sending: false,
    });
  });

  it('records nothing for a refused tap', () => {
    const pad = createFakeBadmintonPad(SINGLES_SAMPLE);
    expect(pad.undo()).toEqual({ ok: false, refusal: 'nothingToUndo' });
    expect(pad.rally('first')).toEqual({ ok: false, refusal: 'notNow' });
    expect(pad.start('first')).toEqual({ ok: true });
    rallies(pad, 'first');
    expect(pad.setScore(5, 5).ok).toBe(false);
    expect(history(pad)).toHaveLength(2);
  });
});

describe('the samples’ match context (owner, 2026-11-01)', () => {
  it('names the doubles match’s sides as the match label joins partners', () => {
    expect(createFakeBadmintonPad(DOUBLES_SAMPLE).snapshot().display.context).toEqual({
      competition: 'Riverside Badminton Club Championships 2026',
      division: 'Open Mixed Doubles',
      round: 'Quarter-final',
      match: 'BAD0001',
      sides: ['A. Sharma / R. Iyer', 'L. Chen / M. Wong'],
    });
  });
});

// Owner, 2026-11-01, option A: a match begins not started; Start, with the side picked to serve first, is its first
// entry. Undo takes it back only while nothing follows it, as the web voids no start once anything follows.
describe('the start', () => {
  it('takes no rally, sanction or Set score before it', () => {
    const pad = createFakeBadmintonPad(SINGLES_SAMPLE);
    expect(pad.rally('first')).toEqual({ ok: false, refusal: 'notNow' });
    expect(pad.sanction({ side: 'first', level: 'warning', person: 'A. Sharma' })).toEqual({
      ok: false,
      refusal: 'notNow',
    });
    expect(pad.setScore(1, 0)).toEqual({ ok: false, refusal: 'notNow' });
    expect(pad.snapshot().history).toEqual([]);
  });

  it('starts the match, the side picked serving from the right at 0-0, and Undo can take it back', () => {
    const pad = started('second');
    expect(display(pad)).toMatchObject({
      points: { first: 0, second: 0 },
      server: 'second',
      court: 'right',
      phase: 'pre',
      lastTap: { kind: 'start', server: 'second' },
      undoable: true,
    });
    expect(pad.snapshot().history).toEqual([
      { ...START_ENTRY, did: { kind: 'start', server: 'second' } },
    ]);
  });

  it('refuses a second start (a second call): the first stands', () => {
    const pad = started('second');
    expect(pad.start('first')).toEqual({ ok: false, refusal: 'notNow' });
    expect(display(pad).server).toBe('second');
    expect(pad.snapshot().history).toHaveLength(1);
  });

  it('returns to not started on an Undo right after it, with no line to say it on, and can start again', () => {
    const pad = started('second');
    expect(pad.undo()).toEqual({ ok: true });
    expect(display(pad)).toMatchObject({ phase: 'notStarted', lastTap: null, undoable: false });
    expect(pad.snapshot().history).toEqual([
      { ...START_ENTRY, did: { kind: 'start', server: 'second' }, undone: true },
    ]);
    expect(pad.start('first')).toEqual({ ok: true });
    expect(display(pad)).toMatchObject({ phase: 'pre', server: 'first' });
  });

  it('cannot be undone on its own once anything follows it, an entry Undo took back included', () => {
    const pad = started();
    rallies(pad, 'second');
    expect(pad.undo()).toEqual({ ok: true });
    expect(display(pad)).toMatchObject({
      phase: 'pre',
      lastTap: { kind: 'undone', tap: { kind: 'rally', side: 'second' } },
      undoable: false,
    });
    expect(pad.undo()).toEqual({ ok: false, refusal: 'nothingToUndo' });
    expect(display(pad).phase).toBe('pre');
  });

  it('opens the doubles sample started by its other scorer, never this phone’s to undo', () => {
    const pad = createFakeBadmintonPad(DOUBLES_SAMPLE);
    expect(pad.snapshot().history[0]).toEqual({ ...START_ENTRY, own: false });
    expect(display(pad).phase).toBe('live');
  });

  it('begins the doubles match not started with none of the other scorer’s taps', () => {
    const pad = createFakeBadmintonPad({ ...DOUBLES_SAMPLE, others: [] });
    expect(display(pad)).toMatchObject({ phase: 'notStarted', points: { first: 0, second: 0 } });
    expect(pad.snapshot().history).toEqual([]);
  });
});

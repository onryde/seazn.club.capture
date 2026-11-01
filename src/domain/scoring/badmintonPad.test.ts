import { describe, expect, it } from 'vitest';
import {
  badmintonPad,
  parseBadmintonTool,
  type BadmintonDisplay,
} from '@/domain/scoring/badmintonPad';

/** Game 1 of a best of 3, singles, before the first rally: what the fake starts at, written out. */
const pre: BadmintonDisplay = {
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
  rules: { bestOf: 3, points: 21, winBy: 2, cap: 30, intervalPoint: 11 },
  phase: 'pre',
  sanctions: [],
  lastTap: null,
  undoable: false,
  awaitingEnding: false,
};

const live: BadmintonDisplay = {
  ...pre,
  points: { first: 6, second: 9 },
  server: 'second',
  court: 'left',
  phase: 'live',
  lastTap: { kind: 'rally', side: 'second', won: 'none', game: 1 },
  undoable: true,
};

describe('badmintonPad: the halves', () => {
  it('puts the first side on top and the second below, with the points as the big value', () => {
    const view = badmintonPad(live);
    expect(view.halves.map((half) => [half.side, half.label, half.value])).toEqual([
      ['first', 'A. Sharma', '6'],
      ['second', 'L. Chen', '9'],
    ]);
  });

  it('joins doubles partners as typed', () => {
    const doubles: BadmintonDisplay = {
      ...pre,
      sides: {
        first: { players: ['A. Sharma', 'R. Iyer'] },
        second: { players: ['L. Chen', 'M. Wong'] },
      },
    };
    expect(badmintonPad(doubles).halves.map((half) => half.label)).toEqual([
      'A. Sharma / R. Iyer',
      'L. Chen / M. Wong',
    ]);
  });

  // Owner ruling 17 (2026-10-31): "right/left service court in box who is serving". The court left the strip.
  it('puts the service court on the server’s plate, and says it whole to a screen reader', () => {
    expect(badmintonPad(live).halves.map((half) => half.serving)).toEqual([
      null,
      {
        shown: { key: 'scoring.badminton.serving.left' },
        said: { key: 'scoring.badminton.servingSaid.left' },
      },
    ]);
    expect(badmintonPad(pre).halves.map((half) => half.serving)).toEqual([
      {
        shown: { key: 'scoring.badminton.serving.right' },
        said: { key: 'scoring.badminton.servingSaid.right' },
      },
      null,
    ]);
  });

  it('has no finished game’s score in game 1', () => {
    expect(badmintonPad(live).halves.map((half) => half.periods)).toEqual([null, null]);
  });

  // Owner ruling 16 (2026-10-31): game 1 21-15 to the first side, game 2 18-21 to the second, game 3 under way. The
  // first half reads [21] [18], the second [15] [21]; the box of the side that won that game is marked.
  const twoGames: BadmintonDisplay = {
    ...live,
    finished: [
      { points: { first: 21, second: 15 }, winner: 'first' },
      { points: { first: 18, second: 21 }, winner: 'second' },
    ],
    game: 3,
  };

  it('shows each side’s score in every finished game, in game order, the games it won marked', () => {
    expect(badmintonPad(twoGames).halves.map((half) => half.periods?.scores)).toEqual([
      [
        { value: '21', won: true },
        { value: '18', won: false },
      ],
      [
        { value: '15', won: false },
        { value: '21', won: true },
      ],
    ]);
  });

  it('says a side’s finished games to a screen reader, in game order: “Games: 21, 18”', () => {
    expect(badmintonPad(twoGames).halves.map((half) => half.periods?.said)).toEqual([
      [{ key: 'scoring.badminton.gamesSaid.other', count: 2, vars: { scores: '21, 18' } }],
      [{ key: 'scoring.badminton.gamesSaid.other', count: 2, vars: { scores: '15, 21' } }],
    ]);
    const one = badmintonPad({ ...twoGames, finished: twoGames.finished.slice(0, 1) });
    expect(one.halves[1].periods).toEqual({
      scores: [{ value: '15', won: false }],
      said: [{ key: 'scoring.badminton.gamesSaid.other', count: 1, vars: { scores: '15' } }],
    });
  });

  it('has no line after the scores without a sanction', () => {
    expect(badmintonPad(twoGames).halves.map((half) => half.sub)).toEqual([null, null]);
  });

  it('puts a side’s heaviest sanction after its scores', () => {
    const view = badmintonPad({
      ...twoGames,
      sanctions: [
        { side: 'second', level: 'penalty', person: 'L. Chen' },
        { side: 'second', level: 'warning', person: 'L. Chen' },
      ],
    });
    expect(view.halves[0].sub).toBeNull();
    expect(view.halves[1].sub).toEqual({ key: 'scoring.sanction.penalty' });
  });

  it('names a sanction in game 1, with no score before it', () => {
    const view = badmintonPad({
      ...live,
      sanctions: [{ side: 'first', level: 'disqualification', person: 'A. Sharma' }],
    });
    expect([view.halves[0].periods, view.halves[0].sub]).toEqual([
      null,
      { key: 'scoring.sanction.disqualification' },
    ]);
  });

  it('tells a screen reader that a tap awards the rally', () => {
    expect(badmintonPad(live).halves.map((half) => half.hint)).toEqual([
      { key: 'scoring.badminton.hint' },
      { key: 'scoring.badminton.hint' },
    ]);
  });

  // Owner ruling 14: a one-line hint at the bottom of each half, the side's name in it (the mock-up's "Tap: rally to …").
  it('shows each half’s hint with its own side’s names, partners joined', () => {
    expect(badmintonPad(live).halves.map((half) => half.hintLine)).toEqual([
      { key: 'scoring.badminton.hintLine', vars: { side: 'A. Sharma' } },
      { key: 'scoring.badminton.hintLine', vars: { side: 'L. Chen' } },
    ]);
    const doubles: BadmintonDisplay = {
      ...live,
      sides: { first: { players: ['A', 'B'] }, second: { players: ['C', 'D'] } },
    };
    expect(badmintonPad(doubles).halves[1].hintLine).toEqual({
      key: 'scoring.badminton.hintLine',
      vars: { side: 'C / D' },
    });
  });

  it.each(['pre', 'live', 'betweenGames'] as const)('takes taps %s', (phase) => {
    expect(badmintonPad({ ...live, phase }).halves.map((half) => half.tappable)).toEqual([
      true,
      true,
    ]);
  });

  it('takes no tap while a disqualification waits for its ending', () => {
    expect(
      badmintonPad({ ...live, awaitingEnding: true }).halves.map((half) => half.tappable),
    ).toEqual([false, false]);
  });
});

describe('badmintonPad: the strip', () => {
  // Owner ruling 16: "Game {n} of {m}" (the controller's brief, 2026-10-31), alone: "of 3" is the best of 3, which the
  // Rules sheet spells out. Ruling 17: the court is on the server's plate, not here.
  it('names the game of how many, and the interval to come', () => {
    expect(badmintonPad(live).strip).toEqual([
      { slot: 'game', text: { key: 'scoring.badminton.gameOf', vars: { game: 1, bestOf: 3 } } },
      { slot: 'interval', text: { key: 'scoring.badminton.intervalAt', vars: { point: 11 } } },
    ]);
  });

  it('reads the format and the interval point from the match’s rules: a best of 5 with its interval at 8', () => {
    const rules = { bestOf: 5, points: 15, winBy: 2, cap: 21, intervalPoint: 8 };
    expect(badmintonPad({ ...pre, rules, game: 4 }).strip.map((item) => item.text)).toEqual([
      { key: 'scoring.badminton.gameOf', vars: { game: 4, bestOf: 5 } },
      { key: 'scoring.badminton.intervalAt', vars: { point: 8 } },
    ]);
  });

  it('says Interval when the server has just reached the interval point', () => {
    const interval = badmintonPad({ ...live, points: { first: 7, second: 11 } });
    expect(interval.strip[1]).toEqual({
      slot: 'interval',
      text: { key: 'scoring.badminton.intervalNow' },
    });
  });

  it('keeps the interval slot, empty, once the interval has passed', () => {
    expect(badmintonPad({ ...live, points: { first: 11, second: 12 } }).strip[1]).toEqual({
      slot: 'interval',
      text: null,
    });
    // 11-10 to the receiver: the leader reached 11 a rally ago.
    expect(badmintonPad({ ...live, points: { first: 11, second: 10 } }).strip[1]).toEqual({
      slot: 'interval',
      text: null,
    });
    // 11-11, the server just levelled: the interval was when the other side reached 11.
    expect(badmintonPad({ ...live, points: { first: 11, second: 11 } }).strip[1]).toEqual({
      slot: 'interval',
      text: null,
    });
  });

  it('keeps every slot once the match is decided, naming the last game, with no interval', () => {
    const decided = badmintonPad({ ...live, phase: 'decided', game: 2 });
    expect(decided.strip.map((item) => [item.slot, item.text])).toEqual([
      ['game', { key: 'scoring.badminton.gameOf', vars: { game: 2, bestOf: 3 } }],
      ['interval', null],
    ]);
  });
});

describe('badmintonPad: the tools', () => {
  it('offers Sanction for each side, and Set score before the first rally', () => {
    expect(badmintonPad(pre).tools).toEqual([
      {
        id: 'sanction.first',
        label: { key: 'scoring.badminton.tool.sanction' },
        detail: 'A. Sharma',
        kind: 'destructive',
        enabled: true,
      },
      {
        id: 'sanction.second',
        label: { key: 'scoring.badminton.tool.sanction' },
        detail: 'L. Chen',
        kind: 'destructive',
        enabled: true,
      },
      {
        id: 'setScore',
        label: { key: 'scoring.badminton.tool.setScore' },
        detail: null,
        kind: 'standard',
        enabled: true,
      },
    ]);
  });

  it('hides Set score once a game is under way', () => {
    expect(badmintonPad(live).tools.map((tool) => tool.id)).toEqual([
      'sanction.first',
      'sanction.second',
    ]);
  });

  it('offers Set score again between games', () => {
    expect(badmintonPad({ ...live, phase: 'betweenGames' }).tools.map((tool) => tool.id)).toEqual([
      'sanction.first',
      'sanction.second',
      'setScore',
    ]);
  });

  it('disables every tool while a disqualification waits for its ending', () => {
    const waiting = badmintonPad({ ...pre, awaitingEnding: true });
    expect(waiting.tools.map((tool) => [tool.id, tool.enabled])).toEqual([
      ['sanction.first', false],
      ['sanction.second', false],
      ['setScore', false],
    ]);
  });

  it('reads its own tool ids back, and nothing else', () => {
    expect(parseBadmintonTool('sanction.first')).toEqual({ kind: 'sanction', side: 'first' });
    expect(parseBadmintonTool('sanction.second')).toEqual({ kind: 'sanction', side: 'second' });
    expect(parseBadmintonTool('setScore')).toEqual({ kind: 'setScore' });
    for (const id of ['', 'sanction', 'sanction.third', 'undo', 'SETSCORE']) {
      expect(parseBadmintonTool(id), id).toBeNull();
    }
  });
});

describe('badmintonPad: the decided match', () => {
  // 2-1 to the first side; the last game 21-19, which the big numbers keep.
  const decided: BadmintonDisplay = {
    ...live,
    points: { first: 21, second: 19 },
    finished: [
      { points: { first: 21, second: 15 }, winner: 'first' },
      { points: { first: 18, second: 21 }, winner: 'second' },
      { points: { first: 21, second: 19 }, winner: 'first' },
    ],
    game: 3,
    phase: 'decided',
    lastTap: { kind: 'rally', side: 'first', won: 'match', game: 3 },
  };

  it('shows the result card over the final score, with no tool and no tap', () => {
    const view = badmintonPad(decided);
    expect(view.card).toEqual({ kind: 'resultRecorded' });
    expect(view.tools).toEqual([]);
    expect(view.halves.map((half) => [half.value, half.tappable, half.serving])).toEqual([
      ['21', false, null],
      ['19', false, null],
    ]);
  });

  it('shows every game’s score, the last game’s too, with the big numbers on the last game', () => {
    const view = badmintonPad(decided);
    expect(
      view.halves.map((half) => [half.value, half.periods?.scores.map((box) => box.value)]),
    ).toEqual([
      ['21', ['21', '18', '21']],
      ['19', ['15', '21', '19']],
    ]);
    expect(view.halves[0].periods?.scores.map((box) => box.won)).toEqual([true, false, true]);
    expect(view.halves[0].periods?.said).toEqual([
      { key: 'scoring.badminton.gamesSaid.other', count: 3, vars: { scores: '21, 18, 21' } },
    ]);
  });

  // Owner ruling 18 (2026-10-31, "box with DQ"): game 1 won 21-15; the first side disqualified in game 2 at 9-4.
  const disqualified: BadmintonDisplay = {
    ...live,
    points: { first: 9, second: 4 },
    finished: [
      { points: { first: 21, second: 15 }, winner: 'first' },
      { points: { first: 9, second: 4 }, disqualified: 'first' },
    ],
    game: 2,
    phase: 'decided',
    sanctions: [{ side: 'first', level: 'disqualification', person: 'A. Sharma' }],
    lastTap: { kind: 'ending', side: 'first', person: 'A. Sharma' },
  };

  it('boxes the game a disqualification ended: no side won it, and the side disqualified is marked DQ', () => {
    const view = badmintonPad(disqualified);
    expect(view.halves.map((half) => half.periods?.scores)).toEqual([
      [
        { value: '21', won: true },
        { value: '9', won: false, mark: { key: 'scoring.badminton.mark.disqualified' } },
      ],
      [
        { value: '15', won: false },
        { value: '4', won: false },
      ],
    ]);
    expect(view.halves.map((half) => half.value)).toEqual(['9', '4']);
    expect(view.card).toEqual({ kind: 'resultRecorded' });
  });

  it('says the disqualified game apart: “Game 2: 9, disqualified”, and the other side’s “Game 2: 4”', () => {
    expect(badmintonPad(disqualified).halves.map((half) => half.periods?.said)).toEqual([
      [
        { key: 'scoring.badminton.gamesSaid.other', count: 1, vars: { scores: '21' } },
        { key: 'scoring.badminton.gameSaid.disqualified', vars: { game: 2, points: 9 } },
      ],
      [
        { key: 'scoring.badminton.gamesSaid.other', count: 1, vars: { scores: '15' } },
        { key: 'scoring.badminton.gameSaid.stopped', vars: { game: 2, points: 4 } },
      ],
    ]);
  });

  it('boxes a game-1 disqualification alone, with no games played to say', () => {
    const view = badmintonPad({
      ...disqualified,
      finished: [{ points: { first: 9, second: 4 }, disqualified: 'second' }],
      game: 1,
    });
    expect(view.halves.map((half) => half.periods)).toEqual([
      {
        scores: [{ value: '9', won: false }],
        said: [{ key: 'scoring.badminton.gameSaid.stopped', vars: { game: 1, points: 9 } }],
      },
      {
        scores: [{ value: '4', won: false, mark: { key: 'scoring.badminton.mark.disqualified' } }],
        said: [{ key: 'scoring.badminton.gameSaid.disqualified', vars: { game: 1, points: 4 } }],
      },
    ]);
  });

  // The four questions: another format. A best of 1 is decided by its one game.
  it('decides a best of 1 on its one game: one box a side, “Game 1 of 1”', () => {
    const view = badmintonPad({
      ...live,
      rules: { ...live.rules, bestOf: 1 },
      points: { first: 19, second: 21 },
      finished: [{ points: { first: 19, second: 21 }, winner: 'second' }],
      phase: 'decided',
      lastTap: { kind: 'rally', side: 'second', won: 'match', game: 1 },
    });
    expect(view.halves.map((half) => half.periods?.scores)).toEqual([
      [{ value: '19', won: false }],
      [{ value: '21', won: true }],
    ]);
    expect(view.strip[0]).toEqual({
      slot: 'game',
      text: { key: 'scoring.badminton.gameOf', vars: { game: 1, bestOf: 1 } },
    });
    expect(view.card).toEqual({ kind: 'resultRecorded' });
  });

  it('still offers Undo on this phone’s own last tap', () => {
    expect(badmintonPad(decided).lastTap).toEqual({
      text: { key: 'scoring.badminton.last.match', vars: { side: 'A. Sharma' } },
      undo: true,
    });
  });

  it('has no card before it is decided', () => {
    expect(badmintonPad(live).card).toBeNull();
  });
});

describe('badmintonPad: the last tap', () => {
  const lastOf = (lastTap: BadmintonDisplay['lastTap']) =>
    badmintonPad({ ...live, lastTap }).lastTap?.text;

  it('has none before the first tap', () => {
    expect(badmintonPad(pre).lastTap).toBeNull();
  });

  it('names the side a rally went to', () => {
    expect(lastOf({ kind: 'rally', side: 'second', won: 'none', game: 1 })).toEqual({
      key: 'scoring.badminton.last.rally',
      vars: { side: 'L. Chen' },
    });
  });

  it('names the game a rally won', () => {
    expect(lastOf({ kind: 'rally', side: 'first', won: 'game', game: 2 })).toEqual({
      key: 'scoring.badminton.last.game',
      vars: { game: 2, side: 'A. Sharma' },
    });
  });

  it('names a sanction’s level and person', () => {
    expect(
      lastOf({ kind: 'sanction', side: 'first', level: 'warning', person: 'A. Sharma' }),
    ).toEqual({
      key: 'scoring.badminton.last.sanction',
      vars: { level: { key: 'scoring.sanction.warning' }, person: 'A. Sharma' },
    });
  });

  it('writes a set score top first', () => {
    expect(lastOf({ kind: 'setScore', first: 5, second: 3 })).toEqual({
      key: 'scoring.badminton.last.setScore',
      vars: { score: '5–3' },
    });
  });

  it('names the disqualified person when the ending is recorded', () => {
    expect(lastOf({ kind: 'ending', side: 'second', person: 'L. Chen' })).toEqual({
      key: 'scoring.badminton.last.ending',
      vars: { person: 'L. Chen' },
    });
  });

  it.each([
    [
      { kind: 'rally', side: 'first' },
      { key: 'scoring.badminton.undone.rally', vars: { side: 'A. Sharma' } },
    ],
    [
      { kind: 'sanction', side: 'second', level: 'expulsion', person: 'L. Chen' },
      {
        key: 'scoring.badminton.undone.sanction',
        vars: { level: { key: 'scoring.sanction.expulsion' }, person: 'L. Chen' },
      },
    ],
    [{ kind: 'setScore', first: 1, second: 2 }, { key: 'scoring.badminton.undone.setScore' }],
    [
      { kind: 'ending', side: 'second', person: 'L. Chen' },
      { key: 'scoring.badminton.undone.ending', vars: { person: 'L. Chen' } },
    ],
  ] as const)('says what Undo took back: %j', (tap, text) => {
    expect(lastOf({ kind: 'undone', tap })).toEqual(text);
  });

  it('offers Undo only when this phone has a tap of its own to take back', () => {
    expect(badmintonPad(live).lastTap?.undo).toBe(true);
    expect(badmintonPad({ ...live, undoable: false }).lastTap?.undo).toBe(false);
  });

  it('offers no Undo while a disqualification waits for its ending: the prompt decides', () => {
    expect(badmintonPad({ ...live, awaitingEnding: true }).lastTap?.undo).toBe(false);
  });
});

describe('badmintonPad: sync', () => {
  it('is synced unless told otherwise, and passes the transport’s word through', () => {
    expect(badmintonPad(live).sync).toEqual({ kind: 'synced' });
    expect(badmintonPad(live, { kind: 'offline', count: 3 }).sync).toEqual({
      kind: 'offline',
      count: 3,
    });
  });
});

// Owner, 2026-11-01: "can we have 0:0 with lime light in place of preview". Games won, top side first.
describe('badmintonPad: the games tally', () => {
  const said = (firstGames: number, secondGames: number) => ({
    key: 'scoring.badminton.gamesTally',
    vars: { first: 'A. Sharma', firstGames, second: 'L. Chen', secondGames },
  });

  it('starts at 0:0, said with both sides’ names', () => {
    expect(badmintonPad(pre).tally).toEqual({ shown: '0:0', said: said(0, 0) });
  });

  it('counts the games each side won, the top side first', () => {
    const state: BadmintonDisplay = {
      ...live,
      finished: [
        { points: { first: 15, second: 21 }, winner: 'second' },
        { points: { first: 21, second: 19 }, winner: 'first' },
        { points: { first: 18, second: 21 }, winner: 'second' },
      ],
      phase: 'decided',
    };
    expect(badmintonPad(state).tally).toEqual({ shown: '1:2', said: said(1, 2) });
  });

  it('counts a game a disqualification ended for nobody (owner ruling 18)', () => {
    const state: BadmintonDisplay = {
      ...live,
      finished: [
        { points: { first: 21, second: 15 }, winner: 'first' },
        { points: { first: 9, second: 4 }, disqualified: 'first' },
      ],
      phase: 'decided',
    };
    expect(badmintonPad(state).tally.shown).toBe('1:0');
  });
});

// Owner, 2026-11-01: the Match details sheet and the Not started card show where the match sits and its rules.
describe('badmintonPad: the match details', () => {
  it('carries the match’s context as kept, and the rule lines of its config', () => {
    expect(badmintonPad(pre).details).toEqual({
      context: {
        competition: 'Spring Open 2026',
        division: 'U15 Boys Singles',
        round: 'Round 1',
        match: 'Match 4',
        sides: ['A. Sharma', 'L. Chen'],
      },
      rules: [
        { key: 'scoring.badminton.rules.bestOf.other', count: 3 },
        { key: 'scoring.badminton.rules.points', vars: { points: 21, winBy: 2 } },
        { key: 'scoring.badminton.rules.cap', vars: { cap: 30 } },
        { key: 'scoring.badminton.intervalAt', vars: { point: 11 } },
        { key: 'scoring.badminton.rules.endsChange', vars: { point: 11, game: 3 } },
      ],
    });
  });

  it('keeps them under a card', () => {
    const view = badmintonPad({ ...pre, phase: 'decided' });
    expect(view.card).toEqual({ kind: 'resultRecorded' });
    expect(view.details.context.competition).toBe('Spring Open 2026');
  });
});

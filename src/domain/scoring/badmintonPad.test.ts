import { describe, expect, it } from 'vitest';
import {
  badmintonPad,
  parseBadmintonTool,
  SANCTION_LEVELS,
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
  rules: {
    bestOf: 3,
    points: 21,
    decidingPoints: 21,
    winBy: 2,
    cap: 30,
    intervalPoint: 11,
    decidingIntervalPoint: 11,
  },
  phase: 'pre',
  sanctions: [],
  lastTap: null,
  undoable: false,
  awaitingEnding: false,
  serverPicked: false,
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

  // Owner ruling, 2026-11-02: "there is a lime light in box 1 fixed instead of, lime color changes who is serving?". The
  // side bar follows the server: lit on the serving side, dim on the other, dim on both while no server is known.
  describe('the side bar follows the server', () => {
    const bars = (display: BadmintonDisplay) =>
      badmintonPad(display).halves.map((half) => half.bar);

    it('lights the serving side’s bar, the second side as the first, and dims the other', () => {
      expect(bars({ ...live, server: 'second' })).toEqual(['dim', 'lit']);
      expect(bars({ ...live, server: 'first' })).toEqual(['lit', 'dim']);
    });

    it('moves the light the moment the serve changes (a rally the receiver won)', () => {
      expect(bars({ ...live, server: 'first' })).not.toEqual(bars({ ...live, server: 'second' }));
    });

    it('lights the pick shown on the Start screen’s first rally, as the plate shows it', () => {
      expect(bars({ ...pre, server: 'second', serverPicked: true })).toEqual(['dim', 'lit']);
    });

    it('dims both while no server is known (a set score, or a match started elsewhere)', () => {
      expect(bars({ ...pre, server: null })).toEqual(['dim', 'dim']);
      expect(bars({ ...live, server: null })).toEqual(['dim', 'dim']);
    });

    it('dims both once the match is decided and before it starts, the plate gone with them', () => {
      expect(bars({ ...live, phase: 'decided' })).toEqual(['dim', 'dim']);
      expect(bars({ ...pre, phase: 'notStarted' })).toEqual(['dim', 'dim']);
    });

    it('lights exactly the half that has the plate, in every phase', () => {
      const phases = ['notStarted', 'pre', 'live', 'betweenGames', 'decided'] as const;
      const servers = ['first', 'second', null] as const;
      for (const phase of phases) {
        for (const server of servers) {
          const halves = badmintonPad({ ...live, phase, server }).halves;
          expect(
            halves.map((half) => half.bar === 'lit'),
            `${phase}/${String(server)}`,
          ).toEqual(halves.map((half) => half.serving !== null));
        }
      }
    });
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

  // Owner ruling 56 (2026-11-04): "if we have warning/yellow/card then we can display there? including for badminton?",
  // "may in the top right corner". A sanction is a card in the half's top-right corner, no longer words in the bottom
  // row: the boxes, then "Tap".
  describe('a sanction is a card in the corner (owner ruling 56), the words gone from the bottom row', () => {
    const NONE = { clock: false, cards: [], said: [] };
    const sanctioned = (...sanctions: BadmintonDisplay['sanctions']) =>
      badmintonPad({ ...twoGames, sanctions });
    const on = (side: 'first' | 'second', level: BadmintonDisplay['sanctions'][number]['level']) =>
      ({ side, level, person: 'L. Chen' }) as const;

    // The table, written out from the owner's words: warning is the yellow card, a fault (the web's `penalty`) and a
    // disqualification are the red one (the web's `--sport-dismissal`); the web's expulsion is a dismissal too.
    const CARDS = [
      ['warning', ['caution']],
      ['penalty', ['dismissal']],
      ['expulsion', ['dismissal']],
      ['disqualification', ['dismissal']],
    ] as const;

    it('maps every level the pad can record (anti-vacuity: the table names exactly the four)', () => {
      expect(CARDS.map(([level]) => level)).toEqual([...SANCTION_LEVELS]);
    });

    it.each(CARDS)(
      'draws a %s as %j, on the side that holds it only, and says its name',
      (level, cards) => {
        const view = sanctioned(on('second', level));
        expect(view.halves[1].marks).toEqual({
          clock: false,
          cards,
          said: [{ key: `scoring.sanction.${level}` }],
        });
        expect(view.halves[0].marks).toEqual(NONE);
      },
    );

    it('draws no card for a side that holds no sanction', () => {
      expect(badmintonPad(twoGames).halves.map((half) => half.marks)).toEqual([NONE, NONE]);
    });

    it('draws a side’s heaviest sanction only, however many it holds and in whatever order', () => {
      const view = sanctioned(on('second', 'penalty'), on('second', 'warning'));
      expect(view.halves[1].marks.cards).toEqual(['dismissal']);
      expect(view.halves[1].marks.said).toEqual([{ key: 'scoring.sanction.penalty' }]);
      const other = sanctioned(on('first', 'warning'), on('first', 'disqualification'));
      expect(other.halves[0].marks.cards).toEqual(['dismissal']);
      const light = sanctioned(on('first', 'warning'), on('first', 'warning'));
      expect(light.halves[0].marks.cards).toEqual(['caution']);
    });

    it('holds each side’s own: a warning on one and a disqualification on the other', () => {
      const view = sanctioned(on('first', 'warning'), on('second', 'disqualification'));
      expect(view.halves.map((half) => half.marks.cards)).toEqual([['caution'], ['dismissal']]);
    });

    it('draws a card in game 1 with no score before it, and never a clock', () => {
      const view = badmintonPad({ ...live, sanctions: [on('first', 'warning')] });
      expect(view.halves[0].periods).toBeNull();
      expect(view.halves[0].marks).toEqual({
        clock: false,
        cards: ['caution'],
        said: [{ key: 'scoring.sanction.warning' }],
      });
    });

    it('puts no words after the boxes: the sanction is a mark and the half has no other line', () => {
      const view = sanctioned(on('second', 'penalty'), on('first', 'warning'));
      expect(view.halves.map((half) => half.sub)).toEqual([null, null]);
      expect(badmintonPad(twoGames).halves.map((half) => half.sub)).toEqual([null, null]);
    });
  });

  it('tells a screen reader that a tap awards the rally', () => {
    expect(badmintonPad(live).halves.map((half) => half.hint)).toEqual([
      { key: 'scoring.badminton.hint' },
      { key: 'scoring.badminton.hint' },
    ]);
  });

  // Owner ruling 56: the visible hint is the one word "Tap", with no side name, so the kit says it and a half carries
  // no hint line of its own (ruling 14's "Tap: rally to …" is superseded).
  it('carries no visible hint line: the kit says the one word', () => {
    for (const half of badmintonPad(live).halves) expect('hintLine' in half).toBe(false);
  });

  // Batch A review (I3, I4): a sport's own plate word and tap label are chess's; badminton's halves draw neither, in
  // any phase, so the kit says "Tap" and the serving plate is the only plate.
  it.each(['notStarted', 'pre', 'live', 'betweenGames', 'decided'] as const)(
    'has no plate word and no tap label of its own %s',
    (phase) => {
      expect(
        badmintonPad({ ...live, phase }).halves.map((half) => [half.plate, half.action]),
      ).toEqual([
        [null, null],
        [null, null],
      ]);
    },
  );

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
  // Owner ruling 16: "Game {n} of {m}" (the controller's brief, 2026-10-31), alone: "of 3" is the best of 3, which
  // MatchCard's rules table spells out (the Start screen, the Not started card and the Match details sheet). Ruling 17:
  // the court is on the server's plate, not here.
  it('names the game of how many, and the interval to come', () => {
    expect(badmintonPad(live).strip).toEqual([
      { slot: 'game', text: { key: 'scoring.badminton.gameOf', vars: { game: 1, bestOf: 3 } } },
      { slot: 'interval', text: { key: 'scoring.badminton.intervalAt', vars: { point: 11 } } },
    ]);
  });

  it('reads the format and the interval point from the match’s rules: a best of 5 with its interval at 8', () => {
    const rules = {
      bestOf: 5,
      points: 15,
      decidingPoints: 15,
      winBy: 2,
      cap: 21,
      intervalPoint: 8,
      decidingIntervalPoint: 8,
    };
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
    expect(view.card).toEqual({ kind: 'resultRecorded', undoLeft: null });
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
    expect(view.card).toEqual({ kind: 'resultRecorded', undoLeft: null });
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
    expect(view.card).toEqual({ kind: 'resultRecorded', undoLeft: null });
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

  // Plan S2-1 Task 7: the ledger names the first server only on the match's first rally (design §7.3), and the web pad
  // leaves it out, so a match started elsewhere may never say it. The line then says the start alone.
  it('says the start alone when its first server is not known: “Match started”', () => {
    expect(lastOf({ kind: 'start', server: null })).toEqual({
      key: 'scoring.badminton.last.startUnknownServer',
    });
    expect(lastOf({ kind: 'start', server: 'second' })).toEqual({
      key: 'scoring.badminton.last.start',
      vars: { side: 'L. Chen' },
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

// Plan S2-1 Task 7: the engine names no server after a set score until the next rally (`score-jumped`), nor before the
// match's first rally when this phone did not pick it. The pad draws no plate then, rather than guess (design §6.2).
describe('badmintonPad: a server the ledger does not name', () => {
  const unknown: BadmintonDisplay = {
    ...live,
    points: { first: 5, second: 3 },
    finished: [{ points: { first: 21, second: 15 }, winner: 'first' }],
    server: null,
    game: 2,
    phase: 'betweenGames',
    lastTap: { kind: 'setScore', first: 5, second: 3 },
  };

  it('draws no serving plate on either half, and still takes a tap', () => {
    const view = badmintonPad(unknown);
    expect(view.halves.map((half) => [half.serving, half.tappable])).toEqual([
      [null, true],
      [null, true],
    ]);
  });

  it('still says where the interval is while both sides are short of it', () => {
    expect(badmintonPad(unknown).strip[1]).toEqual({
      slot: 'interval',
      text: { key: 'scoring.badminton.intervalAt', vars: { point: 11 } },
    });
  });

  // As the web's pad does (skins/badminton.tsx `intervalHint`): an umpire missing a 60-second interval is worse than
  // one seeing it a rally late, so with nobody named serving, a side on the mark alone still says Interval.
  it('still says Interval when one side is on the interval point, with nobody named serving', () => {
    for (const points of [
      { first: 11, second: 5 },
      { first: 7, second: 11 },
    ]) {
      expect(badmintonPad({ ...unknown, points }).strip[1]).toEqual({
        slot: 'interval',
        text: { key: 'scoring.badminton.intervalNow' },
      });
    }
  });

  it('says nothing once the interval point is passed, or both sides are on it', () => {
    for (const points of [
      { first: 12, second: 5 },
      { first: 11, second: 11 },
    ]) {
      expect(badmintonPad({ ...unknown, points }).strip[1]).toEqual({
        slot: 'interval',
        text: null,
      });
    }
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
  it('carries the match’s context as kept, and the rule rows of its config', () => {
    expect(badmintonPad(pre).details).toEqual({
      context: {
        competition: 'Spring Open 2026',
        division: 'U15 Boys Singles',
        round: 'Round 1',
        match: 'Match 4',
        sides: ['A. Sharma', 'L. Chen'],
      },
      rules: [
        {
          label: { key: 'scoring.badminton.rules.format.label' },
          value: { key: 'scoring.badminton.rules.bestOf.other', count: 3 },
        },
        {
          label: { key: 'scoring.badminton.rules.points.label' },
          value: { key: 'scoring.badminton.rules.points.value', vars: { points: 21, winBy: 2 } },
        },
        {
          label: { key: 'scoring.badminton.rules.cap.label' },
          value: { key: 'scoring.badminton.rules.cap.value', vars: { cap: 30 } },
        },
        {
          label: { key: 'scoring.badminton.rules.interval.label' },
          value: { key: 'scoring.badminton.rules.interval.value', vars: { point: 11 } },
        },
        {
          label: { key: 'scoring.badminton.rules.endsChange.label' },
          value: { key: 'scoring.badminton.rules.endsChange.value', vars: { point: 11, game: 3 } },
        },
      ],
    });
  });

  it('keeps them under a card', () => {
    const view = badmintonPad({ ...pre, phase: 'decided' });
    expect(view.card).toEqual({ kind: 'resultRecorded', undoLeft: null });
    expect(view.details.context.competition).toBe('Spring Open 2026');
  });
});

// Owner, 2026-11-01, option A: "it show the player, match info and ask to start". Before the match starts the pad is
// the Start screen: who serves first, from the two sides as typed; no tools, no tap, no serving plate, no line.
describe('badmintonPad: before the match starts', () => {
  const notStarted: BadmintonDisplay = { ...pre, phase: 'notStarted' };

  it('asks who serves first, offering the two sides as typed, top first', () => {
    expect(badmintonPad(notStarted).start).toEqual({
      ask: { key: 'scoring.badminton.start.ask' },
      needsToss: true,
      sides: [
        { side: 'first', label: 'A. Sharma' },
        { side: 'second', label: 'L. Chen' },
      ],
    });
  });

  it('joins doubles partners as typed', () => {
    const doubles: BadmintonDisplay = {
      ...notStarted,
      sides: {
        first: { players: ['A. Sharma', 'R. Iyer'] },
        second: { players: ['L. Chen', 'M. Wong'] },
      },
    };
    expect(badmintonPad(doubles).start?.sides.map((side) => side.label)).toEqual([
      'A. Sharma / R. Iyer',
      'L. Chen / M. Wong',
    ]);
  });

  it('offers no tool, no tap, no serving plate and no last tap; the tally is 0:0 and the details stand', () => {
    // A last tap the display still holds before the start (an engine that keeps the start an Undo took back) says
    // nothing: there is no match on the pad for a line to speak of (review M6, 2026-11-01).
    const view = badmintonPad({
      ...notStarted,
      lastTap: { kind: 'start', server: 'first' },
      undoable: true,
    });
    expect(view.tools).toEqual([]);
    expect(view.halves.map((half) => [half.tappable, half.serving])).toEqual([
      [false, null],
      [false, null],
    ]);
    expect(view.lastTap).toBeNull();
    expect(view.tally.shown).toBe('0:0');
    expect(view.details.context.match).toBe('Match 4');
  });

  it('asks nothing once started: the pad, the side picked serving from the right at 0-0', () => {
    const started: BadmintonDisplay = {
      ...pre,
      server: 'second',
      lastTap: { kind: 'start', server: 'second' },
      undoable: true,
    };
    const view = badmintonPad(started);
    expect(view.start).toBeNull();
    expect(view.halves.map((half) => half.serving?.shown ?? null)).toEqual([
      null,
      { key: 'scoring.badminton.serving.right' },
    ]);
    expect(view.lastTap).toEqual({
      text: { key: 'scoring.badminton.last.start', vars: { side: 'L. Chen' } },
      undo: true,
    });
    expect(view.tools.map((tool) => tool.id)).toEqual([
      'sanction.first',
      'sanction.second',
      'setScore',
    ]);
  });
});

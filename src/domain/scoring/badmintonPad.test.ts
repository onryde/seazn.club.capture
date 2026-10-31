import { describe, expect, it } from 'vitest';
import {
  badmintonPad,
  parseBadmintonTool,
  type BadmintonDisplay,
} from '@/domain/scoring/badmintonPad';

/** Game 1 of a best of 3, singles, before the first rally: what the fake starts at, written out. */
const pre: BadmintonDisplay = {
  sides: { first: { players: ['A. Sharma'] }, second: { players: ['L. Chen'] } },
  points: { first: 0, second: 0 },
  games: { first: 0, second: 0 },
  server: 'first',
  court: 'right',
  game: 1,
  bestOf: 3,
  intervalPoint: 11,
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

  it('marks the server, and only the server', () => {
    expect(badmintonPad(live).halves.map((half) => half.serving)).toEqual([false, true]);
    expect(badmintonPad(pre).halves.map((half) => half.serving)).toEqual([true, false]);
  });

  it('says the games each side has won under its points', () => {
    const view = badmintonPad({ ...live, games: { first: 1, second: 0 } });
    expect(view.halves.map((half) => half.sub)).toEqual([
      { key: 'scoring.badminton.games', vars: { count: 1 } },
      { key: 'scoring.badminton.games', vars: { count: 0 } },
    ]);
  });

  it('adds a side’s heaviest sanction to its games line', () => {
    const view = badmintonPad({
      ...live,
      sanctions: [
        { side: 'second', level: 'penalty', person: 'L. Chen' },
        { side: 'second', level: 'warning', person: 'L. Chen' },
      ],
    });
    expect(view.halves[0].sub).toEqual({ key: 'scoring.badminton.games', vars: { count: 0 } });
    expect(view.halves[1].sub).toEqual({
      key: 'scoring.badminton.gamesSanctioned',
      vars: { count: 0, sanction: { key: 'scoring.sanction.penalty' } },
    });
  });

  it('tells a screen reader that a tap awards the rally', () => {
    expect(badmintonPad(live).halves.map((half) => half.hint)).toEqual([
      { key: 'scoring.badminton.hint' },
      { key: 'scoring.badminton.hint' },
    ]);
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
  it('names the format and the game, the service court, and the interval to come', () => {
    expect(badmintonPad(live).strip).toEqual([
      { slot: 'context', text: { key: 'scoring.badminton.context', vars: { bestOf: 3, game: 1 } } },
      { slot: 'court', text: { key: 'scoring.badminton.court.left' } },
      { slot: 'interval', text: { key: 'scoring.badminton.intervalAt', vars: { point: 11 } } },
    ]);
  });

  it('reads the right service court from the display', () => {
    expect(badmintonPad(pre).strip[1]).toEqual({
      slot: 'court',
      text: { key: 'scoring.badminton.court.right' },
    });
  });

  it('says Interval when the server has just reached the interval point', () => {
    const interval = badmintonPad({ ...live, points: { first: 7, second: 11 } });
    expect(interval.strip[2]).toEqual({
      slot: 'interval',
      text: { key: 'scoring.badminton.intervalNow' },
    });
  });

  it('keeps the interval slot, empty, once the interval has passed', () => {
    expect(badmintonPad({ ...live, points: { first: 11, second: 12 } }).strip[2]).toEqual({
      slot: 'interval',
      text: null,
    });
    // 11-10 to the receiver: the leader reached 11 a rally ago.
    expect(badmintonPad({ ...live, points: { first: 11, second: 10 } }).strip[2]).toEqual({
      slot: 'interval',
      text: null,
    });
    // 11-11, the server just levelled: the interval was when the other side reached 11.
    expect(badmintonPad({ ...live, points: { first: 11, second: 11 } }).strip[2]).toEqual({
      slot: 'interval',
      text: null,
    });
  });

  it('keeps every slot once the match is decided, with no court and no interval', () => {
    const decided = badmintonPad({ ...live, phase: 'decided', games: { first: 0, second: 2 } });
    expect(decided.strip.map((item) => [item.slot, item.text])).toEqual([
      ['context', { key: 'scoring.badminton.context', vars: { bestOf: 3, game: 1 } }],
      ['court', null],
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
  const decided: BadmintonDisplay = {
    ...live,
    phase: 'decided',
    games: { first: 2, second: 1 },
    lastTap: { kind: 'rally', side: 'first', won: 'match', game: 3 },
  };

  it('shows the result card over the final score, with no tool and no tap', () => {
    const view = badmintonPad(decided);
    expect(view.card).toEqual({ kind: 'resultRecorded' });
    expect(view.tools).toEqual([]);
    expect(view.halves.map((half) => [half.value, half.tappable, half.serving])).toEqual([
      ['6', false, false],
      ['9', false, false],
    ]);
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

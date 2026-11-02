import { describe, expect, it } from 'vitest';
import { badmintonEventFor } from '@/domain/scoring/badmintonEvents';
import { foldBadminton, type BadmintonFoldInput } from '@/domain/scoring/badmintonFold';
import { badmintonPad, type BadmintonDisplay } from '@/domain/scoring/badmintonPad';
import type { PadSide } from '@/domain/scoring/padView';
import type { QueuedEvent } from '@/domain/scoring/queue';
import type { Bootstrap, LedgerEvent } from '@/domain/scoring/wire';
import {
  DOUBLES,
  PHONE_LINK,
  eventId,
  SINGLES,
  alternating,
  forfeit,
  ledgerOf,
  queuedOf,
  rallies,
  rally,
  sanction,
  start,
  summary,
  voiding,
  type Spec,
} from '../../../test/badmintonLedger';

// Plan S2-1 Task 7 (design §6.2, §7.3): the pad's display is the server's ledger folded through @seazn/engine with this
// phone's legal queued taps on top. Every expected display below is written out from the spec and the rules of
// badminton, never computed by the fold. Top half = home, bottom = away.

const STANDARD_RULES = { bestOf: 3, points: 21, winBy: 2, cap: 30, intervalPoint: 11 };
const SINGLES_SIDES: BadmintonDisplay['sides'] = {
  first: { players: ['A. Sharma'] },
  second: { players: ['L. Chen'] },
};
const SINGLES_CONTEXT: BadmintonDisplay['context'] = {
  competition: 'Spring Open 2026',
  division: 'U15 Boys Singles',
  round: 'Round 1',
  match: 'Match 4',
  sides: ['A. Sharma', 'L. Chen'],
};

function fold(
  specs: readonly Spec[],
  more: {
    readonly queued?: readonly QueuedEvent[];
    readonly own?: readonly string[];
    readonly toss?: PadSide | null;
    readonly bootstrap?: Bootstrap;
  } = {},
) {
  const input: BadmintonFoldInput = {
    bootstrap: more.bootstrap ?? SINGLES,
    ledger: ledgerOf(specs),
    queued: more.queued ?? [],
    ownEventIds: more.own ?? [],
    toss: more.toss ?? null,
  };
  return foldBadminton(input);
}

/** The folded result, or the test fails saying why it would not fold. */
function folded(...args: Parameters<typeof fold>) {
  const result = fold(...args);
  if (result.kind !== 'folded') throw new Error(`did not fold: ${result.reason}`);
  return result;
}

const display = (...args: Parameters<typeof fold>) => folded(...args).display;

/** Game 1 won 21–15 by the top side, every rally another scorer's; the first rally names home serving. */
const GAME_ONE: readonly Spec[] = [
  start(),
  rally('H', 'H'),
  ...rallies(`${alternating(30).slice(1)}HHHHHH`),
];

describe('foldBadminton: before the start', () => {
  it('opens a match nobody has started: not started, game 1 of its format, nothing to undo', () => {
    const result = folded([]);
    expect(result.display).toEqual({
      sides: SINGLES_SIDES,
      context: SINGLES_CONTEXT,
      points: { first: 0, second: 0 },
      finished: [],
      server: null,
      court: 'right',
      game: 1,
      rules: STANDARD_RULES,
      phase: 'notStarted',
      sanctions: [],
      lastTap: null,
      undoable: false,
      awaitingEnding: false,
      serverPicked: false,
    } satisfies BadmintonDisplay);
    expect(result.legalQueued).toEqual([]);
    expect(result.history).toEqual([]);
  });

  it('shows this phone’s queued start at once, the side picked serving from the right at 0-0', () => {
    const result = folded([], { queued: [queuedOf('k-start', start())], toss: 'second' });
    expect(result.display).toEqual({
      sides: SINGLES_SIDES,
      context: SINGLES_CONTEXT,
      points: { first: 0, second: 0 },
      finished: [],
      server: 'second',
      court: 'right',
      game: 1,
      rules: STANDARD_RULES,
      phase: 'pre',
      sanctions: [],
      lastTap: { kind: 'start', server: 'second' },
      undoable: true,
      awaitingEnding: false,
      serverPicked: true,
    } satisfies BadmintonDisplay);
    expect(result.legalQueued).toEqual(['k-start']);
    expect(result.history).toEqual([
      {
        heading: { key: 'scoring.badminton.gameHeading', vars: { game: 1 } },
        rows: [
          {
            said: { key: 'scoring.badminton.last.start', vars: { side: 'L. Chen' } },
            score: null,
            by: 'thisPhone',
            undone: false,
            sending: true,
          },
        ],
      },
    ]);
  });
});

describe('foldBadminton: the games', () => {
  it('folds a 21–15 game into its box, the winner serving game 2 from the right: “Game 2 of 3”', () => {
    const result = display(GAME_ONE);
    expect(result).toEqual({
      sides: SINGLES_SIDES,
      context: SINGLES_CONTEXT,
      points: { first: 0, second: 0 },
      finished: [{ points: { first: 21, second: 15 }, winner: 'first' }],
      server: 'first',
      court: 'right',
      game: 2,
      rules: STANDARD_RULES,
      phase: 'betweenGames',
      sanctions: [],
      lastTap: { kind: 'rally', side: 'first', won: 'game', game: 1 },
      undoable: false,
      awaitingEnding: false,
      serverPicked: false,
    } satisfies BadmintonDisplay);
    const view = badmintonPad(result);
    expect(view.strip).toEqual([
      { slot: 'game', text: { key: 'scoring.badminton.gameOf', vars: { game: 2, bestOf: 3 } } },
      { slot: 'interval', text: { key: 'scoring.badminton.intervalAt', vars: { point: 11 } } },
    ]);
    expect(view.halves.map((half) => half.periods?.scores)).toEqual([
      [{ value: '21', won: true }],
      [{ value: '15', won: false }],
    ]);
    expect(view.tools.map((tool) => tool.id)).toEqual([
      'sanction.first',
      'sanction.second',
      'setScore',
    ]);
    expect(badmintonPad(display([...GAME_ONE, rally('A')])).tools.map((tool) => tool.id)).toEqual([
      'sanction.first',
      'sanction.second',
    ]);
  });

  it('serves from the rally’s winner after the first rally, which named the toss side serving', () => {
    expect(display([start(), rally('A', 'H')])).toEqual({
      sides: SINGLES_SIDES,
      context: SINGLES_CONTEXT,
      points: { first: 0, second: 1 },
      finished: [],
      server: 'second',
      court: 'left',
      game: 1,
      rules: STANDARD_RULES,
      phase: 'live',
      sanctions: [],
      lastTap: { kind: 'rally', side: 'second', won: 'none', game: 1 },
      undoable: false,
      awaitingEnding: false,
      serverPicked: false,
    } satisfies BadmintonDisplay);
  });

  it('wins a game only by two clear points: 21–20 plays on, 22–20 wins it', () => {
    const level = [start(), rally('H', 'H'), ...rallies(alternating(40).slice(1))];
    expect(display([...level, ...rallies('H')]).points).toEqual({ first: 21, second: 20 });
    expect(display([...level, ...rallies('H')]).phase).toBe('live');
    expect(display([...level, ...rallies('HH')]).finished).toEqual([
      { points: { first: 22, second: 20 }, winner: 'first' },
    ]);
  });

  it('caps a game at 30: 30–29 wins it', () => {
    const level = [start(), rally('H', 'H'), ...rallies(alternating(58).slice(1))];
    expect(display(level).points).toEqual({ first: 29, second: 29 });
    expect(display([...level, ...rallies('A')]).finished).toEqual([
      { points: { first: 29, second: 30 }, winner: 'second' },
    ]);
  });

  it('says Interval when the server has just reached the interval point', () => {
    const view = badmintonPad(display([start(), rally('H', 'H'), ...rallies('HHHHHHAAAAAAAAAAA')]));
    expect(view.halves.map((half) => half.value)).toEqual(['7', '11']);
    expect(view.strip[1]).toEqual({
      slot: 'interval',
      text: { key: 'scoring.badminton.intervalNow' },
    });
  });

  it('decides a best of 3 at two games, keeping the last game’s points, with no server', () => {
    const result = display([...GAME_ONE, ...rallies(`${alternating(36)}HHH`)]);
    expect(result).toEqual({
      sides: SINGLES_SIDES,
      context: SINGLES_CONTEXT,
      points: { first: 21, second: 18 },
      finished: [
        { points: { first: 21, second: 15 }, winner: 'first' },
        { points: { first: 21, second: 18 }, winner: 'first' },
      ],
      server: null,
      court: 'right',
      game: 2,
      rules: STANDARD_RULES,
      phase: 'decided',
      sanctions: [],
      lastTap: { kind: 'rally', side: 'first', won: 'match', game: 2 },
      undoable: false,
      awaitingEnding: false,
      serverPicked: false,
    } satisfies BadmintonDisplay);
    expect(badmintonPad(result).card).toEqual({ kind: 'resultRecorded' });
  });

  // Another format (the four questions): a best of 1, to 21, decided by its one game.
  it('decides a best of 1 on its one game: one box a side, “Game 1 of 1”', () => {
    const bestOfOne: Bootstrap = { ...SINGLES, cfg: { bestOf: 1 } };
    const result = display(
      [start(), rally('H', 'H'), ...rallies(`${alternating(38).slice(1)}AA`)],
      { bootstrap: bestOfOne },
    );
    expect(result.finished).toEqual([{ points: { first: 19, second: 21 }, winner: 'second' }]);
    expect(result.phase).toBe('decided');
    expect(result.rules).toEqual({ ...STANDARD_RULES, bestOf: 1 });
    expect(badmintonPad(result).strip[0]).toEqual({
      slot: 'game',
      text: { key: 'scoring.badminton.gameOf', vars: { game: 1, bestOf: 1 } },
    });
  });

  it('reads the rules from the match’s config: a best of 5 to 15, capped at 21, its interval at 8', () => {
    const five: Bootstrap = { ...SINGLES, cfg: { bestOf: 5, setTo: 15, finalSetTo: 15, cap: 21 } };
    expect(display([], { bootstrap: five }).rules).toEqual({
      bestOf: 5,
      points: 15,
      winBy: 2,
      cap: 21,
      intervalPoint: 8,
    });
  });

  // Another rule set: a deciding game played to 15 has its interval at 8, while games 1 and 2 keep theirs at 11.
  it('takes each game’s own interval point: 11 in game 1, 8 in a deciding game played to 15', () => {
    const toFifteen: Bootstrap = { ...SINGLES, cfg: { finalSetTo: 15 } };
    const intervalOf = (specs: readonly Spec[]) =>
      badmintonPad(display(specs, { bootstrap: toFifteen })).strip[1];
    expect(intervalOf([start()])).toEqual({
      slot: 'interval',
      text: { key: 'scoring.badminton.intervalAt', vars: { point: 11 } },
    });
    const deciding = display([...GAME_ONE, ...rallies('A'.repeat(21))], { bootstrap: toFifteen });
    expect(deciding).toMatchObject({ game: 3, phase: 'betweenGames', rules: { intervalPoint: 8 } });
    expect(intervalOf([...GAME_ONE, ...rallies('A'.repeat(21))])).toEqual({
      slot: 'interval',
      text: { key: 'scoring.badminton.intervalAt', vars: { point: 8 } },
    });
  });

  it('leaves the interval slot empty once the interval has passed', () => {
    const view = badmintonPad(display([start(), rally('H', 'H'), ...rallies('HHHHHHHHHHHA')]));
    expect(view.halves.map((half) => half.value)).toEqual(['12', '1']);
    expect(view.strip[1]).toEqual({ slot: 'interval', text: null });
  });
});

describe('foldBadminton: Set score', () => {
  // Review item 1 (2026-11-02): the pick serves only while the engine has named nobody at the match's 0–0. After a set
  // score the engine still says `undeclared` (probed), so it is the 0–0 that rules the pick out: no plate, no guess,
  // and the next rally sends no `serving`, which at 5–3 would be a false fact in the ledger.
  it('sets the points before the match’s first rally, which stays the next tap, and no longer shows the pick serving', () => {
    const result = folded([], {
      queued: [queuedOf('k-start', start()), queuedOf('k-set', summary(5, 3))],
      toss: 'first',
    });
    expect(result.display).toMatchObject({
      points: { first: 5, second: 3 },
      server: null,
      court: 'right',
      phase: 'pre',
      lastTap: { kind: 'setScore', first: 5, second: 3 },
      serverPicked: false,
    });
    expect(badmintonPad(result.display).halves.map((half) => half.serving)).toEqual([null, null]);
    expect(badmintonPad(result.display).tools.map((tool) => tool.id)).toEqual([
      'sanction.first',
      'sanction.second',
      'setScore',
    ]);
    expect(
      badmintonEventFor(
        { kind: 'rally', side: 'first' },
        { bootstrap: SINGLES, display: result.display },
      ),
    ).toEqual({ type: 'badminton.rally', payload: { wonBy: 'ent-home', scorer: 'p-sharma' } });
    const startRow = result.history[0]?.rows.at(-1);
    expect(startRow?.said).toEqual({ key: 'scoring.badminton.last.startUnknownServer' });
  });

  // A game another scorer recorded whole (a full summary, not partial) is game 1's, as its winning rally would be.
  it('lists a game recorded whole, 21–10, under Game 1, and moves the pad to game 2', () => {
    const whole = { type: 'badminton.game.summary', payload: { home: 21, away: 10 } };
    const result = folded([start(), whole]);
    expect(result.display).toMatchObject({
      points: { first: 0, second: 0 },
      finished: [{ points: { first: 21, second: 10 }, winner: 'first' }],
      game: 2,
      phase: 'betweenGames',
    });
    expect(result.history).toEqual([
      {
        heading: { key: 'scoring.badminton.gameHeading', vars: { game: 1 } },
        rows: [
          {
            said: { key: 'scoring.badminton.last.setScore', vars: { score: '21–10' } },
            score: null,
            by: 'otherScorer',
            undone: false,
            sending: false,
          },
          {
            said: { key: 'scoring.badminton.last.startUnknownServer' },
            score: null,
            by: 'otherScorer',
            undone: false,
            sending: false,
          },
        ],
      },
    ]);
  });

  // The engine names no server after a set score until the next rally (`score-jumped`): no plate, no guess.
  it('names no server after a set score between games, until the next rally names one', () => {
    const won = [start(), rally('H', 'H'), ...rallies('H'.repeat(20))];
    const set = display([...won, summary(5, 3)], { toss: 'second' });
    expect(set).toMatchObject({
      points: { first: 5, second: 3 },
      server: null,
      phase: 'betweenGames',
      game: 2,
    });
    expect(badmintonPad(set).halves.map((half) => half.serving)).toEqual([null, null]);
    expect(display([...won, summary(5, 3), rally('A')])).toMatchObject({
      points: { first: 5, second: 4 },
      server: 'second',
      court: 'right',
      phase: 'live',
    });
  });
});

describe('foldBadminton: a disqualification and its ending', () => {
  const DQ: readonly Spec[] = [
    start(),
    rally('H', 'H'),
    sanction('A', 'disqualification', 'p-chen'),
  ];

  it('waits for the ending after a disqualification: the halves take no tap', () => {
    const result = display(DQ);
    expect(result).toMatchObject({
      points: { first: 1, second: 0 },
      phase: 'live',
      sanctions: [{ side: 'second', level: 'disqualification', person: 'L. Chen' }],
      lastTap: { kind: 'sanction', side: 'second', level: 'disqualification', person: 'L. Chen' },
      awaitingEnding: true,
    });
    expect(badmintonPad(result).halves.map((half) => half.tappable)).toEqual([false, false]);
  });

  it('ends the match on the forfeit: the game in play boxed with DQ, the result recorded', () => {
    expect(display([...DQ, forfeit('A')])).toEqual({
      sides: SINGLES_SIDES,
      context: SINGLES_CONTEXT,
      points: { first: 1, second: 0 },
      finished: [{ points: { first: 1, second: 0 }, disqualified: 'second' }],
      server: null,
      court: 'right',
      game: 1,
      rules: STANDARD_RULES,
      phase: 'decided',
      sanctions: [{ side: 'second', level: 'disqualification', person: 'L. Chen' }],
      lastTap: { kind: 'ending', side: 'second', person: 'L. Chen' },
      undoable: false,
      awaitingEnding: false,
      serverPicked: false,
    } satisfies BadmintonDisplay);
  });

  it('boxes a disqualification between games as the next game, at 0–0', () => {
    const between = [...GAME_ONE, sanction('H', 'disqualification', 'p-sharma'), forfeit('H')];
    expect(display(between)).toMatchObject({
      points: { first: 0, second: 0 },
      finished: [
        { points: { first: 21, second: 15 }, winner: 'first' },
        { points: { first: 0, second: 0 }, disqualified: 'first' },
      ],
      game: 2,
      phase: 'decided',
    });
  });

  it('goes on as before when the disqualification is voided', () => {
    expect(display([...DQ, voiding(3)])).toMatchObject({
      points: { first: 1, second: 0 },
      server: 'first',
      phase: 'live',
      sanctions: [],
      awaitingEnding: false,
      lastTap: {
        kind: 'undone',
        tap: { kind: 'sanction', side: 'second', level: 'disqualification', person: 'L. Chen' },
      },
    });
  });

  it('names a sanctioned doubles player by the bootstrap’s name, and the side when none is named', () => {
    const result = display(
      [start(), rally('H', 'H'), sanction('A', 'warning', 'p-wong'), sanction('H', 'penalty')],
      { bootstrap: DOUBLES },
    );
    expect(result.sides).toEqual({
      first: { players: ['A. Sharma', 'R. Iyer'] },
      second: { players: ['L. Chen', 'M. Wong'] },
    });
    expect(result.sanctions).toEqual([
      { side: 'second', level: 'warning', person: 'M. Wong' },
      { side: 'first', level: 'penalty', person: 'A. Sharma / R. Iyer' },
    ]);
  });
});

describe('foldBadminton: which queued taps are still legal', () => {
  const DECIDED: readonly Spec[] = [...GAME_ONE, ...rallies('H'.repeat(21))];

  // Review Focus 3: another scorer finished the match while this phone was offline.
  it('drops a queued rally the match another scorer decided no longer takes, and does not show it', () => {
    const result = folded(DECIDED, { queued: [queuedOf('k-late', rally('A'))] });
    expect(result.legalQueued).toEqual([]);
    expect(result.display.points).toEqual({ first: 21, second: 0 });
    expect(result.display.undoable).toBe(false);
    expect(result.history.flatMap((group) => group.rows).some((row) => row.sending)).toBe(false);
  });

  // Task 9 additions: an illegal tap is skipped and the ones behind it are judged on the ledger without it.
  it('skips a queued start another scorer already made, and keeps judging the rally behind it', () => {
    const result = folded([start()], {
      queued: [queuedOf('k-start', start()), queuedOf('k-rally', rally('H', 'A'))],
      toss: 'second',
    });
    expect(result.legalQueued).toEqual(['k-rally']);
    expect(result.display).toMatchObject({ points: { first: 1, second: 0 }, server: 'first' });
  });

  // The web refuses an undo of an entry already undone (UNDO_ALREADY_VOIDED); the engine alone would take it.
  it('drops a queued undo of a tap another device already undid', () => {
    const ledger = [start(), rally('H', 'H'), { ...voiding(2), link: PHONE_LINK }];
    const result = folded(ledger, {
      own: ['ev-2'],
      queued: [queuedOf('k-undo', voiding(2)), queuedOf('k-next', rally('A'))],
    });
    expect(result.legalQueued).toEqual(['k-next']);
  });

  // The web takes a scorer's forfeit only as the ending of the sanction right before it (D13, `scorerMayForfeit`); the
  // engine alone takes a forfeit with no sanction at all.
  it('drops a queued ending once its disqualification is voided, and keeps one that still follows it', () => {
    const dq = [start(), rally('H', 'H'), sanction('A', 'disqualification', 'p-chen')];
    const ending = [queuedOf('k-end', forfeit('A'))];
    expect(folded([...dq, voiding(3)], { queued: ending }).legalQueued).toEqual([]);
    const kept = folded(dq, { queued: ending });
    expect(kept.legalQueued).toEqual(['k-end']);
    expect(kept.display.phase).toBe('decided');
  });

  // Another rule set (the four questions): the organiser cut the games to 15 after a set score of 15–10 was recorded.
  // The server judges only the new event strictly, so the ledger's own event stands and a rally behind it is legal.
  it('judges a queued tap alone strictly, not the ledger event before it that the edited rules would refuse', () => {
    const edited: Bootstrap = { ...SINGLES, cfg: { setTo: 15, finalSetTo: 15, cap: 21 } };
    const result = folded([start(), summary(15, 10)], {
      bootstrap: edited,
      queued: [queuedOf('k', rally('H'))],
    });
    expect(result.legalQueued).toEqual(['k']);
  });

  it('keeps every queued tap the match still takes, in order', () => {
    const queued = [
      queuedOf('k1', rally('A')),
      queuedOf('k2', sanction('H', 'warning', 'p-sharma')),
    ];
    expect(folded(GAME_ONE, { queued }).legalQueued).toEqual(['k1', 'k2']);
  });
});

describe('foldBadminton: Undo is offered', () => {
  it('on this phone’s last event, and not once another scorer’s rally stands after it', () => {
    const ledger = [start(), rally('H', 'H'), rally('A')];
    expect(display(ledger, { own: ['ev-2', 'ev-3'] }).undoable).toBe(true);
    expect(display(ledger, { own: ['ev-2'] }).undoable).toBe(false);
    expect(display(ledger, { own: ['ev-2'], queued: [queuedOf('k', rally('H'))] }).undoable).toBe(
      true,
    );
  });
});

describe('foldBadminton: when it cannot fold', () => {
  it('says the config, for a cfg the engine’s schema refuses', () => {
    expect(fold([], { bootstrap: { ...SINGLES, cfg: 'garbled' } })).toEqual({
      kind: 'unfoldable',
      reason: 'cfg',
    });
  });

  it('says the sides, for a seat with no entrant yet', () => {
    const waiting: Bootstrap = { ...SINGLES, sides: { ...SINGLES.sides, away: null } };
    expect(fold([], { bootstrap: waiting })).toEqual({ kind: 'unfoldable', reason: 'sides' });
  });

  it('says the ledger, for one the engine will not replay', () => {
    expect(fold([rally('H')])).toEqual({ kind: 'unfoldable', reason: 'ledger' });
  });
});

describe('foldBadminton: a second call', () => {
  it('answers the same for the same input, and changes none of it', () => {
    const ledger: readonly LedgerEvent[] = Object.freeze(
      ledgerOf([...GAME_ONE, sanction('A', 'warning')]),
    );
    const queued = Object.freeze([queuedOf('k', rally('A'))]);
    const input: BadmintonFoldInput = Object.freeze({
      bootstrap: SINGLES,
      ledger,
      queued,
      ownEventIds: Object.freeze(['ev-2']),
      toss: null,
    });
    const before = JSON.stringify(input);
    expect(foldBadminton(input)).toEqual(foldBadminton(input));
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe('foldBadminton: the start and the first rally', () => {
  // The pick travels on the match's first rally (design §7.3); after it the engine names the server, which a singles
  // rally then carries as a person, as the web's does (review item 2).
  it('names the toss side serving on the first rally the fold’s display makes, and on no rally after', () => {
    const toss = 'second' as const;
    const pre = display([start()], { toss });
    expect(
      badmintonEventFor({ kind: 'rally', side: 'first' }, { bootstrap: SINGLES, display: pre }),
    ).toEqual({
      type: 'badminton.rally',
      payload: { wonBy: 'ent-home', serving: 'ent-away', scorer: 'p-sharma' },
    });
    const live = display([start(), rally('H', 'A')], { toss });
    expect(
      badmintonEventFor({ kind: 'rally', side: 'first' }, { bootstrap: SINGLES, display: live }),
    ).toEqual({
      type: 'badminton.rally',
      payload: { wonBy: 'ent-home', server: 'p-sharma', scorer: 'p-sharma' },
    });
    // The engine takes both as the phone sends them: each judged strictly, as the server would.
    const tapped = (made: ReturnType<typeof badmintonEventFor>) => {
      if (made === null) throw new Error('no event');
      return [queuedOf('k', made)];
    };
    const firstRally = badmintonEventFor(
      { kind: 'rally', side: 'first' },
      { bootstrap: SINGLES, display: pre },
    );
    expect(folded([start()], { toss, queued: tapped(firstRally) }).legalQueued).toEqual(['k']);
    const nextRally = badmintonEventFor(
      { kind: 'rally', side: 'first' },
      { bootstrap: SINGLES, display: live },
    );
    expect(folded([start(), rally('H', 'A')], { queued: tapped(nextRally) }).legalQueued).toEqual([
      'k',
    ]);
  });

  // An empty input: another scorer started the match and this phone holds no pick. Nobody is made the server.
  it('names no server for a match started elsewhere until its first rally: “Match started”', () => {
    const result = display([start()]);
    expect(result).toMatchObject({
      phase: 'pre',
      server: null,
      lastTap: { kind: 'start', server: null },
    });
    expect(badmintonPad(result).halves.map((half) => half.serving)).toEqual([null, null]);
    expect(badmintonPad(result).lastTap?.text).toEqual({
      key: 'scoring.badminton.last.startUnknownServer',
    });
  });

  // An empty input: a match started elsewhere whose first rally named nobody serving. The start's row says no server.
  it('leaves the start’s server unsaid when the first rally names none', () => {
    const rows = folded([start(), rally('H')]).history.flatMap((group) => group.rows);
    expect(rows[rows.length - 1]?.said).toEqual({
      key: 'scoring.badminton.last.startUnknownServer',
    });
  });

  // Review item 3 (2026-11-02): once the server's ledger holds a rally, even one undone since, the pick is never drawn:
  // its first send would carry no `serving` (`payloadForSend`), so a plate for it would be a guess.
  it('draws no picked server once the ledger holds a rally, even one undone since', () => {
    const undone = [start(), rally('H'), voiding(2)];
    expect(display(undone, { toss: 'first' })).toMatchObject({
      points: { first: 0, second: 0 },
      phase: 'pre',
      server: null,
      serverPicked: false,
    });
    expect(display([start()], { toss: 'first' })).toMatchObject({
      server: 'first',
      serverPicked: true,
    });
  });

  // After an interruption: the start was undone and the phone still holds its pick. Nothing serves on the Start screen.
  it('draws no picked server on the Start screen, the pick held from a start since undone', () => {
    const ledger = [
      { ...start(), link: PHONE_LINK },
      { ...voiding(1), link: PHONE_LINK },
    ];
    expect(display(ledger, { own: ['ev-1', 'ev-2'], toss: 'second' })).toMatchObject({
      phase: 'notStarted',
      server: null,
      serverPicked: false,
    });
  });

  it('returns to the Start screen when the start is undone, with no line and nothing to undo', () => {
    const ledger = [
      { ...start(), link: PHONE_LINK },
      { ...voiding(1), link: PHONE_LINK },
    ];
    expect(display(ledger, { own: ['ev-1', 'ev-2'] })).toMatchObject({
      phase: 'notStarted',
      lastTap: null,
      undoable: false,
    });
  });
});

describe('foldBadminton: History from the ledger', () => {
  // ev-2 is a browser on this phone's own link: own is the phone's ids, never the link. ev-3 is the stand-in built from
  // a tap this phone sent (the phone's clock, no link), which this phone then undid (ev-4).
  const LEDGER: readonly Spec[] = [
    start(),
    { ...rally('H', 'H'), link: PHONE_LINK },
    { ...rally('A'), link: null },
    { ...voiding(3), link: PHONE_LINK },
  ];

  it('lists every scorer’s taps newest first, an undone one in its place, no row for the void, a queued one sending', () => {
    const result = folded(LEDGER, {
      own: [eventId(3), eventId(4)],
      queued: [queuedOf('k1', rally('H'))],
    });
    expect(result.history).toEqual([
      {
        heading: { key: 'scoring.badminton.gameHeading', vars: { game: 1 } },
        rows: [
          {
            said: { key: 'scoring.badminton.last.rally', vars: { side: 'A. Sharma' } },
            score: '2–0',
            by: 'thisPhone',
            undone: false,
            sending: true,
          },
          {
            said: { key: 'scoring.badminton.last.rally', vars: { side: 'L. Chen' } },
            score: '1–1',
            by: 'thisPhone',
            undone: true,
            sending: false,
          },
          {
            said: { key: 'scoring.badminton.last.rally', vars: { side: 'A. Sharma' } },
            score: '1–0',
            by: 'otherScorer',
            undone: false,
            sending: false,
          },
          {
            said: { key: 'scoring.badminton.last.start', vars: { side: 'A. Sharma' } },
            score: null,
            by: 'otherScorer',
            undone: false,
            sending: false,
          },
        ],
      },
    ]);
  });

  it('shows this phone’s queued undo at once: the rally undone in its place, the score back, no row for the void', () => {
    const ledger = [start(), { ...rally('H', 'H'), link: PHONE_LINK }];
    const result = folded(ledger, { own: [eventId(2)], queued: [queuedOf('k-undo', voiding(2))] });
    expect(result.legalQueued).toEqual(['k-undo']);
    expect(result.display).toMatchObject({
      points: { first: 0, second: 0 },
      lastTap: { kind: 'undone', tap: { kind: 'rally', side: 'first' } },
      undoable: false,
    });
    expect(result.history[0]?.rows.map((row) => [row.score, row.undone, row.sending])).toEqual([
      ['1–0', true, false],
      [null, false, false],
    ]);
  });

  it('says the last tap was undone when the void is the latest event', () => {
    expect(display(LEDGER, { own: [eventId(3), eventId(4)] })).toMatchObject({
      points: { first: 1, second: 0 },
      lastTap: { kind: 'undone', tap: { kind: 'rally', side: 'second' } },
      undoable: false,
    });
  });

  it('groups by game, the latest first, and lists an organiser’s finalize nowhere', () => {
    const decided = [
      ...GAME_ONE,
      ...rallies('H'.repeat(21)),
      { type: 'core.finalize', payload: {} },
    ];
    const result = folded(decided);
    expect(result.display.phase).toBe('decided');
    expect(result.history.map((group) => [group.heading.vars, group.rows.length])).toEqual([
      [{ game: 2 }, 21],
      [{ game: 1 }, 37],
    ]);
    expect(result.history[0]?.rows[0]).toEqual({
      said: { key: 'scoring.badminton.last.match', vars: { side: 'A. Sharma' } },
      score: '21–0',
      by: 'otherScorer',
      undone: false,
      sending: false,
    });
  });

  it('still offers Undo on this phone’s own tap that decided the match', () => {
    const won = [...GAME_ONE, ...rallies('H'.repeat(20)), { ...rally('H'), link: PHONE_LINK }];
    expect(display(won, { own: [eventId(won.length)] })).toMatchObject({
      phase: 'decided',
      undoable: true,
    });
  });
});

describe('foldBadminton: endings and set scores another scorer wrote', () => {
  it('names the disqualified doubles player on the ending, not the side', () => {
    const ledger = [
      start(),
      rally('H', 'H'),
      sanction('A', 'disqualification', 'p-wong'),
      forfeit('A'),
    ];
    expect(display(ledger, { bootstrap: DOUBLES }).lastTap).toEqual({
      kind: 'ending',
      side: 'second',
      person: 'M. Wong',
    });
  });

  // The pad writes only a disqualification's ending (D13); a retirement after a disqualification is not it.
  it('drops a queued forfeit that is not the disqualification’s ending', () => {
    const dq = [start(), rally('H', 'H'), sanction('A', 'disqualification', 'p-chen')];
    const retired = { type: 'core.forfeit', payload: { by: 'ent-away', reason: 'retired' } };
    expect(folded(dq, { queued: [queuedOf('k-end', retired)] }).legalQueued).toEqual([]);
  });

  // An organiser may end a match any way the web allows. No box says DQ, and the pad has no words for it.
  it('ends the match on an organiser’s forfeit with no DQ box and no row of its own', () => {
    const retired = { type: 'core.forfeit', payload: { by: 'ent-away', reason: 'retired' } };
    const result = folded([start(), rally('H', 'H'), rally('A'), retired]);
    expect(result.display).toMatchObject({
      points: { first: 1, second: 1 },
      finished: [],
      game: 1,
      phase: 'decided',
      lastTap: { kind: 'rally', side: 'second', won: 'none', game: 1 },
    });
    expect(result.history[0]?.rows).toHaveLength(3);
  });

  it('reads a set score the engine’s other form wrote, by entrant, top first', () => {
    const byEntrant = {
      type: 'badminton.game.summary',
      payload: { by: 'ent-away', forBy: 3, forOpp: 5, partial: true },
    };
    expect(display([start(), byEntrant])).toMatchObject({
      points: { first: 5, second: 3 },
      lastTap: { kind: 'setScore', first: 5, second: 3 },
    });
  });

  it('names a side with no members listed by the side’s own name', () => {
    const team: Bootstrap = {
      ...SINGLES,
      sides: {
        home: {
          entrantId: 'ent-home',
          name: 'Riverside BC',
          kind: 'team',
          members: [],
          lineup: [],
        },
        away: SINGLES.sides.away,
      },
    };
    expect(display([], { bootstrap: team }).sides.first).toEqual({ players: ['Riverside BC'] });
  });
});

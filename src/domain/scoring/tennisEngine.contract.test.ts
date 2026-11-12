import {
  EngineError,
  foldMatch,
  type EventEnvelope,
  type LineupPair,
  type MatchOutcome,
} from '@seazn/engine/core';
import { tennisPadRules } from '@seazn/engine/pad';
import { foldEpochOf } from '@seazn/engine/sport';
import { serveContext } from '@seazn/engine/sports/nested';
import { tennis } from '@seazn/engine/sports/tennis';
import { describe, expect, it } from 'vitest';

/**
 * Engine 7.0.0's tennis, read against every event the S2-7 pad sends (plan Task 1). Each fact is its own `it`, its
 * expected value from the ITF rules or the spec's table (never read back from the engine), and every one is run against
 * the real fold with the server's strictness (`strictFromSeq` at the last event). A failing `it` is a finding for the
 * controller, not a thing to bend the test around. Written with its own tiny builders: the shared ledger fixture
 * (`test/tennisLedger.ts`) is Task 3's, and rests on what this file proves.
 */

const HOME = 'ent-home';
const AWAY = 'ent-away';
type Spec = { readonly type: string; readonly payload: unknown };
const SIDE = { H: HOME, A: AWAY } as const;

const singles: LineupPair = {
  home: { entrantId: HOME, slots: [{ personId: 'h1', slot: 'starting', orderNo: 1 }] },
  away: { entrantId: AWAY, slots: [{ personId: 'a1', slot: 'starting', orderNo: 1 }] },
};
const doubles: LineupPair = {
  home: {
    entrantId: HOME,
    slots: [
      { personId: 'h1', slot: 'starting', orderNo: 1, pairOrder: 1 },
      { personId: 'h2', slot: 'starting', orderNo: 2, pairOrder: 2 },
    ],
  },
  away: {
    entrantId: AWAY,
    slots: [
      { personId: 'a1', slot: 'starting', orderNo: 1, pairOrder: 1 },
      { personId: 'a2', slot: 'starting', orderNo: 2, pairOrder: 2 },
    ],
  },
};

const start: Spec = { type: 'core.start', payload: {} };
const pt = (seat: 'H' | 'A', more: object = {}): Spec => ({
  type: 'tennis.point',
  payload: { by: SIDE[seat], ...more },
});
const pts = (winners: string): Spec[] => [...winners].map((l) => pt(l === 'H' ? 'H' : 'A'));
const summary = (home: number, away: number, tb?: { home: number; away: number }): Spec => ({
  type: 'tennis.set_summary',
  payload: { home, away, ...(tb === undefined ? {} : { tb }) },
});
const sanction = (seat: 'H' | 'A', level: string, more: object = {}): Spec => ({
  type: 'tennis.sanction',
  payload: { by: SIDE[seat], level, ...more },
});
const award = (seat: 'H' | 'A'): Spec => ({
  type: 'tennis.game.award',
  payload: { winner: SIDE[seat] },
});
const interruption = (payload: object): Spec => ({ type: 'tennis.interruption', payload });
/** Four points to one side: a love game. */
const game = (seat: 'H' | 'A'): Spec[] => pts(seat === 'H' ? 'HHHH' : 'AAAA');

const envelopes = (specs: readonly Spec[]): EventEnvelope[] =>
  specs.map((spec, i) => ({
    id: `ev-${i + 1}`,
    fixtureId: 'fx-tennis',
    seq: i + 1,
    type: spec.type,
    payload: spec.payload,
    recordedAt: new Date(Date.parse('2026-11-12T10:00:00.000Z') + (i + 1) * 1000).toISOString(),
    recordedBy: null,
  }));

const cfgOf = (raw: unknown) => tennis.configSchema.parse(raw);

/** The state after `specs`, folded as the server folds an append: strict at the last event. */
function stateAfter(raw: unknown, specs: readonly Spec[], lineups: LineupPair = singles) {
  const events = envelopes(specs);
  return foldMatch(tennis, cfgOf(raw), lineups, events, {
    strictFromSeq: events.length,
  });
}

/** The engine's word against the LAST spec (everything before it must be accepted), or null when it takes it. */
function wordFor(
  raw: unknown,
  specs: readonly Spec[],
  lineups: LineupPair = singles,
): string | null {
  try {
    stateAfter(raw, specs, lineups);
    return null;
  } catch (error) {
    if (EngineError.is(error)) return error.code;
    throw error;
  }
}

const TOUR = {};
const NOAD = { game: { noAd: true } };
const MTB10 = { finalSet: { matchTiebreakTo: 10 } };

describe('the start and the serve', () => {
  it('core.start {} takes a match from pre to live, and home serves before any point (ruling 216)', () => {
    expect(stateAfter(TOUR, []).phase).toBe('pre');
    const live = stateAfter(TOUR, [start]);
    expect(live.phase).toBe('live');
    expect(live.serving).toBe('home');
  });

  it('serve changes every game: after one game the other side serves', () => {
    expect(stateAfter(TOUR, [start, ...game('H')]).serving).toBe('away');
    expect(stateAfter(TOUR, [start, ...game('H'), ...game('A')]).serving).toBe('home');
  });
});

describe('tennis.point', () => {
  it('{by} alone is accepted (ruling 217)', () => {
    expect(wordFor(TOUR, [start, pt('H')])).toBeNull();
    expect(wordFor(TOUR, [start, pt('A')])).toBeNull();
  });

  it('a point carrying `serving` is refused INVALID_EVENT: the phone never anchors the serve', () => {
    expect(wordFor(TOUR, [start, pt('H', { serving: HOME })])).toBe('INVALID_EVENT');
  });

  it('a point before the start is refused WRONG_PHASE', () => {
    expect(wordFor(TOUR, [pt('H')])).toBe('WRONG_PHASE');
  });

  it('the game call: 15, 30, 40 for the points one to three (ITF Rule 5(a))', () => {
    expect(tennisPadRules.pointCalls).toEqual(['0', '15', '30', '40']);
    const s = stateAfter(TOUR, [start, ...pts('HH')]);
    expect(s.points).toEqual({ kind: 'standard', home: 2, away: 0, advantage: null });
  });
});

describe('deuce and the no-ad game', () => {
  it('3-3 is deuce: no advantage; one more point gives it to the scorer', () => {
    const deuce = stateAfter(TOUR, [start, ...pts('HHHAAA')]);
    expect(deuce.points).toEqual({ kind: 'standard', home: 3, away: 3, advantage: null });
    const adv = stateAfter(TOUR, [start, ...pts('HHHAAAH')]);
    expect(adv.points).toEqual({ kind: 'standard', home: 3, away: 3, advantage: 'home' });
    expect(adv.games).toEqual({ home: 0, away: 0 });
  });

  it('advantage lost goes back to deuce, and advantage then a point wins the game', () => {
    const back = stateAfter(TOUR, [start, ...pts('HHHAAAHA')]);
    expect(back.points.kind === 'standard' && back.points.advantage).toBeNull();
    expect(stateAfter(TOUR, [start, ...pts('HHHAAAHH')]).games).toEqual({ home: 1, away: 0 });
  });

  it('with game.noAd the point at 3-3 wins the game (the deciding point)', () => {
    expect(stateAfter(NOAD, [start, ...pts('HHHAAA')]).games).toEqual({ home: 0, away: 0 });
    expect(stateAfter(NOAD, [start, ...pts('HHHAAAH')]).games).toEqual({ home: 1, away: 0 });
    expect(stateAfter(NOAD, [start, ...pts('HHHAAAA')]).games).toEqual({ home: 0, away: 1 });
  });
});

describe('the tie-break, the match tie-break and the serve inside them', () => {
  const sixAll: Spec[] = [
    start,
    ...[1, 2, 3, 4, 5].flatMap(() => [...game('H'), ...game('A')]),
    ...game('H'),
    ...game('A'),
  ];

  it('Tour 6-6 opens a tie-break (ITF Rule 5(b)), counted in points from 0-0', () => {
    const s = stateAfter(TOUR, sixAll);
    expect(s.games).toEqual({ home: 6, away: 6 });
    expect(s.points).toEqual({ kind: 'tiebreak', home: 0, away: 0 });
  });

  it('in a tie-break the first point is served by the side due to serve, the next two by the other, then every two', () => {
    // Twelve games played, six each: home served game 1, so home serves the tie-break's first point.
    const served = [0, 1, 2, 3, 4, 5, 6].map(
      (n) => stateAfter(TOUR, [...sixAll, ...pts('H'.repeat(n))]).serving,
    );
    expect(served).toEqual(['home', 'away', 'away', 'home', 'home', 'away', 'away']);
  });

  it('a tie-break is won to 7 by 2', () => {
    const s = stateAfter(TOUR, [...sixAll, ...pts('HHHHHHH')]);
    expect(s.sets).toEqual([{ home: 7, away: 6, tb: { home: 7, away: 0 } }]);
  });

  it('{finalSet:{matchTiebreakTo:10}} at one set all opens a match tie-break', () => {
    const oneAll = [
      start,
      ...[...Array(6)].flatMap(() => game('H')),
      ...[...Array(6)].flatMap(() => game('A')),
    ];
    const s = stateAfter(MTB10, [...oneAll.slice(0, 1), ...oneAll.slice(1)]);
    expect(s.setsWon).toEqual({ home: 1, away: 1 });
    expect(s.points).toEqual({ kind: 'matchTiebreak', home: 0, away: 0 });
  });
});

describe('Fast4 (ITF App VI short sets)', () => {
  const FAST4 = {
    set: { gamesTo: 4, winBy: 2, tiebreakAt: 3, tiebreakTo: 5, tiebreakWinBy: 1 },
    game: { noAd: true },
  };
  const threeAll = [start, ...[1, 2, 3].flatMap(() => [...game('H'), ...game('A')])];

  it('a set tie-break opens at 3-3, and its deciding point at 4-4 wins it 5-4 (margin one, TN-SS-2)', () => {
    expect(stateAfter(FAST4, threeAll).points).toEqual({ kind: 'tiebreak', home: 0, away: 0 });
    const eachFour = [...threeAll, ...pts('HAHAHAHA')];
    expect(stateAfter(FAST4, eachFour).sets).toEqual([]);
    expect(stateAfter(FAST4, [...eachFour, pt('H')]).sets).toEqual([
      { home: 4, away: 3, tb: { home: 5, away: 4 } },
    ]);
  });
});

describe('tennis.set_summary', () => {
  it('{home:6,away:4} is accepted at 0-0 and banks the set', () => {
    expect(wordFor(TOUR, [start, summary(6, 4)])).toBeNull();
    expect(stateAfter(TOUR, [start, summary(6, 4)]).sets).toEqual([{ home: 6, away: 4 }]);
  });

  it('7-6 is refused without `tb` and accepted with tb 7-5', () => {
    expect(wordFor(TOUR, [start, summary(7, 6)])).not.toBeNull();
    expect(wordFor(TOUR, [start, summary(7, 6, { home: 7, away: 5 })])).toBeNull();
    expect(stateAfter(TOUR, [start, summary(7, 6, { home: 7, away: 5 })]).sets).toEqual([
      { home: 7, away: 6, tb: { home: 7, away: 5 } },
    ]);
  });

  it('`tb` is refused in a match tie-break decider; the decider is entered as its points', () => {
    const oneAll = [start, summary(6, 4), summary(4, 6)];
    expect(wordFor(MTB10, [...oneAll, summary(10, 7, { home: 10, away: 7 })])).not.toBeNull();
    expect(wordFor(MTB10, [...oneAll, summary(10, 7)])).toBeNull();
    expect(stateAfter(MTB10, [...oneAll, summary(10, 7)]).sets[2]).toEqual({
      home: 10,
      away: 7,
      mtb: true,
    });
  });

  it('an unreachable score is SET_SCORE_UNREACHABLE', () => {
    expect(wordFor(TOUR, [start, summary(9, 2)])).toBe('SET_SCORE_UNREACHABLE');
  });

  it('is refused once a point of the set is standing', () => {
    expect(wordFor(TOUR, [start, pt('H'), summary(6, 4)])).not.toBeNull();
  });
});

describe('the serve after a set score', () => {
  it('FINDING: an odd-games set_summary does not turn the serve over: 6-3 leaves home serving, the order unknown', () => {
    // ITF Rule 10 would have away serving after nine games (home served the first). The engine keeps the serve where it
    // was and says it cannot name the order (`serveContext.serveOrderKnown`), so the pad must not trust the ball here.
    const s = stateAfter(TOUR, [start, summary(6, 3)]);
    expect(s.serving).toBe('home');
    expect(serveContext(s).serveOrderKnown).toBe(false);
    expect(serveContext(stateAfter(TOUR, [start, summary(6, 4)])).serveOrderKnown).toBe(true);
  });
});

describe('tennis.sanction', () => {
  it('a warning, a point penalty and a game penalty move no score (TN-SE-2)', () => {
    const before = stateAfter(TOUR, [start, ...pts('HA')]);
    for (const level of ['warning', 'point_penalty', 'game_penalty']) {
      const after = stateAfter(TOUR, [start, ...pts('HA'), sanction('H', level)]);
      expect(after.points).toEqual(before.points);
      expect(after.games).toEqual(before.games);
    }
  });

  it('a default makes the next point ENDING_SANCTION_PENDING (TN-SE-1)', () => {
    expect(wordFor(TOUR, [start, sanction('A', 'default'), pt('H')])).toBe(
      'ENDING_SANCTION_PENDING',
    );
  });

  it('a sanction in doubles names a person of that side', () => {
    expect(wordFor(TOUR, [start, sanction('H', 'warning', { person: 'h2' })], doubles)).toBeNull();
  });
});

describe('tennis.game.award', () => {
  it('closes the game for the winner', () => {
    expect(stateAfter(TOUR, [start, award('H')]).games).toEqual({ home: 1, away: 0 });
  });

  it('inside a tie-break it is refused GAME_AWARD_DURING_TIEBREAK', () => {
    const sixAll = [start, ...[1, 2, 3, 4, 5, 6].flatMap(() => [...game('H'), ...game('A')])];
    expect(wordFor(TOUR, [...sixAll, award('H')])).toBe('GAME_AWARD_DURING_TIEBREAK');
  });
});

describe('tennis.interruption', () => {
  it('{kind} and {kind, by} are accepted', () => {
    expect(wordFor(TOUR, [start, interruption({ kind: 'medical' })])).toBeNull();
    expect(wordFor(TOUR, [start, interruption({ kind: 'heat', by: HOME })])).toBeNull();
  });

  it('{kind, person} without `by` is refused', () => {
    expect(wordFor(TOUR, [start, interruption({ kind: 'toilet', person: 'h1' })])).not.toBeNull();
  });
});

describe('what the organiser ends a match with', () => {
  const outcomeOf = (specs: readonly Spec[]): MatchOutcome | null =>
    stateAfter(TOUR, specs).outcome;

  it('core.forfeit by the retiring side gives an award to the other, reason retired', () => {
    const s = stateAfter(TOUR, [
      start,
      ...pts('HA'),
      { type: 'core.forfeit', payload: { by: AWAY, reason: 'retired' } },
    ]);
    expect(s.phase).toBe('done');
    expect(s.outcome).toEqual({ kind: 'award', winner: HOME, loser: AWAY, reason: 'retired' });
  });

  it('core.abandon {reason} ends the match abandoned, with the fold flagged', () => {
    const s = stateAfter(TOUR, [start, { type: 'core.abandon', payload: { reason: 'rain' } }]);
    expect(s.phase).toBe('abandoned');
    expect(outcomeOf([start])).toBeNull();
  });
});

describe('the pad rules and the bounds', () => {
  it('lists the sanction levels and interruption kinds in the engine’s order', () => {
    expect([...tennisPadRules.sanctionLevels]).toEqual([
      'warning',
      'point_penalty',
      'game_penalty',
      'default',
    ]);
    expect([...tennisPadRules.interruptionKinds]).toEqual(['medical', 'toilet', 'heat', 'other']);
  });

  it('bounds a set score field by the format, as literals (7.0.0): Tour, Grand Slam, Fast4, doubles no-ad', () => {
    const fast4 = {
      set: { gamesTo: 4, winBy: 2, tiebreakAt: 3, tiebreakTo: 5, tiebreakWinBy: 1 },
      game: { noAd: true },
    };
    const slam = { bestOf: 5, finalSet: { tiebreakTo: 10 } };
    const doublesNoAd = { game: { noAd: true }, finalSet: { matchTiebreakTo: 10 } };
    expect([TOUR, slam, fast4, doublesNoAd].map((c) => tennisPadRules.gamesFieldBound(c))).toEqual([
      10, 10, 8, 12,
    ]);
    expect(
      [TOUR, slam, fast4, doublesNoAd].map((c) => tennisPadRules.tiebreakFieldBound(c)),
    ).toEqual([11, 14, 8, 11]);
  });

  it('the set score offers a tie-break only where a set can end in one', () => {
    expect(tennisPadRules.setScoreTakesTiebreak({}, TOUR, 7, 6)).toBe(true);
    expect(tennisPadRules.setScoreTakesTiebreak({}, TOUR, 6, 4)).toBe(false);
  });

  it('the epoch is 2', () => {
    expect(foldEpochOf('tennis')).toBe(2);
  });
});

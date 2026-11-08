import { describe, expect, it } from 'vitest';
import { foldFootball } from '@/domain/scoring/footballFold';
import type { FootballDisplay } from '@/domain/scoring/footballTypes';
import type { SportFold } from '@/domain/scoring/scoringSport';
import type { FootballTypes } from '@/domain/scoring/footballTypes';
import type { QueuedEvent } from '@/domain/scoring/queue';
import type { Bootstrap, LedgerEvent } from '@/domain/scoring/wire';
import {
  at,
  CAPPED,
  card,
  clock,
  eventId,
  goal,
  kick,
  KO_11,
  LEAGUE_11,
  ledgerOf,
  MATCH,
  MINI,
  NO_SHEET,
  NO_SLOTS,
  period,
  queuedOf,
  start,
  sub,
  voiding,
  withCfg,
  type Spec,
} from '../../../test/footballLedger';

/**
 * Football's fold (S2-5 design §4, §6, §7; plan P Task 6). Every expected value is written out from the Laws, the design
 * and what staging answered (§4), never computed by the fold.
 */

type Input = {
  readonly bootstrap?: Bootstrap;
  readonly ledger?: readonly LedgerEvent[];
  readonly queued?: readonly QueuedEvent[];
  readonly ownEventIds?: readonly string[];
};

const folding = (input: Input): SportFold<FootballTypes> =>
  foldFootball({
    bootstrap: input.bootstrap ?? MATCH,
    ledger: input.ledger ?? [],
    queued: input.queued ?? [],
    ownEventIds: input.ownEventIds ?? [],
    toss: null,
  });

function folded(input: Input): Extract<SportFold<FootballTypes>, { kind: 'folded' }> {
  const result = folding(input);
  if (result.kind !== 'folded') throw new Error(`unfoldable: ${result.reason}`);
  return result;
}

const displayOf = (specs: readonly Spec[], bootstrap: Bootstrap = MATCH): FootballDisplay =>
  folded({ bootstrap, ledger: ledgerOf(specs) }).display;

const ids = (players: readonly { readonly personId: string }[]) => players.map((p) => p.personId);

const H = (n: number) => `H-p${n}`;
const A = (n: number) => `A-p${n}`;
const player = (id: string, name: string, number: number) => ({ personId: id, name, number });

/** Kick-off: the start, then the clock running from 0. */
const KICK_OFF: readonly Spec[] = [start(), clock(true, at('H1', 0))];
/** Level through 90 minutes. */
const LEVEL_AT_FT: readonly Spec[] = [
  ...KICK_OFF,
  period('HT', at('H1', 2700)),
  clock(true, at('H2', 0)),
  period('FT', at('H2', 2700)),
];
/** Level through extra time too: the shootout. */
const LEVEL_AFTER_ET: readonly Spec[] = [
  ...LEVEL_AT_FT,
  clock(true, at('ET_H1', 0)),
  period('ET_HT', at('ET_H1', 900)),
  clock(true, at('ET_H2', 0)),
  period('ET_FT', at('ET_H2', 900)),
];

describe('foldFootball: the phase', () => {
  it('an empty ledger is notStarted', () => {
    const display = displayOf([]);
    expect([display.phase, display.enginePhase, display.goals, display.kickedOff]).toEqual([
      'notStarted',
      'pre',
      { first: 0, second: 0 },
      false,
    ]);
  });

  it('core.start opens H1 with no anchor', () => {
    const display = displayOf([start()]);
    expect([display.phase, display.enginePhase, display.clock.anchor, display.kickedOff]).toEqual([
      'play',
      'H1',
      null,
      false,
    ]);
  });

  it('anything standing after the start is a kick-off; a voided one is not', () => {
    expect(displayOf(KICK_OFF).kickedOff).toBe(true);
    expect(displayOf([start(), goal({ by: 'H' }), voiding(eventId(2))]).kickedOff).toBe(false);
  });

  it('HT stops the clock and opens H2 with justEnded H1', () => {
    const display = displayOf([...KICK_OFF, period('HT', at('H1', 2760))]);
    expect([
      display.enginePhase,
      display.clock.anchor,
      display.clock.justEnded,
      display.marker,
    ]).toEqual(['H2', null, 'H1', 'FT']);
  });

  it('a voided HT is no break', () => {
    const display = displayOf([...KICK_OFF, period('HT', at('H1', 2760)), voiding(eventId(3))]);
    expect([display.enginePhase, display.clock.justEnded]).toEqual(['H1', null]);
  });

  it('an undone FT goes back to the half-time break before it', () => {
    const display = displayOf([
      ...KICK_OFF,
      period('HT', at('H1', 2760)),
      period('FT', at('H2', 0)),
      voiding(eventId(4)),
    ]);
    expect([display.enginePhase, display.clock.justEnded]).toEqual(['H2', 'H1']);
  });

  it('an undone start shows no last tap: the Start screen is back', () => {
    const display = displayOf([start(), voiding(eventId(1))]);
    expect([display.phase, display.lastTap]).toEqual(['notStarted', null]);
  });

  it('an undone goal is said as undone', () => {
    const display = displayOf([...KICK_OFF, goal({ by: 'H' }), voiding(eventId(3))]);
    expect(display.lastTap).toEqual({
      kind: 'undone',
      tap: { kind: 'goal', side: 'first', scorer: null, ownGoal: false, penalty: false, at: null },
    });
  });

  it('a Start in the new period ends the break', () => {
    const display = displayOf([
      ...KICK_OFF,
      period('HT', at('H1', 2760)),
      clock(true, at('H2', 0)),
    ]);
    expect([
      display.clock.justEnded,
      display.clock.anchor?.period,
      display.clock.anchor?.elapsed,
    ]).toEqual([null, 'H2', 0]);
  });

  it('the marker End of period sends is the one the engine takes now', () => {
    expect(displayOf(KICK_OFF).marker).toBe('HT');
    expect(displayOf(KICK_OFF, withCfg(MATCH, MINI)).marker).toBe('QT');
    expect(displayOf([]).marker).toBeNull();
  });

  it('level at FT with extra time opens ET_H1', () => {
    const display = displayOf(LEVEL_AT_FT);
    expect([display.phase, display.enginePhase, display.clock.justEnded, display.marker]).toEqual([
      'play',
      'ET_H1',
      'H2',
      'ET_HT',
    ]);
  });

  it('level at FT in a league match decides it, a draw', () => {
    const display = displayOf(LEVEL_AT_FT, withCfg(MATCH, LEAGUE_11));
    expect([display.phase, display.goals]).toEqual(['decided', { first: 0, second: 0 }]);
  });

  // The brief said "next first"; the engine's `expectedKicker` (sports/period/shootout.js:56) names nobody before the first
  // kick: the referee's toss decides who opens, and either team's first kick is taken.
  it('level at ET_FT opens the shootout, either team to kick first', () => {
    const display = displayOf(LEVEL_AFTER_ET);
    expect([display.phase, display.enginePhase, display.shootout, display.marker]).toEqual([
      'shootout',
      'SHOOTOUT',
      { kicks: [], next: null, scored: { first: 0, second: 0 } },
      null,
    ]);
  });

  it('after away opens the kicks, home is next, and away again after home', () => {
    const one = displayOf([...LEVEL_AFTER_ET, kick({ by: 'A', scored: true })]);
    const two = displayOf([
      ...LEVEL_AFTER_ET,
      kick({ by: 'A', scored: true }),
      kick({ by: 'H', scored: false }),
    ]);
    expect([one.shootout?.next, two.shootout?.next]).toEqual(['first', 'second']);
  });
});

/** 4–1 on penalties: home scores four, away one of three, and home's fourth decides it. */
const SHOOTOUT_4_1: readonly Spec[] = [
  ...LEVEL_AFTER_ET,
  kick({ by: 'H', scored: true }),
  kick({ by: 'A', scored: false }),
  kick({ by: 'H', scored: true }),
  kick({ by: 'A', scored: false }),
  kick({ by: 'H', scored: true }),
  kick({ by: 'A', scored: true }),
  kick({ by: 'H', scored: true }),
];

describe('foldFootball: the shootout', () => {
  it('the deciding kick decides', () => {
    const display = displayOf(SHOOTOUT_4_1);
    expect([display.phase, display.shootout?.scored]).toEqual(['decided', { first: 4, second: 1 }]);
  });

  it('undoing the deciding kick reopens the shootout', () => {
    const display = displayOf([...SHOOTOUT_4_1, voiding(eventId(SHOOTOUT_4_1.length))]);
    expect([display.phase, display.shootout?.next, display.shootout?.scored]).toEqual([
      'shootout',
      'first',
      { first: 3, second: 1 },
    ]);
  });

  it('lists the kicks by seat, in order', () => {
    const display = displayOf(SHOOTOUT_4_1.slice(0, LEVEL_AFTER_ET.length + 2));
    expect(display.shootout?.kicks).toEqual([
      { side: 'first', scored: true },
      { side: 'second', scored: false },
    ]);
  });
});

describe('foldFootball: goals', () => {
  it('a goal by H-p9 scores home 1–0', () => {
    const display = displayOf([...KICK_OFF, goal({ by: 'H', scorer: H(9), at: at('H1', 600) })]);
    expect([display.goals, display.lastTap]).toEqual([
      { first: 1, second: 0 },
      {
        kind: 'goal',
        side: 'first',
        scorer: player(H(9), 'Home Player 9', 9),
        ownGoal: false,
        penalty: false,
        at: at('H1', 600),
      },
    ]);
  });

  it('an own goal by an away player credits home', () => {
    const display = displayOf([...KICK_OFF, goal({ by: 'A', ownGoal: true, scorer: A(4) })]);
    expect([display.goals, display.lastTap]).toEqual([
      { first: 1, second: 0 },
      {
        kind: 'goal',
        side: 'first',
        scorer: player(A(4), 'Away Player 4', 4),
        ownGoal: true,
        penalty: false,
        at: null,
      },
    ]);
  });

  it('a console goal naming a player folds on a side with no slots', () => {
    const display = displayOf([start(), goal({ by: 'H', scorer: H(9) })], NO_SLOTS);
    expect([
      display.goals,
      display.sides.first.sheet,
      ids(display.sides.first.onPitch).length,
    ]).toEqual([{ first: 1, second: 0 }, false, 16]);
  });

  it('a side with no rows is sheet false and folds a team-only goal', () => {
    const display = displayOf([start(), goal({ by: 'H' })], NO_SHEET);
    expect([display.goals, display.sides.first.sheet, display.sides.first.onPitch]).toEqual([
      { first: 1, second: 0 },
      false,
      [],
    ]);
  });

  it('names a team as typed and its players with their shirt numbers', () => {
    const { first } = displayOf([start()]).sides;
    expect([first.name, first.entrantId, first.sheet, first.onPitch[0], first.bench[0]]).toEqual([
      'Home FC',
      'ent-home',
      true,
      player(H(1), 'Home Player 1', 1),
      player(H(12), 'Home Player 12', 12),
    ]);
  });
});

describe('foldFootball: cards and substitutions', () => {
  it('a sub takes the bench player on and the starter off', () => {
    const { first } = displayOf([...KICK_OFF, sub({ by: 'H', off: H(8), on: H(14) })]).sides;
    expect([ids(first.onPitch).includes(H(14)), ids(first.onPitch).includes(H(8))]).toEqual([
      true,
      false,
    ]);
  });

  it('without rolling subs the player off is not offered on', () => {
    const { first } = displayOf([...KICK_OFF, sub({ by: 'H', off: H(8), on: H(14) })]).sides;
    expect(ids(first.offeredOn)).toEqual([H(12), H(13), H(15), H(16)]);
  });

  it('with rolling subs he is', () => {
    const { first } = displayOf(
      [...KICK_OFF, sub({ by: 'H', off: H(8), on: H(14) })],
      withCfg(MATCH, MINI),
    ).sides;
    expect(ids(first.offeredOn)).toEqual([H(12), H(13), H(15), H(16), H(8)]);
  });

  it('a sent-off player is neither on the pitch nor cardable', () => {
    const { first } = displayOf([...KICK_OFF, card({ by: 'H', color: 'red', person: H(5) })]).sides;
    expect([
      ids(first.onPitch).includes(H(5)),
      ids(first.cardable).includes(H(5)),
      first.sentOff,
    ]).toEqual([false, false, [H(5)]]);
  });

  it('a bench player sent off is not offered on', () => {
    const { first } = displayOf([
      ...KICK_OFF,
      card({ by: 'H', color: 'red', person: H(15) }),
    ]).sides;
    expect([ids(first.offeredOn), ids(first.cardable).includes(H(15))]).toEqual([
      [H(12), H(13), H(14), H(16)],
      false,
    ]);
  });

  it('a player who came off is still cardable', () => {
    const { first } = displayOf([...KICK_OFF, sub({ by: 'H', off: H(8), on: H(14) })]).sides;
    expect(ids(first.cardable)).toContain(H(8));
  });

  it('second yellow is offered only after a yellow', () => {
    const before = displayOf(KICK_OFF).sides.first;
    const after = displayOf([...KICK_OFF, card({ by: 'H', color: 'yellow', person: H(6) })]).sides
      .first;
    const away = displayOf([...KICK_OFF, card({ by: 'H', color: 'yellow', person: H(6) })]).sides
      .second;
    expect([before.yellowed, after.yellowed, after.cards, away.cards, away.yellowed]).toEqual([
      [],
      [H(6)],
      { yellow: 1, red: 0 },
      { yellow: 0, red: 0 },
      [],
    ]);
  });

  it('a second yellow counts as a red, and ends the player’s game', () => {
    const { first } = displayOf([
      ...KICK_OFF,
      card({ by: 'H', color: 'yellow', person: H(6) }),
      card({ by: 'H', color: 'second_yellow', person: H(6) }),
      card({ by: 'H', color: 'red' }),
    ]).sides;
    expect([first.cards, first.sentOff, first.yellowed]).toEqual([
      { yellow: 1, red: 2 },
      [H(6)],
      [H(6)],
    ]);
  });

  it('subsLeft is false once the window cap is spent', () => {
    const threeWindows = [
      ...KICK_OFF,
      sub({ by: 'H', off: H(8), on: H(14), at: at('H1', 600) }),
      sub({ by: 'H', off: H(7), on: H(13), at: at('H1', 1200) }),
      sub({ by: 'H', off: H(6), on: H(12), at: at('H1', 1500) }),
    ];
    // A fourth change at the third window's stoppage joins that window (Law 3: windows, not players).
    expect(displayOf(threeWindows, withCfg(MATCH, CAPPED)).subsLeft).toEqual({
      first: true,
      second: true,
    });
    const later = [...threeWindows, goal({ by: 'A', at: at('H1', 1600) })];
    expect(displayOf(later, withCfg(MATCH, CAPPED)).subsLeft).toEqual({
      first: false,
      second: true,
    });
  });

  it('subsLeft is false at maxSubs, with players still on the bench', () => {
    const threeSubs = [
      ...KICK_OFF,
      sub({ by: 'A', off: A(2), on: A(12), at: at('H1', 600) }),
      sub({ by: 'A', off: A(3), on: A(13), at: at('H1', 600) }),
      sub({ by: 'A', off: A(4), on: A(14), at: at('H1', 900) }),
    ];
    const display = displayOf(threeSubs, withCfg(MATCH, { ...LEAGUE_11, maxSubs: 3 }));
    expect([display.subsLeft, ids(display.sides.second.offeredOn)]).toEqual([
      { first: true, second: false },
      [A(15), A(16)],
    ]);
  });

  it('subsLeft is false once the bench is spent', () => {
    const fiveSubs = [
      ...KICK_OFF,
      sub({ by: 'A', off: A(2), on: A(12), at: at('H1', 600) }),
      sub({ by: 'A', off: A(3), on: A(13), at: at('H1', 600) }),
      sub({ by: 'A', off: A(4), on: A(14), at: at('H1', 900) }),
      sub({ by: 'A', off: A(5), on: A(15), at: at('H1', 900) }),
      sub({ by: 'A', off: A(6), on: A(16), at: at('H1', 900) }),
    ];
    expect(displayOf(fiveSubs, withCfg(MATCH, CAPPED)).subsLeft).toEqual({
      first: true,
      second: false,
    });
  });

  it('subsLeft is false with nobody left on the bench', () => {
    expect(displayOf([start()], NO_SHEET).subsLeft).toEqual({ first: false, second: false });
  });
});

describe('foldFootball: queued taps', () => {
  it('a queued goal below the ledger’s newest stamp stays legal, raised to it', () => {
    const result = folded({
      ledger: ledgerOf([...KICK_OFF, goal({ by: 'A', at: at('H1', 600) })]),
      queued: [queuedOf('k1', goal({ by: 'H', at: at('H1', 590) }))],
    });
    expect([result.legalQueued, result.display.goals, result.display.lastTap]).toEqual([
      ['k1'],
      { first: 1, second: 1 },
      {
        kind: 'goal',
        side: 'first',
        scorer: null,
        ownGoal: false,
        penalty: false,
        at: at('H1', 600),
      },
    ]);
  });

  it('a voided event’s stamp is no floor for a queued tap', () => {
    const result = folded({
      ledger: ledgerOf([...KICK_OFF, goal({ by: 'A', at: at('H1', 600) }), voiding(eventId(3))]),
      queued: [queuedOf('k1', goal({ by: 'H', at: at('H1', 590) }))],
    });
    expect([result.legalQueued, result.display.lastTap]).toEqual([
      ['k1'],
      {
        kind: 'goal',
        side: 'first',
        scorer: null,
        ownGoal: false,
        penalty: false,
        at: at('H1', 590),
      },
    ]);
  });

  it('a queued goal stamped in H1 after HT stands unstamped', () => {
    const result = folded({
      ledger: ledgerOf([...KICK_OFF, period('HT', at('H1', 2700))]),
      queued: [queuedOf('k1', goal({ by: 'H', at: at('H1', 2690) }))],
    });
    expect([result.legalQueued, result.display.goals, result.display.lastTap]).toEqual([
      ['k1'],
      { first: 1, second: 0 },
      { kind: 'goal', side: 'first', scorer: null, ownGoal: false, penalty: false, at: null },
    ]);
  });

  it('a bench scorer tap is not legal', () => {
    const result = folded({
      ledger: ledgerOf(KICK_OFF),
      queued: [queuedOf('k1', goal({ by: 'H', scorer: H(14) }))],
    });
    expect([result.legalQueued, result.display.goals]).toEqual([[], { first: 0, second: 0 }]);
  });

  it('a refused queued tap is skipped and the next judged', () => {
    const result = folded({
      ledger: ledgerOf(KICK_OFF),
      queued: [
        queuedOf('k1', goal({ by: 'H', scorer: H(14) })),
        queuedOf('k2', goal({ by: 'H', scorer: H(9) })),
      ],
    });
    expect([result.legalQueued, result.display.goals]).toEqual([['k2'], { first: 1, second: 0 }]);
  });

  it('a queued Undo of an event already undone is not legal', () => {
    const result = folded({
      ledger: ledgerOf([...KICK_OFF, goal({ by: 'H' }), voiding(eventId(3))]),
      queued: [queuedOf('k1', voiding(eventId(3)))],
    });
    expect(result.legalQueued).toEqual([]);
  });

  it('Undo is not offered on a queued tap the match does not take', () => {
    const result = folded({
      ledger: ledgerOf(KICK_OFF),
      queued: [queuedOf('k1', goal({ by: 'H', scorer: H(14) }))],
    });
    expect(result.display.undoable).toBe(false);
  });

  it('Undo is offered on this phone’s own tap and not on another scorer’s', () => {
    const ledger = ledgerOf([...KICK_OFF, goal({ by: 'H' })]);
    expect(folded({ ledger, ownEventIds: [eventId(3)] }).display.undoable).toBe(true);
    expect(folded({ ledger, ownEventIds: [] }).display.undoable).toBe(false);
  });
});

describe('foldFootball: the clock', () => {
  it('an own stand-in anchor is device-based', () => {
    const ledger = ledgerOf([start(), { ...clock(true, at('H1', 0)), link: null }]);
    const { anchor } = folded({ ledger, ownEventIds: [eventId(2)] }).display.clock;
    expect(anchor).toEqual({
      period: 'H1',
      elapsed: 0,
      running: true,
      atMs: Date.parse(ledger[1]?.recordedAt ?? ''),
      base: 'device',
    });
  });

  it('a console anchor is server-based', () => {
    const ledger = ledgerOf(KICK_OFF);
    expect(folded({ ledger }).display.clock.anchor?.base).toBe('server');
  });

  it('a queued Start is the anchor, on the phone’s clock at its createdAt', () => {
    const tap = queuedOf('k1', clock(true, at('H1', 0)), '2026-11-07T14:30:00.000Z');
    const { anchor } = folded({ ledger: ledgerOf([start()]), queued: [tap] }).display.clock;
    expect(anchor).toEqual({
      period: 'H1',
      elapsed: 0,
      running: true,
      atMs: Date.parse('2026-11-07T14:30:00.000Z'),
      base: 'device',
    });
  });

  it('asOf is the newest stamp folded', () => {
    const display = displayOf([...KICK_OFF, goal({ by: 'H', at: at('H1', 840) })]);
    expect(display.clock.asOf).toEqual(at('H1', 840));
  });
});

describe('foldFootball: what it cannot fold', () => {
  it('a seat with no entrant is unfoldable: sides', () => {
    const bye: Bootstrap = { ...MATCH, sides: { ...MATCH.sides, away: null } };
    expect(folding({ bootstrap: bye })).toEqual({ kind: 'unfoldable', reason: 'sides' });
  });

  it('a config the schema refuses is unfoldable: cfg', () => {
    expect(folding({ bootstrap: withCfg(MATCH, { halves: 3 }) })).toEqual({
      kind: 'unfoldable',
      reason: 'cfg',
    });
  });

  it('a ledger the engine will not replay is unfoldable: ledger', () => {
    expect(folding({ ledger: ledgerOf([start(), start()]) })).toEqual({
      kind: 'unfoldable',
      reason: 'ledger',
    });
  });

  it('KO_11 is the test match’s own config', () => {
    expect(MATCH.cfg).toBe(KO_11);
  });
});

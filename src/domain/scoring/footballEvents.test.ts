import { describe, expect, it } from 'vitest';
import { footballEventFor, footballPayloadForSend } from '@/domain/scoring/footballEvents';
import { foldFootball } from '@/domain/scoring/footballFold';
import type { FootballTap, FootballTypes } from '@/domain/scoring/footballTypes';
import type { QueuedEvent } from '@/domain/scoring/queue';
import type { SportEvent, SportEventContext } from '@/domain/scoring/scoringSport';
import type { Bootstrap } from '@/domain/scoring/wire';
import {
  at,
  card,
  clock,
  eventId,
  goal,
  kick,
  KO_11,
  ledgerOf,
  MATCH,
  MINI,
  period,
  queuedOf,
  sinBin,
  start,
  sub,
  voiding,
  withCfg,
  type Spec,
} from '../../../test/footballLedger';

/**
 * Football's taps as the events the server records (S2-5 design §7.3, §8; plan P Task 7; rulings 3 and 4). Every
 * expected payload is written out from the design's table and what staging accepted (§4), never computed by the code.
 */

function ctxOf(
  specs: readonly Spec[],
  bootstrap: Bootstrap = MATCH,
): SportEventContext<FootballTypes> {
  const fold = foldFootball({
    bootstrap,
    ledger: ledgerOf(specs),
    queued: [],
    ownEventIds: [],
    toss: null,
  });
  if (fold.kind !== 'folded') throw new Error(`unfoldable: ${fold.reason}`);
  return { bootstrap, display: fold.display };
}

const eventOf = (tap: FootballTap, specs: readonly Spec[], bootstrap: Bootstrap = MATCH) =>
  footballEventFor(tap, ctxOf(specs, bootstrap));

const KICK_OFF: readonly Spec[] = [start(), clock(true, at('H1', 0))];
const AT_600: readonly Spec[] = [...KICK_OFF, goal({ by: 'A', at: at('H1', 600) })];
const AFTER_HT: readonly Spec[] = [...KICK_OFF, period('HT', at('H1', 2760))];
const LEVEL_AFTER_ET: readonly Spec[] = [
  ...KICK_OFF,
  period('HT', at('H1', 2700)),
  clock(true, at('H2', 0)),
  period('FT', at('H2', 2700)),
  clock(true, at('ET_H1', 0)),
  period('ET_HT', at('ET_H1', 900)),
  clock(true, at('ET_H2', 0)),
  period('ET_FT', at('ET_H2', 900)),
];

const STAMP = at('H1', 1000);

describe('footballEventFor: each tap (design §8)', () => {
  it.each<[string, FootballTap, readonly Spec[], SportEvent]>([
    ['Start match', { kind: 'start' }, [], { type: 'core.start', payload: {} }],
    [
      // A clock tap carries the ledger's tip it was made over: its send tells a later clock event of another screen's.
      'Start',
      { kind: 'clock', running: true, elapsed: 0 },
      [start()],
      { type: 'football.clock', payload: { running: true, at: at('H1', 0) }, base: 1 },
    ],
    [
      'Pause',
      { kind: 'clock', running: false, elapsed: 754 },
      KICK_OFF,
      { type: 'football.clock', payload: { running: false, at: at('H1', 754) }, base: 2 },
    ],
    [
      'Goal',
      {
        kind: 'goal',
        side: 'first',
        scorer: 'H-p9',
        assist: 'H-p10',
        penalty: false,
        stamp: STAMP,
      },
      KICK_OFF,
      {
        type: 'football.goal',
        payload: { by: 'ent-home', scorer: 'H-p9', assist: 'H-p10', at: STAMP },
      },
    ],
    [
      'Card',
      {
        kind: 'card',
        side: 'second',
        person: 'A-p5',
        color: 'yellow',
        reason: 'dissent',
        stamp: STAMP,
      },
      KICK_OFF,
      {
        type: 'football.card',
        payload: { by: 'ent-away', person: 'A-p5', color: 'yellow', reason: 'dissent', at: STAMP },
      },
    ],
    [
      'Sub',
      { kind: 'sub', side: 'first', off: 'H-p8', on: 'H-p14', stamp: STAMP },
      AT_600,
      {
        type: 'football.sub',
        payload: { by: 'ent-home', off: 'H-p8', on: 'H-p14', at: STAMP },
      },
    ],
    [
      'End of period',
      { kind: 'period', stamp: at('H1', 2760) },
      KICK_OFF,
      { type: 'football.period', payload: { phase: 'HT', at: at('H1', 2760) } },
    ],
    [
      'Missed penalty',
      {
        kind: 'penaltyMiss',
        side: 'first',
        taker: 'H-p9',
        goalkeeper: 'A-p1',
        outcome: 'saved',
        stamp: STAMP,
      },
      KICK_OFF,
      {
        type: 'football.penalty',
        payload: { by: 'ent-home', taker: 'H-p9', goalkeeper: 'A-p1', outcome: 'saved', at: STAMP },
      },
    ],
    [
      'Sin-bin',
      { kind: 'sinBin', side: 'second', person: 'A-p6', reason: 'dissent', stamp: STAMP },
      KICK_OFF,
      {
        type: 'football.sinbin.start',
        payload: { by: 'ent-away', person: 'A-p6', reason: 'dissent', at: STAMP },
      },
    ],
    [
      'Back from sin-bin',
      { kind: 'sinBinEnd', side: 'second', person: 'A-p6', stamp: at('H1', 1200) },
      [...KICK_OFF, sinBin({ by: 'A', person: 'A-p6', at: at('H1', 600) })],
      {
        type: 'football.sinbin.end',
        payload: { by: 'ent-away', person: 'A-p6', at: at('H1', 1200) },
      },
    ],
    [
      'Shot',
      { kind: 'shot', side: 'first', taker: 'H-p9', outcome: 'blocked', stamp: STAMP },
      KICK_OFF,
      {
        type: 'football.shot',
        payload: { by: 'ent-home', taker: 'H-p9', outcome: 'blocked', at: STAMP },
      },
    ],
    [
      'Shootout · Scored',
      { kind: 'kick', side: 'first', person: 'H-p9', scored: true },
      LEVEL_AFTER_ET,
      { type: 'football.shootout.kick', payload: { by: 'ent-home', person: 'H-p9', scored: true } },
    ],
  ])('%s', (_name, tap, specs, event) => {
    expect(eventOf(tap, specs)).toEqual(event);
  });
});

describe('footballEventFor: goals', () => {
  it('own goal in home’s column is by away and credits home', () => {
    const event = eventOf(
      { kind: 'ownGoal', side: 'first', scorer: 'A-p4', stamp: STAMP },
      KICK_OFF,
    );
    expect(event).toEqual({
      type: 'football.goal',
      payload: { by: 'ent-away', ownGoal: true, scorer: 'A-p4', at: STAMP },
    });
    const credited = ctxOf([...KICK_OFF, { type: event?.type ?? '', payload: event?.payload }]);
    expect(credited.display.goals).toEqual({ first: 1, second: 0 });
  });

  it('own goal with Don’t know carries no scorer', () => {
    expect(
      eventOf({ kind: 'ownGoal', side: 'second', scorer: null, stamp: STAMP }, KICK_OFF),
    ).toEqual({
      type: 'football.goal',
      payload: { by: 'ent-home', ownGoal: true, at: STAMP },
    });
  });

  it('a penalty goal has penalty true and no assist', () => {
    const tap: FootballTap = {
      kind: 'goal',
      side: 'first',
      scorer: 'H-p9',
      assist: 'H-p10',
      penalty: true,
      stamp: STAMP,
    };
    expect(eventOf(tap, KICK_OFF)).toEqual({
      type: 'football.goal',
      payload: { by: 'ent-home', scorer: 'H-p9', penalty: true, at: STAMP },
    });
  });

  it('Don’t know records the team with no scorer, and no stamp when the clock knew none', () => {
    const tap: FootballTap = {
      kind: 'goal',
      side: 'second',
      scorer: null,
      assist: null,
      penalty: false,
      stamp: null,
    };
    expect(eventOf(tap, [start()])).toEqual({ type: 'football.goal', payload: { by: 'ent-away' } });
  });

  it('null for a bench scorer, an assist off the pitch, or the scorer as his own assist', () => {
    const goalBy = (scorer: string, assist: string | null): FootballTap => ({
      kind: 'goal',
      side: 'first',
      scorer,
      assist,
      penalty: false,
      stamp: STAMP,
    });
    expect(eventOf(goalBy('H-p14', null), KICK_OFF)).toBeNull();
    expect(eventOf(goalBy('H-p9', 'H-p14'), KICK_OFF)).toBeNull();
    expect(eventOf(goalBy('H-p9', 'H-p9'), KICK_OFF)).toBeNull();
    expect(eventOf(goalBy('A-p9', null), KICK_OFF)).toBeNull();
  });

  it('null for an own goal by a player of the column’s own team', () => {
    expect(
      eventOf({ kind: 'ownGoal', side: 'first', scorer: 'H-p4', stamp: STAMP }, KICK_OFF),
    ).toBeNull();
  });

  it('null for a goal before the start', () => {
    const tap: FootballTap = {
      kind: 'goal',
      side: 'first',
      scorer: null,
      assist: null,
      penalty: false,
      stamp: null,
    };
    expect(eventOf(tap, [])).toBeNull();
  });
});

describe('footballEventFor: stamps (design §7.3)', () => {
  const teamGoal = (stamp: { period: string; elapsed: number } | null): FootballTap => ({
    kind: 'goal',
    side: 'first',
    scorer: null,
    assist: null,
    penalty: false,
    stamp,
  });

  it('a stamp below a same-period asOf is raised', () => {
    expect(eventOf(teamGoal(at('H1', 590)), AT_600)?.payload).toEqual({
      by: 'ent-home',
      at: at('H1', 600),
    });
  });

  it('a stamp captured in another period than the fold’s is dropped', () => {
    expect(eventOf(teamGoal(at('H1', 2690)), AFTER_HT)?.payload).toEqual({ by: 'ent-home' });
  });

  it('Start in a new period is elapsed 0 in that period', () => {
    expect(eventOf({ kind: 'clock', running: true, elapsed: 0 }, AFTER_HT)).toEqual({
      type: 'football.clock',
      payload: { running: true, at: at('H2', 0) },
      base: 3,
    });
  });

  it('a clock reading below a same-period asOf is raised to it', () => {
    expect(eventOf({ kind: 'clock', running: false, elapsed: 590 }, AT_600)?.payload).toEqual({
      running: false,
      at: at('H1', 600),
    });
  });

  // Ruling 154: a sub joins the stoppage when the newest stamped event in the period is a sub and its own reading is no
  // more than 120 s past that sub's stamp; it then takes that exact stamp. Otherwise it takes its own reading.
  const SUB_AT_600: readonly Spec[] = [
    ...KICK_OFF,
    sub({ by: 'H', off: 'H-p8', on: 'H-p14', at: at('H1', 600) }),
  ];
  const subTap = (stamp: ReturnType<typeof at> | null, side: 'first' | 'second' = 'first') =>
    ({
      kind: 'sub',
      side,
      off: side === 'first' ? 'H-p7' : 'A-p7',
      on: side === 'first' ? 'H-p13' : 'A-p13',
      stamp,
    }) as const;

  it('a sub with nothing stamped since the last goal takes its own reading, not the goal’s stamp (F-R1)', () => {
    expect(eventOf(subTap(at('H1', 1800)), AT_600)?.payload).toEqual({
      by: 'ent-home',
      off: 'H-p7',
      on: 'H-p13',
      at: at('H1', 1800),
    });
  });

  it('a sub 120 s after a sub joins its stoppage, taking its stamp; 121 s after, its own reading', () => {
    expect(eventOf(subTap(at('H1', 720)), SUB_AT_600)?.payload).toMatchObject({
      at: at('H1', 600),
    });
    expect(eventOf(subTap(at('H1', 721)), SUB_AT_600)?.payload).toMatchObject({
      at: at('H1', 721),
    });
  });

  // Review M1: a sub that joins keeps its own reading beside the payload, as the queue's local metadata (never sent), so
  // its send can fall back to it when the stoppage it joined is gone.
  it('a sub that joins the stoppage carries its own reading beside the payload; one that does not, none', () => {
    expect(eventOf(subTap(at('H1', 700)), SUB_AT_600)).toEqual({
      type: 'football.sub',
      payload: { by: 'ent-home', off: 'H-p7', on: 'H-p13', at: at('H1', 600) },
      reading: at('H1', 700),
    });
    expect(eventOf(subTap(at('H1', 800)), SUB_AT_600)).toEqual({
      type: 'football.sub',
      payload: { by: 'ent-home', off: 'H-p7', on: 'H-p13', at: at('H1', 800) },
    });
    expect(eventOf(subTap(null), SUB_AT_600)).not.toHaveProperty('reading');
  });

  it('a concussion sub that joins carries its own reading too', () => {
    const trial = withCfg(MATCH, { ...KO_11, maxSubs: 5, subWindows: 3, concussionSubs: 1 });
    const concussion = { ...subTap(at('H1', 700)), concussion: true } as const;
    expect(eventOf(concussion, SUB_AT_600, trial)).toMatchObject({
      type: 'core.lineup.replacement',
      payload: { at: at('H1', 600) },
      reading: at('H1', 700),
    });
  });

  it('the other team’s sub at the stoppage is joined too', () => {
    expect(eventOf(subTap(at('H1', 650), 'second'), SUB_AT_600)?.payload).toEqual({
      by: 'ent-away',
      off: 'A-p7',
      on: 'A-p13',
      at: at('H1', 600),
    });
  });

  it('a goal or a card after the sub ends the stoppage: the next sub takes its own reading', () => {
    const goalBetween = [...SUB_AT_600, goal({ by: 'A', at: at('H1', 630) })];
    expect(eventOf(subTap(at('H1', 650)), goalBetween)?.payload).toMatchObject({
      at: at('H1', 650),
    });
    const cardBetween = [...SUB_AT_600, card({ by: 'A', color: 'yellow', at: at('H1', 630) })];
    expect(eventOf(subTap(at('H1', 650)), cardBetween)?.payload).toMatchObject({
      at: at('H1', 650),
    });
  });

  it('a sub in a new period does not join the last period’s stoppage', () => {
    const lastHalf = [...SUB_AT_600, period('HT', at('H1', 2700)), clock(true, at('H2', 0))];
    expect(eventOf(subTap(at('H2', 30)), lastHalf)?.payload).toMatchObject({ at: at('H2', 30) });
  });

  it('a sub at half-time (no reading) is unstamped: no window', () => {
    expect(eventOf(subTap(null), AFTER_HT)?.payload).toEqual({
      by: 'ent-home',
      off: 'H-p7',
      on: 'H-p13',
    });
  });

  // Ruling 155: a concussion sub is the engine's `core.lineup.replacement` with the concussion exemption, stamped as any
  // sub (ruling 154). It spends no ordinary sub and no window.
  it('a concussion sub is a core.lineup.replacement naming the concussion exemption', () => {
    const trial = withCfg(MATCH, { ...KO_11, maxSubs: 5, subWindows: 3, concussionSubs: 1 });
    expect(eventOf({ ...subTap(at('H1', 900)), concussion: true }, AT_600, trial)).toEqual({
      type: 'core.lineup.replacement',
      payload: {
        side: 'ent-home',
        off: 'H-p7',
        on: { personId: 'H-p13', slot: 'bench', orderNo: 1 },
        exemption: 'concussion',
        at: at('H1', 900),
      },
    });
  });

  it('null for a sub of a player not on the pitch, or one not offered on', () => {
    expect(
      eventOf({ kind: 'sub', side: 'first', off: 'H-p14', on: 'H-p15', stamp: null }, KICK_OFF),
    ).toBeNull();
    expect(
      eventOf({ kind: 'sub', side: 'first', off: 'H-p8', on: 'H-p7', stamp: null }, KICK_OFF),
    ).toBeNull();
  });

  it('End of period sends the legal marker', () => {
    const end = { kind: 'period', stamp: null } as const;
    expect(eventOf(end, KICK_OFF)?.payload).toEqual({ phase: 'HT' });
    expect(eventOf(end, KICK_OFF, withCfg(MATCH, MINI))?.payload).toEqual({ phase: 'QT' });
    expect(eventOf(end, LEVEL_AFTER_ET.slice(0, -1))?.payload).toEqual({ phase: 'ET_FT' });
  });

  it('null for End of period when the display names no marker, even in a phase that takes one', () => {
    const ctx = ctxOf(KICK_OFF);
    const display = { ...ctx.display, marker: null };
    expect(footballEventFor({ kind: 'period', stamp: null }, { ...ctx, display })).toBeNull();
  });

  it('null for End of period when no marker is taken (before the start, in the shootout)', () => {
    expect(eventOf({ kind: 'period', stamp: null }, [])).toBeNull();
    expect(eventOf({ kind: 'period', stamp: null }, LEVEL_AFTER_ET)).toBeNull();
  });

  it('a kick carries no at', () => {
    expect(
      eventOf({ kind: 'kick', side: 'second', person: null, scored: false }, LEVEL_AFTER_ET),
    ).toEqual({
      type: 'football.shootout.kick',
      payload: { by: 'ent-away', scored: false },
    });
  });

  // Controller ruling 156 (F-R4): a booking during the kicks, from More. The engine takes a card in SHOOTOUT; the kicks
  // have no running clock, so the card carries no at, as a kick does.
  it('a card during the shootout carries no at', () => {
    const tap: FootballTap = {
      kind: 'card',
      side: 'first',
      person: 'H-p1',
      color: 'yellow',
      reason: 'unsporting_behaviour',
      stamp: null,
    };
    expect(eventOf(tap, LEVEL_AFTER_ET)).toEqual({
      type: 'football.card',
      payload: { by: 'ent-home', person: 'H-p1', color: 'yellow', reason: 'unsporting_behaviour' },
    });
  });
});

describe('footballEventFor: what the engine would refuse is never made', () => {
  const cardFor = (
    person: string | null,
    color: string,
    reason: string | null = null,
  ): FootballTap => ({
    kind: 'card',
    side: 'first',
    person,
    color,
    reason,
    stamp: STAMP,
  });

  it('null for second_yellow without a prior yellow', () => {
    expect(eventOf(cardFor('H-p6', 'second_yellow'), KICK_OFF)).toBeNull();
    const booked = [...KICK_OFF, card({ by: 'H', color: 'yellow', person: 'H-p6' })];
    expect(eventOf(cardFor('H-p6', 'second_yellow'), booked)?.payload).toEqual({
      by: 'ent-home',
      person: 'H-p6',
      color: 'second_yellow',
      at: STAMP,
    });
  });

  it('null for a second plain yellow to a booked player', () => {
    const booked = [...KICK_OFF, card({ by: 'H', color: 'yellow', person: 'H-p6' })];
    expect(eventOf(cardFor('H-p6', 'yellow'), booked)).toBeNull();
  });

  it('null for a card to a player sent off, a colour or a reason the engine does not list', () => {
    const sentOff = [...KICK_OFF, card({ by: 'H', color: 'red', person: 'H-p6' })];
    expect(eventOf(cardFor('H-p6', 'red'), sentOff)).toBeNull();
    expect(eventOf(cardFor('H-p6', 'blue'), KICK_OFF)).toBeNull();
    expect(eventOf(cardFor('H-p6', 'yellow', 'rudeness'), KICK_OFF)).toBeNull();
  });

  it('a bench player may be booked, and a team-only card names nobody', () => {
    expect(eventOf(cardFor('H-p15', 'yellow'), KICK_OFF)?.payload).toEqual({
      by: 'ent-home',
      person: 'H-p15',
      color: 'yellow',
      at: STAMP,
    });
    expect(eventOf(cardFor(null, 'red', 'spitting'), KICK_OFF)?.payload).toEqual({
      by: 'ent-home',
      color: 'red',
      reason: 'spitting',
      at: STAMP,
    });
  });

  it('null for an outcome the engine does not list', () => {
    const miss = (outcome: string): FootballTap => ({
      kind: 'penaltyMiss',
      side: 'first',
      taker: null,
      goalkeeper: null,
      outcome,
      stamp: STAMP,
    });
    const shot = (outcome: string): FootballTap => ({
      kind: 'shot',
      side: 'first',
      taker: null,
      outcome,
      stamp: STAMP,
    });
    expect(eventOf(miss('scored'), KICK_OFF)).toBeNull();
    expect(eventOf(shot('wide'), KICK_OFF)).toBeNull();
    expect(eventOf(shot('scored'), KICK_OFF)?.payload).toEqual({
      by: 'ent-home',
      outcome: 'scored',
      at: STAMP,
    });
  });

  it('null for a goalkeeper not on the other team’s pitch, or a taker not on his own', () => {
    const miss = (taker: string | null, goalkeeper: string | null): FootballTap => ({
      kind: 'penaltyMiss',
      side: 'first',
      taker,
      goalkeeper,
      outcome: 'post',
      stamp: STAMP,
    });
    expect(eventOf(miss(null, 'H-p1'), KICK_OFF)).toBeNull();
    expect(eventOf(miss('A-p9', null), KICK_OFF)).toBeNull();
  });

  it('null for a kick, a sin-bin or a shot by a player not on the pitch', () => {
    expect(
      eventOf({ kind: 'kick', side: 'first', person: 'H-p14', scored: true }, LEVEL_AFTER_ET),
    ).toBeNull();
    expect(
      eventOf(
        { kind: 'sinBin', side: 'first', person: 'H-p14', reason: null, stamp: STAMP },
        KICK_OFF,
      ),
    ).toBeNull();
    expect(
      eventOf(
        { kind: 'shot', side: 'first', taker: 'H-p14', outcome: 'saved', stamp: STAMP },
        KICK_OFF,
      ),
    ).toBeNull();
  });

  it('null for a player back from a bin he is not in', () => {
    expect(
      eventOf({ kind: 'sinBinEnd', side: 'second', person: 'A-p6', stamp: STAMP }, KICK_OFF),
    ).toBeNull();
  });

  it('null for a tap the phase does not take: a kick in play, a goal or the clock in the shootout', () => {
    expect(
      eventOf({ kind: 'kick', side: 'first', person: null, scored: true }, KICK_OFF),
    ).toBeNull();
    const goalTap: FootballTap = {
      kind: 'goal',
      side: 'first',
      scorer: null,
      assist: null,
      penalty: false,
      stamp: null,
    };
    expect(eventOf(goalTap, LEVEL_AFTER_ET)).toBeNull();
    expect(eventOf({ kind: 'clock', running: true, elapsed: 0 }, LEVEL_AFTER_ET)).toBeNull();
  });
});

/** When the queued taps below were made, by the phone's clock. */
const T = '2026-11-07T14:30:00.000Z';
const send = (bootstrap: Bootstrap | null = MATCH, ownEventIds: readonly string[] = []) => ({
  bootstrap,
  ownEventIds,
});
const queued = (spec: Spec, more: Partial<QueuedEvent> = {}): QueuedEvent => ({
  ...queuedOf('k1', spec, T),
  ...more,
});

// The controller's ruling of 2026-11-08 (design §7.2 at 8aafcca2): a queued tap's payload is never changed for the time
// it waited. A changed payload counted the wait twice on this phone's own clock and hid the server's copy of a tap
// whose answer was lost (the phone review's I1 and I2). A Start accepted late is followed by a resync tap instead
// (`needsResync`, `resyncTap`).
describe('footballPayloadForSend (design §7.2, §7.3; ruling 3)', () => {
  it('payloadForSend raises a same-period stamp to the ledger’s newest', () => {
    const tap = queued(goal({ by: 'H', at: at('H1', 590) }));
    expect(footballPayloadForSend(tap, ledgerOf(AT_600), false, send())).toEqual({
      by: 'ent-home',
      at: at('H1', 600),
    });
  });

  it('payloadForSend drops an earlier-period stamp', () => {
    const tap = queued(goal({ by: 'H', at: at('H1', 2690) }));
    expect(footballPayloadForSend(tap, ledgerOf(AFTER_HT), false, send())).toEqual({
      by: 'ent-home',
    });
  });

  it('a Start that waited in the queue is sent as it was tapped, however long it waited', () => {
    const tap = queued(clock(true, at('H1', 600)));
    expect(footballPayloadForSend(tap, ledgerOf(AT_600), false, send())).toBe(tap.payload);
  });

  // A queue file written before the ruling may still hold a Start with a base: it moves nothing.
  it('a Start from an older queue file, carrying a base, is sent as it was tapped too', () => {
    const tap = queued(clock(true, at('H1', 720)), { base: 600, attempts: 1 });
    expect(footballPayloadForSend(tap, ledgerOf(AT_600), false, send())).toBe(tap.payload);
  });

  it('a Pause queued 120 s keeps its at', () => {
    const tap = queued(clock(false, at('H1', 700)));
    expect(footballPayloadForSend(tap, ledgerOf(AT_600), false, send())).toBe(tap.payload);
  });

  it('a Start below the ledger’s newest same-period stamp is raised to it, as any stamp is', () => {
    const tap = queued(clock(true, at('H1', 500)));
    expect(footballPayloadForSend(tap, ledgerOf(AT_600), false, send())).toEqual({
      running: true,
      at: at('H1', 600),
    });
  });

  it('two sends over the same ledger send the same payload: the server’s copy is known by it', () => {
    const tap = queued(clock(true, at('H1', 500)));
    const first = footballPayloadForSend(tap, ledgerOf(AT_600), false, send());
    const again = footballPayloadForSend(
      { ...tap, payload: first, attempts: 1 },
      ledgerOf(AT_600),
      false,
      send(),
    );
    expect(again).toEqual(first);
  });

  it('a copied tap keeps its payload', () => {
    const tap = queued(goal({ by: 'H', at: at('H1', 590) }));
    expect(footballPayloadForSend(tap, ledgerOf(AT_600), true, send())).toBe(tap.payload);
  });

  it('a voided event’s stamp is no floor', () => {
    const tap = queued(goal({ by: 'H', at: at('H1', 590) }));
    const ledger = ledgerOf([...AT_600, voiding(eventId(3))]);
    expect(footballPayloadForSend(tap, ledger, false, send())).toBe(tap.payload);
  });

  // Ruling 154 at send: a sub queued offline is judged against the ledger as it stands when it goes.
  it('a sub queued offline, sent after another phone’s sub landed within 120 s of it, joins that stoppage', () => {
    const tap = queued(sub({ by: 'H', off: 'H-p7', on: 'H-p13', at: at('H1', 700) }));
    const theirs = ledgerOf([
      ...KICK_OFF,
      sub({ by: 'A', off: 'A-p8', on: 'A-p14', at: at('H1', 640) }),
    ]);
    expect(footballPayloadForSend(tap, theirs, false, send())).toEqual({
      by: 'ent-home',
      off: 'H-p7',
      on: 'H-p13',
      at: at('H1', 640),
    });
  });

  // Review M1: the sub this one joined was undone (or never landed) before this one went: it is sent at its own reading.
  it('a joined sub whose stoppage is gone is sent at its own reading, not the stoppage’s stamp', () => {
    const theirs = [...KICK_OFF, sub({ by: 'A', off: 'A-p8', on: 'A-p14', at: at('H1', 600) })];
    const joined = sub({ by: 'H', off: 'H-p7', on: 'H-p13', at: at('H1', 600) });
    const tap = queued(joined, { reading: at('H1', 700) });
    const undone = ledgerOf([...theirs, voiding(eventId(3))]);
    expect(footballPayloadForSend(tap, undone, false, send())).toEqual({
      by: 'ent-home',
      off: 'H-p7',
      on: 'H-p13',
      at: at('H1', 700),
    });
    expect(footballPayloadForSend(tap, ledgerOf(KICK_OFF), false, send())).toMatchObject({
      at: at('H1', 700),
    });
    // The stoppage still standing: it joins, as tapped.
    expect(footballPayloadForSend(tap, ledgerOf(theirs), false, send())).toEqual(tap.payload);
    // A tap from a queue file written before the reading was kept falls back to its payload's stamp.
    expect(footballPayloadForSend(queued(joined), undone, false, send())).toEqual(
      queued(joined).payload,
    );
  });

  it('a sub queued offline keeps its own reading past the 120 s, or with a goal after the other sub', () => {
    const tap = queued(sub({ by: 'H', off: 'H-p7', on: 'H-p13', at: at('H1', 800) }));
    const theirs = ledgerOf([
      ...KICK_OFF,
      sub({ by: 'A', off: 'A-p8', on: 'A-p14', at: at('H1', 640) }),
    ]);
    expect(footballPayloadForSend(tap, theirs, false, send())).toBe(tap.payload);
    const near = queued(sub({ by: 'H', off: 'H-p7', on: 'H-p13', at: at('H1', 700) }));
    const goalAfter = ledgerOf([
      ...KICK_OFF,
      sub({ by: 'A', off: 'A-p8', on: 'A-p14', at: at('H1', 640) }),
      goal({ by: 'A', at: at('H1', 660) }),
    ]);
    expect(footballPayloadForSend(near, goalAfter, false, send())).toBe(near.payload);
  });

  it('with no bootstrap held, the period of the newest stamp stands for the phase', () => {
    const tap = queued(goal({ by: 'H', at: at('H1', 590) }));
    expect(footballPayloadForSend(tap, ledgerOf(AT_600), false, send(null))).toEqual({
      by: 'ent-home',
      at: at('H1', 600),
    });
  });
});

// The controller's ruling, final review (2026-11-08): a queued clock tap of this phone's that another screen's later
// clock event or period marker overtook in its period is withdrawn at its send, never sent. The phone's link is
// MATCH's (`link-phone`); the ledger's events are the browser's unless a spec says otherwise.
describe('footballPayloadForSend withdraws a clock tap another screen overtook', () => {
  /** Kicked off (seq 1 and 2); the phone, offline, taps Pause at 10:00 over that ledger (its tip, 2). */
  const PAUSE = queued(clock(false, at('H1', 600)), { base: 2 });
  const WITHDRAWN = {
    line: { event: 'scoring.football.clockTapWithdrawn', fields: { phase: 'H1' } },
  };

  it('the console’s own Pause, recorded after the tap, withdraws it: never sent, the record says H1', () => {
    const ledger = ledgerOf([...KICK_OFF, clock(false, at('H1', 590))]);
    expect(footballPayloadForSend(PAUSE, ledger, false, send())).toMatchObject(WITHDRAWN);
  });

  it('the console’s Half-time, recorded after it, withdraws it too', () => {
    const ledger = ledgerOf([...KICK_OFF, period('HT', at('H1', 2700))]);
    expect(footballPayloadForSend(PAUSE, ledger, false, send())).toMatchObject(WITHDRAWN);
  });

  // The organiser's console writes `device_link_id` null (N1 of the final re-review): it is another screen's too.
  it('the organiser’s console, with no device link, withdraws it as well: a Pause, and a Half-time', () => {
    for (const spec of [clock(false, at('H1', 590)), period('HT', at('H1', 2700))]) {
      const ledger = ledgerOf([...KICK_OFF, { ...spec, link: null }]);
      expect(footballPayloadForSend(PAUSE, ledger, false, send())).toMatchObject(WITHDRAWN);
    }
    // The stand-in this phone sent itself (no link, in its own ids) is not the console's.
    const own = ledgerOf([...KICK_OFF, { ...clock(false, at('H1', 590)), link: null }]);
    const ownId = own[own.length - 1]!.id;
    expect(footballPayloadForSend(PAUSE, own, false, send(MATCH, [ownId]))).not.toMatchObject(
      WITHDRAWN,
    );
  });

  it('a later goal is no clock event: the Pause is sent, raised to it', () => {
    const ledger = ledgerOf([...KICK_OFF, goal({ by: 'A', at: at('H1', 650) })]);
    expect(footballPayloadForSend(PAUSE, ledger, false, send())).toEqual({
      running: false,
      at: at('H1', 650),
    });
  });

  it('a clock event the scorer saw when tapping (at or under its base) overtakes nothing', () => {
    const ledger = ledgerOf([...KICK_OFF, clock(false, at('H1', 590))]);
    const seen = queued(clock(true, at('H1', 590)), { base: 3 });
    expect(footballPayloadForSend(seen, ledger, false, send())).toBe(seen.payload);
  });

  it('a copy the ledger holds goes as first sent: the server has it already', () => {
    const ledger = ledgerOf([...KICK_OFF, clock(false, at('H1', 590))]);
    expect(footballPayloadForSend(PAUSE, ledger, true, send())).toBe(PAUSE.payload);
  });

  it('with no bootstrap there is no link to tell another screen by: it is restamped as any tap', () => {
    const ledger = ledgerOf([...KICK_OFF, clock(false, at('H1', 590))]);
    expect(footballPayloadForSend(PAUSE, ledger, false, send(null))).toBe(PAUSE.payload);
  });
});

describe('never minute, addedMinutes or core.forfeit', () => {
  it('scans every event made above', () => {
    const taps: readonly [FootballTap, readonly Spec[]][] = [
      [{ kind: 'start' }, []],
      [{ kind: 'clock', running: true, elapsed: 30 }, KICK_OFF],
      [
        { kind: 'goal', side: 'first', scorer: 'H-p9', assist: null, penalty: false, stamp: STAMP },
        KICK_OFF,
      ],
      [{ kind: 'ownGoal', side: 'first', scorer: null, stamp: STAMP }, KICK_OFF],
      [
        { kind: 'card', side: 'first', person: null, color: 'red', reason: null, stamp: STAMP },
        KICK_OFF,
      ],
      [{ kind: 'sub', side: 'first', off: 'H-p8', on: 'H-p14', stamp: STAMP }, AT_600],
      [{ kind: 'period', stamp: STAMP }, KICK_OFF],
      [
        {
          kind: 'penaltyMiss',
          side: 'first',
          taker: null,
          goalkeeper: null,
          outcome: 'post',
          stamp: STAMP,
        },
        KICK_OFF,
      ],
      [{ kind: 'sinBin', side: 'first', person: 'H-p3', reason: null, stamp: STAMP }, KICK_OFF],
      [
        { kind: 'sinBinEnd', side: 'second', person: 'A-p6', stamp: STAMP },
        [...KICK_OFF, sinBin({ by: 'A', person: 'A-p6', at: at('H1', 600) })],
      ],
      [{ kind: 'shot', side: 'first', taker: null, outcome: 'saved', stamp: STAMP }, KICK_OFF],
      [{ kind: 'kick', side: 'first', person: null, scored: true }, LEVEL_AFTER_ET],
    ];
    // Every kind of tap the pad makes (the review's M2: sinBinEnd was missing), written out from `FootballTap`.
    expect(new Set(taps.map(([tap]) => tap.kind))).toEqual(
      new Set([
        'start',
        'clock',
        'goal',
        'ownGoal',
        'card',
        'sub',
        'period',
        'penaltyMiss',
        'sinBin',
        'sinBinEnd',
        'shot',
        'kick',
      ]),
    );
    const events = taps.map(([tap, specs]) => eventOf(tap, specs));
    expect(events.every((event) => event !== null)).toBe(true);
    const text = JSON.stringify(events);
    expect([
      text.includes('minute'),
      text.includes('addedMinutes'),
      text.includes('core.forfeit'),
    ]).toEqual([false, false, false]);
  });
});

import { FOLD_EPOCH } from '@seazn/engine/sport';
import { describe, expect, it } from 'vitest';
import { footballSport } from '@/domain/scoring/footballSport';
import type { FootballDisplay, FootballTap } from '@/domain/scoring/footballTypes';
import type { SportFoldInput } from '@/domain/scoring/scoringSport';
import { sportFor } from '@/domain/scoring/sports';
import { KICK_OFF, KICKS_4_1, LEVEL_AFTER_ET } from '../../../test/footballPadFixtures';
import {
  at,
  eventId,
  goal,
  ledgerOf,
  MATCH,
  period,
  start,
  type Spec,
} from '../../../test/footballLedger';

// Football as the match runtime scores it (S2-5 plan P Task 9): the sport's own answers to the questions the runtime asks
// of any sport. Every expected value is a literal written from the spec, never computed by the code under test.

function inputOf(specs: readonly Spec[], own: readonly number[] = []): SportFoldInput {
  return {
    bootstrap: MATCH,
    ledger: ledgerOf(specs),
    queued: [],
    ownEventIds: own.map(eventId),
    toss: null,
  };
}

function displayOf(specs: readonly Spec[], own: readonly number[] = []): FootballDisplay {
  const fold = footballSport.fold(inputOf(specs, own));
  if (fold.kind !== 'folded') throw new Error(`did not fold: ${fold.reason}`);
  return fold.display;
}

const abandon: Spec = { type: 'core.abandon', payload: { reason: 'weather' } };
const finalize: Spec = { type: 'core.finalize', payload: {} };

/** 2–1 at full time in a league match, where a draw would stand. */
const TWO_ONE: readonly Spec[] = [
  ...KICK_OFF,
  goal({ by: 'H', at: at('H1', 600) }),
  period('HT', at('H1', 2700)),
  goal({ by: 'A', at: at('H2', 300) }),
  goal({ by: 'H', at: at('H2', 1200) }),
  period('FT', at('H2', 2700)),
];

describe('footballSport: which sport it is', () => {
  it('is the table’s football row', () => {
    expect(sportFor('football')).toBe(footballSport);
    expect(footballSport.key).toBe('football');
  });

  it('folds at the engine’s epoch for football (ruling 53), 4 at engine 2.0.0', () => {
    expect(footballSport.epoch).toBe(FOLD_EPOCH.football);
    expect(footballSport.epoch).toBe(4);
  });

  it('remembers its fold: the same input is folded once, another is folded again', () => {
    const input = inputOf(KICK_OFF);
    expect(footballSport.fold(input)).toBe(footballSport.fold(input));
    expect(footballSport.fold(inputOf([start()]))).not.toBe(footballSport.fold(input));
  });
});

describe('footballSport: the match’s state', () => {
  it('is not started until the match starts, then not again', () => {
    expect(footballSport.notStarted(displayOf([]))).toBe(true);
    expect(footballSport.notStarted(displayOf([start()]))).toBe(false);
    expect(footballSport.notStarted(displayOf(TWO_ONE))).toBe(false);
  });

  it('is decided only in done, final and abandoned', () => {
    expect(footballSport.decided(displayOf([]))).toBe(false);
    expect(footballSport.decided(displayOf(KICK_OFF))).toBe(false);
    expect(footballSport.decided(displayOf(TWO_ONE.slice(0, -2)))).toBe(false);
    expect(footballSport.decided(displayOf(LEVEL_AFTER_ET))).toBe(false);
    expect(footballSport.decided(displayOf(TWO_ONE))).toBe(true);
    expect(footballSport.decided(displayOf([...TWO_ONE, finalize]))).toBe(true);
    expect(footballSport.decided(displayOf([...KICK_OFF, abandon]))).toBe(true);
    expect(footballSport.decided(displayOf(KICKS_4_1))).toBe(true);
  });

  it('never waits on an ending: the engine decides the match', () => {
    for (const specs of [[], KICK_OFF, TWO_ONE]) {
      expect(footballSport.awaitingEnding(displayOf(specs))).toBe(false);
    }
  });

  it('writes Home’s card: the score, the kicks after a shootout, and nothing before or for an abandoned match', () => {
    expect(footballSport.resultLine(displayOf(KICK_OFF))).toBe('');
    expect(footballSport.resultLine(displayOf(TWO_ONE))).toBe('2–1');
    expect(footballSport.resultLine(displayOf(KICKS_4_1))).toBe('5–5 (4–1)');
    expect(footballSport.resultLine(displayOf([...KICK_OFF, abandon]))).toBe('');
  });
});

describe('footballSport: a tap', () => {
  const TAPS: readonly FootballTap[] = [
    { kind: 'start' },
    { kind: 'clock', running: true, elapsed: 0 },
    {
      kind: 'goal',
      side: 'first',
      scorer: null,
      assist: null,
      penalty: false,
      stamp: null,
    },
    { kind: 'period', stamp: null },
  ];

  it('picks no side to serve: football has no serve, so the match keeps no pick', () => {
    for (const tap of TAPS) expect(footballSport.tossOf(tap)).toBeNull();
  });

  it('refuses a tap the match does not take as not now', () => {
    for (const tap of TAPS) expect(footballSport.refusalFor(tap)).toBe('notNow');
  });

  it('builds the event for its taps', () => {
    const display = displayOf([]);
    expect(footballSport.eventFor({ kind: 'start' }, { bootstrap: MATCH, display })).toEqual({
      type: 'core.start',
      payload: {},
    });
  });

  it('sends a copied payload as it is', () => {
    const queued = {
      key: 'k',
      type: 'football.goal',
      payload: { by: 'ent-home' },
      rulesVersion: 0,
      createdAt: '2026-11-07T14:30:00.000Z',
      attempts: 1,
    };
    const send = { bootstrap: MATCH, ownEventIds: [] };
    expect(footballSport.payloadForSend(queued, [], true, send)).toEqual({ by: 'ent-home' });
  });
});

describe('footballSport: the pad', () => {
  it('is the football pad of the display, and carries the transport’s word the runtime gives it', () => {
    const display = displayOf(KICK_OFF);
    expect(footballSport.pad(display, { kind: 'synced' }).halves[0].label).toBe('Home FC');
    expect(footballSport.pad(display, { kind: 'offline', count: 2 }).sync).toEqual({
      kind: 'offline',
      count: 2,
    });
  });
});

describe('footballSport: Undo’s line', () => {
  it('names the tap Undo takes back, as the fold said it', () => {
    const display = displayOf([...KICK_OFF, goal({ by: 'A', at: at('H1', 600) })], [1, 2, 3]);
    expect(footballSport.undoneOf(display)).toEqual(display.lastTap);
    expect(footballSport.undoneOf(display)).toMatchObject({ kind: 'goal', side: 'second' });
  });

  it('names nothing with no last tap, and nothing again once Undo has taken it back', () => {
    expect(footballSport.undoneOf(displayOf([]))).toBeNull();
    const display = displayOf([...KICK_OFF, goal({ by: 'A', at: at('H1', 600) })], [1, 2, 3]);
    const done = footballSport.undoneOf(display);
    if (done === null) throw new Error('no last tap');
    const undone = footballSport.showUndone(display, done);
    expect(undone.lastTap).toEqual({ kind: 'undone', tap: done });
    expect(footballSport.undoneOf(undone)).toBeNull();
  });
});

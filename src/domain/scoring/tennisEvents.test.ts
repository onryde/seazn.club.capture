import { describe, expect, it } from 'vitest';
import { tennisEventFor, tennisPayloadForSend } from '@/domain/scoring/tennisEvents';
import { display } from '@/domain/scoring/tennisFold.testkit';
import type { TennisTap } from '@/domain/scoring/tennisTypes';
import type { Bootstrap } from '@/domain/scoring/wire';
import {
  AWAY,
  DOUBLES,
  HOME,
  SINGLES,
  ledgerOf,
  queuedOf,
  start,
  toss,
} from '../../../test/tennisLedger';

// S2-7 Task 5 (rulings 215, 217-221): each tap as the event the server records. Every payload below is written out
// literally from the engine's event schema and the spec, with the entrant ids of the fixture; the top half is `home`.

const SEND = { bootstrap: null, ownEventIds: [] };

function eventFor(tap: TennisTap, bootstrap: Bootstrap = SINGLES) {
  return tennisEventFor(tap, { bootstrap, display: display([start()], { bootstrap }) });
}

describe('each tap is the event the server records', () => {
  it('Start is core.start with no payload', () => {
    expect(eventFor({ kind: 'start' })).toEqual({ type: 'core.start', payload: {} });
  });

  it('a point is tennis.point with the winning entrant and nothing else (ruling 217)', () => {
    expect(eventFor({ kind: 'point', side: 'first' })).toEqual({
      type: 'tennis.point',
      payload: { by: HOME },
    });
    expect(eventFor({ kind: 'point', side: 'second' })).toEqual({
      type: 'tennis.point',
      payload: { by: AWAY },
    });
  });

  it('a set score is tennis.set_summary, home first, with no tb when the set had none', () => {
    expect(eventFor({ kind: 'setScore', first: 6, second: 3, tb: null })).toEqual({
      type: 'tennis.set_summary',
      payload: { home: 6, away: 3 },
    });
    const keys = Object.keys(
      eventFor({ kind: 'setScore', first: 6, second: 3, tb: null })?.payload as object,
    );
    expect(keys).toEqual(['home', 'away']);
  });

  it('a tie-break set carries its points, top side first', () => {
    expect(
      eventFor({ kind: 'setScore', first: 6, second: 7, tb: { first: 4, second: 7 } }),
    ).toEqual({
      type: 'tennis.set_summary',
      payload: { home: 6, away: 7, tb: { home: 4, away: 7 } },
    });
  });

  it('a violation is tennis.sanction with the side and level, and no person for a side alone', () => {
    expect(
      eventFor({ kind: 'violation', side: 'second', level: 'point_penalty', person: null }),
    ).toEqual({ type: 'tennis.sanction', payload: { by: AWAY, level: 'point_penalty' } });
  });

  it('a doubles violation carries the player as the bootstrap id', () => {
    expect(
      eventFor({ kind: 'violation', side: 'first', level: 'warning', person: 'h2' }, DOUBLES),
    ).toEqual({ type: 'tennis.sanction', payload: { by: HOME, level: 'warning', person: 'h2' } });
  });

  it('a game award is tennis.game.award with the winner', () => {
    expect(eventFor({ kind: 'award', side: 'second' })).toEqual({
      type: 'tennis.game.award',
      payload: { winner: AWAY },
    });
  });

  it('a break is tennis.interruption with its kind and side', () => {
    expect(eventFor({ kind: 'break', breakKind: 'medical', side: 'first' })).toEqual({
      type: 'tennis.interruption',
      payload: { kind: 'medical', by: HOME },
    });
  });

  it('a break for both or none has no by (ruling 220)', () => {
    const event = eventFor({ kind: 'break', breakKind: 'heat', side: null });
    expect(event).toEqual({ type: 'tennis.interruption', payload: { kind: 'heat' } });
    expect(Object.keys(event?.payload as object)).toEqual(['kind']);
  });
});

describe('what a tap that names what the match does not have becomes', () => {
  it('a seat with no entrant gives null, whatever the tap', () => {
    const open = { ...SINGLES, sides: { home: SINGLES.sides.home, away: null } };
    const taps: TennisTap[] = [
      { kind: 'start' },
      { kind: 'point', side: 'first' },
      { kind: 'award', side: 'second' },
    ];
    for (const tap of taps) {
      expect(tennisEventFor(tap, { bootstrap: open, display: display([start()]) })).toBeNull();
    }
  });

  it('a person the side does not list gives null', () => {
    expect(
      eventFor({ kind: 'violation', side: 'first', level: 'warning', person: 'a1' }, DOUBLES),
    ).toBeNull();
    expect(
      eventFor({ kind: 'violation', side: 'first', level: 'warning', person: 'nobody' }),
    ).toBeNull();
  });

  it("a level the phone never sends gives null (default is the organiser's, ruling 218)", () => {
    const tap = { kind: 'violation', side: 'first', level: 'default', person: null } as never;
    expect(eventFor(tap)).toBeNull();
    expect(
      eventFor({ kind: 'violation', side: 'first', level: 'penalty', person: null } as never),
    ).toBeNull();
  });

  it('a break kind the engine does not list gives null', () => {
    expect(eventFor({ kind: 'break', breakKind: 'lunch', side: null } as never)).toBeNull();
  });
});

describe('what the phone never sends (AGENTS §1, rulings 217, 218, 220)', () => {
  const taps: TennisTap[] = [
    { kind: 'start' },
    { kind: 'point', side: 'first' },
    { kind: 'point', side: 'second' },
    { kind: 'setScore', first: 6, second: 4, tb: null },
    { kind: 'setScore', first: 7, second: 6, tb: { first: 7, second: 5 } },
    ...(['warning', 'point_penalty', 'game_penalty'] as const).flatMap((level) => [
      { kind: 'violation' as const, side: 'first' as const, level, person: null },
      { kind: 'violation' as const, side: 'second' as const, level, person: 'a1' },
    ]),
    { kind: 'award', side: 'first' },
    ...(['medical', 'toilet', 'heat', 'other'] as const).flatMap((breakKind) => [
      { kind: 'break' as const, breakKind, side: 'first' as const },
      { kind: 'break' as const, breakKind, side: null },
    ]),
  ];
  const ALLOWED = [
    'core.start',
    'tennis.point',
    'tennis.set_summary',
    'tennis.sanction',
    'tennis.game.award',
    'tennis.interruption',
  ];
  const FORBIDDEN_FIELDS = ['server', 'scorer', 'meta', 'duration', 'at', 'reason'];

  it('every tap kind becomes an allowed event type, never a forfeit, a settle or an abandon', () => {
    for (const tap of taps) {
      const event = eventFor(tap, DOUBLES);
      expect(event).not.toBeNull();
      expect(ALLOWED).toContain(event?.type);
    }
  });

  it('no payload carries a field the pad does not send, and no sanction is a default', () => {
    for (const tap of taps) {
      const payload = eventFor(tap, DOUBLES)?.payload as Record<string, unknown>;
      for (const name of FORBIDDEN_FIELDS) expect(payload).not.toHaveProperty(name);
      expect(payload.level).not.toBe('default');
    }
  });

  it('a point carries exactly {by}', () => {
    expect(Object.keys(eventFor({ kind: 'point', side: 'first' })?.payload as object)).toEqual([
      'by',
    ]);
  });

  it('no tap carries a send anchor: base and reading stay off the event', () => {
    for (const tap of taps) {
      const event = eventFor(tap, DOUBLES);
      expect(event).not.toHaveProperty('base');
      expect(event).not.toHaveProperty('reading');
    }
  });
});

describe('the payload a queued tap is sent with', () => {
  const queued = queuedOf('k1', { type: 'tennis.point', payload: { by: HOME } });

  it('is the queued payload, unchanged', () => {
    expect(tennisPayloadForSend(queued, [], false, SEND)).toEqual({ by: HOME });
  });

  it('is the same payload however often it is asked, over any ledger, copied or not', () => {
    const ledger = ledgerOf([start(), { type: 'tennis.point', payload: { by: AWAY } }]);
    const first = tennisPayloadForSend(queued, ledger, false, SEND);
    expect(tennisPayloadForSend(queued, ledger, false, SEND)).toEqual(first);
    expect(tennisPayloadForSend(queued, ledger, true, SEND)).toEqual(first);
    expect(tennisPayloadForSend(queued, [], false, SEND)).toEqual(first);
  });

  it('keeps a set score and a break as queued', () => {
    const score = queuedOf('k2', { type: 'tennis.set_summary', payload: { home: 6, away: 2 } });
    expect(tennisPayloadForSend(score, [], false, SEND)).toEqual({ home: 6, away: 2 });
  });
});

describe('the toss (S2-7 Task 16, rulings 233, 235)', () => {
  const beforeStart = (bootstrap: Bootstrap = SINGLES) => display([], { bootstrap });
  const tossFor = (tap: TennisTap, shown = beforeStart(), bootstrap: Bootstrap = SINGLES) =>
    tennisEventFor(tap, { bootstrap, display: shown });

  it('is tennis.toss with the serving entrant and nothing else, top side first', () => {
    expect(tossFor({ kind: 'toss', side: 'first' })).toEqual({
      type: 'tennis.toss',
      payload: { serving: HOME },
    });
    expect(tossFor({ kind: 'toss', side: 'second' })).toEqual({
      type: 'tennis.toss',
      payload: { serving: AWAY },
    });
  });

  it('is refused once the match has started: the phone has no toss control mid-match (controller ruling 2)', () => {
    expect(tossFor({ kind: 'toss', side: 'second' }, display([start()]))).toBeNull();
  });

  it('is refused when a toss is already held: a second scorer’s pick is never sent over the first', () => {
    expect(tossFor({ kind: 'toss', side: 'second' }, display([toss('H')]))).toBeNull();
  });

  it('sends the same payload as queued (nothing in a toss can go stale)', () => {
    const queued = queuedOf('k', toss('A'));
    expect(tennisPayloadForSend(queued, ledgerOf([]), false, SEND)).toEqual({ serving: AWAY });
  });
});

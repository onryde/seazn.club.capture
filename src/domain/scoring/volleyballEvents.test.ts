import { describe, expect, it } from 'vitest';
import type { PadSide } from '@/domain/scoring/padView';
import type { SportEvent } from '@/domain/scoring/scoringSport';
import { foldVolleyball } from '@/domain/scoring/volleyballFold';
import {
  scoreEventsIn,
  volleyballEventFor,
  volleyballPayloadForSend,
} from '@/domain/scoring/volleyballEvents';
import type { VolleyballDisplay, VolleyballTap } from '@/domain/scoring/volleyballTypes';
import type { Bootstrap, LedgerEvent } from '@/domain/scoring/wire';
import {
  AWAY,
  BEACH,
  HOME,
  INDOOR,
  judgedLedgerOf,
  ledgerOf,
  queuedOf,
  rally,
  start,
  summary,
  voiding,
  type Spec,
} from '../../../test/volleyballLedger';

// S2-6 Task 5 (spec §4; rulings 171-176, 179, 180, 188, 189): what each tap is on the wire, and what a send keeps. The
// payloads are written out from the engine's event schemas (`setbased/kernel.d.ts`: SetBasedRally, SetBasedTimeout,
// SetBasedSub, SetBasedSanction, SetSummaryPositional), never computed by `volleyballEventFor`. Displays come from folding
// real ledgers, so a `serverPicked` or an `anchorNeeded` is the fold's, not a hand-made flag.

function displayOf(specs: readonly Spec[], bootstrap: Bootstrap, toss: PadSide | null = null) {
  const result = foldVolleyball({
    bootstrap,
    ledger: judgedLedgerOf(bootstrap, specs),
    queued: [],
    ownEventIds: [],
    toss,
  });
  if (result.kind !== 'folded') throw new Error(`did not fold: ${result.reason}`);
  return result.display;
}

const eventFor = (tap: VolleyballTap, display: VolleyballDisplay, bootstrap: Bootstrap = INDOOR) =>
  volleyballEventFor(tap, { bootstrap, display });

const rallyTap = (
  side: PadSide,
  serving: PadSide | null = null,
  servingAt: number | null = null,
): VolleyballTap => ({ kind: 'rally', side, serving, servingAt });

/** Four sets played, two all: the deciding set's toss is due. */
const wonSet = (winner: 'H' | 'A', serving?: 'H' | 'A'): Spec[] => [
  rally({ wonBy: winner, ...(serving === undefined ? {} : { serving }) }),
  ...Array.from({ length: 24 }, () => rally({ wonBy: winner })),
];
const TWO_ALL: Spec[] = [
  start(),
  ...wonSet('H', 'H'),
  ...wonSet('A'),
  ...wonSet('H'),
  ...wonSet('A'),
];

const LIVE: Spec[] = [start(), rally({ wonBy: 'H', serving: 'H' })];
const live = () => displayOf(LIVE, INDOOR);

describe('volleyballEventFor: each tap is one event, with its exact fields', () => {
  it('the start is core.start (the engine refuses a timeout, a sub or a sanction before it)', () => {
    expect(eventFor({ kind: 'start', server: 'first' }, displayOf([], INDOOR))).toEqual({
      type: 'core.start',
      payload: {},
    });
  });

  it('a rally names who won it: wonBy and nothing else once the engine knows the server', () => {
    expect(eventFor(rallyTap('second'), live())).toEqual({
      type: 'volleyball.rally',
      payload: { wonBy: AWAY },
    });
  });

  it('a timeout names the side: by, and never technical', () => {
    expect(eventFor({ kind: 'timeout', side: 'first' }, live())).toEqual({
      type: 'volleyball.timeout',
      payload: { by: HOME },
    });
  });

  it('a sub names the side and the people by id: by, off, on', () => {
    expect(eventFor({ kind: 'sub', side: 'second', off: 'a1', on: 'a7' }, live())).toEqual({
      type: 'volleyball.sub',
      payload: { by: AWAY, off: 'a1', on: 'a7' },
    });
  });

  it('a sub with no players named is the side alone: by', () => {
    expect(eventFor({ kind: 'sub', side: 'first' }, live())).toEqual({
      type: 'volleyball.sub',
      payload: { by: HOME },
    });
  });

  it('a sanction names the side, the level and, when there is one, the person by id', () => {
    expect(
      eventFor({ kind: 'sanction', side: 'first', level: 'penalty', person: 'h-coach' }, live()),
    ).toEqual({
      type: 'volleyball.sanction',
      payload: { by: HOME, level: 'penalty', person: 'h-coach' },
    });
    expect(
      eventFor({ kind: 'sanction', side: 'second', level: 'warning', person: null }, live()),
    ).toEqual({ type: 'volleyball.sanction', payload: { by: AWAY, level: 'warning' } });
  });

  it('a set score is the score so far, top first: home, away, partial', () => {
    expect(eventFor({ kind: 'setScore', first: 12, second: 9 }, live())).toEqual({
      type: 'volleyball.set.summary',
      payload: { home: 12, away: 9, partial: true },
    });
  });

  it('a match with a seat empty makes no event', () => {
    const noAway = { ...INDOOR, sides: { home: INDOOR.sides.home, away: null } };
    expect(eventFor(rallyTap('first'), live(), noAway)).toBeNull();
  });
});

describe('volleyballEventFor: a person the side does not list is refused', () => {
  it('a sub or a sanction naming someone off the sheet is null, and one naming the other side’s player too', () => {
    expect(eventFor({ kind: 'sub', side: 'first', off: 'h1', on: 'ghost' }, live())).toBeNull();
    expect(eventFor({ kind: 'sub', side: 'first', off: 'a1', on: 'h7' }, live())).toBeNull();
    expect(
      eventFor({ kind: 'sanction', side: 'first', level: 'warning', person: 'ghost' }, live()),
    ).toBeNull();
  });

  it('a person who has left the field but is on the sheet is listed (ruling 182)', () => {
    expect(eventFor({ kind: 'sub', side: 'first', off: 'h7', on: 'h1' }, live())).not.toBeNull();
  });

  it('beach records no substitutions: a sub is null', () => {
    const beach = displayOf([start(), rally({ wonBy: 'H', serving: 'H', server: 'h1' })], BEACH);
    expect(eventFor({ kind: 'sub', side: 'first', off: 'h1', on: 'h2' }, beach, BEACH)).toBeNull();
  });
});

describe('volleyballEventFor: the rally’s serve (rulings 179, 180)', () => {
  it('Start’s pick rides the first rally as serving, with the score count it was made at', () => {
    const picked = displayOf([start()], INDOOR, 'second');
    expect(eventFor(rallyTap('second'), picked)).toEqual({
      type: 'volleyball.rally',
      payload: { wonBy: AWAY, serving: AWAY },
      base: 0,
    });
  });

  it('the toss answer rides the deciding set’s first rally, with its base', () => {
    const toss = displayOf(TWO_ALL, INDOOR);
    expect(toss.anchorNeeded).toBe(true);
    const event = eventFor(rallyTap('first', 'first', toss.scoreEvents), toss);
    expect(event).toEqual({
      type: 'volleyball.rally',
      payload: { wonBy: HOME, serving: HOME },
      base: 100,
    });
  });

  it('drops the answer when a co-scorer’s rally landed after it was made: the count moved', () => {
    const co = displayOf([...TWO_ALL, rally({ wonBy: 'A' })], INDOOR);
    // The toss sheet was answered at 100 score events; the ledger is now at 101 and the engine names the server.
    expect(eventFor(rallyTap('first', 'first', 100), co)).toEqual({
      type: 'volleyball.rally',
      payload: { wonBy: HOME },
    });
  });

  it('drops an answer that was never asked for: no toss is due', () => {
    expect(eventFor(rallyTap('first', 'second', 1), live())).toEqual({
      type: 'volleyball.rally',
      payload: { wonBy: HOME },
    });
  });

  it('drops an answer made at another count even while the question stands', () => {
    const toss = displayOf(TWO_ALL, INDOOR);
    expect(eventFor(rallyTap('first', 'first', 99), toss)?.payload).toEqual({ wonBy: HOME });
  });
});

describe('volleyballEventFor: the server (rulings 173, 188, 189)', () => {
  const beachLive = () =>
    displayOf([start(), rally({ wonBy: 'H', serving: 'H', server: 'h1' })], BEACH);

  it('indoor never sends server', () => {
    expect(live().serverPersonId).toBeNull();
    const event = eventFor(rallyTap('first'), live());
    expect(event?.payload).not.toHaveProperty('server');
  });

  it('indoor never sends server, even if the display carried one', () => {
    const odd: VolleyballDisplay = { ...live(), serverPersonId: 'h1', serverPerson: 'x' };
    expect(eventFor(rallyTap('first'), odd)?.payload).not.toHaveProperty('server');
  });

  it('beach with a declared pair order sends the engine’s server, the person by id', () => {
    const shown = beachLive();
    expect(shown.serverPersonId).toBe('h1');
    expect(eventFor(rallyTap('second'), shown, BEACH)?.payload).toEqual({
      wonBy: AWAY,
      server: 'h1',
    });
  });

  it('beach names no server before the engine does: Start’s pick is not the engine’s belief', () => {
    const picked = displayOf([start()], BEACH, 'first');
    expect(picked.serverPicked).toBe(true);
    expect(eventFor(rallyTap('first'), picked, BEACH)?.payload).toEqual({
      wonBy: HOME,
      serving: HOME,
    });
  });

  it('beach’s deciding-set rally answered by the toss carries no server: the engine names nobody there', () => {
    const oneAll: Spec[] = [
      start(),
      rally({ wonBy: 'H', serving: 'H', server: 'h1' }),
      ...Array.from({ length: 20 }, () => rally({ wonBy: 'H' })),
      ...Array.from({ length: 21 }, () => rally({ wonBy: 'A' })),
    ];
    const toss = displayOf(oneAll, BEACH);
    expect([toss.set, toss.anchorNeeded, toss.serverPersonId]).toEqual([3, true, null]);
    const event = eventFor(rallyTap('first', 'first', toss.scoreEvents), toss, BEACH);
    expect(event?.payload).toEqual({ wonBy: HOME, serving: HOME });
  });
});

describe('volleyballEventFor: what the pad never writes (AGENTS §1; rulings 171, 172, 174, 176)', () => {
  const FORBIDDEN = [
    'core.forfeit',
    'core.settle',
    'core.abandon',
    'core.lineup.replacement',
    'volleyball.expedite.start',
  ];
  const ALLOWED = [
    'core.start',
    'volleyball.rally',
    'volleyball.timeout',
    'volleyball.sub',
    'volleyball.sanction',
    'volleyball.set.summary',
  ];

  // A tap of each kind, typed over the kinds (a new kind does not compile until it is listed here).
  const TAPS: Readonly<Record<VolleyballTap['kind'], VolleyballTap>> = {
    start: { kind: 'start', server: 'first' },
    rally: rallyTap('first'),
    timeout: { kind: 'timeout', side: 'first' },
    sub: { kind: 'sub', side: 'first', off: 'h1', on: 'h7' },
    sanction: { kind: 'sanction', side: 'first', level: 'disqualification', person: null },
    setScore: { kind: 'setScore', first: 3, second: 2 },
  };

  const sweep = (bootstrap: Bootstrap) => {
    const shown = displayOf([start()], bootstrap, 'first');
    return Object.values(TAPS)
      .map((tap) => eventFor(tap, shown, bootstrap))
      .filter((event): event is SportEvent => event !== null);
  };

  it.each([
    ['indoor', INDOOR],
    ['beach', BEACH],
  ] as const)(
    '%s: every tap kind is an event of an allowed type, never a forbidden one',
    (_n, bootstrap) => {
      const events = sweep(bootstrap);
      expect(events.length).toBeGreaterThanOrEqual(5);
      for (const event of events) {
        expect(ALLOWED).toContain(event.type);
        expect(FORBIDDEN).not.toContain(event.type);
      }
    },
  );

  it('no payload carries technical, scorer or a forfeit’s method', () => {
    for (const bootstrap of [INDOOR, BEACH])
      for (const event of sweep(bootstrap)) {
        const keys = Object.keys(event.payload as Record<string, unknown>);
        for (const key of ['technical', 'scorer', 'method', 'reason', 'returns'])
          expect(keys, `${event.type}`).not.toContain(key);
      }
  });

  it('a rally for a side whose lineup is one row still names no scorer (a singles-looking side)', () => {
    const { home } = INDOOR.sides;
    if (home === null) throw new Error('seed has a home side');
    const one = {
      ...INDOOR,
      sides: { ...INDOOR.sides, home: { ...home, lineup: [home.lineup[0]!] } },
    };
    expect(eventFor(rallyTap('first'), live(), one)?.payload).not.toHaveProperty('scorer');
  });
});

describe('scoreEventsIn: the one count', () => {
  it('counts rallies and set scores, not timeouts, and not one an undo took back', () => {
    const events = ledgerOf([start(), rally({ wonBy: 'H' }), rally({ wonBy: 'A' }), voiding(2)]);
    expect(scoreEventsIn(events)).toBe(1);
  });

  it('counts a set score given so far as one', () => {
    expect(scoreEventsIn(ledgerOf([start(), summary(10, 8), rally({ wonBy: 'H' })]))).toBe(2);
  });
});

describe('volleyballPayloadForSend: a stamp is valid at its own count only', () => {
  const stamped = (base: number | undefined) => ({
    ...queuedOf('q1', rally({ wonBy: 'H', serving: 'H' })),
    ...(base === undefined ? {} : { base }),
  });
  const ledger = (n: number): LedgerEvent[] =>
    ledgerOf([start(), ...Array.from({ length: n }, () => rally({ wonBy: 'H' }))]);

  it('keeps serving while the ledger holds the count the pick was made at', () => {
    expect(volleyballPayloadForSend(stamped(2), ledger(2), false)).toEqual({
      wonBy: HOME,
      serving: HOME,
    });
  });

  it('drops serving when a co-scorer’s rally moved the count', () => {
    expect(volleyballPayloadForSend(stamped(2), ledger(3), false)).toEqual({ wonBy: HOME });
  });

  it('keeps it once the ledger holds the tap’s own copy, whatever the count (the server matches a resend by key)', () => {
    expect(volleyballPayloadForSend(stamped(2), ledger(3), true)).toEqual({
      wonBy: HOME,
      serving: HOME,
    });
  });

  it('an old queue file with no base drops it only when a rally naming serving already stands', () => {
    const named: LedgerEvent[] = ledgerOf([start(), rally({ wonBy: 'H', serving: 'H' })]);
    expect(volleyballPayloadForSend(stamped(undefined), ledger(2), false)).toEqual({
      wonBy: HOME,
      serving: HOME,
    });
    expect(volleyballPayloadForSend(stamped(undefined), named, false)).toEqual({ wonBy: HOME });
  });

  it('a rally an undo took back does not count as played', () => {
    const undone = ledgerOf([start(), rally({ wonBy: 'H' }), voiding(2)]);
    expect(volleyballPayloadForSend(stamped(0), undone, false)).toEqual({
      wonBy: HOME,
      serving: HOME,
    });
  });

  it('a tap with no stamp goes as queued', () => {
    const plain = queuedOf('q2', { type: 'volleyball.timeout', payload: { by: HOME } });
    expect(volleyballPayloadForSend(plain, ledger(5), false)).toEqual({ by: HOME });
  });

  it('two sends over one ledger give one payload', () => {
    const once = volleyballPayloadForSend(stamped(2), ledger(3), false);
    expect(volleyballPayloadForSend(stamped(2), ledger(3), false)).toEqual(once);
    expect(volleyballPayloadForSend({ ...stamped(2), payload: once }, ledger(3), false)).toEqual(
      once,
    );
  });
});

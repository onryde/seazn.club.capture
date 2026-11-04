import { describe, expect, it } from 'vitest';
import { tableTennisEventFor, tableTennisPayloadForSend } from '@/domain/scoring/tableTennisEvents';
import type { TableTennisDisplay, TableTennisTap } from '@/domain/scoring/tableTennisPad';
import type { Bootstrap } from '@/domain/scoring/wire';
import {
  DOUBLES,
  DOUBLES_BENCH,
  DOUBLES_NO_ORDER,
  SINGLES,
  expedite,
  ledgerOf,
  queuedOf,
  rally,
  sanction,
  start,
  summary,
  timeout,
  voiding,
} from '../../../test/tableTennisLedger';

// Plan S2-2 Task 4 (design §4, §5.1): what each table tennis tap is on the wire. The top half is `home`, the bottom
// `away`. Expected payloads are written out from the engine's schema (`SetBasedRally`: `wonBy`, `serving` the SIDE as an
// entrant id, `server` and `scorer` PERSON ids, `returns` the receiver's count; `SetBasedSanction`: `by`, `level`,
// optional `person`) and from the design's rules, never computed by the code under test. 13 is ITTF 2.15.4's count.

/** Doubles, game 1 at 3–1, live; the engine names home's A. Sharma as server (a pair order on the team sheet). */
const LIVE: TableTennisDisplay = {
  sides: {
    first: { players: ['A. Sharma', 'R. Iyer'] },
    second: { players: ['L. Chen', 'M. Wong'] },
  },
  context: {
    competition: 'Spring Open 2026',
    division: 'U15 Boys Doubles',
    round: 'Round 1',
    match: 'Match 4',
    sides: ['A. Sharma / R. Iyer', 'L. Chen / M. Wong'],
  },
  points: { first: 3, second: 1 },
  finished: [],
  game: 1,
  rules: { bestOf: 5, setTo: 11, finalSetTo: 11, winBy: 2, scoreBound: 99 },
  phase: 'live',
  server: 'first',
  serverPerson: 'A. Sharma',
  serverPersonId: 'p-sharma',
  serveNumber: 1,
  serverPicked: false,
  anchorNeeded: false,
  expedite: 'off',
  deuce: false,
  records: { timeouts: true, sanctions: true, expedite: true },
  lastTap: { kind: 'rally', side: 'first', won: 'none', game: 1 },
  undoable: true,
};

/** Singles at 3–1, the engine naming home as server: the fold names the SIDE only, never a singles person. */
const SINGLES_LIVE: TableTennisDisplay = {
  ...LIVE,
  sides: { first: { players: ['A. Sharma'] }, second: { players: ['L. Chen'] } },
  serverPerson: null,
  serverPersonId: null,
};

/** The Start screen's pick, `second`, before the match's first point: no ledger event has named a server yet. */
const PICKED: TableTennisDisplay = {
  ...LIVE,
  points: { first: 0, second: 0 },
  phase: 'pre',
  server: 'second',
  serverPerson: null,
  serverPersonId: null,
  serverPicked: true,
  lastTap: { kind: 'start', server: 'second' },
};

/** The engine can name no server for want of an anchor (a co-scorer's point landed first): Who is serving? shows. */
const ANCHORLESS: TableTennisDisplay = {
  ...LIVE,
  server: null,
  serverPerson: null,
  serverPersonId: null,
  serveNumber: null,
  anchorNeeded: true,
};

/** Expedite in force, the engine naming home as server: the receiver (away) can take a 13 returns point. */
const IN_FORCE: TableTennisDisplay = { ...LIVE, expedite: 'inForce' };
const SINGLES_IN_FORCE: TableTennisDisplay = { ...SINGLES_LIVE, expedite: 'inForce' };

const eventFor = (
  tap: TableTennisTap,
  display: TableTennisDisplay = LIVE,
  bootstrap: Bootstrap = DOUBLES,
) => tableTennisEventFor(tap, { bootstrap, display });

const point = (side: 'first' | 'second', serving: 'first' | 'second' | null = null) =>
  ({ kind: 'rally', side, serving }) as const;

const RALLY = 'tabletennis.rally';

describe('tableTennisEventFor: the start', () => {
  it('starts the match with an empty core.start: the pick travels on the first rally', () => {
    expect(
      eventFor({ kind: 'start', server: 'second' }, { ...PICKED, phase: 'notStarted' }),
    ).toStrictEqual({ type: 'core.start', payload: {} });
  });
});

describe('tableTennisEventFor: a rally', () => {
  it('gives the top half’s point to home and the bottom half’s to away', () => {
    expect(eventFor(point('first'))).toStrictEqual({
      type: RALLY,
      payload: { wonBy: 'ent-home', server: 'p-sharma' },
    });
    expect(eventFor(point('second'))).toStrictEqual({
      type: RALLY,
      payload: { wonBy: 'ent-away', server: 'p-sharma' },
    });
  });

  it('names the doubles server the engine names, from the team sheet’s pair order, and no scorer', () => {
    expect(
      eventFor(point('second'), { ...LIVE, server: 'second', serverPersonId: 'p-wong' }),
    ).toStrictEqual({
      type: RALLY,
      payload: { wonBy: 'ent-away', server: 'p-wong' },
    });
  });

  // An empty input: a team sheet with no pair order gives the engine nobody to name, so the rally names nobody.
  it('doubles rally without pair order sends no server', () => {
    const unordered = { ...LIVE, serverPerson: null, serverPersonId: null };
    expect(eventFor(point('first'), unordered, DOUBLES_NO_ORDER)).toStrictEqual({
      type: RALLY,
      payload: { wonBy: 'ent-home' },
    });
  });

  it('sends no server for a side with a bench row, whose server the phone does not name', () => {
    const bench = { ...LIVE, serverPerson: null, serverPersonId: null };
    expect(eventFor(point('second'), bench, DOUBLES_BENCH)).toStrictEqual({
      type: RALLY,
      payload: { wonBy: 'ent-away' },
    });
  });

  it('names a singles server, the serving side’s one player, and the winner as scorer', () => {
    expect(eventFor(point('second'), SINGLES_LIVE, SINGLES)).toStrictEqual({
      type: RALLY,
      payload: { wonBy: 'ent-away', server: 'p-sharma', scorer: 'p-chen' },
    });
    expect(eventFor(point('first'), { ...SINGLES_LIVE, server: 'second' }, SINGLES)).toStrictEqual({
      type: RALLY,
      payload: { wonBy: 'ent-home', server: 'p-chen', scorer: 'p-sharma' },
    });
  });

  it('names no server while the engine names none, and still the singles scorer', () => {
    expect(eventFor(point('second'), { ...SINGLES_LIVE, server: null }, SINGLES)).toStrictEqual({
      type: RALLY,
      payload: { wonBy: 'ent-away', scorer: 'p-chen' },
    });
  });

  it('names the picked side as serving on the first point, whichever side wins it, and no server', () => {
    expect(eventFor(point('first'), PICKED)).toStrictEqual({
      type: RALLY,
      payload: { wonBy: 'ent-home', serving: 'ent-away' },
    });
    expect(eventFor(point('second'), { ...PICKED, server: 'first' })).toStrictEqual({
      type: RALLY,
      payload: { wonBy: 'ent-away', serving: 'ent-home' },
    });
  });

  // A pick is not the engine's belief: it anchors the serve, and it names no person as the server (singles included).
  it('names no server on the pick’s rally, in singles or in doubles', () => {
    expect(eventFor(point('first'), PICKED, SINGLES)).toStrictEqual({
      type: RALLY,
      payload: { wonBy: 'ent-home', serving: 'ent-away', scorer: 'p-sharma' },
    });
    const confused: TableTennisDisplay = { ...PICKED, serverPersonId: 'p-chen' };
    expect(eventFor(point('first'), confused)).toStrictEqual({
      type: RALLY,
      payload: { wonBy: 'ent-home', serving: 'ent-away' },
    });
  });

  it('a held serving rides the rally, as the entrant of the side answered', () => {
    expect(eventFor(point('second', 'first'), ANCHORLESS)).toStrictEqual({
      type: RALLY,
      payload: { wonBy: 'ent-away', serving: 'ent-home' },
    });
    expect(
      eventFor(point('first', 'second'), { ...ANCHORLESS, sides: SINGLES_LIVE.sides }, SINGLES),
    ).toStrictEqual({
      type: RALLY,
      payload: { wonBy: 'ent-home', serving: 'ent-away', scorer: 'p-sharma' },
    });
  });

  it('a held serving wins over a pick that is still showing', () => {
    expect(eventFor(point('first', 'first'), PICKED)).toStrictEqual({
      type: RALLY,
      payload: { wonBy: 'ent-home', serving: 'ent-home' },
    });
  });

  // The web leaves `serving` off the ordinary tap: a stamp of the engine's own belief would make its drift check check
  // itself (tabletennis.tsx buildHalf). Only an answer the scorer gave, or the pick, is sent.
  it('names no serving when the engine names the server and nothing is held', () => {
    const made = eventFor(point('second'));
    expect(made?.payload).not.toHaveProperty('serving');
  });

  it('names no serving and no server when the engine can name none and nothing is held', () => {
    expect(eventFor(point('first'), ANCHORLESS)).toStrictEqual({
      type: RALLY,
      payload: { wonBy: 'ent-home' },
    });
  });
});

describe('tableTennisEventFor: 13 returns', () => {
  const returns = (side: 'first' | 'second') => ({ kind: 'returns', side }) as const;

  it('gives the receiver the point and records the 13 returns, naming no serving and no server', () => {
    expect(eventFor(returns('second'), IN_FORCE)).toStrictEqual({
      type: RALLY,
      payload: { wonBy: 'ent-away', returns: 13 },
    });
    expect(eventFor(returns('first'), { ...IN_FORCE, server: 'second' })).toStrictEqual({
      type: RALLY,
      payload: { wonBy: 'ent-home', returns: 13 },
    });
  });

  it('names the singles receiver as scorer, as a rally does, and still no server', () => {
    expect(eventFor(returns('second'), SINGLES_IN_FORCE, SINGLES)).toStrictEqual({
      type: RALLY,
      payload: { wonBy: 'ent-away', returns: 13, scorer: 'p-chen' },
    });
  });

  it('returns is null for the server: a 13 returns point never credits the serving side', () => {
    expect(eventFor(returns('first'), IN_FORCE)).toBeNull();
    expect(eventFor(returns('second'), { ...IN_FORCE, server: 'second' })).toBeNull();
  });

  it('returns is null while expedite is off, and while it is only offered', () => {
    expect(eventFor(returns('second'), { ...LIVE, expedite: 'off' })).toBeNull();
    expect(eventFor(returns('second'), { ...LIVE, expedite: 'offered' })).toBeNull();
  });

  it('returns is null while the engine names no server: nobody is known to be receiving', () => {
    expect(eventFor(returns('first'), { ...IN_FORCE, server: null })).toBeNull();
    expect(eventFor(returns('second'), { ...IN_FORCE, server: null })).toBeNull();
  });

  // The Start pick is not an engine-named server: it must not decide who the receiver is.
  it('returns is null while the server shown is only this phone’s pick', () => {
    expect(eventFor(returns('second'), { ...IN_FORCE, serverPicked: true })).toBeNull();
  });
});

describe('tableTennisEventFor: a timeout and Expedite', () => {
  it('records a timeout by the side, the top half’s as home', () => {
    expect(eventFor({ kind: 'timeout', side: 'first' })).toStrictEqual({
      type: 'tabletennis.timeout',
      payload: { by: 'ent-home' },
    });
    expect(eventFor({ kind: 'timeout', side: 'second' })).toStrictEqual({
      type: 'tabletennis.timeout',
      payload: { by: 'ent-away' },
    });
  });

  it('starts Expedite with an empty payload', () => {
    expect(eventFor({ kind: 'expedite' })).toStrictEqual({
      type: 'tabletennis.expedite.start',
      payload: {},
    });
  });
});

describe('tableTennisEventFor: the cards and the set score', () => {
  it('records a card against the side, naming the person by the id the bootstrap gave', () => {
    expect(
      eventFor({ kind: 'sanction', side: 'second', level: 'penalty', person: 'M. Wong' }),
    ).toStrictEqual({
      type: 'tabletennis.sanction',
      payload: { by: 'ent-away', level: 'penalty', person: 'p-wong' },
    });
    expect(
      eventFor({ kind: 'sanction', side: 'first', level: 'warning', person: 'R. Iyer' }),
    ).toStrictEqual({
      type: 'tabletennis.sanction',
      payload: { by: 'ent-home', level: 'warning', person: 'p-iyer' },
    });
  });

  it('omits the person when the tap names none: a card by the side', () => {
    const made = eventFor({ kind: 'sanction', side: 'first', level: 'warning', person: null });
    expect(made).toStrictEqual({
      type: 'tabletennis.sanction',
      payload: { by: 'ent-home', level: 'warning' },
    });
    expect(made?.payload).not.toHaveProperty('person');
  });

  it('records nothing for a person who does not play for that side', () => {
    expect(
      eventFor({ kind: 'sanction', side: 'first', level: 'warning', person: 'L. Chen' }),
    ).toBeNull();
    expect(
      eventFor({ kind: 'sanction', side: 'first', level: 'warning', person: 'Nobody' }),
    ).toBeNull();
  });

  it('records a team card, naming no person, against a side that lists no people', () => {
    const teams: Bootstrap = {
      ...DOUBLES,
      sides: {
        home: { entrantId: 'ent-a', name: 'A', kind: 'individual', members: [], lineup: [] },
        away: DOUBLES.sides.away,
      },
    };
    const team = (person: string | null) =>
      eventFor({ kind: 'sanction', side: 'first', level: 'warning', person }, LIVE, teams);
    expect(team('A')).toStrictEqual({
      type: 'tabletennis.sanction',
      payload: { by: 'ent-a', level: 'warning' },
    });
    expect(team(null)).toStrictEqual({
      type: 'tabletennis.sanction',
      payload: { by: 'ent-a', level: 'warning' },
    });
    expect(team('L. Chen')).toBeNull();
  });

  it('still names the person when a singles side is named as its one player', () => {
    expect(
      eventFor(
        { kind: 'sanction', side: 'first', level: 'penalty', person: 'A. Sharma' },
        SINGLES_LIVE,
        SINGLES,
      ),
    ).toStrictEqual({
      type: 'tabletennis.sanction',
      payload: { by: 'ent-home', level: 'penalty', person: 'p-sharma' },
    });
  });

  it('sets the game’s points top first as home and away, a partial summary', () => {
    expect(eventFor({ kind: 'setScore', first: 9, second: 4 }, PICKED)).toStrictEqual({
      type: 'tabletennis.game.summary',
      payload: { home: 9, away: 4, partial: true },
    });
  });
});

// An empty input: a match with a seat the bootstrap has no entrant for (a bye, a match waiting on a result).
describe('tableTennisEventFor: a match with an empty seat', () => {
  const TAPS: readonly TableTennisTap[] = [
    { kind: 'start', server: 'first' },
    point('first'),
    point('second', 'first'),
    { kind: 'returns', side: 'second' },
    { kind: 'timeout', side: 'first' },
    { kind: 'expedite' },
    { kind: 'sanction', side: 'first', level: 'warning', person: null },
    { kind: 'setScore', first: 1, second: 0 },
  ];

  it('records nothing, for any tap, when either seat is empty', () => {
    const [home, away] = [DOUBLES.sides.home, DOUBLES.sides.away];
    for (const bye of [
      { home, away: null },
      { home: null, away },
    ]) {
      const bootstrap: Bootstrap = { ...DOUBLES, sides: bye };
      for (const tap of TAPS) expect(eventFor(tap, IN_FORCE, bootstrap)).toBeNull();
    }
  });

  // The pad never ends a match: a device link gets 403 for a settle, an abandon or any forfeit of ours.
  it('never emits a forfeit, a settle or an abandon: every tap, at every point a match can be at', () => {
    const displays = [LIVE, SINGLES_LIVE, PICKED, ANCHORLESS, IN_FORCE, SINGLES_IN_FORCE];
    const types = new Set(
      displays.flatMap((display) =>
        TAPS.flatMap((tap) => {
          const made = eventFor(tap, display);
          return made === null ? [] : [made.type];
        }),
      ),
    );
    expect([...types].sort()).toEqual([
      'core.start',
      'tabletennis.expedite.start',
      'tabletennis.game.summary',
      'tabletennis.rally',
      'tabletennis.sanction',
      'tabletennis.timeout',
    ]);
  });
});

// The controller's ruling (2026-11-03), after badminton's (2026-11-02): the first rally can lose its `serving` at its
// first send, but table tennis never recovers a lost anchor from later rallies (the engine's rotation is fixed-turns,
// design §4.1), so a tap holding the answer keeps it unless a rally that carries one already stands.
describe('tableTennisPayloadForSend', () => {
  const HELD = queuedOf('k-held', rally({ wonBy: 'H', serving: 'A' }));
  const WITHOUT = { wonBy: 'ent-home' };

  it('sends the answer when the ledger holds no rally yet', () => {
    expect(tableTennisPayloadForSend(HELD, ledgerOf([start()]))).toBe(HELD.payload);
    expect(tableTennisPayloadForSend(HELD, [])).toBe(HELD.payload);
  });

  it('payloadForSend drops serving when a standing rally already carries it', () => {
    expect(
      tableTennisPayloadForSend(HELD, ledgerOf([start(), rally({ wonBy: 'A', serving: 'H' })])),
    ).toEqual(WITHOUT);
  });

  it('keeps the rest of the tap when it drops serving', () => {
    const attributed = queuedOf('k', rally({ wonBy: 'H', serving: 'A', returns: 5 }));
    expect(
      tableTennisPayloadForSend(
        attributed,
        ledgerOf([start(), rally({ wonBy: 'A', serving: 'H' })]),
      ),
    ).toEqual({ wonBy: 'ent-home', returns: 5 });
  });

  // Unlike badminton: with no anchor standing, rallies that name no `serving` do not make this one stale.
  it('payloadForSend keeps serving when no anchor stands, whatever rallies do', () => {
    const plain = ledgerOf([start(), rally({ wonBy: 'H' }), rally({ wonBy: 'A' })]);
    expect(tableTennisPayloadForSend(HELD, plain)).toBe(HELD.payload);
  });

  // The controller's ruling, after badminton's: an undone rally does not count as played, so its anchor is gone.
  it('a voided anchor does not count', () => {
    const undone = ledgerOf([start(), rally({ wonBy: 'A', serving: 'H' }), voiding(2)]);
    expect(tableTennisPayloadForSend(HELD, undone)).toBe(HELD.payload);
  });

  it('a voided anchor does not count beside a standing rally that names no serving', () => {
    const ledger = ledgerOf([
      start(),
      rally({ wonBy: 'A', serving: 'H' }),
      voiding(2),
      rally({ wonBy: 'H' }),
    ]);
    expect(tableTennisPayloadForSend(HELD, ledger)).toBe(HELD.payload);
  });

  it('drops serving when an anchor still stands beside one that was undone', () => {
    const ledger = ledgerOf([
      start(),
      rally({ wonBy: 'A', serving: 'H' }),
      voiding(2),
      rally({ wonBy: 'H', serving: 'H' }),
    ]);
    expect(tableTennisPayloadForSend(HELD, ledger)).toEqual(WITHOUT);
  });

  // After an interruption: a send may have reached the server, which then holds the tap under its key as first sent.
  it('a retried tap keeps its payload', () => {
    const sent = { ...HELD, attempts: 1 };
    const ledger = ledgerOf([start(), rally({ wonBy: 'A', serving: 'H' })]);
    expect(tableTennisPayloadForSend(sent, ledger)).toBe(sent.payload);
  });

  it('changes no tap that names no serving: a 13 returns point, a timeout, a card', () => {
    const ledger = ledgerOf([start(), rally({ wonBy: 'A', serving: 'H' })]);
    for (const spec of [
      rally({ wonBy: 'H' }),
      rally({ wonBy: 'A', returns: 13 }),
      timeout('A'),
      expedite(),
      sanction('A', 'penalty', 'p-chen'),
      summary(3, 2),
      start(),
    ]) {
      const tap = queuedOf('k', spec);
      expect(tableTennisPayloadForSend(tap, ledger)).toBe(tap.payload);
    }
  });

  it('is not misled by a ledger event whose payload is not a record', () => {
    const garbled = ledgerOf([start(), rally({ wonBy: 'A', serving: 'H' })]).map((event) => ({
      ...event,
      payload: event.type === RALLY ? null : event.payload,
    }));
    expect(tableTennisPayloadForSend(HELD, garbled)).toBe(HELD.payload);
  });
});

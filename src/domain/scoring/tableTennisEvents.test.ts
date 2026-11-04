import { describe, expect, it } from 'vitest';
import { tableTennisEventFor, tableTennisPayloadForSend } from '@/domain/scoring/tableTennisEvents';
import { foldTableTennis } from '@/domain/scoring/tableTennisFold';
import type { TableTennisDisplay, TableTennisTap } from '@/domain/scoring/tableTennisPad';
import type { QueuedEvent } from '@/domain/scoring/queue';
import type { Bootstrap, LedgerEvent } from '@/domain/scoring/wire';
import {
  DOUBLES,
  DOUBLES_BENCH,
  DOUBLES_NO_ORDER,
  SINGLES,
  expedite,
  ledgerOf,
  queuedOf,
  rallies,
  rally,
  sanction,
  start,
  summary,
  timeout,
  voiding,
  wholeGame,
  type Spec,
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
  scoreEvents: 4,
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
  scoreEvents: 0,
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

/** The count of score events LIVE, ANCHORLESS and the pick's displays hold unless a test says (`scoreEvents`). */
const COUNT = 4;

/** A point; a held answer (`serving`) says the count it was made at (`servingAt`), as the hook's `carry` does. */
const point = (
  side: 'first' | 'second',
  serving: 'first' | 'second' | null = null,
  servingAt: number | null = serving === null ? null : COUNT,
) => ({ kind: 'rally', side, serving, servingAt }) as const;

/**
 * What a tap is sent with. `copied` is whether the ledger holds the server's copy of the tap (the match's `copiesOf`);
 * it matters only for a tap that has been sent before, so it is false unless a test says.
 */
const sendOf = (queued: QueuedEvent, ledger: readonly LedgerEvent[], copied = false) =>
  tableTennisPayloadForSend(queued, ledger, copied);

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
      base: 0,
    });
    expect(eventFor(point('second'), { ...PICKED, server: 'first' })).toStrictEqual({
      type: RALLY,
      payload: { wonBy: 'ent-away', serving: 'ent-home' },
      base: 0,
    });
  });

  // A pick is not the engine's belief: it anchors the serve, and it names no person as the server (singles included).
  it('names no server on the pick’s rally, in singles or in doubles', () => {
    expect(eventFor(point('first'), PICKED, SINGLES)).toStrictEqual({
      type: RALLY,
      payload: { wonBy: 'ent-home', serving: 'ent-away', scorer: 'p-sharma' },
      base: 0,
    });
    const confused: TableTennisDisplay = { ...PICKED, serverPersonId: 'p-chen' };
    expect(eventFor(point('first'), confused)).toStrictEqual({
      type: RALLY,
      payload: { wonBy: 'ent-home', serving: 'ent-away' },
      base: 0,
    });
  });

  it('a held serving rides the rally, as the entrant of the side answered', () => {
    expect(eventFor(point('second', 'first'), ANCHORLESS)).toStrictEqual({
      type: RALLY,
      payload: { wonBy: 'ent-away', serving: 'ent-home' },
      base: 4,
    });
    expect(
      eventFor(point('first', 'second'), { ...ANCHORLESS, sides: SINGLES_LIVE.sides }, SINGLES),
    ).toStrictEqual({
      type: RALLY,
      payload: { wonBy: 'ent-home', serving: 'ent-away', scorer: 'p-sharma' },
      base: 4,
    });
  });

  // Task 7 fix round 1 (I2): an answer is read only where the pad needs one (`anchorNeeded`). A pick standing, or a server the
  // engine names, means the answer is stale or was never asked for, and the domain does not stamp it (the hook's own
  // guard is a second door, not the only one).
  it('a held serving is ignored while a pick stands: the pick is what served', () => {
    expect(eventFor(point('first', 'first'), PICKED)).toStrictEqual({
      type: RALLY,
      payload: { wonBy: 'ent-home', serving: 'ent-away' },
      base: 0,
    });
  });

  it('a held serving is ignored when the engine names the server: nothing is sent as serving', () => {
    // Doubles: the held answer says the home side served; the engine names the away side's server.
    const doubles = eventFor(point('second', 'first'), {
      ...LIVE,
      server: 'second',
      serverPersonId: 'p-wong',
      scoreEvents: 7,
    });
    expect(doubles).toStrictEqual({
      type: RALLY,
      payload: { wonBy: 'ent-away', server: 'p-wong' },
    });
    // Singles: the same, and the rally carries no base to judge a stamp it does not have.
    const singles = eventFor(point('first', 'second'), SINGLES_LIVE, SINGLES);
    expect(singles).toStrictEqual({
      type: RALLY,
      payload: { wonBy: 'ent-home', server: 'p-sharma', scorer: 'p-sharma' },
    });
  });

  // Fix round 1: a `serving` stamp is valid only at the score it was made at. The tap keeps the number of standing score
  // events (points and game scores) the scorer's view held, so its first send can tell the score has moved.
  it('a rally that names serving carries the display’s count of score events as its base', () => {
    expect(eventFor(point('second', 'first', 7), { ...ANCHORLESS, scoreEvents: 7 })?.base).toBe(7);
    expect(eventFor(point('first'), { ...PICKED, scoreEvents: 0 })?.base).toBe(0);
    expect(eventFor(point('first'), { ...PICKED, scoreEvents: 3 })?.base).toBe(3);
  });

  // Fix round 2 (M1 of the Batch C review): the tie between a held answer and its score is the domain's, not only the
  // hook's. The tap says the count the answer was made at (`servingAt`); at another count the answer was made to a score
  // that no longer stands, and the rally goes without it, with no base to judge.
  it('a held serving made at another count of score events than the display holds is not stamped', () => {
    for (const at of [3, 5, 0, null]) {
      expect(eventFor(point('second', 'first', at), ANCHORLESS), String(at)).toStrictEqual({
        type: RALLY,
        payload: { wonBy: 'ent-away' },
      });
    }
    expect(eventFor(point('second', 'first', 4), ANCHORLESS)).toStrictEqual({
      type: RALLY,
      payload: { wonBy: 'ent-away', serving: 'ent-home' },
      base: 4,
    });
  });

  it('a rally that names no serving, and every other tap, carries no base', () => {
    const taps: readonly TableTennisTap[] = [
      point('second'),
      { kind: 'returns', side: 'second' },
      { kind: 'timeout', side: 'first' },
      { kind: 'expedite' },
      { kind: 'sanction', side: 'first', level: 'warning', person: null },
      { kind: 'setScore', first: 1, second: 0 },
      { kind: 'start', server: 'first' },
    ];
    for (const tap of taps) {
      expect(eventFor(tap, { ...IN_FORCE, scoreEvents: 7 })).not.toHaveProperty('base');
    }
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
// design §4.1). A tap with no `base` (a queue file from before it existed) therefore keeps its answer unless a rally that
// carries one already stands: these taps are all of that kind. A tap with a `base` is judged by the count (next describe).
describe('tableTennisPayloadForSend: a tap with no base', () => {
  const HELD = queuedOf('k-held', rally({ wonBy: 'H', serving: 'A' }));
  const WITHOUT = { wonBy: 'ent-home' };

  it('sends the answer when the ledger holds no rally yet', () => {
    expect(sendOf(HELD, ledgerOf([start()]))).toBe(HELD.payload);
    expect(sendOf(HELD, [])).toBe(HELD.payload);
  });

  it('payloadForSend drops serving when a standing rally already carries it', () => {
    expect(sendOf(HELD, ledgerOf([start(), rally({ wonBy: 'A', serving: 'H' })]))).toEqual(WITHOUT);
  });

  it('keeps the rest of the tap when it drops serving', () => {
    const attributed = queuedOf('k', rally({ wonBy: 'H', serving: 'A', returns: 5 }));
    expect(sendOf(attributed, ledgerOf([start(), rally({ wonBy: 'A', serving: 'H' })]))).toEqual({
      wonBy: 'ent-home',
      returns: 5,
    });
  });

  // Unlike badminton: with no anchor standing, rallies that name no `serving` do not make this one stale.
  it('payloadForSend keeps serving when no anchor stands, whatever rallies do', () => {
    const plain = ledgerOf([start(), rally({ wonBy: 'H' }), rally({ wonBy: 'A' })]);
    expect(sendOf(HELD, plain)).toBe(HELD.payload);
  });

  // The controller's ruling, after badminton's: an undone rally does not count as played, so its anchor is gone.
  it('a voided anchor does not count', () => {
    const undone = ledgerOf([start(), rally({ wonBy: 'A', serving: 'H' }), voiding(2)]);
    expect(sendOf(HELD, undone)).toBe(HELD.payload);
  });

  it('a voided anchor does not count beside a standing rally that names no serving', () => {
    const ledger = ledgerOf([
      start(),
      rally({ wonBy: 'A', serving: 'H' }),
      voiding(2),
      rally({ wonBy: 'H' }),
    ]);
    expect(sendOf(HELD, ledger)).toBe(HELD.payload);
  });

  it('drops serving when an anchor still stands beside one that was undone', () => {
    const ledger = ledgerOf([
      start(),
      rally({ wonBy: 'A', serving: 'H' }),
      voiding(2),
      rally({ wonBy: 'H', serving: 'H' }),
    ]);
    expect(sendOf(HELD, ledger)).toEqual(WITHOUT);
  });

  // After an interruption: a send may have reached the server. When the ledger holds the copy of the tap, that copy
  // stands (the web matches a resend by its key and never compares payloads), so the tap is sent as it was first sent.
  it('a retried tap whose copy is in the ledger keeps its payload', () => {
    const sent = { ...HELD, attempts: 1 };
    const ledger = ledgerOf([start(), rally({ wonBy: 'A', serving: 'H' })]);
    expect(sendOf(sent, ledger, true)).toBe(sent.payload);
  });

  // Fix round 2 (I2): with no copy in the ledger the first attempt may never have been stored, and a resend is then
  // appended as new: it is judged as a first send is.
  it('a retried tap whose copy is not in the ledger is judged as a first send', () => {
    const sent = { ...HELD, attempts: 1 };
    const ledger = ledgerOf([start(), rally({ wonBy: 'A', serving: 'H' })]);
    expect(sendOf(sent, ledger, false)).toEqual(WITHOUT);
    expect(sendOf(sent, ledgerOf([start()]), false)).toBe(sent.payload);
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
      expect(sendOf(tap, ledger)).toBe(tap.payload);
    }
  });

  it('is not misled by a ledger event whose payload is not a record', () => {
    const garbled = ledgerOf([start(), rally({ wonBy: 'A', serving: 'H' })]).map((event) => ({
      ...event,
      payload: event.type === RALLY ? null : event.payload,
    }));
    expect(sendOf(HELD, garbled)).toBe(HELD.payload);
  });
});

// Fix round 1 (the controller's ruling, 2026-11-04, from the Batch B review): the engine's fixed-turns rotation takes any
// `serving` as an anchor and works back from the turn parity, so a stamp made at 0–0 that lands after n co-scorer points
// that named none makes the engine name the wrong next server for n = 2 and 3, with no `unknownBecause`, for the whole
// match. A stamp is valid only at the score it was made at: the tap keeps `base`, the number of standing score events
// (points and game scores) in the scorer's view, and its first send drops `serving` if the ledger's count is another.
describe('tableTennisPayloadForSend: a serving is valid at the score it was made at', () => {
  const madeAt = (base: number) => ({
    ...queuedOf('k-base', rally({ wonBy: 'H', serving: 'A' })),
    base,
  });
  const WITHOUT = { wonBy: 'ent-home' };
  /** `n` points the browser scorer recorded, each naming no serving, behind the match's start. */
  const behind = (n: number) =>
    ledgerOf([start(), ...Array.from({ length: n }, () => rally({ wonBy: 'A' }))]);

  // The reviewer's probe (rv/stalepick.mjs): the pick rally was made at 0–0, home having served first.
  it('drops the pick when 1, 2, 3 or 4 co-scorer points landed since it was made at 0–0', () => {
    for (const landed of [1, 2, 3, 4]) {
      expect(sendOf(madeAt(0), behind(landed))).toEqual(WITHOUT);
    }
  });

  it('keeps the pick when nothing landed since it was made', () => {
    const pick = madeAt(0);
    expect(sendOf(pick, behind(0))).toBe(pick.payload);
    expect(sendOf(pick, [])).toBe(pick.payload);
  });

  it('drops the pick when a game score landed since: a set score moves the score as a point does', () => {
    expect(sendOf(madeAt(0), ledgerOf([start(), summary(3, 2)]))).toEqual(WITHOUT);
    expect(sendOf(madeAt(0), ledgerOf([start(), wholeGame(11, 7)]))).toEqual(WITHOUT);
  });

  it('counts a point and a game score alike, and nothing else a scorer records', () => {
    const quiet = ledgerOf([
      start(),
      rally({ wonBy: 'H' }),
      timeout('A'),
      expedite(),
      sanction('H', 'warning'),
    ]);
    expect(sendOf(madeAt(1), quiet)).toEqual(madeAt(1).payload);
    const withSummary = ledgerOf([start(), rally({ wonBy: 'H' }), summary(2, 1)]);
    expect(sendOf(madeAt(2), withSummary)).toEqual(madeAt(2).payload);
  });

  it('does not count a co-scorer’s point that was undone', () => {
    const undone = ledgerOf([start(), rally({ wonBy: 'A' }), voiding(2)]);
    const pick = madeAt(0);
    expect(sendOf(pick, undone)).toBe(pick.payload);
    const net = ledgerOf([start(), rally({ wonBy: 'A' }), rally({ wonBy: 'H' }), voiding(3)]);
    expect(sendOf(madeAt(1), net)).toEqual(madeAt(1).payload);
  });

  it('drops a held answer when the score moved since it was made at k, and keeps it at k', () => {
    const answered = madeAt(3);
    expect(sendOf(answered, behind(3))).toBe(answered.payload);
    expect(sendOf(answered, behind(4))).toEqual(WITHOUT);
  });

  // A tap of the phone's own that the server refused is no longer in the ledger: the score the stamp was made at is gone.
  it('drops the stamp when the ledger holds fewer score events than the tap was made at', () => {
    expect(sendOf(madeAt(2), behind(1))).toEqual(WITHOUT);
  });

  it('keeps the rest of the tap when it drops serving', () => {
    const attributed = {
      ...queuedOf('k', rally({ wonBy: 'H', serving: 'A', returns: 5 })),
      base: 0,
    };
    expect(sendOf(attributed, behind(2))).toEqual({
      wonBy: 'ent-home',
      returns: 5,
    });
  });

  // Fix round 2 (I1 of the Batch C review): a tap that carries a `base` is judged by the count alone. The phone sends
  // `serving` only while the engine says the anchor is needed, and a count equal to `base` is the ledger the phone saw
  // when it asked, whatever stamps stand in it.
  it('keeps the stamp when the count is where it was made, though a standing rally carries one', () => {
    const anchored = ledgerOf([start(), rally({ wonBy: 'A', serving: 'H' })]);
    const answered = madeAt(1);
    expect(sendOf(answered, anchored)).toBe(answered.payload);
  });

  it('drops the stamp when the count moved, whatever stamps stand', () => {
    const anchored = ledgerOf([
      start(),
      rally({ wonBy: 'A', serving: 'H' }),
      rally({ wonBy: 'H' }),
    ]);
    expect(sendOf(madeAt(1), anchored)).toEqual(WITHOUT);
  });

  // A tap read back from a queue file written before `base` existed: only the rule that needs no count applies, and
  // the rule that a standing stamp drops it still holds for these.
  it('judges a tap with no base by the old rule alone: a standing stamp drops it, the count does not', () => {
    const old = queuedOf('k-old', rally({ wonBy: 'H', serving: 'A' }));
    expect(old).not.toHaveProperty('base');
    expect(sendOf(old, behind(3))).toBe(old.payload);
    const anchored = ledgerOf([start(), rally({ wonBy: 'A', serving: 'H' })]);
    expect(sendOf(old, anchored)).toEqual(WITHOUT);
  });

  it('changes no tap that names no serving, a base or not', () => {
    const plain = { ...queuedOf('k', rally({ wonBy: 'H' })), base: 0 };
    expect(sendOf(plain, behind(3))).toBe(plain.payload);
  });
});

// Fix round 2 (I1 of the Batch C review, probe rv-bc/disputed): game 1 holds two stamps that disagree, the phone's pick
// and a co-scorer's anchor tile naming the other side. The engine marks the game `recorded-disagrees` and opens game 2
// with no first server (`alternation-disputed`), so it needs an anchor again: Who is serving? is asked, and its answer
// must reach the engine though game 1's stamps still stand.
describe('tableTennisPayloadForSend: the answer that re-anchors after a game whose stamps disagree', () => {
  /** Home's stamp at 0–0, then away's at 1–0 (the turn is home's: a contradiction), then home takes the game 11–1. */
  const DISPUTED: readonly Spec[] = [
    start(),
    rally({ wonBy: 'H', serving: 'H' }),
    rally({ wonBy: 'A', serving: 'A' }),
    ...rallies('HHHHHHHHHH'),
  ];
  const foldOf = (queued: readonly QueuedEvent[]) => {
    const fold = foldTableTennis({
      bootstrap: SINGLES,
      ledger: ledgerOf(DISPUTED),
      queued,
      ownEventIds: [],
      toss: null,
    });
    if (fold.kind !== 'folded') throw new Error(`did not fold: ${fold.reason}`);
    return fold.display;
  };
  /** The phone's rally, taken the way the hook takes it: the answer "home served" made at the count game 2 opened at. */
  const answered = () => {
    const display = foldOf([]);
    const made = eventFor(point('first', 'first', 12), display, SINGLES);
    if (made === null) throw new Error('the tap was refused');
    return {
      display,
      queued: {
        ...queuedOf('k-answer', { type: made.type, payload: made.payload }),
        base: made.base,
      },
    };
  };

  it('asks for the answer: game 2 opens with no server named, after 12 score events', () => {
    const display = foldOf([]);
    expect([display.game, display.server, display.anchorNeeded, display.scoreEvents]).toEqual([
      2,
      null,
      true,
      12,
    ]);
  });

  it('queues the answer as a stamp made at that count', () => {
    const { queued } = answered();
    expect(queued.payload).toEqual({ wonBy: 'ent-home', serving: 'ent-home', scorer: 'p-sharma' });
    expect(queued.base).toBe(12);
  });

  it('keeps the answer at its first send, though the stamps of game 1 stand', () => {
    const { queued } = answered();
    expect(sendOf(queued, ledgerOf(DISPUTED))).toBe(queued.payload);
  });

  it('leaves the engine anchored once the send is written back to the queue', () => {
    const { queued } = answered();
    const sent = sendOf(queued, ledgerOf(DISPUTED));
    const after = foldOf([{ ...queued, payload: sent }]);
    expect([after.anchorNeeded, after.server]).toEqual([false, 'first']);
  });
});

// Fix round 2 (I2 of the Batch C review, probe rv-bc/resend): an offline phone marks an attempt on every failed POST, and
// a browser scorer may score meanwhile. The web matches a resend by its key and never compares payloads, so a first
// attempt that was never stored is appended as new, and a stamp made at 0–0 would land after the points that moved it.
// A resend keeps the payload as first sent only while the ledger holds a copy of the tap; otherwise it is judged as a
// first send is.
describe('tableTennisPayloadForSend: a resend whose first copy the ledger does not hold', () => {
  const stamped = { ...queuedOf('k-pick', rally({ wonBy: 'H', serving: 'A' })), base: 0 };
  const WITHOUT = { wonBy: 'ent-home' };
  const behind = (n: number) =>
    ledgerOf([start(), ...Array.from({ length: n }, () => rally({ wonBy: 'A' }))]);

  it('drops the stamp after two attempts and two co-scorer points: no copy, the count moved', () => {
    expect(sendOf({ ...stamped, attempts: 2 }, behind(2), false)).toEqual(WITHOUT);
  });

  it.each([1, 2, 3])('drops it on attempt %i too', (attempts) => {
    expect(sendOf({ ...stamped, attempts }, behind(2), false)).toEqual(WITHOUT);
  });

  it('keeps the payload as first sent when the ledger holds a copy of the tap', () => {
    const resent = { ...stamped, attempts: 2 };
    expect(sendOf(resent, behind(2), true)).toBe(resent.payload);
  });

  it('keeps the stamp when no copy is there but the score has not moved since it was made', () => {
    const resent = { ...stamped, attempts: 2 };
    expect(sendOf(resent, behind(0), false)).toBe(resent.payload);
  });

  it('changes no resend that names no serving', () => {
    const plain = { ...queuedOf('k', rally({ wonBy: 'H' })), base: 0, attempts: 2 };
    expect(sendOf(plain, behind(2), false)).toBe(plain.payload);
  });
});

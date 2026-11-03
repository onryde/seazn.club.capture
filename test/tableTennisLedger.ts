import { foldEpochOf } from '@seazn/engine/sport';
import type { QueuedEvent } from '@/domain/scoring/queue';
import type { Bootstrap, BootstrapSide, LedgerEvent } from '@/domain/scoring/wire';

/**
 * Literal table tennis ledgers for the fold's tests (plan S2-2 Task 3): a bootstrap as the endpoint sends it, and events
 * written the way the web's ledger holds them. Only the inputs are built here; every expected display is written out in
 * the test that asserts it, from the ITTF laws and the design, never computed by the fold.
 */

export const HOME = 'ent-home';
export const AWAY = 'ent-away';
export const PHONE_LINK = 'link-phone';
export const BROWSER_LINK = 'link-browser';

type Player = readonly [personId: string, fullName: string, pairOrder?: number | null];

/** A side from its players: a pair's rows carry the pair order unless a player's is given as null. */
function seat(entrantId: string, players: readonly Player[]): BootstrapSide {
  return {
    entrantId,
    name: players.map(([, name]) => name).join(' / '),
    kind: players.length > 1 ? 'pair' : 'individual',
    members: players.map(([personId, fullName]) => ({ personId, fullName })),
    lineup: players.map(([personId, , order], i) => ({
      personId,
      pairOrder: order === undefined ? (players.length > 1 ? i + 1 : null) : order,
    })),
  };
}

export const SINGLES: Bootstrap = {
  fixtureId: 'fx-tt-1',
  linkId: PHONE_LINK,
  sportKey: 'tabletennis',
  moduleVersion: '1.0.0',
  cfg: {},
  rulesVersion: 1,
  epochRequired: foldEpochOf('tabletennis'),
  screen: 'pad',
  viewOnlyReason: null,
  context: {
    competition: 'Spring Open 2026',
    division: 'U15 Boys Singles',
    round: 'Round 1',
    match: 'Match 4',
  },
  sides: {
    home: seat(HOME, [['p-sharma', 'A. Sharma']]),
    away: seat(AWAY, [['p-chen', 'L. Chen']]),
  },
  lastSeq: 0,
  status: 'in_play',
};

const DOUBLES_HOME: readonly Player[] = [
  ['p-sharma', 'A. Sharma'],
  ['p-iyer', 'R. Iyer'],
];
const DOUBLES_AWAY: readonly Player[] = [
  ['p-chen', 'L. Chen'],
  ['p-wong', 'M. Wong'],
];

/** Doubles with the team sheet's pair order: the first named serves a pair's first turn. */
export const DOUBLES: Bootstrap = {
  ...SINGLES,
  sides: { home: seat(HOME, DOUBLES_HOME), away: seat(AWAY, DOUBLES_AWAY) },
};

/** Doubles whose team sheet declared no pair order. */
export const DOUBLES_NO_ORDER: Bootstrap = {
  ...SINGLES,
  sides: {
    home: seat(
      HOME,
      DOUBLES_HOME.map(([id, name]) => [id, name, null] as const),
    ),
    away: seat(
      AWAY,
      DOUBLES_AWAY.map(([id, name]) => [id, name, null] as const),
    ),
  },
};

/** Doubles whose home side lists a third player, a bench row with no pair order. */
export const DOUBLES_BENCH: Bootstrap = {
  ...SINGLES,
  sides: {
    home: seat(HOME, [...DOUBLES_HOME, ['p-bench', 'S. Reserve', null]]),
    away: seat(AWAY, DOUBLES_AWAY),
  },
};

/** The same match with its config set (the organiser's variant, or a record flag turned off). */
export const withCfg = (bootstrap: Bootstrap, cfg: unknown): Bootstrap => ({ ...bootstrap, cfg });

/** An event before it is numbered: what was recorded, and by which link (another device's unless said). */
export type Spec = {
  readonly type: string;
  readonly payload: unknown;
  readonly voids?: number;
  readonly link?: string | null;
};

export type Seat = 'H' | 'A';
const entrant = (side: Seat) => (side === 'H' ? HOME : AWAY);

export const start = (): Spec => ({ type: 'core.start', payload: {} });

/** A point for `wonBy`; `serving` is the side that served it (the anchor), `returns` the receiver's returns. */
export const rally = (more: {
  readonly wonBy: Seat;
  readonly serving?: Seat;
  readonly returns?: number;
}): Spec => ({
  type: 'tabletennis.rally',
  payload: {
    wonBy: entrant(more.wonBy),
    ...(more.serving === undefined ? {} : { serving: entrant(more.serving) }),
    ...(more.returns === undefined ? {} : { returns: more.returns }),
  },
});

/** One point per letter, `H` to home and `A` to away, in order. */
export const rallies = (winners: string): Spec[] =>
  [...winners].map((letter) => rally({ wonBy: letter === 'H' ? 'H' : 'A' }));

export const timeout = (by: Seat): Spec => ({
  type: 'tabletennis.timeout',
  payload: { by: entrant(by) },
});

export const expedite = (): Spec => ({ type: 'tabletennis.expedite.start', payload: {} });

export const sanction = (by: Seat, level: string, person?: string): Spec => ({
  type: 'tabletennis.sanction',
  payload: person === undefined ? { by: entrant(by), level } : { by: entrant(by), level, person },
});

/** Set score: a game's score so far (`partial`), as the pad writes it before a game's first point. */
export const summary = (home: number, away: number): Spec => ({
  type: 'tabletennis.game.summary',
  payload: { home, away, partial: true },
});

/** A game recorded whole: the score it ended with, no `partial`. */
export const wholeGame = (home: number, away: number): Spec => ({
  type: 'tabletennis.game.summary',
  payload: { home, away },
});

/** A void of the event at `seq`, as the web keeps it: the target in the payload and in `voids_event_id`. */
export const voiding = (seq: number): Spec => ({
  type: 'core.void',
  payload: { event_id: eventId(seq) },
  voids: seq,
});

export const eventId = (seq: number) => `ev-${seq}`;

/** Where a ledger's clock starts unless the test says: the first event is a second after it. */
export const LEDGER_FROM = '2026-11-03T10:00:00.000Z';

/** The specs numbered from seq 1, as the server's ledger holds them, a second apart from `from` on. */
export function ledgerOf(specs: readonly Spec[], from: string = LEDGER_FROM): LedgerEvent[] {
  return specs.map((spec, i) => ({
    id: eventId(i + 1),
    seq: i + 1,
    type: spec.type,
    payload: spec.payload,
    recordedAt: new Date(Date.parse(from) + (i + 1) * 1000).toISOString(),
    voids: spec.voids === undefined ? null : eventId(spec.voids),
    deviceLinkId: spec.link === undefined ? BROWSER_LINK : spec.link,
  }));
}

/** A tap this phone queued, as the queue file holds it. */
export function queuedOf(key: string, spec: Spec): QueuedEvent {
  const payload = spec.voids === undefined ? spec.payload : { event_id: eventId(spec.voids) };
  return {
    key,
    type: spec.type,
    payload,
    rulesVersion: 1,
    createdAt: '2026-11-03T10:30:00.000Z',
    attempts: 0,
  };
}

/** The start, then the first point (home serving: the anchor), then `winners` for the points after it. */
export const anchored = (first: Seat, winners: string): readonly Spec[] => [
  start(),
  rally({ wonBy: first, serving: 'H' }),
  ...rallies(winners),
];

/** Game 1 won 11–7 by the top side, home serving first: the sides trade points to 7–7, then home takes the last four. */
export const GAME_ONE_11_7: readonly Spec[] = anchored('H', 'AHAHAHAHAHAHAHHHH');

/** Game 1 level at 10–10, home serving first: twenty points are played, so deuce begins. */
export const DEUCE_10_10: readonly Spec[] = anchored('H', `${'AH'.repeat(9)}A`);

/** A best of 5 the top side won 11–0, 11–0, 11–0: decided. */
export const DECIDED_3_0: readonly Spec[] = anchored('H', 'H'.repeat(32));

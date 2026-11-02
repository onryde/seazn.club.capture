import type { QueuedEvent } from '@/domain/scoring/queue';
import type { Bootstrap, BootstrapSide, LedgerEvent } from '@/domain/scoring/wire';

/**
 * Literal badminton ledgers for the fold's tests (plan S2-1 Task 7): a bootstrap as the endpoint sends it, and events
 * written the way the web's ledger holds them. Only the inputs are built here; every expected display is written out
 * in the test that asserts it, never computed by the fold.
 */

export const HOME = 'ent-home';
export const AWAY = 'ent-away';
export const PHONE_LINK = 'link-phone';
export const BROWSER_LINK = 'link-browser';

function seat(entrantId: string, players: readonly (readonly [string, string])[]): BootstrapSide {
  return {
    entrantId,
    name: players.map(([, name]) => name).join(' / '),
    kind: players.length > 1 ? 'pair' : 'individual',
    members: players.map(([personId, fullName]) => ({ personId, fullName })),
    lineup: players.map(([personId], i) => ({
      personId,
      pairOrder: players.length > 1 ? i + 1 : null,
    })),
  };
}

export const SINGLES: Bootstrap = {
  fixtureId: 'fx-1',
  linkId: PHONE_LINK,
  sportKey: 'badminton',
  moduleVersion: '1.0.0',
  cfg: {},
  rulesVersion: 1,
  epochRequired: 2,
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

export const DOUBLES: Bootstrap = {
  ...SINGLES,
  sides: {
    home: seat(HOME, [
      ['p-sharma', 'A. Sharma'],
      ['p-iyer', 'R. Iyer'],
    ]),
    away: seat(AWAY, [
      ['p-chen', 'L. Chen'],
      ['p-wong', 'M. Wong'],
    ]),
  },
};

/** An event before it is numbered: what was recorded, and by which link (another device's unless said). */
export type Spec = {
  readonly type: string;
  readonly payload: unknown;
  readonly voids?: number;
  readonly link?: string | null;
};

type Seat = 'H' | 'A';
const entrant = (seat: Seat) => (seat === 'H' ? HOME : AWAY);

export const start = (): Spec => ({ type: 'core.start', payload: {} });

export const rally = (wonBy: Seat, serving?: Seat): Spec => ({
  type: 'badminton.rally',
  payload:
    serving === undefined
      ? { wonBy: entrant(wonBy) }
      : { wonBy: entrant(wonBy), serving: entrant(serving) },
});

/** One rally per letter, `H` to home and `A` to away, in order. */
export const rallies = (winners: string): Spec[] =>
  [...winners].map((letter) => rally(letter === 'H' ? 'H' : 'A'));

export const sanction = (by: Seat, level: string, person?: string): Spec => ({
  type: 'badminton.sanction',
  payload: person === undefined ? { by: entrant(by), level } : { by: entrant(by), level, person },
});

export const forfeit = (by: Seat): Spec => ({
  type: 'core.forfeit',
  payload: { by: entrant(by), reason: 'disqualified' },
});

export const summary = (home: number, away: number): Spec => ({
  type: 'badminton.game.summary',
  payload: { home, away, partial: true },
});

/** A void of the event at `seq`, as the web keeps it: the target in the payload and in `voids_event_id`. */
export const voiding = (seq: number): Spec => ({
  type: 'core.void',
  payload: { event_id: eventId(seq) },
  voids: seq,
});

export const eventId = (seq: number) => `ev-${seq}`;

/** The specs numbered from seq 1, as the server's ledger holds them, a second apart. */
export function ledgerOf(specs: readonly Spec[]): LedgerEvent[] {
  return specs.map((spec, i) => ({
    id: eventId(i + 1),
    seq: i + 1,
    type: spec.type,
    payload: spec.payload,
    recordedAt: new Date(Date.parse('2026-11-01T10:00:00.000Z') + (i + 1) * 1000).toISOString(),
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
    createdAt: '2026-11-01T10:30:00.000Z',
    attempts: 0,
  };
}

/** `count` rallies alternating, the top side first: `HAHA…`. */
export const alternating = (count: number): string =>
  Array.from({ length: count }, (_, i) => (i % 2 === 0 ? 'H' : 'A')).join('');

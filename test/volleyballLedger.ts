import { foldEpochOf } from '@seazn/engine/sport';
import { envelopeOf } from '@/domain/scoring/setBasedEngine';
import type { QueuedEvent } from '@/domain/scoring/queue';
import { volleyballCfg, volleyballRefusalOf } from '@/domain/scoring/volleyballEngine';
import { volleyballLineupOf } from '@/domain/scoring/volleyballLineup';
import type { Bootstrap, BootstrapSide, BootstrapSlot, LedgerEvent } from '@/domain/scoring/wire';

/**
 * Literal volleyball seeds and a ledger builder for the tests of the fold, the events and the replay (S2-6 Task 2): a
 * bootstrap as the endpoint sends it (indoor teams with a bench and one coach, beach pairs with the team sheet's pair
 * order) and events appended through the REAL engine, so a ledger a test builds is one the server would hold. Only the
 * inputs are built here; every expected display is written out in the test that asserts it.
 */

export const HOME = 'ent-home';
export const AWAY = 'ent-away';
export const PHONE_LINK = 'link-phone';
export const BROWSER_LINK = 'link-browser';

/** Indoor's shipped config as the endpoint sends it (the engine's defaults, restated: the schema fills the rest). */
export const INDOOR_CFG = {};

/** Beach's variant as the server stores it: restated whole, since 7.0.0's config has no variant field. */
export const BEACH_CFG = {
  bestOf: 3,
  setTo: 21,
  finalSetTo: 15,
  pointsMap: { '*': [2, 0] },
  records: { timeouts: true, sanctions: true, substitutions: false, expedite: false },
};

const NAMES = ['A', 'B', 'C', 'D', 'E', 'F'] as const;

/** Six starters and a bench player on one side, plus a coach on request; ids `<prefix>1`.. and `<prefix>-coach`. */
function team(entrantId: string, prefix: string, name: string, coach: boolean): BootstrapSide {
  const players: BootstrapSlot[] = NAMES.map((letter, i) => ({
    personId: `${prefix}${i + 1}`,
    pairOrder: null,
    slot: 'starting' as const,
    orderNo: i + 1,
    squadNumber: i + 1,
    ...(letter === 'A' ? { positionKey: 'setter' } : {}),
  }));
  const bench: BootstrapSlot = {
    personId: `${prefix}7`,
    pairOrder: null,
    slot: 'bench',
    orderNo: 7,
    squadNumber: 7,
  };
  const staff: BootstrapSlot[] = coach
    ? [{ personId: `${prefix}-coach`, pairOrder: null, slot: 'bench', orderNo: 8, role: 'coach' }]
    : [];
  const rows = [...players, bench, ...staff];
  return {
    entrantId,
    name,
    kind: 'team',
    members: rows.map((row) => ({ personId: row.personId, fullName: `${name} ${row.personId}` })),
    lineup: rows,
  };
}

/** A beach pair: the team sheet's pair order is 1 and 2, as listed. */
function pair(entrantId: string, prefix: string, name: string): BootstrapSide {
  const rows: BootstrapSlot[] = [1, 2].map((n) => ({
    personId: `${prefix}${n}`,
    pairOrder: n,
    slot: 'starting' as const,
    orderNo: n,
  }));
  return {
    entrantId,
    name,
    kind: 'pair',
    members: rows.map((row) => ({ personId: row.personId, fullName: `${name} ${row.personId}` })),
    lineup: rows,
  };
}

const BASE = {
  linkId: PHONE_LINK,
  moduleVersion: '1.0.0',
  rulesVersion: 1,
  screen: 'pad' as const,
  viewOnlyReason: null,
  context: {
    competition: 'Spring League 2026',
    division: 'Open',
    round: 'Round 1',
    match: 'Match 2',
  },
  lastSeq: 0,
  status: 'in_play',
};

/** An indoor match: six starters and a bench player a side, the home side with one coach row. */
export const INDOOR: Bootstrap = {
  ...BASE,
  fixtureId: 'fx-vb-indoor',
  sportKey: 'volleyball',
  cfg: INDOOR_CFG,
  epochRequired: foldEpochOf('volleyball'),
  sides: {
    home: team(HOME, 'h', 'Falcons', true),
    away: team(AWAY, 'a', 'Herons', false),
  },
};

/** A beach match: two pairs, each player with a pair order. */
export const BEACH: Bootstrap = {
  ...BASE,
  fixtureId: 'fx-vb-beach',
  sportKey: 'volleyball',
  cfg: BEACH_CFG,
  epochRequired: foldEpochOf('volleyball'),
  sides: { home: pair(HOME, 'h', 'Sand / Surf'), away: pair(AWAY, 'a', 'Dune / Tide') },
};

/** The same match with its config set. */
export const withCfg = (bootstrap: Bootstrap, cfg: unknown): Bootstrap => ({ ...bootstrap, cfg });

/** An event before it is numbered: what was recorded, and by which link (another device's unless said). */
export type Spec = {
  readonly type: string;
  readonly payload: unknown;
  readonly voids?: number;
  readonly link?: string | null;
};

export type Seat = 'H' | 'A';
const entrant = (side: Seat): string => (side === 'H' ? HOME : AWAY);

export const start = (): Spec => ({ type: 'core.start', payload: {} });

/** A rally for `wonBy`; `serving` anchors the first server's side, `server` names a player (beach, from pair order). */
export const rally = (more: {
  readonly wonBy: Seat;
  readonly serving?: Seat;
  readonly server?: string;
}): Spec => ({
  type: 'volleyball.rally',
  payload: {
    wonBy: entrant(more.wonBy),
    ...(more.serving === undefined ? {} : { serving: entrant(more.serving) }),
    ...(more.server === undefined ? {} : { server: more.server }),
  },
});

/** One rally per letter, `H` to home and `A` to away, in order. */
export const rallies = (winners: string): Spec[] =>
  [...winners].map((letter) => rally({ wonBy: letter === 'H' ? 'H' : 'A' }));

export const timeout = (by: Seat): Spec => ({
  type: 'volleyball.timeout',
  payload: { by: entrant(by) },
});

export const eventId = (seq: number): string => `ev-${seq}`;

/** A void of the event at `seq`, as the web keeps it: the target in the payload and in `voids_event_id`. */
export const voiding = (seq: number): Spec => ({
  type: 'core.void',
  payload: { event_id: eventId(seq) },
  voids: seq,
});

/** Where a ledger's clock starts unless the test says: the first event is a second after it. */
export const LEDGER_FROM = '2026-11-11T10:00:00.000Z';

/** The specs numbered from seq 1 as the server's ledger holds them, a second apart from `from` on. NOT judged. */
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

/**
 * The specs as a ledger the REAL engine took: each event is judged against everything before it as the server judges
 * an append, and the first one it refuses throws with the engine's word, so a test cannot build a ledger no server holds.
 */
export function judgedLedgerOf(
  bootstrap: Bootstrap,
  specs: readonly Spec[],
  from: string = LEDGER_FROM,
): LedgerEvent[] {
  const { home, away } = bootstrap.sides;
  if (home === null || away === null) throw new Error('a ledger needs both sides');
  const match = {
    fixtureId: bootstrap.fixtureId,
    cfg: volleyballCfg(bootstrap.cfg),
    lineups: { home: volleyballLineupOf(home), away: volleyballLineupOf(away) },
  };
  const events = ledgerOf(specs, from);
  events.forEach((event, i) => {
    const word = volleyballRefusalOf(
      match,
      events.slice(0, i + 1).map((e) => envelopeOf(bootstrap.fixtureId, e)),
    );
    if (word !== null)
      throw new Error(`the engine refused ${event.type} at seq ${event.seq}: ${word}`);
  });
  return events;
}

/** A tap this phone queued, as the queue file holds it. */
export function queuedOf(key: string, spec: Spec): QueuedEvent {
  const payload = spec.voids === undefined ? spec.payload : { event_id: eventId(spec.voids) };
  return {
    key,
    type: spec.type,
    payload,
    rulesVersion: 1,
    createdAt: '2026-11-11T10:30:00.000Z',
    attempts: 0,
  };
}

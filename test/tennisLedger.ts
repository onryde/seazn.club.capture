import { foldEpochOf } from '@seazn/engine/sport';
import type { QueuedEvent } from '@/domain/scoring/queue';
import { envelopeOf } from '@/domain/scoring/setBasedEngine';
import { tennisCfgOf, tennisLineupOf, tennisRefusalOf } from '@/domain/scoring/tennisEngine';
import type { Bootstrap, BootstrapSide, BootstrapSlot, LedgerEvent } from '@/domain/scoring/wire';

/**
 * Literal tennis seeds and a ledger builder for the tests of the fold, the events and the replay (S2-7 Task 3), as
 * `volleyballLedger.ts` is for volleyball: a bootstrap as the endpoint sends it (singles, and doubles with the team
 * sheet's pair order) and events appended through the REAL engine, so a ledger a test builds is one the server would
 * hold. Only the inputs are built here; every expected display is written out in the test that asserts it.
 */

export const HOME = 'ent-home';
export const AWAY = 'ent-away';
export const PHONE_LINK = 'link-phone';
export const BROWSER_LINK = 'link-browser';

/** The Tour's shipped config as the endpoint sends it (the engine's defaults; the schema fills the rest). */
export const TOUR_CFG = {};

/** Grand Slam, as the server stores the preset (7.0.0's config has no variant field): best of 5, the last set's breaker to 10. */
export const GRAND_SLAM_CFG = {
  bestOf: 5,
  set: { gamesTo: 6, winBy: 2, tiebreakAt: 6, tiebreakTo: 7 },
  finalSet: { tiebreakTo: 10 },
  game: { noAd: false },
  tiebreak: { winBy: 2 },
  points: { win: 2, loss: 0 },
};

/** Fast4: sets to 4 games, a tie-break at 3-3 to 5 with a deciding point at 4-4, no-ad games. */
export const FAST4_CFG = {
  bestOf: 3,
  set: { gamesTo: 4, winBy: 2, tiebreakAt: 3, tiebreakTo: 5, tiebreakWinBy: 1 },
  finalSet: 'same',
  game: { noAd: true },
  tiebreak: { winBy: 2 },
  points: { win: 2, loss: 0 },
};

/** The ITF doubles norm: no-ad games and a 10-point match tie-break as the deciding set. */
export const DOUBLES_NOAD_CFG = {
  bestOf: 3,
  set: { gamesTo: 6, winBy: 2, tiebreakAt: 6, tiebreakTo: 7 },
  finalSet: { matchTiebreakTo: 10 },
  game: { noAd: true },
  tiebreak: { winBy: 2 },
  points: { win: 2, loss: 0 },
};

/** One player: the team sheet's one starting row. */
function player(entrantId: string, personId: string, name: string): BootstrapSide {
  const row: BootstrapSlot = { personId, pairOrder: null, slot: 'starting', orderNo: 1 };
  return {
    entrantId,
    name,
    kind: 'individual',
    members: [{ personId, fullName: name }],
    lineup: [row],
  };
}

/** A doubles pair: the team sheet's pair order is 1 and 2, as listed. */
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
  sportKey: 'tennis',
  cfg: TOUR_CFG,
  epochRequired: foldEpochOf('tennis'),
};

/** A singles match: one player a side. */
export const SINGLES: Bootstrap = {
  ...BASE,
  fixtureId: 'fx-tn-singles',
  sides: { home: player(HOME, 'h1', 'Ana Ruiz'), away: player(AWAY, 'a1', 'Bea Lund') },
};

/** A doubles match: two pairs, each player with a pair order. */
export const DOUBLES: Bootstrap = {
  ...BASE,
  fixtureId: 'fx-tn-doubles',
  sides: { home: pair(HOME, 'h', 'Ruiz / Vega'), away: pair(AWAY, 'a', 'Lund / Berg') },
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

/** The toss (engine 8.0.0, ruling 233): which entrant serves the first game, `{serving}` and nothing else. */
export const toss = (seat: Seat): Spec => ({
  type: 'tennis.toss',
  payload: { serving: entrant(seat) },
});

/** A point for `seat`: `{by}` only, as the pad sends it (ruling 217). */
export const point = (seat: Seat): Spec => ({
  type: 'tennis.point',
  payload: { by: entrant(seat) },
});

/** One point per letter, `H` to home and `A` to away, in order. */
export const points = (winners: string): Spec[] =>
  [...winners].map((letter) => point(letter === 'H' ? 'H' : 'A'));

/** A love game: four points to `seat`. */
export const game = (seat: Seat): Spec[] => points(seat === 'H' ? 'HHHH' : 'AAAA');

export const sanction = (seat: Seat, level: string, person?: string): Spec => ({
  type: 'tennis.sanction',
  payload: { by: entrant(seat), level, ...(person === undefined ? {} : { person }) },
});

export const award = (seat: Seat): Spec => ({
  type: 'tennis.game.award',
  payload: { winner: entrant(seat) },
});

/** A break: its kind, and the side it was for (none for "Both / none"). */
export const interruption = (kind: string, by?: Seat): Spec => ({
  type: 'tennis.interruption',
  payload: { kind, ...(by === undefined ? {} : { by: entrant(by) }) },
});

/** Set score: a set's games (and, for a tie-break set, its points), as the pad writes it before a set's first point. */
export const summary = (home: number, away: number, tb?: { home: number; away: number }): Spec => ({
  type: 'tennis.set_summary',
  payload: { home, away, ...(tb === undefined ? {} : { tb }) },
});

/** The organiser's: a side retires (the offending side is `by`). The phone never sends it. */
export const forfeit = (by: Seat, reason: string): Spec => ({
  type: 'core.forfeit',
  payload: { by: entrant(by), reason },
});

/** The organiser's: the match is abandoned. The phone never sends it. */
export const abandon = (reason: string): Spec => ({ type: 'core.abandon', payload: { reason } });

export const eventId = (seq: number): string => `ev-${seq}`;

/** A void of the event at `seq`, as the web keeps it: the target in the payload and in `voids_event_id`. */
export const voiding = (seq: number): Spec => ({
  type: 'core.void',
  payload: { event_id: eventId(seq) },
  voids: seq,
});

/** Where a ledger's clock starts unless the test says: the first event is a second after it. */
export const LEDGER_FROM = '2026-11-12T10:00:00.000Z';

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
  const cfg = tennisCfgOf(bootstrap.cfg);
  if (home === null || away === null) throw new Error('a ledger needs both sides');
  if (cfg === null) throw new Error('a ledger needs a config the engine reads');
  const match = {
    fixtureId: bootstrap.fixtureId,
    cfg,
    lineups: { home: tennisLineupOf(home), away: tennisLineupOf(away) },
  };
  const events = ledgerOf(specs, from);
  events.forEach((event, i) => {
    const word = tennisRefusalOf(
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
    createdAt: '2026-11-12T10:30:00.000Z',
    attempts: 0,
  };
}

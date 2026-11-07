import { foldEpochOf } from '@seazn/engine/sport';
import type { QueuedEvent } from '@/domain/scoring/queue';
import type { Bootstrap, BootstrapSide, LedgerEvent } from '@/domain/scoring/wire';

/**
 * Literal football ledgers for the football tests (S2-5 plan P Task 4): a bootstrap as the endpoint sends it, team sheet
 * and all (design §10), and events written the way the web's ledger holds them. Only the inputs are built here; every
 * expected display is written out in the test that asserts it, from the Laws and the design, never computed by the fold.
 */

export const HOME_ENTRANT = 'ent-home';
export const AWAY_ENTRANT = 'ent-away';
export const PHONE_LINK = 'link-phone';
export const BROWSER_LINK = 'link-browser';

/** A squad of 16: 1–11 start (1 in goal), 12–16 on the bench, each wearing their number. */
const SQUAD = 16;
const STARTERS = 11;

function team(entrantId: string, prefix: 'H' | 'A', club: 'Home' | 'Away'): BootstrapSide {
  const numbers = Array.from({ length: SQUAD }, (_, i) => i + 1);
  return {
    entrantId,
    name: `${club} FC`,
    kind: 'team',
    members: numbers.map((n) => ({ personId: `${prefix}-p${n}`, fullName: `${club} Player ${n}` })),
    lineup: numbers.map((n) => ({
      personId: `${prefix}-p${n}`,
      pairOrder: null,
      slot: n <= STARTERS ? 'starting' : 'bench',
      orderNo: n,
      role: 'player',
      squadNumber: n,
      ...(n === 1 ? { positionKey: 'GK' } : {}),
    })),
  };
}

/** `H-p1`…`H-p16`, "Home Player 1"…: a team sheet as the web's bootstrap sends it. */
export const HOME: BootstrapSide = team(HOME_ENTRANT, 'H', 'Home');
/** `A-p1`…`A-p16`, "Away Player 1"…. */
export const AWAY: BootstrapSide = team(AWAY_ENTRANT, 'A', 'Away');

/** A knockout tie: 2 × 45, extra time 2 × 15, then a shootout; a sin-bin is 10 minutes. */
export const KO_11 = {
  halves: 2,
  halfMinutes: 45,
  extraTime: { enabled: true, halfMinutes: 15 },
  shootout: true,
  sinBinMinutes: 10,
} as const;
/** A league match: 2 × 45, and a draw stands. */
export const LEAGUE_11 = {
  halves: 2,
  halfMinutes: 45,
  extraTime: { enabled: false, halfMinutes: 15 },
  shootout: false,
} as const;
/** Small-sided youth: four quarters of 10, rolling substitutions, seven a side. */
export const MINI = { halves: 4, halfMinutes: 10, rollingSubs: true, teamSize: 7 } as const;
/** The Laws' cap: five substitutions in three windows. */
export const CAPPED = { ...LEAGUE_11, maxSubs: 5, subWindows: 3 } as const;

/** A knockout tie with both team sheets, on the pad. */
export const MATCH: Bootstrap = {
  fixtureId: 'fx-fb-1',
  linkId: PHONE_LINK,
  sportKey: 'football',
  moduleVersion: '2.0.0',
  cfg: KO_11,
  rulesVersion: 1,
  epochRequired: foldEpochOf('football'),
  screen: 'pad',
  viewOnlyReason: null,
  context: {
    competition: 'County Cup 2026',
    division: 'Open Age',
    round: 'Quarter-final',
    match: 'QF 2',
  },
  sides: { home: HOME, away: AWAY },
  lastSeq: 0,
  status: 'in_play',
};

/** The same match under another config. */
export const withCfg = (bootstrap: Bootstrap, cfg: unknown): Bootstrap => ({ ...bootstrap, cfg });

/** A side's rows as an older web sends them: the people, no slot, number, position or role. */
const withoutSlots = (side: BootstrapSide): BootstrapSide => ({
  ...side,
  lineup: side.lineup.map(({ personId }) => ({ personId, pairOrder: null })),
});

/** Rows but no team sheet on them (a web older than design §10): the fold takes every row as starting. */
export const NO_SLOTS: Bootstrap = {
  ...MATCH,
  sides: { home: withoutSlots(HOME), away: withoutSlots(AWAY) },
};

/** No rows at all: the organiser set no team sheet (design §6.6). */
export const NO_SHEET: Bootstrap = {
  ...MATCH,
  sides: { home: { ...HOME, lineup: [] }, away: { ...AWAY, lineup: [] } },
};

/** An event before it is numbered: what was recorded, and by which link (the ledger's unless said). */
export type Spec = {
  readonly type: string;
  readonly payload: unknown;
  /** The id of the event a `core.void` voids. */
  readonly voids?: string;
  readonly link?: string | null;
};

export type Seat = 'H' | 'A';
/** A match-time stamp: the period and the seconds into it. */
export type At = { readonly period: string; readonly elapsed: number };

export const at = (period: string, elapsed: number): At => ({ period, elapsed });
const entrant = (side: Seat) => (side === 'H' ? HOME_ENTRANT : AWAY_ENTRANT);

/** The payload's fields that were given: the engine's schemas are strict, and absent is not `undefined`. */
const given = (fields: Readonly<Record<string, unknown>>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));

export const start = (): Spec => ({ type: 'core.start', payload: {} });

/** Start (running) or Pause, stamped with the match time it was tapped at, or unstamped. */
export const clock = (running: boolean, stamp?: At): Spec => ({
  type: 'football.clock',
  payload: given({ running, at: stamp }),
});

export const goal = (more: {
  readonly by: Seat;
  readonly scorer?: string;
  readonly assist?: string;
  readonly ownGoal?: boolean;
  readonly penalty?: boolean;
  readonly at?: At;
}): Spec => ({ type: 'football.goal', payload: given({ ...more, by: entrant(more.by) }) });

export const card = (more: {
  readonly by: Seat;
  readonly color: 'yellow' | 'second_yellow' | 'red';
  readonly person?: string;
  readonly reason?: string;
  readonly at?: At;
}): Spec => ({ type: 'football.card', payload: given({ ...more, by: entrant(more.by) }) });

export const sub = (more: {
  readonly by: Seat;
  readonly off: string;
  readonly on: string;
  readonly at?: At;
}): Spec => ({ type: 'football.sub', payload: given({ ...more, by: entrant(more.by) }) });

/** A period marker (HT, FT, QT, 3QT, ET_HT, ET_FT): the whistle that ends a period. */
export const period = (marker: string, stamp?: At): Spec => ({
  type: 'football.period',
  payload: given({ phase: marker, at: stamp }),
});

/** A penalty that did not go in (a scored one is a goal with `penalty`). */
export const penalty = (more: {
  readonly by: Seat;
  readonly outcome: 'missed' | 'saved' | 'post';
  readonly taker?: string;
  readonly goalkeeper?: string;
  readonly at?: At;
}): Spec => ({ type: 'football.penalty', payload: given({ ...more, by: entrant(more.by) }) });

export const sinBin = (more: {
  readonly by: Seat;
  readonly person?: string;
  readonly minutes?: number;
  readonly at?: At;
}): Spec => ({ type: 'football.sinbin.start', payload: given({ ...more, by: entrant(more.by) }) });

export const sinBinEnd = (more: {
  readonly by: Seat;
  readonly person?: string;
  readonly at?: At;
}): Spec => ({ type: 'football.sinbin.end', payload: given({ ...more, by: entrant(more.by) }) });

export const shot = (more: {
  readonly by: Seat;
  readonly outcome: 'saved' | 'missed' | 'blocked' | 'scored';
  readonly taker?: string;
  readonly goalkeeper?: string;
  readonly at?: At;
}): Spec => ({ type: 'football.shot', payload: given({ ...more, by: entrant(more.by) }) });

/** A shootout kick. */
export const kick = (more: {
  readonly by: Seat;
  readonly scored: boolean;
  readonly person?: string;
}): Spec => ({
  type: 'football.shootout.kick',
  payload: given({ ...more, by: entrant(more.by) }),
});

/** A void of the event `id`, as the web keeps it: the target in the payload and in `voids_event_id`. */
export const voiding = (id: string): Spec => ({
  type: 'core.void',
  payload: { event_id: id },
  voids: id,
});

/** The id `ledgerOf` gives the event at `seq`. */
export const eventId = (seq: number) => `ev-${seq}`;

/** Where a ledger's clock starts unless the test says: the first event is a second after it. */
export const LEDGER_FROM = '2026-11-07T14:00:00.000Z';
/** When a queued tap was made unless the test says. */
export const QUEUED_AT = '2026-11-07T14:30:00.000Z';

/**
 * The specs numbered from seq 1, as the server's ledger holds them, a second apart from `recordedFrom` on, every one by
 * `deviceLinkId` (another device's unless said; null is the phone's own stand-in) unless a spec names its own link.
 */
export function ledgerOf(
  specs: readonly Spec[],
  options: { readonly recordedFrom?: string; readonly deviceLinkId?: string | null } = {},
): LedgerEvent[] {
  const from = Date.parse(options.recordedFrom ?? LEDGER_FROM);
  const link = options.deviceLinkId === undefined ? BROWSER_LINK : options.deviceLinkId;
  return specs.map((spec, i) => ({
    id: eventId(i + 1),
    seq: i + 1,
    type: spec.type,
    payload: spec.payload,
    recordedAt: new Date(from + (i + 1) * 1000).toISOString(),
    voids: spec.voids ?? null,
    deviceLinkId: spec.link === undefined ? link : spec.link,
  }));
}

/** A tap this phone queued, as the queue file holds it. */
export function queuedOf(key: string, spec: Spec, createdAt: string = QUEUED_AT): QueuedEvent {
  return { key, type: spec.type, payload: spec.payload, rulesVersion: 1, createdAt, attempts: 0 };
}

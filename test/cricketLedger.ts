import { foldEpochOf } from '@seazn/engine/sport';
import { isRecord } from '@/domain/credentials/wire';
import type { QueuedEvent } from '@/domain/scoring/queue';
import type { Bootstrap, BootstrapSide, BootstrapSlot, LedgerEvent } from '@/domain/scoring/wire';

/**
 * Literal cricket ledgers for the cricket tests (S2-4 plan Task 4): a bootstrap as the endpoint sends it, team sheet and
 * all (spec §7.1), and events written the way the web's ledger holds them. Only the inputs are built here; every
 * expected display is written out in the test that asserts it, from the Laws and the spec, never computed by the fold.
 *
 * `inningsOf` writes an innings ball by ball from a short script, naming each ball's over, striker, non-striker and
 * bowler as a scorer on the web's pad would. It walks the crease by the Laws' plain rules (odd runs cross, an over ends
 * with the ends changed, a dismissed batter's replacement takes their end, the next in the team-sheet order), not by the
 * phone's fold. `cricketEngine.test.ts` folds every fixture strictly, as the server judges each append, so a fixture this
 * gets wrong is a red test, not a quiet one.
 */

export const HOME_ENTRANT = 'ent-home';
export const AWAY_ENTRANT = 'ent-away';
export const PHONE_LINK = 'link-phone';
export const BROWSER_LINK = 'link-browser';

export type Seat = 'H' | 'A';

/** Eleven a side (the Laws); the team sheet's batting order is 1 to 11. */
const STARTERS = 11;

/** `H-p3`, `A-p11`: a player of a side by their place in the team sheet's order. */
export const player = (side: Seat, n: number): string => `${side}-p${n}`;

function team(entrantId: string, side: Seat, club: 'Home' | 'Away'): BootstrapSide {
  const starters = Array.from({ length: STARTERS }, (_, i) => i + 1);
  const rows: BootstrapSlot[] = [
    ...starters.map((n): BootstrapSlot => ({
      personId: player(side, n),
      pairOrder: null,
      slot: 'starting',
      orderNo: n,
      role: 'player',
      ...(n === 2 ? { roles: ['wicketkeeper'] } : {}),
    })),
    { personId: player(side, 12), pairOrder: null, slot: 'bench', orderNo: 12, role: 'player' },
    { personId: `${side}-coach`, pairOrder: null, slot: 'bench', orderNo: 13, role: 'coach' },
  ];
  return {
    entrantId,
    name: `${club} CC`,
    kind: 'team',
    members: [
      ...[...starters, 12].map((n) => ({
        personId: player(side, n),
        fullName: `${club} Player ${n}`,
      })),
      { personId: `${side}-coach`, fullName: `${club} Coach` },
    ],
    lineup: rows,
  };
}

/** `H-p1`…`H-p11` start (the order 1–11; `H-p2` keeps wicket), `H-p12` on the bench, `H-coach`. "Home Player 1"…. */
export const HOME: BootstrapSide = team(HOME_ENTRANT, 'H', 'Home');
/** `A-p1`…`A-p11`, `A-p12`, `A-coach`. "Away Player 1"…. */
export const AWAY: BootstrapSide = team(AWAY_ENTRANT, 'A', 'Away');

// The formats. Every one sets `minOversForResult`: the engine's default (5) is longer than a two-over innings, and the
// schema refuses that config (the preview's finding). Overs are `ballsPerInnings` (engine `cricket.ts:66`).

/** A knockout of two six-ball overs a side: one over a bowler, and a tie goes to a super over. */
export const KO_2 = {
  ballsPerInnings: 12,
  ballsPerOver: 6,
  maxOversPerBowler: 1,
  superOver: true,
  minOversForResult: 1,
} as const;
/** The same in a league: a tie is the result. */
export const LEAGUE_2 = { ...KO_2, superOver: false } as const;
/** A T20: twenty overs a side, four a bowler, a super over on a tie. */
export const T20 = {
  ballsPerInnings: 120,
  ballsPerOver: 6,
  maxOversPerBowler: 4,
  superOver: true,
  minOversForResult: 5,
} as const;
/** Two innings a side, unlimited overs, the follow-on at a lead of 200, two reviews an innings. */
export const TWO_INNINGS = {
  inningsPerSide: 2,
  ballsPerInnings: null,
  followOn: { enabled: true, lead: 200 },
  reviews: { perInnings: 2 },
  minOversForResult: 0,
} as const;

/** A knockout of two overs a side, both team sheets in, on the pad. */
export const MATCH: Bootstrap = {
  fixtureId: 'fx-cricket-1',
  linkId: PHONE_LINK,
  sportKey: 'cricket',
  moduleVersion: '3.0.0',
  cfg: KO_2,
  rulesVersion: 1,
  epochRequired: foldEpochOf('cricket'),
  screen: 'pad',
  viewOnlyReason: null,
  context: {
    competition: 'Summer Bash 2026',
    division: 'Open',
    round: 'Final',
    match: 'Match 7',
  },
  sides: { home: HOME, away: AWAY },
  lastSeq: 0,
  status: 'in_play',
};

/** The same match under another format. */
export const withCfg = (bootstrap: Bootstrap, cfg: unknown): Bootstrap => ({ ...bootstrap, cfg });

/** The away side's team sheet not entered: no rows (spec §4.10). */
export const NO_AWAY_PLAYERS: Bootstrap = {
  ...MATCH,
  sides: { home: HOME, away: { ...AWAY, lineup: [] } },
};

/** A side's rows as a web older than the team sheet sends them: the people, no slot, order, role or roles. */
const withoutSlots = (side: BootstrapSide): BootstrapSide => ({
  ...side,
  lineup: side.lineup.map(({ personId }) => ({ personId, pairOrder: null })),
});

/** Rows but no team sheet on them: every row starts, the bench and the coach included, in the order sent. */
export const NO_SLOTS: Bootstrap = {
  ...MATCH,
  sides: { home: withoutSlots(HOME), away: withoutSlots(AWAY) },
};

// ---------------------------------------------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------------------------------------------

/** An event before it is numbered: what was recorded, and by which link (the browser's unless said). */
export type Spec = {
  readonly type: string;
  readonly payload: unknown;
  /** The seq of the event a `core.void` voids. */
  readonly voids?: number;
  readonly link?: string | null;
};

export const entrant = (side: Seat): string => (side === 'H' ? HOME_ENTRANT : AWAY_ENTRANT);

/** The payload's fields that were given: the engine's schemas are strict, and absent is not `undefined`. */
const given = (fields: Readonly<Record<string, unknown>>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));

export const toss = (wonBy: Seat, elected: 'bat' | 'bowl'): Spec => ({
  type: 'cricket.toss',
  payload: { wonBy: entrant(wonBy), elected },
});

export const start = (): Spec => ({ type: 'core.start', payload: {} });

export type Extra = {
  readonly kind: 'wide' | 'noball' | 'bye' | 'legbye' | 'penalty';
  readonly runs: number;
};

export type Wicket = {
  readonly kind: string;
  readonly out: string;
  readonly fielder?: string;
  readonly fielderAssist?: string;
  readonly incoming?: string;
  readonly bowlerCredited: boolean;
};

/** One delivery as the web's pad writes it. `bat` is 0 unless said. */
export type BallSpec = {
  readonly over: number;
  readonly ballInOver: number;
  readonly striker: string;
  readonly nonStriker: string;
  readonly bowler: string;
  readonly bat?: number;
  readonly extras?: Extra;
  readonly boundary?: 4 | 6;
  readonly wicket?: Wicket;
};

const ballPayload = (b: BallSpec): Record<string, unknown> =>
  given({
    over: b.over,
    ballInOver: b.ballInOver,
    striker: b.striker,
    nonStriker: b.nonStriker,
    bowler: b.bowler,
    runs: given({ bat: b.bat ?? 0, extras: b.extras }),
    boundary: b.boundary,
    wicket: b.wicket === undefined ? undefined : given({ ...b.wicket }),
  });

export const ball = (b: BallSpec): Spec => ({ type: 'cricket.ball', payload: ballPayload(b) });

/** A super-over delivery: over 0, the same shape. */
export const superBall = (b: BallSpec): Spec => ({
  type: 'cricket.superover.ball',
  payload: ballPayload(b),
});

/** Over totals for a side with no players entered (ruling 66): the innings' running totals so far. */
export const summary = (runs: number, wickets: number, legalBalls: number): Spec => ({
  type: 'cricket.innings.summary',
  payload: { runs, wickets, legalBalls, partial: true },
});

export const retire = (
  person: string,
  reason: 'hurt' | 'out' | 'other',
  incoming?: string,
): Spec => ({
  type: 'cricket.retire',
  payload: given({ person, reason, incoming }),
});

export const bowlerChange = (
  bowler: string,
  reason?: 'incapacitated' | 'suspended' | 'other',
): Spec => ({ type: 'cricket.bowler.change', payload: given({ bowler, reason }) });

export const declare = (): Spec => ({ type: 'cricket.innings.declare', payload: {} });

/** A void of the event at `seq`, as the web keeps it: the target in the payload and in `voids_event_id`. */
export const voiding = (seq: number): Spec => ({
  type: 'core.void',
  payload: { event_id: eventId(seq) },
  voids: seq,
});

export const eventId = (seq: number): string => `ev-${seq}`;

/** Where a ledger's clock starts unless the test says: the first event is a second after it. */
export const LEDGER_FROM = '2026-11-08T10:00:00.000Z';

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
    createdAt: '2026-11-08T10:30:00.000Z',
    attempts: 0,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Innings, ball by ball
// ---------------------------------------------------------------------------------------------------------------

/** One delivery of a script: runs off the bat, an extra, a boundary, or a dismissal of the striker (bowled). */
export type Delivery = {
  readonly bat?: number;
  readonly extras?: Extra;
  readonly boundary?: 4 | 6;
  /** The striker is out, bowled. */
  readonly out?: true;
};

/** A dot ball, a single, a wide (one run), a boundary four, a wicket. */
export const DOT: Delivery = {};
export const ONE: Delivery = { bat: 1 };
export const TWO: Delivery = { bat: 2 };
export const FOUR: Delivery = { bat: 4, boundary: 4 };
export const WIDE: Delivery = { extras: { kind: 'wide', runs: 1 } };
/** A no-ball, nothing off the bat: one run, and a free hit to follow. */
export const NO_BALL: Delivery = { extras: { kind: 'noball', runs: 1 } };
export const OUT: Delivery = { out: true };

type Crease = { striker: string; nonStriker: string; next: number; legal: number; wickets: number };

/**
 * An innings as balls: `batting` bats in its team-sheet order (1 and 2 open, 1 on strike), `bowlers[i]` bowls over i,
 * six balls an over. Ten wickets is all out. The script is the caller's: it ends when the caller says.
 */
export function inningsOf(
  batting: Seat,
  bowlers: readonly string[],
  script: readonly Delivery[],
): Spec[] {
  const crease: Crease = {
    striker: player(batting, 1),
    nonStriker: player(batting, 2),
    next: 3,
    legal: 0,
    wickets: 0,
  };
  return script.map((delivery) => deliver(crease, batting, bowlers, delivery));
}

const BALLS_PER_OVER = 6;
const ALL_OUT = 10;

function deliver(crease: Crease, batting: Seat, bowlers: readonly string[], d: Delivery): Spec {
  const over = Math.floor(crease.legal / BALLS_PER_OVER);
  const bowler = bowlers[over];
  if (bowler === undefined) throw new Error(`no bowler named for over ${over}`);
  const out = d.out === true;
  crease.wickets += out ? 1 : 0;
  const incoming = out && crease.wickets < ALL_OUT ? player(batting, crease.next) : undefined;
  const spec = ball({
    over,
    ballInOver: (crease.legal % BALLS_PER_OVER) + 1,
    striker: crease.striker,
    nonStriker: crease.nonStriker,
    bowler,
    bat: d.bat,
    extras: d.extras,
    boundary: d.boundary,
    wicket: out
      ? { kind: 'bowled', out: crease.striker, bowlerCredited: true, incoming }
      : undefined,
  });
  walk(crease, d, incoming);
  return spec;
}

/** The Laws' plain walk: odd runs cross (a wide's or no-ball's own run is not run), a wicket's replacement takes the end. */
function walk(crease: Crease, d: Delivery, incoming: string | undefined): void {
  const extra = d.extras;
  const legal = extra === undefined || (extra.kind !== 'wide' && extra.kind !== 'noball');
  const penalty = extra?.kind === 'wide' || extra?.kind === 'noball' ? 1 : 0;
  const ran =
    (d.boundary === undefined ? (d.bat ?? 0) : 0) +
    (extra === undefined ? 0 : extra.runs - penalty);
  if (d.out === true) {
    if (incoming !== undefined) crease.striker = incoming;
    if (incoming !== undefined) crease.next += 1;
  } else if (ran % 2 === 1) swapEnds(crease);
  if (legal) crease.legal += 1;
  if (legal && crease.legal % BALLS_PER_OVER === 0) swapEnds(crease);
}

/**
 * A super-over innings as balls (`cricket.superover.ball`, over 0): the same walk, one over, `bowler` bowling it. A
 * wicket here names no `incoming` (the engine ignores it in a super over, §4.6): a script that goes on after one must
 * name the replacement on its next ball itself, so it ends at the wicket.
 */
export function superOverOf(batting: Seat, bowler: string, script: readonly Delivery[]): Spec[] {
  return inningsOf(batting, [bowler], script).map((spec) => ({
    type: 'cricket.superover.ball',
    payload: withoutIncoming(spec.payload),
  }));
}

function withoutIncoming(payload: unknown): unknown {
  if (!isRecord(payload) || !isRecord(payload.wicket)) return payload;
  const wicket = Object.entries(payload.wicket).filter(([key]) => key !== 'incoming');
  return { ...payload, wicket: Object.fromEntries(wicket) };
}

function swapEnds(crease: Crease): void {
  [crease.striker, crease.nonStriker] = [crease.nonStriker, crease.striker];
}

const times = (n: number, delivery: Delivery): Delivery[] =>
  Array.from({ length: n }, () => delivery);

// ---------------------------------------------------------------------------------------------------------------
// Fixtures (KO_2 unless said; the home side wins the toss and bats)
// ---------------------------------------------------------------------------------------------------------------

/** The away side's bowlers for a two-over innings: `A-p11`, then `A-p10` (one over each, KO_2's cap). */
export const AWAY_BOWLERS = [player('A', 11), player('A', 10)] as const;
/** The home side's bowlers for a two-over innings: `H-p11`, then `H-p10`. */
export const HOME_BOWLERS = [player('H', 11), player('H', 10)] as const;

/** The toss and the start: the home side won it and bats. */
export const OPENING: readonly Spec[] = [toss('H', 'bat'), start()];

/** The first over bowled: six singles, so 6/0 after one over; the sixth single and the change of ends leave `H-p2` on strike. */
export const OVER_ONE_DONE: readonly Spec[] = [
  ...OPENING,
  ...inningsOf('H', AWAY_BOWLERS, times(6, ONE)),
];

/**
 * The home side all out in the first innings for 1 off 11 balls (1.5 overs): a single, then a wicket on each of the next
 * ten balls, each batter bowled and the next in the order in. The away side then needs 2 off 12.
 */
export const ALL_OUT_FIRST: readonly Spec[] = [
  ...OPENING,
  ...inningsOf('H', AWAY_BOWLERS, [ONE, ...times(10, OUT)]),
];

/** The home side's innings done, 8/0 off two overs (eight singles, four dots): the away side needs 9 off 12. */
export const FIRST_INNINGS_8: readonly Spec[] = [
  ...OPENING,
  ...inningsOf('H', AWAY_BOWLERS, [...times(8, ONE), ...times(4, DOT)]),
];

/** Eight a side off two overs each: a tie in a knockout, so a super over is due (no super-over ball yet). */
export const TIED_KO: readonly Spec[] = [
  ...FIRST_INNINGS_8,
  ...inningsOf('A', HOME_BOWLERS, [...times(8, ONE), ...times(4, DOT)]),
];

/** A T20's five bowlers a side, each bowling every fifth over (four overs, the cap). */
const t20Bowlers = (side: Seat): string[] =>
  Array.from({ length: 20 }, (_, over) => player(side, 7 + (over % 5)));

/**
 * A long T20 ledger, 280 events (the R4 probe's): 20 overs of singles with a wide to open each over (140 balls, 140/0),
 * then the reply's 20 overs of dot balls with a wide to open 18 of them (138 balls, 18/0). Home wins by 122 runs.
 */
export const T20_LONG: readonly Spec[] = [
  ...OPENING,
  ...inningsOf(
    'H',
    t20Bowlers('A'),
    Array.from({ length: 20 }, () => [WIDE, ...times(6, ONE)]).flat(),
  ),
  ...inningsOf(
    'A',
    t20Bowlers('H'),
    Array.from({ length: 20 }, (_, over) =>
      over < 18 ? [WIDE, ...times(6, DOT)] : times(6, DOT),
    ).flat(),
  ),
];

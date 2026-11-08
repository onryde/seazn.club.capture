import { foldEpochOf } from '@seazn/engine/sport';
import type { BootstrapSide, BootstrapSlot } from '@/domain/scoring/wire';
import type { FakeMatchSeed, FakeSeedEvent } from '@/services/fakeScoringPort';

/**
 * A cricket match for the fake scoring server (S2-4 plan Task 8; AGENTS §10: every state developable on a laptop), as a
 * seed for `createFakeScoringPort`. `fakeChessPad`'s twin: the fake server folds it with the real engine and builds each
 * side's lineup from its team sheet as the web's server does (`teamSheetOf`), so this is only the match, with made-up
 * names, ids and a context. The scoring rules are the engine's, never ours.
 */

export const HOME_ENTRANT = 'ent-riverside';
export const AWAY_ENTRANT = 'ent-hillcrest';

/** Eleven a side (the Laws), then one on the bench. */
const STARTERS = 11;

/** A player of a side by their place in its team sheet's batting order: `ent-riverside-p3`. */
export const playerOf = (entrantId: string, n: number): string => `${entrantId}-p${n}`;

/** A side's team sheet: 1 to 11 start in that order (the second keeps wicket), the 12th on the bench. */
function side(entrantId: string, name: string, surnames: readonly string[]): BootstrapSide {
  const starters = Array.from({ length: STARTERS }, (_, i) => i + 1);
  const lineup: BootstrapSlot[] = [
    ...starters.map((n): BootstrapSlot => ({
      personId: playerOf(entrantId, n),
      pairOrder: null,
      slot: 'starting',
      orderNo: n,
      role: 'player',
      ...(n === 2 ? { roles: ['wicketkeeper'] } : {}),
    })),
    {
      personId: playerOf(entrantId, 12),
      pairOrder: null,
      slot: 'bench',
      orderNo: 12,
      role: 'player',
    },
  ];
  return {
    entrantId,
    name,
    kind: 'team',
    members: surnames.map((surname, i) => ({
      personId: playerOf(entrantId, i + 1),
      fullName: surname,
    })),
    lineup,
  };
}

const RIVERSIDE = [
  'A. Sharma',
  'B. Okafor',
  'C. Mendes',
  'D. Walsh',
  'E. Nakamura',
  'F. Haddad',
  'G. Lindqvist',
  'H. Brennan',
  'I. Petrova',
  'J. Mwangi',
  'K. Doyle',
  'L. Fontaine',
];
const HILLCREST = [
  'M. Chen',
  'N. Patel',
  'O. Kowalski',
  'P. Reyes',
  'Q. Adeyemi',
  'R. Novak',
  'S. Dubois',
  'T. Jansen',
  'U. Rossi',
  'V. Kaur',
  'W. Murphy',
  'X. Larsen',
];

/** A knockout of two six-ball overs a side, one over a bowler, and a super over on a tie. */
export const KNOCKOUT_CFG = {
  ballsPerInnings: 12,
  ballsPerOver: 6,
  maxOversPerBowler: 1,
  superOver: true,
  minOversForResult: 1,
} as const;

/** A cricket match nobody has touched: no toss yet. `over` changes the seed. */
export function cricketSeed(
  over: Partial<Omit<FakeMatchSeed, 'sides' | 'sport'>> = {},
): FakeMatchSeed {
  return {
    sport: 'cricket',
    fixtureId: 'fake-cricket',
    linkId: 'fake-link-fake-cricket',
    cfg: KNOCKOUT_CFG,
    rulesVersion: 0,
    epochRequired: foldEpochOf('cricket'),
    screen: 'pad',
    context: {
      competition: 'Summer Bash 2026',
      division: 'Open T2',
      round: 'Final',
      match: 'Match 7',
    },
    sides: {
      home: side(HOME_ENTRANT, 'Riverside CC', RIVERSIDE),
      away: side(AWAY_ENTRANT, 'Hillcrest CC', HILLCREST),
    },
    events: [],
    ...over,
  };
}

const home = (n: number) => playerOf(HOME_ENTRANT, n);
const away = (n: number) => playerOf(AWAY_ENTRANT, n);

/** A delivery of the first over: Riverside's openers in (1 on strike), Hillcrest's 11 bowling. */
const firstOver = (
  ballInOver: number,
  striker: string,
  nonStriker: string,
  runs: Readonly<Record<string, unknown>>,
  boundary?: 4 | 6,
): FakeSeedEvent => ({
  type: 'cricket.ball',
  payload: {
    over: 0,
    ballInOver,
    striker,
    nonStriker,
    bowler: away(11),
    runs,
    ...(boundary === undefined ? {} : { boundary }),
  },
});

/**
 * The toss (Riverside won it and bats), the start, then three balls of the first over: a single, a boundary four by the
 * second opener, a dot. Riverside 5/0 off 0.3 overs; B. Okafor on strike.
 */
export const LIVE_EVENTS: readonly FakeSeedEvent[] = [
  { type: 'cricket.toss', payload: { wonBy: HOME_ENTRANT, elected: 'bat' } },
  { type: 'core.start', payload: {} },
  firstOver(1, home(1), home(2), { bat: 1 }),
  firstOver(2, home(2), home(1), { bat: 4 }, 4),
  firstOver(3, home(2), home(1), { bat: 0 }),
];

/** The match under way: `LIVE_EVENTS` on the ledger. */
export const liveCricketSeed = (
  over: Partial<Omit<FakeMatchSeed, 'sides' | 'sport'>> = {},
): FakeMatchSeed => cricketSeed({ events: LIVE_EVENTS, ...over });

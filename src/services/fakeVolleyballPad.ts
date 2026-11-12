import { foldEpochOf } from '@seazn/engine/sport';
import type { PadSide } from '@/domain/scoring/padView';
import type { BootstrapSide, BootstrapSlot } from '@/domain/scoring/wire';
import type { FakeMatchSeed, FakeSeedEvent } from '@/services/fakeScoringPort';

/**
 * Volleyball matches for the fake scoring server (S2-6 Task 9; AGENTS §10: every state developable on a laptop), as seeds
 * for `createFakeScoringPort`. `fakeTableTennisPad`'s twin: the fake server folds them with the real engine, so these are
 * only the matches, with made-up clubs, players, ids and a context. The scoring rules are the engine's, never ours.
 */

export const HOME_ENTRANT = 'ent-home';
export const AWAY_ENTRANT = 'ent-away';

/** The entrant a half's side is, as the seeds name them. */
export const ENTRANT_OF: Readonly<Record<PadSide, string>> = {
  first: HOME_ENTRANT,
  second: AWAY_ENTRANT,
};

/** Indoor's shipped config is the engine's defaults; beach's variant is restated whole (7.0.0's config has no variant field). */
export const INDOOR_CFG = {};
export const BEACH_CFG = {
  bestOf: 3,
  setTo: 21,
  finalSetTo: 15,
  pointsMap: { '*': [2, 0] },
  records: { timeouts: true, sanctions: true, substitutions: false, expedite: false },
};

const SURNAMES = ['Adams', 'Brown', 'Clark', 'Davis', 'Evans', 'Frost', 'Grant'] as const;

/** Six starters and a bench player; ids `<entrant>-p1`…`-p7`; a coach row on request (`<entrant>-coach`). */
function team(entrantId: string, name: string, initial: string, coach: boolean): BootstrapSide {
  const players: BootstrapSlot[] = SURNAMES.map((_, i) => ({
    personId: `${entrantId}-p${i + 1}`,
    pairOrder: null,
    slot: i < 6 ? ('starting' as const) : ('bench' as const),
    orderNo: i + 1,
    role: 'player',
    squadNumber: i + 1,
  }));
  const staff: BootstrapSlot[] = coach
    ? [
        {
          personId: `${entrantId}-coach`,
          pairOrder: null,
          slot: 'bench',
          orderNo: 8,
          role: 'coach',
        },
      ]
    : [];
  const rows = [...players, ...staff];
  return {
    entrantId,
    name,
    kind: 'team',
    members: rows.map((row, i) => ({
      personId: row.personId,
      fullName:
        row.role === 'coach' ? `${initial}. Coach` : `${initial}. ${SURNAMES[i] ?? 'Player'}`,
    })),
    lineup: rows,
  };
}

/** A beach pair, the team sheet's pair order 1 and 2. */
function pair(entrantId: string, name: string, first: string, second: string): BootstrapSide {
  const people = [first, second];
  return {
    entrantId,
    name,
    kind: 'pair',
    members: people.map((fullName, i) => ({ personId: `${entrantId}-p${i + 1}`, fullName })),
    lineup: people.map((_, i) => ({
      personId: `${entrantId}-p${i + 1}`,
      pairOrder: i + 1,
      slot: 'starting' as const,
      orderNo: i + 1,
      role: 'player',
    })),
  };
}

const CONTEXT = {
  competition: 'Spring League 2026',
  division: 'Open',
  round: 'Round 1',
  match: 'Match 2',
};

type SeedOptions = {
  readonly fixtureId?: string;
  /** What other scorers wrote before this phone met the match, in order. */
  readonly events?: readonly FakeSeedEvent[];
  readonly cfg?: unknown;
  /** No coach row, no bench: a side with players only, or (`'none'`) no team sheet rows at all. */
  readonly sheet?: 'full' | 'none';
};

/** An indoor match nobody has touched: six starters and a bench player a side, the home side with a coach row. */
export function indoorSeed(options: SeedOptions = {}): FakeMatchSeed {
  const { fixtureId = 'fake-vb-indoor', events = [], cfg = INDOOR_CFG, sheet = 'full' } = options;
  const bare = (side: BootstrapSide): BootstrapSide =>
    sheet === 'none' ? { ...side, lineup: [], members: [] } : side;
  return {
    sport: 'volleyball',
    fixtureId,
    linkId: `fake-link-${fixtureId}`,
    cfg,
    rulesVersion: 0,
    epochRequired: foldEpochOf('volleyball'),
    screen: 'pad',
    context: CONTEXT,
    sides: {
      home: bare(team(HOME_ENTRANT, 'Falcons', 'F', true)),
      away: bare(team(AWAY_ENTRANT, 'Herons', 'H', false)),
    },
    events,
  };
}

/** A beach match nobody has touched: two pairs, each player with a pair order. */
export function beachSeed(options: SeedOptions = {}): FakeMatchSeed {
  const { fixtureId = 'fake-vb-beach', events = [], cfg = BEACH_CFG } = options;
  return {
    sport: 'volleyball',
    fixtureId,
    linkId: `fake-link-${fixtureId}`,
    cfg,
    rulesVersion: 0,
    epochRequired: foldEpochOf('volleyball'),
    screen: 'pad',
    context: CONTEXT,
    sides: {
      home: pair(HOME_ENTRANT, 'Sand / Surf', 'S. Sand', 'U. Surf'),
      away: pair(AWAY_ENTRANT, 'Dune / Tide', 'D. Dune', 'T. Tide'),
    },
    events,
  };
}

export const VOLLEYBALL_INDOOR_SEED: FakeMatchSeed = indoorSeed();
export const VOLLEYBALL_BEACH_SEED: FakeMatchSeed = beachSeed();

const START: FakeSeedEvent = { type: 'core.start', payload: {} };

/** A rally for `wonBy` (`first` or `second`); `serving` anchors the first server's side. */
export function rallyEvent(wonBy: PadSide, serving?: PadSide): FakeSeedEvent {
  return {
    type: 'volleyball.rally',
    payload: {
      wonBy: ENTRANT_OF[wonBy],
      ...(serving === undefined ? {} : { serving: ENTRANT_OF[serving] }),
    },
  };
}

/** Another scorer started it and named no first server: the pad asks Who serves first? on the first tap. */
export const VOLLEYBALL_UNANCHORED_SEED: FakeMatchSeed = indoorSeed({
  fixtureId: 'fake-vb-unanchored',
  events: [START],
});

/** `winner` takes `points` rallies in a row (the first of the match names its server when `serving` is given). */
function run(winner: PadSide, points: number, serving?: PadSide): FakeSeedEvent[] {
  return Array.from({ length: points }, (_, i) =>
    i === 0 && serving !== undefined ? rallyEvent(winner, serving) : rallyEvent(winner),
  );
}

/**
 * Indoor, two sets all (25-0 to the home side, 25-0 to the away side, twice, alternating): the deciding set is tossed
 * afresh, so the first tap at its 0-0 asks Who serves first in set 5?.
 */
export const VOLLEYBALL_DECIDING_SEED: FakeMatchSeed = indoorSeed({
  fixtureId: 'fake-vb-deciding',
  events: [
    START,
    ...run('first', 25, 'first'),
    ...run('second', 25),
    ...run('first', 25),
    ...run('second', 25),
  ],
});

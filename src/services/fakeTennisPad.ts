import { foldEpochOf } from '@seazn/engine/sport';
import type { PadSide } from '@/domain/scoring/padView';
import type { BootstrapSide, BootstrapSlot } from '@/domain/scoring/wire';
import type { FakeMatchSeed, FakeSeedEvent } from '@/services/fakeScoringPort';

/**
 * Tennis matches for the fake scoring server (S2-7 Task 9; AGENTS §10: every state developable on a laptop), as seeds for
 * `createFakeScoringPort`. `fakeVolleyballPad`'s twin: the fake server folds them with the real engine, so these are only
 * the matches, with made-up players, ids and a context. The scoring rules are the engine's, never ours.
 */

export const HOME_ENTRANT = 'ent-home';
export const AWAY_ENTRANT = 'ent-away';

/** The entrant a half's side is, as the seeds name them. */
export const ENTRANT_OF: Readonly<Record<PadSide, string>> = {
  first: HOME_ENTRANT,
  second: AWAY_ENTRANT,
};

/** The Tour's shipped config is the engine's defaults (the schema fills the rest). */
export const TOUR_CFG = {};

/** A Grand Slam's: best of five, the last set's breaker to 10 (7.0.0's config has no variant field), advantage games. */
export const GRAND_SLAM_CFG = {
  bestOf: 5,
  set: { gamesTo: 6, winBy: 2, tiebreakAt: 6, tiebreakTo: 7 },
  finalSet: { tiebreakTo: 10 },
  game: { noAd: false },
  tiebreak: { winBy: 2 },
  points: { win: 2, loss: 0 },
};

/** Fast4: sets to 4 games, a tie-break at 3-3 to 5, no-ad games, best of three. */
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
  const row: BootstrapSlot = {
    personId,
    pairOrder: null,
    slot: 'starting',
    orderNo: 1,
    role: 'player',
  };
  return {
    entrantId,
    name,
    kind: 'individual',
    members: [{ personId, fullName: name }],
    lineup: [row],
  };
}

/** A doubles pair: the team sheet's pair order is 1 and 2, as listed. */
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
};

function seedOf(
  sides: FakeMatchSeed['sides'],
  fallbackId: string,
  options: SeedOptions,
): FakeMatchSeed {
  const { fixtureId = fallbackId, events = [], cfg = TOUR_CFG } = options;
  return {
    sport: 'tennis',
    fixtureId,
    linkId: `fake-link-${fixtureId}`,
    cfg,
    rulesVersion: 0,
    epochRequired: foldEpochOf('tennis'),
    screen: 'pad',
    context: CONTEXT,
    sides,
    events,
  };
}

/** A singles match nobody has touched: one player a side. */
export const singlesSeed = (options: SeedOptions = {}): FakeMatchSeed =>
  seedOf(
    {
      home: player(HOME_ENTRANT, 'ent-home-p1', 'Ana Ruiz'),
      away: player(AWAY_ENTRANT, 'ent-away-p1', 'Bea Lund'),
    },
    'fake-tn-singles',
    options,
  );

/** A doubles match nobody has touched: two pairs, each player with a pair order. */
export const doublesSeed = (options: SeedOptions = {}): FakeMatchSeed =>
  seedOf(
    {
      home: pair(HOME_ENTRANT, 'Ruiz / Vega', 'Ana Ruiz', 'Eva Vega'),
      away: pair(AWAY_ENTRANT, 'Lund / Berg', 'Bea Lund', 'Ida Berg'),
    },
    'fake-tn-doubles',
    options,
  );

/** The Tour's singles, best of three: the default match of a laptop run. */
export const TENNIS_TOUR_SEED: FakeMatchSeed = singlesSeed();

/** Doubles with no-ad games and a match tie-break as the deciding set. */
export const TENNIS_DOUBLES_NOAD_SEED: FakeMatchSeed = doublesSeed({
  fixtureId: 'fake-tn-doubles-noad',
  cfg: DOUBLES_NOAD_CFG,
});

/** Fast4 singles. */
export const TENNIS_FAST4_SEED: FakeMatchSeed = singlesSeed({
  fixtureId: 'fake-tn-fast4',
  cfg: FAST4_CFG,
});

export const START: FakeSeedEvent = { type: 'core.start', payload: {} };

/** A point for `side`. */
export const pointEvent = (side: PadSide): FakeSeedEvent => ({
  type: 'tennis.point',
  payload: { by: ENTRANT_OF[side] },
});

/** `winner` takes `games` love games in a row. */
export const gameEvents = (winner: PadSide, games = 1): FakeSeedEvent[] =>
  Array.from({ length: games * 4 }, () => pointEvent(winner));

/** Another scorer started it: the pad is under way at 0-0. */
export const TENNIS_STARTED_SEED: FakeMatchSeed = singlesSeed({
  fixtureId: 'fake-tn-started',
  events: [START],
});

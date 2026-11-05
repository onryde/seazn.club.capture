import { foldEpochOf } from '@seazn/engine/sport';
import { chessCfg } from '@/domain/scoring/chessEngine';
import type { BootstrapSide } from '@/domain/scoring/wire';
import type { FakeMatchSeed } from '@/services/fakeScoringPort';

/**
 * A chess game for the fake scoring server (plan S2-3 Task 1; AGENTS §10: every state developable on a laptop), as a seed
 * for `createFakeScoringPort`. `fakeTableTennisPad`'s twin: the fake server folds it with the real engine, so this is only
 * the match, with made-up names, ids and a context. The scoring rules are the engine's, never ours. The sport key is the
 * engine's `boardgame`, shared with every generic one-against-one game (ruling 61).
 */

export const HOME_ENTRANT = 'ent-home';
export const AWAY_ENTRANT = 'ent-away';

/** One side as the bootstrap sends it: an individual entrant with its one player. */
function side(entrantId: string, fullName: string): BootstrapSide {
  const personId = `${entrantId}-p1`;
  return {
    entrantId,
    name: fullName,
    kind: 'individual',
    members: [{ personId, fullName }],
    lineup: [{ personId, pairOrder: null }],
  };
}

/** A chess game nobody has touched: not started, the engine's default config (home holds White). `over` changes the seed. */
export function chessSeed(
  over: Partial<Omit<FakeMatchSeed, 'sides' | 'sport'>> = {},
): FakeMatchSeed {
  return {
    sport: 'boardgame',
    fixtureId: 'fake-chess',
    linkId: 'fake-link-fake-chess',
    cfg: chessCfg({}),
    rulesVersion: 0,
    epochRequired: foldEpochOf('boardgame'),
    screen: 'pad',
    context: {
      competition: 'Spring Open 2026',
      division: 'Open Rapid',
      round: 'Round 1',
      match: 'Board 4',
    },
    sides: { home: side(HOME_ENTRANT, 'A. Sharma'), away: side(AWAY_ENTRANT, 'L. Chen') },
    events: [],
    ...over,
  };
}

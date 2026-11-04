import { tableTennisCfg } from '@/domain/scoring/tableTennisEngine';
import type { PadSide } from '@/domain/scoring/padView';
import type { BootstrapSide } from '@/domain/scoring/wire';
import type { FakeMatchSeed } from '@/services/fakeScoringPort';

/**
 * Table tennis matches for the fake scoring server (plan S2-2 Task 7; AGENTS §10: every state developable on a laptop),
 * as seeds for `createFakeScoringPort`. Badminton's twin is `fakeBadmintonPad`, which was a pad of counters made before
 * the engine could be reached from the phone. Table tennis has no such second implementation: the fake server folds it
 * with the real engine, so these are only the matches, with made-up names, ids and a context. The scoring rules are the
 * engine's, never ours (design §6).
 */

/** One side as the bootstrap sends it: a pair declares its pair order unless `ordered` is false (a team sheet without one). */
function side(entrantId: string, players: readonly string[], ordered: boolean): BootstrapSide {
  const pair = players.length > 1;
  return {
    entrantId,
    name: players.join(' / '),
    kind: pair ? 'pair' : 'individual',
    members: players.map((fullName, i) => ({ personId: `${entrantId}-p${i + 1}`, fullName })),
    lineup: players.map((_, i) => ({
      personId: `${entrantId}-p${i + 1}`,
      pairOrder: pair && ordered ? i + 1 : null,
    })),
  };
}

export const HOME_ENTRANT = 'ent-home';
export const AWAY_ENTRANT = 'ent-away';

/** The entrant a half's side is, as the seeds name them. */
export const ENTRANT_OF: Readonly<Record<PadSide, string>> = {
  first: HOME_ENTRANT,
  second: AWAY_ENTRANT,
};

type Names = readonly [home: readonly string[], away: readonly string[]];

/** A table tennis match nobody has touched: not started, the engine's default config (best of 5 to 11). */
export function tableTennisSeed(
  fixtureId: string,
  names: Names,
  over: Partial<Omit<FakeMatchSeed, 'fixtureId' | 'sides'>> & { readonly ordered?: boolean } = {},
): FakeMatchSeed {
  const { ordered = true, ...rest } = over;
  return {
    sport: 'tabletennis',
    fixtureId,
    linkId: `fake-link-${fixtureId}`,
    cfg: tableTennisCfg({}),
    rulesVersion: 0,
    epochRequired: 2,
    screen: 'pad',
    context: {
      competition: 'Spring Open 2026',
      division: 'U15 Boys Singles',
      round: 'Round 1',
      match: 'Match 4',
    },
    sides: {
      home: side(HOME_ENTRANT, names[0], ordered),
      away: side(AWAY_ENTRANT, names[1], ordered),
    },
    events: [],
    ...rest,
  };
}

/** Singles, not started: the Start screen. */
export const TABLE_TENNIS_SINGLES_SEED: FakeMatchSeed = tableTennisSeed('fake-tt-singles', [
  ['A. Sharma'],
  ['L. Chen'],
]);

/** Doubles with the team sheet's pair order, not started: the plate can name the serving player. */
export const TABLE_TENNIS_DOUBLES_SEED: FakeMatchSeed = tableTennisSeed(
  'fake-tt-doubles',
  [
    ['A. Sharma', 'R. Iyer'],
    ['L. Chen', 'M. Wong'],
  ],
  {
    context: {
      competition: 'Riverside Table Tennis Club Championships 2026',
      division: 'Open Mixed Doubles',
      round: 'Quarter-final',
      match: 'TT0001',
    },
  },
);

/**
 * Singles started by another scorer, who named no first server: the engine can say nobody serves, so the pad asks Who is
 * serving? at once (design §4.2).
 */
export const TABLE_TENNIS_UNANCHORED_SEED: FakeMatchSeed = tableTennisSeed(
  'fake-tt-unanchored',
  [['A. Sharma'], ['L. Chen']],
  { events: [{ type: 'core.start', payload: {} }] },
);

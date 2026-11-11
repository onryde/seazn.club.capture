import { foldEpochOf } from '@seazn/engine/sport';
import type { BootstrapSide, BootstrapSlot } from '@/domain/scoring/wire';
import type { FakeMatchSeed, FakeSeedEvent } from '@/services/fakeScoringPort';

/**
 * A football match for the fake scoring server (S2-5 plan P Task 9; AGENTS §10: every state developable on a laptop), as
 * a seed for `createFakeScoringPort`. `fakeChessPad`'s twin: the fake server folds it with the real engine, so this is
 * only the match, with made-up clubs, players, ids and a context. The rules are the engine's, never ours.
 */

export const HOME_ENTRANT = 'ent-home';
export const AWAY_ENTRANT = 'ent-away';

/** Eleven a side start (the Laws); five sit on the bench. */
const STARTERS = 11;
const SQUAD = 16;

/**
 * How the bootstrap sends the team sheets (design §10, §6.6): `full`, a row per player with its slot, order and shirt
 * number; `noSlots`, the players with no slot (a web older than §10: every row starts, and the pad shows the team only);
 * `none`, no rows at all (the organiser set no team sheet).
 */
export type FakeSheet = 'full' | 'noSlots' | 'none';

const SURNAMES = [
  'Adeyemi',
  'Brennan',
  'Costa',
  'Dlamini',
  'Evans',
  'Fischer',
  'Garcia',
  'Hughes',
  'Ito',
  'Jansen',
  'Kowalski',
  'Laurent',
  'Moreau',
  'Novak',
  'Okafor',
  'Price',
] as const;

/** Row `n` (from 1) of a sheet: 1–11 start, 12–16 on the bench, the shirt its number, the keeper in goal. */
function sheetRow(personId: string, n: number): BootstrapSlot {
  return {
    personId,
    pairOrder: null,
    slot: n <= STARTERS ? 'starting' : 'bench',
    orderNo: n,
    role: 'player',
    squadNumber: n,
    ...(n === 1 ? { positionKey: 'GK' } : {}),
  };
}

function rowsOf(ids: readonly string[], sheet: FakeSheet): readonly BootstrapSlot[] {
  if (sheet === 'none') return [];
  return ids.map((personId, i) =>
    sheet === 'full' ? sheetRow(personId, i + 1) : { personId, pairOrder: null },
  );
}

/** One club as the bootstrap sends it: its players, `ent-home-p1`… with an initial and a surname, and its rows. */
function team(entrantId: string, name: string, initial: string, sheet: FakeSheet): BootstrapSide {
  const ids = Array.from({ length: SQUAD }, (_, i) => `${entrantId}-p${i + 1}`);
  return {
    entrantId,
    name,
    kind: 'team',
    members: ids.map((personId, i) => ({
      personId,
      fullName: `${initial}. ${SURNAMES[i] ?? 'Player'}`,
    })),
    lineup: rowsOf(ids, sheet),
  };
}

type FootballSeedOptions = {
  readonly sheet?: FakeSheet;
  /** The match's config as the endpoint sends it; unset is the engine's default (2 × 45, a draw stands). */
  readonly cfg?: unknown;
  /** What other scorers wrote before this phone met the match, in order. */
  readonly events?: readonly FakeSeedEvent[];
  readonly fixtureId?: string;
};

/** A football match nobody has touched: not started, both team sheets in full unless `sheet` says otherwise. */
export function footballSeed(options: FootballSeedOptions = {}): FakeMatchSeed {
  const { sheet = 'full', cfg = {}, events = [], fixtureId = 'fake-football' } = options;
  return {
    sport: 'football',
    fixtureId,
    linkId: `fake-link-${fixtureId}`,
    cfg,
    rulesVersion: 0,
    epochRequired: foldEpochOf('football'),
    screen: 'pad',
    context: {
      competition: 'County League 2026',
      division: 'Open Age',
      round: 'Matchday 3',
      match: 'Match 7',
    },
    sides: {
      home: team(HOME_ENTRANT, 'Riverside FC', 'R', sheet),
      away: team(AWAY_ENTRANT, 'Northgate United', 'N', sheet),
    },
    events,
  };
}

import { foldEpochOf } from '@seazn/engine/sport';
import { describe, expect, it } from 'vitest';
import type { AppendBody } from '@/domain/scoring/wire';
import { createFakeScoringPort, type FakeMatchSeed } from '@/services/fakeScoringPort';
import {
  doublesSeed,
  singlesSeed,
  START,
  TENNIS_DOUBLES_NOAD_SEED,
  TENNIS_FAST4_SEED,
  TENNIS_STARTED_SEED,
  TENNIS_TOUR_SEED,
} from '@/services/fakeTennisPad';
import type { ScoringLink } from '@/services/scoringPort';
import { FAKE_SCORING_SECRET } from '../../test/fakeScoringLinkPort';

// The tennis seeds for the fake scoring server (S2-7 Task 9): each is a match the real engine takes, with the sides the
// pad's sheets list. Every expected number is written out from the seed's own literals.

const LINK: ScoringLink = { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET };

let n = 0;
const body = (expected_seq: number, type: string, payload: unknown = {}): AppendBody => {
  n += 1;
  return {
    expected_seq,
    type,
    payload,
    idempotency_key: `fp-${n}`,
    engine_epoch: foldEpochOf('tennis'),
    rules_version: 0,
  };
};

const bootstrapOf = async (seed: FakeMatchSeed) => {
  const result = await createFakeScoringPort(seed).bootstrap(LINK);
  if (result.kind !== 'ok') throw new Error(`no bootstrap: ${result.kind}`);
  return result.bootstrap;
};

describe('the seeds', () => {
  it.each([
    ['tour', TENNIS_TOUR_SEED, 'individual', 1],
    ['fast4', TENNIS_FAST4_SEED, 'individual', 1],
    ['singles', singlesSeed(), 'individual', 1],
    ['doubles no-ad', TENNIS_DOUBLES_NOAD_SEED, 'pair', 2],
    ['doubles', doublesSeed(), 'pair', 2],
  ] as const)(
    '%s: tennis, the engine’s epoch, %s players a side',
    async (_n, seed, kind, members) => {
      const bootstrap = await bootstrapOf(seed);
      expect(bootstrap.sportKey).toBe('tennis');
      expect(bootstrap.epochRequired).toBe(foldEpochOf('tennis'));
      expect(bootstrap.sides.home?.kind).toBe(kind);
      expect(bootstrap.sides.away?.members).toHaveLength(members);
    },
  );

  it('carry their own configs: Fast4’s sets to 4, the doubles’ match tie-break to 10', async () => {
    expect((await bootstrapOf(TENNIS_FAST4_SEED)).cfg).toMatchObject({ set: { gamesTo: 4 } });
    expect((await bootstrapOf(TENNIS_DOUBLES_NOAD_SEED)).cfg).toMatchObject({
      finalSet: { matchTiebreakTo: 10 },
    });
  });

  it('a doubles pair’s sheet carries the pair order 1 and 2, and a singles player none', async () => {
    const doubles = await bootstrapOf(TENNIS_DOUBLES_NOAD_SEED);
    expect(doubles.sides.home?.lineup.map((row) => row.pairOrder)).toEqual([1, 2]);
    const singles = await bootstrapOf(TENNIS_TOUR_SEED);
    expect(singles.sides.home?.lineup.map((row) => row.pairOrder)).toEqual([null]);
  });

  it('a started seed already holds the other scorer’s start', async () => {
    expect(TENNIS_STARTED_SEED.events).toEqual([START]);
    expect((await bootstrapOf(TENNIS_STARTED_SEED)).lastSeq).toBe(1);
  });
});

describe('the fake server judges them with the engine and the team sheet', () => {
  const doubles = () =>
    createFakeScoringPort(doublesSeed({ events: [START], fixtureId: 'fake-tn-judge' }));

  it('a sanction names a player on the sheet', async () => {
    expect(
      await doubles().append(
        LINK,
        'fake-tn-judge',
        body(1, 'tennis.sanction', {
          by: 'ent-home',
          level: 'warning',
          person: 'ent-home-p2',
        }),
      ),
    ).toMatchObject({ kind: 'accepted' });
  });

  it('a point is taken, and a second start is refused', async () => {
    const port = doubles();
    expect(
      await port.append(LINK, 'fake-tn-judge', body(1, 'tennis.point', { by: 'ent-home' })),
    ).toMatchObject({ kind: 'accepted' });
    expect(await port.append(LINK, 'fake-tn-judge', body(2, 'core.start'))).toMatchObject({
      kind: 'refused',
    });
  });
});

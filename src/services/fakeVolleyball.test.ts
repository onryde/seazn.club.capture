import { foldEpochOf } from '@seazn/engine/sport';
import { describe, expect, it } from 'vitest';
import type { AppendBody, Bootstrap } from '@/domain/scoring/wire';
import { createFakeScoringPort, type FakeMatchSeed } from '@/services/fakeScoringPort';
import type { ScoringLink } from '@/services/scoringPort';
import { FAKE_SCORING_SECRET } from '../../test/fakeScoringLinkPort';
import { BEACH, INDOOR } from '../../test/volleyballLedger';

// The fake server serves volleyball with the real engine (S2-6 Task 2): the team sheet's lineups judge a tap, and beach's
// missing substitutions are refused with the engine's own word.

const LINK: ScoringLink = { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET };

const seedOf = (b: Bootstrap): FakeMatchSeed => {
  if (b.sides.home === null || b.sides.away === null) throw new Error('both sides');
  return {
    fixtureId: b.fixtureId,
    linkId: b.linkId,
    sport: 'volleyball',
    cfg: b.cfg,
    rulesVersion: b.rulesVersion,
    epochRequired: foldEpochOf('volleyball'),
    screen: 'pad',
    context: b.context,
    sides: { home: b.sides.home, away: b.sides.away },
    events: [],
  };
};

let n = 0;
const body = (expected_seq: number, type: string, payload: unknown = {}): AppendBody => {
  n += 1;
  return {
    expected_seq,
    type,
    payload,
    idempotency_key: `vb-${n}`,
    engine_epoch: foldEpochOf('volleyball'),
    rules_version: 1,
  };
};

describe('the fake server, volleyball', () => {
  it('answers volleyball as its sport key and takes a start and a rally', async () => {
    const port = createFakeScoringPort(seedOf(INDOOR));
    const answer = await port.bootstrap(LINK);
    expect(answer).toMatchObject({ kind: 'ok', bootstrap: { sportKey: 'volleyball' } });
    expect(await port.append(LINK, INDOOR.fixtureId, body(0, 'core.start'))).toMatchObject({
      kind: 'accepted',
    });
    expect(
      await port.append(
        LINK,
        INDOOR.fixtureId,
        body(1, 'volleyball.rally', { wonBy: 'ent-home', serving: 'ent-home' }),
      ),
    ).toMatchObject({ kind: 'accepted' });
  });

  it('judges a substitution by the variant: taken indoor, refused on a beach pair', async () => {
    const sub = { by: 'ent-home', off: 'h1', on: 'h7' };
    const indoor = createFakeScoringPort(seedOf(INDOOR));
    await indoor.append(LINK, INDOOR.fixtureId, body(0, 'core.start'));
    expect(
      await indoor.append(LINK, INDOOR.fixtureId, body(1, 'volleyball.sub', sub)),
    ).toMatchObject({ kind: 'accepted' });

    const beach = createFakeScoringPort(seedOf(BEACH));
    await beach.append(LINK, BEACH.fixtureId, body(0, 'core.start'));
    const refused = await beach.append(
      LINK,
      BEACH.fixtureId,
      body(1, 'volleyball.sub', { by: 'ent-home', off: 'h1', on: 'h2' }),
    );
    expect(refused).toMatchObject({ kind: 'refused', status: 422 });
  });
});

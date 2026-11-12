import { foldEpochOf } from '@seazn/engine/sport';
import { describe, expect, it } from 'vitest';
import type { AppendBody, Bootstrap } from '@/domain/scoring/wire';
import { createFakeScoringPort, type FakeMatchSeed } from '@/services/fakeScoringPort';
import type { ScoringLink } from '@/services/scoringPort';
import { FAKE_SCORING_SECRET } from '../../test/fakeScoringLinkPort';
import { DOUBLES, SINGLES } from '../../test/tennisLedger';

// The fake server serves tennis with the real engine (S2-7 Task 3): the team sheet's lineups judge a tap, and a point
// after a default is refused with the engine's own word.

const LINK: ScoringLink = { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET };

const seedOf = (b: Bootstrap): FakeMatchSeed => {
  if (b.sides.home === null || b.sides.away === null) throw new Error('both sides');
  return {
    fixtureId: b.fixtureId,
    linkId: b.linkId,
    sport: 'tennis',
    cfg: b.cfg,
    rulesVersion: b.rulesVersion,
    epochRequired: foldEpochOf('tennis'),
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
    idempotency_key: `tn-${n}`,
    engine_epoch: foldEpochOf('tennis'),
    rules_version: 1,
  };
};

describe('the fake server, tennis', () => {
  it('answers tennis as its sport key and takes a start and a point', async () => {
    const port = createFakeScoringPort(seedOf(SINGLES));
    expect(await port.bootstrap(LINK)).toMatchObject({
      kind: 'ok',
      bootstrap: { sportKey: 'tennis' },
    });
    expect(await port.append(LINK, SINGLES.fixtureId, body(0, 'core.start'))).toMatchObject({
      kind: 'accepted',
    });
    expect(
      await port.append(LINK, SINGLES.fixtureId, body(1, 'tennis.point', { by: 'ent-home' })),
    ).toMatchObject({ kind: 'accepted' });
  });

  it('refuses a point after a default, as the engine does (TN-SE-1), with a 422', async () => {
    const port = createFakeScoringPort(seedOf(SINGLES));
    await port.append(LINK, SINGLES.fixtureId, body(0, 'core.start'));
    await port.append(
      LINK,
      SINGLES.fixtureId,
      body(1, 'tennis.sanction', { by: 'ent-away', level: 'default' }),
    );
    expect(
      await port.append(LINK, SINGLES.fixtureId, body(2, 'tennis.point', { by: 'ent-home' })),
    ).toMatchObject({ kind: 'refused', status: 422 });
  });

  it('takes a doubles match: both partners are on the court, a sanction may name one', async () => {
    const port = createFakeScoringPort(seedOf(DOUBLES));
    await port.append(LINK, DOUBLES.fixtureId, body(0, 'core.start'));
    expect(
      await port.append(
        LINK,
        DOUBLES.fixtureId,
        body(1, 'tennis.sanction', { by: 'ent-home', level: 'warning', person: 'h2' }),
      ),
    ).toMatchObject({ kind: 'accepted' });
  });
});

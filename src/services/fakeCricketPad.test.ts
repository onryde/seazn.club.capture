import { describe, expect, it } from 'vitest';
import type { AppendBody } from '@/domain/scoring/wire';
import {
  AWAY_ENTRANT,
  HOME_ENTRANT,
  cricketSeed,
  liveCricketSeed,
  playerOf,
} from '@/services/fakeCricketPad';
import { createFakeScoringPort } from '@/services/fakeScoringPort';
import { FAKE_SCORING_SECRET } from '../../test/fakeScoringLinkPort';

// S2-4 plan Task 8: the fake server serves cricket, folded with the real engine over each side's TEAM SHEET (the web's
// `buildLineup`, the phone's `teamSheetOf`), not the set-based sports' all-starting lineup: the 12th of each side is on
// the bench, so the engine refuses them a ball. Literal ids and codes; made-up names and token.

const LINK = { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET };
const FIXTURE = 'fake-cricket';

let keys = 0;
/** A body for the next tap, under cricket's epoch (4) and the seed's rules version (0). */
function body(expected_seq: number, type: string, payload: object): AppendBody {
  keys += 1;
  return {
    expected_seq,
    type,
    payload,
    idempotency_key: `cricket-key-${keys}`,
    engine_epoch: 4,
    rules_version: 0,
  };
}

/** The first ball of the match: Riverside's 1 and 2 in, bowled by the Hillcrest player named. */
const firstBall = (bowler: string) =>
  body(2, 'cricket.ball', {
    over: 0,
    ballInOver: 1,
    striker: playerOf(HOME_ENTRANT, 1),
    nonStriker: playerOf(HOME_ENTRANT, 2),
    bowler,
    runs: { bat: 0 },
  });

describe('the fake serves cricket', () => {
  it('answers the bootstrap as a cricket match', async () => {
    const answer = await createFakeScoringPort(cricketSeed()).bootstrap(LINK);
    expect(answer).toMatchObject({ kind: 'ok', bootstrap: { sportKey: 'cricket' } });
  });

  it('folds each side’s team sheet: the bench player cannot bowl, the eleventh can', async () => {
    const port = createFakeScoringPort(cricketSeed());
    const toss = body(0, 'cricket.toss', { wonBy: HOME_ENTRANT, elected: 'bat' });
    expect(await port.append(LINK, FIXTURE, toss)).toMatchObject({ kind: 'accepted', seq: 1 });
    expect(await port.append(LINK, FIXTURE, body(1, 'core.start', {}))).toMatchObject({
      kind: 'accepted',
      seq: 2,
    });
    expect(await port.append(LINK, FIXTURE, firstBall(playerOf(AWAY_ENTRANT, 12)))).toMatchObject({
      kind: 'refused',
      status: 422,
    });
    expect(await port.append(LINK, FIXTURE, firstBall(playerOf(AWAY_ENTRANT, 11)))).toMatchObject({
      kind: 'accepted',
      seq: 3,
    });
  });

  it('the live seed is the toss, the start and three balls on the ledger', async () => {
    const events = await createFakeScoringPort(liveCricketSeed()).events(LINK, FIXTURE, 0);
    expect(Array.isArray(events) ? events.map((event) => event.type) : events).toEqual([
      'cricket.toss',
      'core.start',
      'cricket.ball',
      'cricket.ball',
      'cricket.ball',
    ]);
  });
});

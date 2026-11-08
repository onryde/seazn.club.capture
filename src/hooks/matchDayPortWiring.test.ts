import { describe, expect, it } from 'vitest';
import { matchDayPortFor } from '@/hooks/matchDayPortWiring';
import type { ScoringFetch } from '@/services/fetchScoringPort';
import { createLogger } from '@/services/logger';
import { createRingRecord } from '@/services/sessionRecord';
import { FIXTURE_DAY_TOKEN } from '../../test/fixtures/dayCode';

/** A server that is never reached, so what the port asked is all a test sees. */
function wiring(hosts: readonly string[]) {
  const asked: string[] = [];
  const fetch: ScoringFetch = async (url) => {
    asked.push(url);
    return { status: 503, headers: { get: () => null }, text: async () => '' };
  };
  const logger = createLogger({ record: createRingRecord(), now: () => 0 });
  return { port: matchDayPortFor({ fetch, logger, hosts }), asked };
}

/**
 * The inert seam (AGENTS §13, class 1): `createNativePorts` is not run by any test, so the rule it wires lives in this
 * one function and is tested here: the code's token goes only to the build's own host, `hosts[0]`, and a build that
 * has none sends nowhere.
 */
describe('which host the composition root’s Match Day port trusts', () => {
  it('the build’s own host, and no other', async () => {
    const { port, asked } = wiring(['stg.seazn.club']);
    await port.day({ origin: 'https://stg.seazn.club', token: FIXTURE_DAY_TOKEN });
    await port.day({ origin: 'https://seazn.club', token: FIXTURE_DAY_TOKEN });
    expect(asked).toEqual(['https://stg.seazn.club/api/v1/match-day-code']);
  });

  it('the production build’s host is production’s alone', async () => {
    const { port, asked } = wiring(['seazn.club']);
    await port.day({ origin: 'https://stg.seazn.club', token: FIXTURE_DAY_TOKEN });
    await port.day({ origin: 'https://seazn.club', token: FIXTURE_DAY_TOKEN });
    expect(asked).toEqual(['https://seazn.club/api/v1/match-day-code']);
  });

  // MD-2 Task 2b: review and approve left Task 3's offline stub; the port the app is given asks for them.
  it('asks the review and the approve on the build’s own host, not a stub', async () => {
    const { port, asked } = wiring(['stg.seazn.club']);
    const code = { origin: 'https://stg.seazn.club', token: FIXTURE_DAY_TOKEN };
    const stage = '6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
    await port.review(code, 'swiss', stage);
    await port.approve(code, 'draw', stage, 'h', null);
    expect(asked).toEqual([
      `https://stg.seazn.club/api/v1/match-day-code/approvals/swiss/${stage}`,
      `https://stg.seazn.club/api/v1/match-day-code/approvals/draw/${stage}`,
    ]);
  });

  it('a build with no host sends nowhere', async () => {
    const { port, asked } = wiring([]);
    const answer = await port.day({ origin: 'https://stg.seazn.club', token: FIXTURE_DAY_TOKEN });
    expect(answer).toEqual({ ok: false, offline: true });
    expect(asked).toEqual([]);
  });
});

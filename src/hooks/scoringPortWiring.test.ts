import { afterEach, describe, expect, it, vi } from 'vitest';
import { scoringPortFor } from '@/hooks/scoringPortWiring';
import type { ScoringFetch } from '@/services/fetchScoringPort';
import { createLogger } from '@/services/logger';
import { createServerClock } from '@/services/serverClock';
import { createRingRecord } from '@/services/sessionRecord';
import { FAKE_SCORING_SECRET } from '../../test/fakeScoringLinkPort';

const FIXTURE = '6f0c5a52-3d1e-4a0b-8f55-0c2f6d7b9e10';

/** A server that is never reached, so what the port asked is all a test sees. */
function wiring(hosts: readonly string[], headers: Readonly<Record<string, string>> = {}) {
  const asked: string[] = [];
  const fetch: ScoringFetch = async (url) => {
    asked.push(url);
    return { status: 503, headers: { get: (name) => headers[name] ?? null }, text: async () => '' };
  };
  const logger = createLogger({ record: createRingRecord(), now: () => 0 });
  const serverClock = createServerClock({ logger });
  return { port: scoringPortFor({ fetch, logger, hosts, serverClock }), asked, serverClock };
}

afterEach(() => vi.useRealTimers());

/**
 * The inert seam (AGENTS §13, class 1): `createNativePorts` is not run by any test, so the rule it wires lives in
 * this one function and is tested here: the port sends only to the build's own host, `hosts[0]`, and a build that has
 * none sends nowhere.
 */
describe('which host the composition root’s scoring port trusts', () => {
  it('the build’s own host, and no other', async () => {
    const { port, asked } = wiring(['stg.seazn.club']);
    const token = FAKE_SCORING_SECRET;
    await port.events({ origin: 'https://stg.seazn.club', token }, FIXTURE, 0);
    await port.events({ origin: 'https://seazn.club', token }, FIXTURE, 0);
    expect(asked).toEqual([`https://stg.seazn.club/api/v1/fixtures/${FIXTURE}/events?since_seq=0`]);
  });

  it('the production build’s host is production’s alone', async () => {
    const { port, asked } = wiring(['seazn.club']);
    const token = FAKE_SCORING_SECRET;
    await port.rules({ origin: 'https://stg.seazn.club', token }, FIXTURE);
    await port.rules({ origin: 'https://seazn.club', token }, FIXTURE);
    expect(asked).toEqual([`https://seazn.club/api/v1/fixtures/${FIXTURE}/rules`]);
  });

  it('a build with no host sends nowhere', async () => {
    const { port, asked } = wiring([]);
    const link = { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET };
    expect(await port.bootstrap(link)).toEqual({ kind: 'offline' });
    expect(asked).toEqual([]);
  });
});

/**
 * S2-5 design §7.2: the server clock in `Ports` is fed by this port's answers, or the football clock reads the
 * phone's own time for ever (the inert seam). On the device's clock (`Date.now`, frozen here by the fake timers at
 * 12:00:00Z), an answer whose `Date` says 12:01:00 samples 60 000 + 500.
 */
describe('which clock the composition root’s scoring port feeds', () => {
  it('the server clock it is given: each answer’s Date header moves its offset', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 10, 7, 12, 0, 0));
    const { port, serverClock } = wiring(['stg.seazn.club'], {
      Date: 'Sat, 07 Nov 2026 12:01:00 GMT',
    });
    expect(serverClock.offsetMs()).toBe(0);
    await port.rules({ origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET }, FIXTURE);
    expect(serverClock.offsetMs()).toBe(60_500);
  });
});

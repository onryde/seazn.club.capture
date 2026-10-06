import { describe, expect, it } from 'vitest';
import { chooseCodePort } from '@/hooks/codePortWiring';
import type { FetchLike } from '@/services/httpAsk';
import { createLogger } from '@/services/logger';
import { createRingRecord } from '@/services/sessionRecord';

const CODE = { code: 'fx42hmnp7k2q', slot: 1, token: 'tok-9f3c2a7e5b1d4680ab', expiresAt: null };
const ORIGIN = 'https://seazn.club';

/** A server that answers every ask offline, so a real check is told from the fake's sample. */
function wiring(input: { dev: boolean; fakeFlag: string | undefined }) {
  const asked: string[] = [];
  const fetch: FetchLike = async (url) => {
    asked.push(url);
    return { status: 503, headers: { get: () => null }, text: async () => '' };
  };
  const logger = createLogger({ record: createRingRecord(), now: () => 0 });
  const port = chooseCodePort({ ...input, origin: ORIGIN, fetch, logger });
  return { port, asked };
}

/**
 * D25, final review M1: a development build may opt into the fake code port
 * with `EXPO_PUBLIC_FAKE_CODE=1`; a release never can, whatever the flag. The
 * gate `chooseEngine` keeps for the engine (CD24), here for the code.
 */
describe('which code port the composition root wires', () => {
  it('a release build asks the server, whatever the flag', async () => {
    for (const fakeFlag of ['1', undefined]) {
      const { port, asked } = wiring({ dev: false, fakeFlag });
      expect(await port.check(CODE)).toEqual({ ok: false, error: { kind: 'offline' } });
      expect(asked).toEqual([`${ORIGIN}/api/v1/capture/codes/fx42hmnp7k2q?slot=1`]);
    }
  });

  it('a development build asks the server unless EXPO_PUBLIC_FAKE_CODE=1', async () => {
    for (const fakeFlag of [undefined, '0', 'true', '']) {
      const { port, asked } = wiring({ dev: true, fakeFlag });
      expect(await port.check(CODE)).toMatchObject({ ok: false });
      expect(asked, String(fakeFlag)).toHaveLength(1);
    }
  });

  it('a development build with the flag answers from the fake, on the build’s origin', async () => {
    const { port, asked } = wiring({ dev: true, fakeFlag: '1' });
    expect(await port.check(CODE)).toMatchObject({
      ok: true,
      value: { heartbeatUrl: `${ORIGIN}/api/v1/capture/codes/fx42hmnp7k2q/beats` },
    });
    expect(asked).toEqual([]);
    expect(port.codeUrl('fx42hmnp7k2q')).toBe(`${ORIGIN}/api/v1/capture/codes/fx42hmnp7k2q`);
  });
});

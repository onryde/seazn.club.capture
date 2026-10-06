import { describe, expect, it } from 'vitest';
import { parseWaitingFields, waitingToWire } from '@/domain/credentials/waitingFields';
import { err } from '@/domain/Result';
import { createFakeCodePort, sampleWaiting, SAMPLE_CODE } from '@/services/fakeCodePort';

const TOKEN = 'tok-fake-0000000000000';
const CODE = { code: SAMPLE_CODE, slot: 1, token: TOKEN, expiresAt: null };

describe('the fake code port', () => {
  it('answers the sample waiting fields for the code asked, and records the call without the token', async () => {
    const port = createFakeCodePort();
    expect(await port.check({ ...CODE, code: 'fx42hmnp7k77' })).toMatchObject({
      ok: true,
      value: { code: 'fx42hmnp7k77' },
    });
    expect(port.calls).toEqual([{ code: 'fx42hmnp7k77', slot: 1 }]);
    expect(JSON.stringify(port.calls)).not.toContain(TOKEN);
  });

  it('answers what it was told, in order, and holds an answer until released', async () => {
    const port = createFakeCodePort();
    port.answer(err({ kind: 'offline' }));
    expect(await port.check(CODE)).toEqual({ ok: false, error: { kind: 'offline' } });
    const release = port.hold();
    let settled = false;
    const held = port.check(CODE).then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    await held;
    expect(settled).toBe(true);
  });

  it("serves sample fields the real reader accepts, on the code's own D3 paths", () => {
    const sample = sampleWaiting({ code: 'fx42hmnp7k77' });
    expect(parseWaitingFields(waitingToWire(sample), 'stg.seazn.club')).toEqual(sample);
    expect(sample.heartbeatUrl).toBe(
      'https://stg.seazn.club/api/v1/capture/codes/fx42hmnp7k77/beats',
    );
    expect(sample.startUrl).toBe('https://stg.seazn.club/api/v1/capture/codes/fx42hmnp7k77/start');
    expect(createFakeCodePort().codeUrl(SAMPLE_CODE)).toBe(
      `https://stg.seazn.club/api/v1/capture/codes/${SAMPLE_CODE}`,
    );
  });

  // Final review M2: the fake answers on the origin it was built for, so a
  // production development build's fake names the production host throughout.
  it('answers on its own origin, which the real reader accepts for that host', async () => {
    const port = createFakeCodePort('https://seazn.club');
    const answer = await port.check(CODE);
    if (!answer.ok) throw new Error('the fake answered an error');
    expect(answer.value).toMatchObject({
      overlayUrl: 'https://seazn.club/overlay/fixtures/fake-fixture',
      heartbeatUrl: `https://seazn.club/api/v1/capture/codes/${SAMPLE_CODE}/beats`,
      startUrl: `https://seazn.club/api/v1/capture/codes/${SAMPLE_CODE}/start`,
    });
    expect(parseWaitingFields(waitingToWire(answer.value), 'seazn.club')).toEqual(answer.value);
    expect(port.codeUrl(SAMPLE_CODE)).toBe(
      `https://seazn.club/api/v1/capture/codes/${SAMPLE_CODE}`,
    );
  });
});

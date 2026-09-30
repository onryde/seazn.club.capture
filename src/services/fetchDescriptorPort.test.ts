import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createFetchDescriptorPort,
  DESCRIPTOR_TIMEOUT_MS,
  descriptorUrl,
  parseRetryAfter,
  type FetchLike,
  type FetchResponse,
} from '@/services/fetchDescriptorPort';
import { createLogger } from '@/services/logger';
import { createRingRecord } from '@/services/sessionRecord';
import {
  descriptorWire,
  FIXTURE_NOW,
  FIXTURE_SECRETS,
  FIXTURE_SID,
} from '../../test/fixtures/wire';

const TOKEN = 'fake-token-00000000000000000000';

function respond(
  status: number,
  body: unknown = null,
  headers: Record<string, string> = {},
): FetchResponse {
  return { status, headers: { get: (name) => headers[name] ?? null }, json: async () => body };
}

const STAGING = { origin: 'https://stg.seazn.club', hosts: ['stg.seazn.club'] } as const;
const PRODUCTION = { origin: 'https://seazn.club', hosts: ['seazn.club'] } as const;

function portOver(fetch: FetchLike, env: typeof STAGING | typeof PRODUCTION = STAGING) {
  const record = createRingRecord();
  const calls: Parameters<FetchLike>[] = [];
  const descriptor = createFetchDescriptorPort({
    ...env,
    fetch: (url, init) => {
      calls.push([url, init]);
      return fetch(url, init);
    },
    logger: createLogger({ record, now: () => 0 }),
    now: () => FIXTURE_NOW.getTime(),
  });
  return { ask: () => descriptor.fetch(FIXTURE_SID, TOKEN), calls, lines: () => record.lines() };
}

const answering =
  (response: FetchResponse): FetchLike =>
  async () =>
    response;

const errorLines = (lines: readonly string[]) =>
  lines.filter((line) => line.includes('"event":"descriptor.error"'));

describe('the fetch descriptor port', () => {
  afterEach(() => vi.useRealTimers());

  it('asks the provisional endpoint with the token as Bearer, never cached (D2)', async () => {
    const port = portOver(answering(respond(200, descriptorWire())));
    const answer = await port.ask();
    expect(answer).toMatchObject({
      ok: true,
      value: { sid: FIXTURE_SID, label: 'Seazn XI v Fake CC' },
    });
    expect(port.calls[0]?.[0]).toBe(
      `https://stg.seazn.club/api/capture/sessions/${FIXTURE_SID}/descriptor`,
    );
    expect(port.calls[0]?.[1]).toMatchObject({
      method: 'GET',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Cache-Control': 'no-store',
        Accept: 'application/json',
      },
    });
  });

  it.each([
    [401, { kind: 'invalid' }],
    [404, { kind: 'not-found' }],
    [500, { kind: 'offline' }],
    [503, { kind: 'offline' }],
    [302, { kind: 'offline' }],
  ])('maps %i to %j (D3)', async (status, error) => {
    expect(await portOver(answering(respond(status))).ask()).toEqual({ ok: false, error });
  });

  it.each([
    [{ endReason: 'no_inbound_timeout' }, 'no-inbound-timeout'],
    [{ endReason: 'stopped' }, 'stopped'],
    [null, 'unknown'],
  ])('reads a 410 body %j as ended by %s', async (body, endReason) => {
    const answer = await portOver(answering(respond(410, body))).ask();
    expect(answer).toEqual({ ok: false, error: { kind: 'ended', endReason } });
  });

  it('reads Retry-After on a 429', async () => {
    const answer = await portOver(answering(respond(429, null, { 'Retry-After': '30' }))).ask();
    expect(answer).toEqual({ ok: false, error: { kind: 'rate-limited', retryAfterS: 30 } });
  });

  it('refuses a descriptor for a different session (the sid guard, D3)', async () => {
    const other = descriptorWire({ sid: '5d9c1d0e-0000-4000-8000-00000000beef' });
    expect(await portOver(answering(respond(200, other))).ask()).toEqual({
      ok: false,
      error: { kind: 'invalid' },
    });
  });

  it('refuses a malformed 200, including a body that is not JSON', async () => {
    const notJson: FetchResponse = {
      ...respond(200),
      json: () => Promise.reject(new SyntaxError('x')),
    };
    expect(await portOver(answering(respond(200, { sid: FIXTURE_SID }))).ask()).toEqual({
      ok: false,
      error: { kind: 'invalid' },
    });
    expect(await portOver(answering(notJson)).ask()).toEqual({
      ok: false,
      error: { kind: 'invalid' },
    });
  });

  it('reads a 200 for a session already over as ended', async () => {
    const over = descriptorWire({ state: 'completed', endReason: 'stopped' });
    expect(await portOver(answering(respond(200, over))).ask()).toEqual({
      ok: false,
      error: { kind: 'ended', endReason: 'stopped' },
    });
  });

  it('calls a network failure offline', async () => {
    const port = portOver(() => Promise.reject(new TypeError('Network request failed')));
    expect(await port.ask()).toEqual({ ok: false, error: { kind: 'offline' } });
  });

  it('calls a server that never answers offline after 8 s (captive portal)', async () => {
    vi.useFakeTimers();
    const port = portOver(() => new Promise<FetchResponse>(() => undefined));
    const answer = port.ask();
    await vi.advanceTimersByTimeAsync(DESCRIPTOR_TIMEOUT_MS);
    expect(await answer).toEqual({ ok: false, error: { kind: 'offline' } });
  });

  it('calls a body that never finishes offline after 8 s', async () => {
    vi.useFakeTimers();
    const stuckBody: FetchResponse = { ...respond(200), json: () => new Promise(() => undefined) };
    const port = portOver(answering(stuckBody));
    const answer = port.ask();
    await vi.advanceTimersByTimeAsync(DESCRIPTOR_TIMEOUT_MS);
    expect(await answer).toEqual({ ok: false, error: { kind: 'offline' } });
  });

  it('is still waiting a moment before the deadline', async () => {
    vi.useFakeTimers();
    const port = portOver(() => new Promise<FetchResponse>(() => undefined));
    let settled = false;
    void port.ask().then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(DESCRIPTOR_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
  });

  it('aborts the request at the deadline, and records the timeout once, not the abort too', async () => {
    vi.useFakeTimers();
    let aborted = false;
    // A real fetch rejects once its signal aborts; that late rejection is not a second error.
    const abortable: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          aborted = true;
          reject(new Error('Aborted'));
        });
      });
    const port = portOver(abortable);
    const answer = port.ask();
    await vi.advanceTimersByTimeAsync(DESCRIPTOR_TIMEOUT_MS);
    expect(await answer).toEqual({ ok: false, error: { kind: 'offline' } });
    await vi.advanceTimersByTimeAsync(DESCRIPTOR_TIMEOUT_MS);
    expect(aborted).toBe(true);
    const errors = errorLines(port.lines());
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('"problem":"timeout"');
  });

  it('leaves no deadline timer behind once the server has answered', async () => {
    vi.useFakeTimers();
    const port = portOver(answering(respond(200, descriptorWire())));
    expect((await port.ask()).ok).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never rejects, even when the response itself throws', async () => {
    const broken: FetchResponse = {
      status: 429,
      headers: {
        get: () => {
          throw new Error('broken headers');
        },
      },
      json: async () => null,
    };
    expect(await portOver(answering(broken)).ask()).toEqual({
      ok: false,
      error: { kind: 'offline' },
    });
  });

  it('records every error and never the token', async () => {
    const port = portOver(answering(respond(401)));
    await port.ask();
    expect(port.lines().join('\n')).toContain('"event":"descriptor.error"');
    expect(port.lines().join('\n')).not.toContain(TOKEN);
  });

  it('puts the token in the header only: never in the URL, an error or the record', async () => {
    const answers: FetchLike[] = [
      answering(respond(401)),
      answering(respond(404)),
      answering(respond(410, { endReason: 'stopped' })),
      answering(respond(429, null, { 'Retry-After': 'soon' })),
      answering(respond(503)),
      answering(respond(200, { sid: FIXTURE_SID })),
      answering(respond(200, descriptorWire({ heartbeatUrl: 'https://evil.example/hb' }))),
      answering(respond(200, descriptorWire({ overlayUrl: 'https://evil.example/o' }))),
      () => Promise.reject(new Error(`Network request failed for ${TOKEN}`)),
    ];
    for (const fetch of answers) {
      const port = portOver(fetch);
      const answer = await port.ask();
      const seen = [port.calls[0]?.[0] ?? '', JSON.stringify(answer), ...port.lines()].join('\n');
      for (const secret of FIXTURE_SECRETS) expect(seen).not.toContain(secret);
    }
  });
});

describe('the fetch descriptor port: Seazn hosts only (ruling 6)', () => {
  const seazn = (host: string) => ({
    overlayUrl: `https://${host}/overlay/fixtures/fake-fixture`,
    heartbeatUrl: `https://${host}/api/capture/sessions/fake/heartbeat`,
  });

  it('keeps a staging descriptor on a staging build', async () => {
    const port = portOver(answering(respond(200, descriptorWire(seazn('stg.seazn.club')))));
    expect(await port.ask()).toMatchObject({
      ok: true,
      value: { overlayUrl: 'https://stg.seazn.club/overlay/fixtures/fake-fixture' },
    });
  });

  it('keeps a production descriptor on a production build', async () => {
    const wire = descriptorWire(seazn('seazn.club'));
    const port = portOver(answering(respond(200, wire)), PRODUCTION);
    expect(await port.ask()).toMatchObject({
      ok: true,
      value: {
        overlayUrl: 'https://seazn.club/overlay/fixtures/fake-fixture',
        heartbeatUrl: 'https://seazn.club/api/capture/sessions/fake/heartbeat',
      },
    });
    expect(port.calls[0]?.[0]).toBe(
      `https://seazn.club/api/capture/sessions/${FIXTURE_SID}/descriptor`,
    );
  });

  it('refuses a descriptor whose heartbeat is foreign: the heartbeat carries the Bearer', async () => {
    const wire = descriptorWire({ heartbeatUrl: 'https://evil.example/api/heartbeat' });
    const port = portOver(answering(respond(200, wire)));
    expect(await port.ask()).toEqual({ ok: false, error: { kind: 'invalid' } });
    const errors = errorLines(port.lines());
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('"problem":"foreign-heartbeat"');
  });

  it('shows no overlay when the overlay is foreign, like /relay, and says so in the record', async () => {
    const wire = descriptorWire({ overlayUrl: 'https://evil.example/overlay/fixtures/x' });
    const port = portOver(answering(respond(200, wire)));
    expect(await port.ask()).toMatchObject({ ok: true, value: { overlayUrl: null } });
    expect(port.lines().join('\n')).toContain('"event":"descriptor.overlay-dropped"');
  });

  it.each([
    ['a Seazn name with a foreign suffix', 'stg.seazn.club.evil.example'],
    ['a name that merely ends in the Seazn host', 'evilstg.seazn.club'],
  ])('refuses a heartbeat on %s, and drops an overlay there', async (_label, host) => {
    const heartbeat = descriptorWire({ heartbeatUrl: `https://${host}/hb` });
    expect(await portOver(answering(respond(200, heartbeat))).ask()).toEqual({
      ok: false,
      error: { kind: 'invalid' },
    });
    const overlay = descriptorWire({ overlayUrl: `https://${host}/overlay/fixtures/x` });
    expect(await portOver(answering(respond(200, overlay))).ask()).toMatchObject({
      ok: true,
      value: { overlayUrl: null },
    });
  });

  it('refuses a production heartbeat named evilseazn.club', async () => {
    const wire = descriptorWire({
      ...seazn('seazn.club'),
      heartbeatUrl: 'https://evilseazn.club/hb',
    });
    expect(await portOver(answering(respond(200, wire)), PRODUCTION).ask()).toEqual({
      ok: false,
      error: { kind: 'invalid' },
    });
  });

  it('keeps a proper subdomain of the Seazn host', async () => {
    const wire = descriptorWire(seazn('api.stg.seazn.club'));
    expect((await portOver(answering(respond(200, wire))).ask()).ok).toBe(true);
  });

  it('keeps no overlay when the descriptor already had none', async () => {
    const port = portOver(answering(respond(200, descriptorWire({ overlayUrl: null }))));
    expect(await port.ask()).toMatchObject({ ok: true, value: { overlayUrl: null } });
    expect(port.lines().join('\n')).not.toContain('overlay-dropped');
  });
});

describe('descriptorUrl', () => {
  it('keeps a hostile sid inside its own path segment', () => {
    expect(descriptorUrl('https://stg.seazn.club', 'a/../b?x=1#y')).toBe(
      'https://stg.seazn.club/api/capture/sessions/a%2F..%2Fb%3Fx%3D1%23y/descriptor',
    );
  });
});

describe('parseRetryAfter (D5)', () => {
  const now = FIXTURE_NOW.getTime();
  it.each([
    [null, 5],
    ['30', 30],
    [' 30 ', 30],
    ['0', 1],
    ['600', 120],
    ['soon', 5],
    ['-5', 5],
    ['1.5', 5],
    ['', 5],
    ['Sat, 03 Oct 2026 13:00:42 GMT', 42],
    ['Sat, 03 Oct 2026 12:00:00 GMT', 1],
    ['Sun, 04 Oct 2026 13:00:00 GMT', 120],
    // The shape of a date that is not one: never NaN, which would retry at once.
    ['Sat, 99 Oct 2026 13:00:00 GMT', 5],
  ])('reads %j as %i s', (value, seconds) => {
    expect(parseRetryAfter(value, now)).toBe(seconds);
  });
});

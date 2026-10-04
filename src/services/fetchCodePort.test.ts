import { afterEach, describe, expect, it, vi } from 'vitest';
import { CODE_TIMEOUT_MS, codeUrl, createFetchCodePort } from '@/services/fetchCodePort';
import type { FetchLike, FetchResponse } from '@/services/httpAsk';
import { createLogger } from '@/services/logger';
import { parseRecordLine, createRingRecord } from '@/services/sessionRecord';

// Made up, inside capture-qr.v2 and capture-descriptor.v1 (web 5bb72e8a2).
const TOKEN = 'tok-9f3c2a7e5b1d4680ab';
const CODE = { code: 'fx42hmnp7k2q', slot: 1, token: TOKEN, expiresAt: null };
const NOW = Date.parse('2026-10-03T13:00:00Z');

const waiting = (overrides: Record<string, unknown> = {}) => ({
  state: 'waiting',
  code: 'fx42hmnp7k2q',
  label: 'Example Town v Sample CC',
  venueTimezone: 'Europe/London',
  autoAllowed: true,
  destinationName: null,
  overlayUrl: 'https://stg.seazn.club/overlay/fixtures/f1',
  pollSeconds: 60,
  heartbeatUrl: 'https://stg.seazn.club/api/v1/capture/codes/fx42hmnp7k2q/beats',
  startUrl: 'https://stg.seazn.club/api/v1/capture/codes/fx42hmnp7k2q/start',
  ...overrides,
});

/** `$defs.refusal`: what the server sends with every refusal (capture-descriptor.v1). */
const refusalBody = (code: string) => ({ code, message: 'a developer string' });

const respond = (
  status: number,
  body: unknown = null,
  headers: Record<string, string> = {},
): FetchResponse => ({
  status,
  headers: { get: (name) => headers[name] ?? null },
  json: async () => body,
});

/** A captive portal's page, or an edge's: no JSON at all. */
const html = (status: number): FetchResponse => ({
  status,
  headers: { get: () => null },
  json: async () => {
    throw new SyntaxError('Unexpected token <');
  },
});

function portOver(fetch: FetchLike, origin = 'https://stg.seazn.club') {
  const record = createRingRecord();
  const calls: Parameters<FetchLike>[] = [];
  const port = createFetchCodePort({
    origin,
    fetch: (url, init) => {
      calls.push([url, init]);
      return fetch(url, init);
    },
    logger: createLogger({ record, now: () => 0 }),
    now: () => NOW,
  });
  const entries = () => record.lines().map(parseRecordLine);
  return { ask: () => port.check(CODE), port, calls, record, entries };
}

const answering =
  (response: FetchResponse): FetchLike =>
  async () =>
    response;

afterEach(() => vi.useRealTimers());

describe('the code port (amendment §2, the Home outcome table)', () => {
  it('asks GET code with ?slot= and no phone, the token as Bearer, never cached (D3)', async () => {
    const { ask, calls } = portOver(answering(respond(200, waiting())));
    await ask();
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0] ?? [];
    expect(url).toBe('https://stg.seazn.club/api/v1/capture/codes/fx42hmnp7k2q?slot=1');
    expect(url).not.toContain('phone');
    expect(url).not.toContain(TOKEN);
    expect(init).toMatchObject({
      method: 'GET',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Cache-Control': 'no-store' },
    });
  });

  it('reads a waiting answer and a session-shaped one alike', async () => {
    expect(await portOver(answering(respond(200, waiting()))).ask()).toMatchObject({
      ok: true,
      value: { code: 'fx42hmnp7k2q', pollSeconds: 60 },
    });
    const session = waiting({
      state: 'live',
      sid: '6f1c2b7a-3d4e-4f50-8a9b-0c1d2e3f4a5b',
      cred: { srt: null, rtmps: {} },
    });
    expect(await portOver(answering(respond(200, session))).ask()).toMatchObject({
      ok: true,
      value: { code: 'fx42hmnp7k2q' },
    });
  });

  // D5, D7, D18: the server's word, each only with its refusal JSON naming it (X1).
  it.each([
    [401, 'code_ended', { kind: 'ended' }],
    [404, 'not_a_stream_code', { kind: 'not-found' }],
    [410, 'code_ended', { kind: 'ended' }],
    [422, 'invalid', { kind: 'invalid' }],
    [503, 'unavailable', { kind: 'offline' }],
    [500, 'unavailable', { kind: 'offline' }],
  ])('reads %i %s as %o', async (status, word, error) => {
    const answer = await portOver(answering(respond(status, refusalBody(word)))).ask();
    expect(answer).toEqual({ ok: false, error });
  });

  // X1: a captive portal at a ground must never tell the operator their code ended.
  it.each([
    ['an HTML 401', html(401)],
    ['an empty 401', respond(401)],
    ['a 401 naming another word', respond(401, refusalBody('not_a_stream_code'))],
    ['an HTML 404', html(404)],
    ['a 404 with no code', respond(404, { message: 'not found' })],
    ['an HTML 410', html(410)],
    ['an empty 422', respond(422)],
    ['a 422 naming another word', respond(422, refusalBody('code_ended'))],
    ['an HTML 200', html(200)],
    ['a 200 with no JSON object', respond(200, null)],
    ['a 302 to a sign-in page', respond(302)],
  ])('reads %s as no connection', async (_why, response) => {
    const view = portOver(answering(response));
    expect(await view.ask()).toEqual({ ok: false, error: { kind: 'offline' } });
    expect(view.entries().map((entry) => entry.event)).toEqual(['code.error']);
  });

  it("reads 429's Retry-After, with or without a body", async () => {
    const answer = await portOver(answering(respond(429, null, { 'Retry-After': '7' }))).ask();
    expect(answer).toEqual({ ok: false, error: { kind: 'rate-limited', retryAfterS: 7 } });
    const bodied = respond(429, refusalBody('rate_limited'), { 'Retry-After': '120' });
    expect(await portOver(answering(bodied)).ask()).toEqual({
      ok: false,
      error: { kind: 'rate-limited', retryAfterS: 120 },
    });
  });

  it('refuses an answer for another code (the D3 guard, kept for the code)', async () => {
    const view = portOver(answering(respond(200, waiting({ code: 'fx42hmnp7k2r' }))));
    expect(await view.ask()).toEqual({ ok: false, error: { kind: 'invalid' } });
    expect(view.entries()[0]?.fields).toMatchObject({ problem: 'code-mismatch' });
  });

  it('refuses a 200 with an unknown state, no state, or a missing field', async () => {
    for (const body of [
      waiting({ state: 'paused' }),
      waiting({ state: undefined }),
      waiting({ label: undefined }),
    ]) {
      expect(await portOver(answering(respond(200, body))).ask()).toEqual({
        ok: false,
        error: { kind: 'invalid' },
      });
    }
  });

  it('refuses a beat URL off the build host whole, and drops a foreign overlay with a line', async () => {
    const foreignBeat = await portOver(
      answering(respond(200, waiting({ heartbeatUrl: 'https://evil.example/b' }))),
    ).ask();
    expect(foreignBeat).toEqual({ ok: false, error: { kind: 'invalid' } });
    const view = portOver(
      answering(respond(200, waiting({ overlayUrl: 'https://evil.example/o' }))),
    );
    expect(await view.ask()).toMatchObject({ ok: true, value: { overlayUrl: null } });
    expect(view.entries().map((entry) => entry.event)).toEqual(['code.overlay-dropped']);
  });

  it('says nothing in the record for a clean answer, an overlay null included', async () => {
    const view = portOver(answering(respond(200, waiting({ overlayUrl: null }))));
    expect(await view.ask()).toMatchObject({ ok: true });
    expect(view.record.lines()).toEqual([]);
  });

  it('reads production answers on the production host only', async () => {
    const prod = waiting({
      overlayUrl: null,
      heartbeatUrl: 'https://seazn.club/api/v1/capture/codes/fx42hmnp7k2q/beats',
      startUrl: 'https://seazn.club/api/v1/capture/codes/fx42hmnp7k2q/start',
    });
    const read = await portOver(answering(respond(200, prod)), 'https://seazn.club').ask();
    expect(read).toMatchObject({ ok: true });
    expect(await portOver(answering(respond(200, prod))).ask()).toEqual({
      ok: false,
      error: { kind: 'invalid' },
    });
  });

  it('calls a network failure offline, and a server that never answers offline after 8 s', async () => {
    expect(await portOver(async () => Promise.reject(new Error('down'))).ask()).toEqual({
      ok: false,
      error: { kind: 'offline' },
    });
    vi.useFakeTimers();
    const hung = portOver(() => new Promise<FetchResponse>(() => undefined));
    let settled = false;
    const answer = hung.ask().then((value) => {
      settled = true;
      return value;
    });
    await vi.advanceTimersByTimeAsync(CODE_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await answer).toEqual({ ok: false, error: { kind: 'offline' } });
    expect(hung.entries()[0]?.fields).toMatchObject({ problem: 'timeout' });
  });

  it('records every refusal by kind and status, and never the token or the code', async () => {
    const view = portOver(answering(respond(404, refusalBody('not_a_stream_code'))));
    await view.ask();
    expect(view.entries()).toEqual([
      expect.objectContaining({
        event: 'code.error',
        level: 'warn',
        fields: { kind: 'not-found', status: 404 },
      }),
    ]);
    const text = view.record.lines().join('\n');
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain('fx42hmnp7k2q');
  });

  it('holds no state between checks: a second check asks again', async () => {
    const view = portOver(answering(respond(200, waiting())));
    await view.ask();
    await view.ask();
    expect(view.calls).toHaveLength(2);
  });

  it("builds the code's URL for the saved code (D3), encoding the code", () => {
    expect(codeUrl('https://seazn.club', 'a b/c')).toBe(
      'https://seazn.club/api/v1/capture/codes/a%20b%2Fc',
    );
    expect(portOver(answering(respond(200))).port.codeUrl('fx42hmnp7k2q')).toBe(
      'https://stg.seazn.club/api/v1/capture/codes/fx42hmnp7k2q',
    );
  });
});

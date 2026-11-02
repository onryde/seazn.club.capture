import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppendBody } from '@/domain/scoring/wire';
import {
  EVENTS_TIMEOUT_MS,
  SCORING_MAX_BODY_BYTES,
  SCORING_TIMEOUT_MS,
  createFetchScoringPort,
  type ScoringFetch,
} from '@/services/fetchScoringPort';
import type { FetchResponse } from '@/services/httpAsk';
import { createLogger, type Logger } from '@/services/logger';
import type { ScoringLink } from '@/services/scoringPort';
import { SCRUBBED } from '@/services/scrub';
import { createRingRecord, parseRecordLine } from '@/services/sessionRecord';
import { FAKE_SCORING_SECRET } from '../../test/fakeScoringLinkPort';

/** Made up: the contract's shape, never a real link. The bearer the port sends and must never say. */
const TOKEN = FAKE_SCORING_SECRET;
const ORIGIN = 'https://stg.seazn.club';
const LINK: ScoringLink = { origin: ORIGIN, token: TOKEN };
const FIXTURE = '6f0c5a52-3d1e-4a0b-8f55-0c2f6d7b9e10';
const NOW = Date.parse('2026-11-02T10:00:00Z');

const ok = (data: unknown) => ({ ok: true, data, requestId: 'req-1' });
const failure = (code: string, extras: Record<string, unknown> = {}) => ({
  ok: false,
  error: { code, message: 'a developer string', ...extras },
  requestId: 'req-1',
});

const side = (entrant: string, name: string) => ({
  entrant_id: entrant,
  name,
  kind: 'individual',
  members: [{ person_id: `${entrant}-p`, full_name: name }],
  lineup: [{ person_id: `${entrant}-p`, pair_order: null }],
});
const BOOTSTRAP = ok({
  fixture_id: FIXTURE,
  link_id: 'link-1',
  sport_key: 'badminton',
  module_version: '1.0.0',
  cfg: { bestOf: 3 },
  rules_version: 2,
  engine_epoch_required: 2,
  screen: 'pad',
  view_only_reason: null,
  names: { competition: 'Spring Open 2026', division: null, round_label: null, ref: 'QF·1' },
  sides: { home: side('ent-home', 'A. Sharma'), away: side('ent-away', 'L. Chen') },
  state: { status: 'in_play', last_seq: 3 },
});

const EVENT = {
  id: 'ev-4',
  seq: 4,
  type: 'badminton.rally',
  payload: { wonBy: 'ent-home' },
  recorded_at: '2026-11-02T10:00:00.000Z',
  recorded_by: null,
  voids_event_id: null,
  device_link_id: 'link-1',
};

const BODY: AppendBody = {
  expected_seq: 3,
  type: 'badminton.rally',
  payload: { wonBy: 'ent-home' },
  idempotency_key: 'a2f4c3d1-7a60-4d5e-9b0c-1e2f3a4b5c6d',
  engine_epoch: 2,
  rules_version: 2,
};

const CREATED = ok({
  seq: 4,
  state_summary: {},
  outcome: null,
  status: 'in_play',
  event_id: 'ev-4',
  rules_version: 2,
});

const respond = (
  status: number,
  body: unknown = null,
  headers: Record<string, string> = {},
): FetchResponse => ({
  status,
  headers: { get: (name) => headers[name] ?? null },
  text: async () => JSON.stringify(body),
});

const raw = (status: number, text: string, url?: string): FetchResponse => ({
  status,
  headers: { get: () => null },
  text: async () => text,
  ...(url === undefined ? {} : { url }),
});

type Call = Parameters<ScoringFetch>;

function portOver(
  fetch: ScoringFetch,
  overrides: { logger?: Logger; host?: string; timeoutMs?: number } = {},
) {
  const calls: Call[] = [];
  const record = createRingRecord();
  const logger = overrides.logger ?? createLogger({ record, now: () => 0 });
  const port = createFetchScoringPort({
    fetch: (url, init) => {
      calls.push([url, init]);
      return fetch(url, init);
    },
    logger,
    host: overrides.host ?? 'stg.seazn.club',
    ...(overrides.timeoutMs === undefined ? {} : { timeoutMs: overrides.timeoutMs }),
    now: () => NOW,
  });
  const entries = () => record.lines().map(parseRecordLine);
  return { port, calls, record, entries };
}

const answering =
  (response: FetchResponse): ScoringFetch =>
  async () =>
    response;

afterEach(() => vi.useRealTimers());

describe('what each call asks', () => {
  it('bootstrap: GET /api/v1/device-link, the link’s token as Bearer, never cached, no redirect, no body', async () => {
    const { port, calls } = portOver(answering(respond(200, BOOTSTRAP)));
    await port.bootstrap(LINK);
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0];
    expect(url).toBe('https://stg.seazn.club/api/v1/device-link');
    expect(init.method).toBe('GET');
    expect(init.headers).toMatchObject({
      Authorization: `Bearer ${TOKEN}`,
      'Cache-Control': 'no-store',
      Accept: 'application/json',
    });
    expect(init.redirect).toBe('error');
    expect(init).not.toHaveProperty('body');
    expect(init.headers).not.toHaveProperty('Content-Type');
    expect(init.signal).toBeDefined();
  });

  it('events: GET the fixture’s events since a seq', async () => {
    const { port, calls } = portOver(answering(respond(200, ok([EVENT]))));
    await port.events(LINK, FIXTURE, 3);
    expect(calls[0][0]).toBe(
      `https://stg.seazn.club/api/v1/fixtures/${FIXTURE}/events?since_seq=3`,
    );
    expect(calls[0][1].method).toBe('GET');
    expect(calls[0][1].headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('rules: GET the fixture’s rules', async () => {
    const { port, calls } = portOver(
      answering(respond(200, ok({ cfg: { bestOf: 3 }, rules_version: 3, format_line: null }))),
    );
    await port.rules(LINK, FIXTURE);
    expect(calls[0][0]).toBe(`https://stg.seazn.club/api/v1/fixtures/${FIXTURE}/rules`);
  });

  it('append: POST the fixture’s events, the body exactly as the server reads it, as JSON', async () => {
    const { port, calls } = portOver(answering(respond(201, CREATED)));
    await port.append(LINK, FIXTURE, BODY);
    const [url, init] = calls[0];
    expect(url).toBe(`https://stg.seazn.club/api/v1/fixtures/${FIXTURE}/events`);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    });
    expect(init.redirect).toBe('error');
    expect(JSON.parse(init.body ?? 'null')).toEqual({
      expected_seq: 3,
      type: 'badminton.rally',
      payload: { wonBy: 'ent-home' },
      idempotency_key: 'a2f4c3d1-7a60-4d5e-9b0c-1e2f3a4b5c6d',
      engine_epoch: 2,
      rules_version: 2,
    });
  });

  it('realtime token: GET the public route for the fixture, the same Bearer', async () => {
    const grant = ok({
      token: 'rt',
      channel: `fixture:${FIXTURE}`,
      url: 'https://x.test',
      apikey: 'k',
    });
    const { port, calls } = portOver(answering(respond(200, grant)));
    await port.realtimeToken(LINK, FIXTURE);
    expect(calls[0][0]).toBe(
      `https://stg.seazn.club/api/v1/public/fixtures/${FIXTURE}/realtime-token`,
    );
    expect(calls[0][1].headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('puts a fixture id in the path as one segment, whatever it holds', async () => {
    const { port, calls } = portOver(answering(respond(200, ok([]))));
    await port.events(LINK, 'a/b?c#d', 0);
    expect(calls[0][0]).toBe(
      'https://stg.seazn.club/api/v1/fixtures/a%2Fb%3Fc%23d/events?since_seq=0',
    );
  });
});

describe('a fixture id in a path', () => {
  it('is one segment for the realtime route as well', async () => {
    const { port, calls } = portOver(answering(respond(200, ok(null))));
    await port.realtimeToken(LINK, 'a/b?c#d');
    expect(calls[0][0]).toBe(
      'https://stg.seazn.club/api/v1/public/fixtures/a%2Fb%3Fc%23d/realtime-token',
    );
  });
});

describe('what each call answers', () => {
  it('bootstrap: ok with the parsed bootstrap', async () => {
    const { port } = portOver(answering(respond(200, BOOTSTRAP)));
    const answer = await port.bootstrap(LINK);
    expect(answer).toMatchObject({
      kind: 'ok',
      bootstrap: { fixtureId: FIXTURE, screen: 'pad', lastSeq: 3 },
    });
  });

  it('events: the ledger, and an empty ledger is an empty list, not a failure', async () => {
    const full = await portOver(answering(respond(200, ok([EVENT])))).port.events(LINK, FIXTURE, 3);
    expect(full).toEqual([
      {
        id: 'ev-4',
        seq: 4,
        type: 'badminton.rally',
        payload: { wonBy: 'ent-home' },
        recordedAt: '2026-11-02T10:00:00.000Z',
        voids: null,
        deviceLinkId: 'link-1',
      },
    ]);
    const empty = await portOver(answering(respond(200, ok([])))).port.events(LINK, FIXTURE, 4);
    expect(empty).toEqual([]);
  });

  it('rules: the cfg, its version and the rules line', async () => {
    const { port } = portOver(
      answering(
        respond(200, ok({ cfg: { bestOf: 1 }, rules_version: 3, format_line: 'Best of 1' })),
      ),
    );
    expect(await port.rules(LINK, FIXTURE)).toEqual({
      cfg: { bestOf: 1 },
      rulesVersion: 3,
      formatLine: 'Best of 1',
    });
  });

  it('append: accepted, with the event id the server gave', async () => {
    const { port } = portOver(answering(respond(201, CREATED)));
    expect(await port.append(LINK, FIXTURE, BODY)).toEqual({
      kind: 'accepted',
      seq: 4,
      eventId: 'ev-4',
      rulesVersion: 2,
    });
  });

  it('realtime token: the grant, or null when the server has no url or key to give', async () => {
    const full = ok({ token: 'rt', channel: 'fixture:1', url: 'https://x.test', apikey: 'k' });
    expect(await portOver(answering(respond(200, full))).port.realtimeToken(LINK, FIXTURE)).toEqual(
      {
        token: 'rt',
        channel: 'fixture:1',
        url: 'https://x.test',
        apikey: 'k',
      },
    );
    const bare = ok({ token: 'rt', channel: 'fixture:1', url: null, apikey: null });
    expect(
      await portOver(answering(respond(200, bare))).port.realtimeToken(LINK, FIXTURE),
    ).toBeNull();
  });

  it.each([
    [409, failure('SEQ_CONFLICT', { current_seq: 41 }), { kind: 'seqConflict', currentSeq: 41 }],
    [
      409,
      failure('FIXTURE_RULES_CHANGED', { rules_version: 3 }),
      { kind: 'rulesChanged', rulesVersion: 3 },
    ],
    [426, failure('ENGINE_OUTDATED', { required: 3 }), { kind: 'outdated', required: 3 }],
    [401, failure('LINK_REVOKED'), { kind: 'linkDead', code: 'LINK_REVOKED' }],
    [422, failure('WRONG_PHASE'), { kind: 'refused', status: 422, code: 'WRONG_PHASE' }],
    [403, failure('FORBIDDEN'), { kind: 'refused', status: 403, code: 'FORBIDDEN' }],
  ])('append: %d is read by its envelope', async (status, body, expected) => {
    const { port } = portOver(answering(respond(status, body)));
    expect(await port.append(LINK, FIXTURE, BODY)).toEqual(expected);
  });

  it('every read says a dead link and a throttle the same way an append does', async () => {
    const dead = answering(respond(401, failure('LINK_EXPIRED')));
    const { port } = portOver(dead);
    const expected = { kind: 'linkDead', code: 'LINK_EXPIRED' };
    expect(await port.bootstrap(LINK)).toEqual(expected);
    expect(await port.events(LINK, FIXTURE, 0)).toEqual(expected);
    expect(await port.rules(LINK, FIXTURE)).toEqual(expected);
  });
});

describe('Retry-After', () => {
  it('a 429 waits for the seconds the header names', async () => {
    const throttled = respond(429, failure('RATE_LIMITED'), { 'Retry-After': '2' });
    const { port } = portOver(answering(throttled));
    expect(await port.append(LINK, FIXTURE, BODY)).toEqual({
      kind: 'rateLimited',
      retryAfterMs: 2000,
    });
  });

  it('a 429 reads an HTTP date against the clock it was given', async () => {
    const at = new Date(NOW + 30_000).toUTCString();
    const throttled = respond(429, failure('RATE_LIMITED'), { 'Retry-After': at });
    const { port } = portOver(answering(throttled));
    expect(await port.append(LINK, FIXTURE, BODY)).toEqual({
      kind: 'rateLimited',
      retryAfterMs: 30_000,
    });
  });

  it('a 429 with no usable header waits the contract’s 5 s, and never more than 2 minutes', async () => {
    const none = portOver(answering(respond(429, failure('RATE_LIMITED'))));
    expect(await none.port.append(LINK, FIXTURE, BODY)).toEqual({
      kind: 'rateLimited',
      retryAfterMs: 5000,
    });
    const huge = respond(429, failure('RATE_LIMITED'), { 'Retry-After': '99999' });
    expect(await portOver(answering(huge)).port.append(LINK, FIXTURE, BODY)).toEqual({
      kind: 'rateLimited',
      retryAfterMs: 120_000,
    });
  });
});

describe('what is no answer from the server: offline, so a tap stays queued', () => {
  const offline = { kind: 'offline' };

  it('a rejected fetch: no network', async () => {
    const { port } = portOver(async () => {
      throw new Error('Network request failed');
    });
    expect(await port.append(LINK, FIXTURE, BODY)).toEqual(offline);
    expect(await port.events(LINK, FIXTURE, 0)).toEqual(offline);
    expect(await port.bootstrap(LINK)).toEqual(offline);
    expect(await port.rules(LINK, FIXTURE)).toEqual(offline);
    expect(await port.realtimeToken(LINK, FIXTURE)).toBeNull();
  });

  it('a fetch that never answers: offline after 8 s, the request aborted', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const { port } = portOver((_url, init) => {
      signal = init.signal;
      return new Promise<FetchResponse>(() => {});
    });
    const pending = port.append(LINK, FIXTURE, BODY);
    await vi.advanceTimersByTimeAsync(SCORING_TIMEOUT_MS - 1);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual(offline);
    expect(signal?.aborted).toBe(true);
    expect(SCORING_TIMEOUT_MS).toBe(8000);
  });

  it('a body that trickles after the headers is bounded too', async () => {
    vi.useFakeTimers();
    const { port } = portOver(async () => ({
      status: 201,
      headers: { get: () => null },
      text: () => new Promise<string>(() => {}),
    }));
    const pending = port.append(LINK, FIXTURE, BODY);
    await vi.advanceTimersByTimeAsync(SCORING_TIMEOUT_MS);
    expect(await pending).toEqual(offline);
  });

  it('append: a body over 64 KiB is no answer, never one cut short: the tap goes again with its key', async () => {
    const big = JSON.stringify(ok({ pad: 'x'.repeat(64 * 1024) }));
    const { port, entries } = portOver(answering(raw(201, big)));
    expect(await port.append(LINK, FIXTURE, BODY)).toEqual(offline);
    expect(entries()[0].fields).toMatchObject({
      op: 'append',
      kind: 'offline',
      problem: 'too-large',
    });
  });

  it('append: a valid 201 over 64 KiB is no answer either: the cap is on the size, not on what it holds', async () => {
    const padding = ' '.repeat(64 * 1024);
    const accepted = portOver(answering(raw(201, `${JSON.stringify(CREATED)}${padding}`)));
    expect(await accepted.port.append(LINK, FIXTURE, BODY)).toEqual(offline);
  });

  it('rules: over 64 KiB is tooLarge, not offline: the network is not what is wrong', async () => {
    const big = JSON.stringify(
      ok({ cfg: { pad: 'x'.repeat(64 * 1024) }, rules_version: 3, format_line: null }),
    );
    const { port, entries } = portOver(answering(raw(200, big)));
    expect(await port.rules(LINK, FIXTURE)).toEqual({ kind: 'tooLarge' });
    expect(entries()[0].fields).toMatchObject({
      op: 'rules',
      kind: 'tooLarge',
      problem: 'too-large',
    });
  });

  it('realtime grant: over 64 KiB is no grant, the larger cap is not its', async () => {
    const text = JSON.stringify(
      ok({ token: 'rt', channel: 'fixture:1', url: 'https://x.test', apikey: 'k' }),
    );
    const padded = `${text}${' '.repeat(64 * 1024)}`;
    expect(
      await portOver(answering(raw(200, padded))).port.realtimeToken(LINK, FIXTURE),
    ).toBeNull();
  });

  it('the scoring cap is 1 MiB, for events and the bootstrap only', () => {
    expect(SCORING_MAX_BODY_BYTES).toBe(1048576);
  });

  // A long match: 400 events of a real payload's size are well over the 64 KiB every other answer is held to.
  it('events: a 400-event ledger (over 64 KiB) is read whole', async () => {
    const ledger = Array.from({ length: 400 }, (_, i) => ({
      ...EVENT,
      id: `ev-${i + 1}`,
      seq: i + 1,
      payload: { wonBy: 'ent-home', note: 'x'.repeat(200) },
    }));
    const text = JSON.stringify(ok(ledger));
    expect(text.length).toBeGreaterThan(64 * 1024);
    const { port } = portOver(answering(raw(200, text)));
    const events = await port.events(LINK, FIXTURE, 0);
    expect(Array.isArray(events) && events.length).toBe(400);
    expect(Array.isArray(events) && events[399].seq).toBe(400);
  });

  it('bootstrap: one over 64 KiB (a long cfg) is read', async () => {
    const heavy = ok({
      ...(BOOTSTRAP.data as Record<string, unknown>),
      cfg: { pad: 'x'.repeat(100 * 1024) },
    });
    const { port } = portOver(answering(raw(200, JSON.stringify(heavy))));
    expect(await port.bootstrap(LINK)).toMatchObject({ kind: 'ok' });
  });

  it('events and bootstrap: a body at 1 MiB exactly is read, one byte over is tooLarge', async () => {
    const text = JSON.stringify(ok([]));
    const exact = `${text}${' '.repeat(SCORING_MAX_BODY_BYTES - text.length)}`;
    expect(exact.length).toBe(SCORING_MAX_BODY_BYTES);
    expect(await portOver(answering(raw(200, exact))).port.events(LINK, FIXTURE, 0)).toEqual([]);
    const over = portOver(answering(raw(200, `${exact} `)));
    expect(await over.port.events(LINK, FIXTURE, 0)).toEqual({ kind: 'tooLarge' });
    expect(await over.port.bootstrap(LINK)).toEqual({ kind: 'tooLarge' });
    expect(over.entries()[0].fields).toMatchObject({
      op: 'events',
      kind: 'tooLarge',
      problem: 'too-large',
    });
  });

  it('the cap counts bytes, not characters', async () => {
    const text = JSON.stringify(ok([]));
    const pad = Math.ceil((SCORING_MAX_BODY_BYTES - text.length) / 3) + 1;
    const wide = `${text}${'€'.repeat(pad)}`;
    expect(wide.length).toBeLessThan(SCORING_MAX_BODY_BYTES);
    expect(await portOver(answering(raw(200, wide))).port.events(LINK, FIXTURE, 0)).toEqual({
      kind: 'tooLarge',
    });
  });

  it('events have 15 s, the longest of the calls: the ledger of a long match is the big answer', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const { port } = portOver((_url, init) => {
      signal = init.signal;
      return new Promise<FetchResponse>(() => {});
    });
    const pending = port.events(LINK, FIXTURE, 0);
    await vi.advanceTimersByTimeAsync(SCORING_TIMEOUT_MS);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(EVENTS_TIMEOUT_MS - SCORING_TIMEOUT_MS - 1);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual(offline);
    expect(signal?.aborted).toBe(true);
    expect(EVENTS_TIMEOUT_MS).toBe(15000);
  });

  it('an events body that trickles is bounded at the 15 s too', async () => {
    vi.useFakeTimers();
    const { port } = portOver(async () => ({
      status: 200,
      headers: { get: () => null },
      text: () => new Promise<string>(() => {}),
    }));
    const pending = port.events(LINK, FIXTURE, 0);
    await vi.advanceTimersByTimeAsync(EVENTS_TIMEOUT_MS);
    expect(await pending).toEqual(offline);
  });

  it('bootstrap, rules and the realtime grant keep the 8 s', async () => {
    vi.useFakeTimers();
    const { port } = portOver(() => new Promise<FetchResponse>(() => {}));
    const pending = [
      port.bootstrap(LINK),
      port.rules(LINK, FIXTURE),
      port.realtimeToken(LINK, FIXTURE),
    ];
    await vi.advanceTimersByTimeAsync(SCORING_TIMEOUT_MS);
    expect(await pending[0]).toEqual(offline);
    expect(await pending[1]).toEqual(offline);
    expect(await pending[2]).toBeNull();
  });

  it('a build’s own timeout shortens every call, events too', async () => {
    vi.useFakeTimers();
    const { port } = portOver(() => new Promise<FetchResponse>(() => {}), { timeoutMs: 100 });
    const pending = port.events(LINK, FIXTURE, 0);
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toEqual(offline);
  });

  // Nothing in a call may reject: the sender awaits it, and a rejection would stop the queue for good.
  it('a body JSON cannot hold is offline with no request made, never a rejection', async () => {
    const { port, calls, entries } = portOver(answering(respond(201, CREATED)));
    const bad = { ...BODY, payload: { n: 10n } } as unknown as AppendBody;
    await expect(port.append(LINK, FIXTURE, bad)).resolves.toEqual(offline);
    expect(calls).toHaveLength(0);
    expect(entries()[0].fields).toMatchObject({
      op: 'append',
      kind: 'offline',
      problem: 'unexpected',
    });
  });

  it('a fixture id encodeURIComponent cannot take (a lone surrogate) never rejects, for any call', async () => {
    const { port, calls } = portOver(answering(respond(200, ok([]))));
    const lone = '\uD800';
    await expect(port.events(LINK, lone, 0)).resolves.toEqual(offline);
    await expect(port.rules(LINK, lone)).resolves.toEqual(offline);
    await expect(port.append(LINK, lone, BODY)).resolves.toEqual(offline);
    await expect(port.realtimeToken(LINK, lone)).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('a build can shorten the 8 s', async () => {
    vi.useFakeTimers();
    const { port } = portOver(() => new Promise<FetchResponse>(() => {}), { timeoutMs: 100 });
    const pending = port.rules(LINK, FIXTURE);
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toEqual(offline);
  });

  it('a body at 64 KiB exactly is read', async () => {
    const text = JSON.stringify(ok([]));
    const padded = `${text}${' '.repeat(64 * 1024 - text.length)}`;
    expect(padded.length).toBe(64 * 1024);
    const { port } = portOver(answering(raw(200, padded)));
    expect(await port.events(LINK, FIXTURE, 0)).toEqual([]);
  });

  it('a redirect the platform followed (the answer’s URL is not the one asked): offline', async () => {
    const elsewhere = raw(201, JSON.stringify(CREATED), 'https://portal.example/login');
    const { port } = portOver(answering(elsewhere));
    expect(await port.append(LINK, FIXTURE, BODY)).toEqual(offline);
  });

  it('an answer whose URL is the one asked, or that says none, is read', async () => {
    const url = `https://stg.seazn.club/api/v1/fixtures/${FIXTURE}/events`;
    const same = portOver(answering(raw(201, JSON.stringify(CREATED), url)));
    expect(await same.port.append(LINK, FIXTURE, BODY)).toMatchObject({ kind: 'accepted' });
    const blank = portOver(answering(raw(201, JSON.stringify(CREATED), '')));
    expect(await blank.port.append(LINK, FIXTURE, BODY)).toMatchObject({ kind: 'accepted' });
  });

  it('a captive portal’s page under any status: never a refusal', async () => {
    const page = '<!doctype html><title>Sign in to the venue Wi-Fi</title>';
    for (const status of [200, 201, 401, 403, 404, 409, 422, 426, 429, 500]) {
      const { port } = portOver(answering(raw(status, page)));
      expect(await port.append(LINK, FIXTURE, BODY)).toEqual(offline);
      expect(await port.bootstrap(LINK)).toEqual(offline);
    }
  });

  it('a 200 that is not the shape asked for: offline, for each read', async () => {
    const { port } = portOver(answering(respond(200, ok({ unexpected: true }))));
    expect(await port.bootstrap(LINK)).toEqual(offline);
    expect(await port.events(LINK, FIXTURE, 0)).toEqual(offline);
    expect(await port.rules(LINK, FIXTURE)).toEqual(offline);
  });

  it('a read answered 201 is no read: a status this call never gets is offline', async () => {
    const { port } = portOver(answering(respond(201, BOOTSTRAP)));
    expect(await port.bootstrap(LINK)).toEqual(offline);
  });

  it('a body that cannot be read at all: offline', async () => {
    const { port } = portOver(async () => ({
      status: 201,
      headers: { get: () => null },
      text: async () => {
        throw new Error('stream closed');
      },
    }));
    expect(await port.append(LINK, FIXTURE, BODY)).toEqual(offline);
  });

  it('a 5xx, with the envelope or without: offline', async () => {
    const { port } = portOver(answering(respond(503, failure('UNAVAILABLE'))));
    expect(await port.append(LINK, FIXTURE, BODY)).toEqual(offline);
  });
});

describe('the token goes only to the build’s Seazn host', () => {
  const never = async (): Promise<FetchResponse> => {
    throw new Error('this must never be fetched');
  };

  it.each([
    ['another host', 'https://evil.example'],
    ['a longer host that starts like it', 'https://stg.seazn.club.evil.example'],
    ['the production host on a staging build', 'https://seazn.club'],
    ['userinfo that names it', 'https://stg.seazn.club@evil.example'],
    ['plain http', 'http://stg.seazn.club'],
    ['a port', 'https://stg.seazn.club:8443'],
    ['a path', 'https://stg.seazn.club/x'],
    ['a trailing slash', 'https://stg.seazn.club/'],
    ['nothing', ''],
  ])('%s: no call is made, whichever it is', async (_name, origin) => {
    const { port, calls } = portOver(never);
    const link = { origin, token: TOKEN };
    expect(await port.bootstrap(link)).toEqual({ kind: 'offline' });
    expect(await port.events(link, FIXTURE, 0)).toEqual({ kind: 'offline' });
    expect(await port.rules(link, FIXTURE)).toEqual({ kind: 'offline' });
    expect(await port.append(link, FIXTURE, BODY)).toEqual({ kind: 'offline' });
    expect(await port.realtimeToken(link, FIXTURE)).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('a build with no host trusts none', async () => {
    const { port, calls } = portOver(never, { host: '' });
    expect(await port.bootstrap({ origin: 'https://', token: TOKEN })).toEqual({ kind: 'offline' });
    expect(await port.bootstrap({ origin: '', token: TOKEN })).toEqual({ kind: 'offline' });
    expect(calls).toHaveLength(0);
  });

  it('the production build’s own host is the host it sends to', async () => {
    const { port, calls } = portOver(answering(respond(200, ok([]))), { host: 'seazn.club' });
    await port.events({ origin: 'https://seazn.club', token: TOKEN }, FIXTURE, 0);
    expect(calls[0][0]).toBe(`https://seazn.club/api/v1/fixtures/${FIXTURE}/events?since_seq=0`);
  });
});

/** Every argument any logger method received, as one string: the token is in none of it. */
function spyLogger() {
  const spies = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    protect: vi.fn(),
    protectLink: vi.fn(),
    release: vi.fn(),
  };
  // protectLink is handed the token on purpose: it is how the record learns to mask it.
  const everything = () =>
    JSON.stringify(
      Object.entries(spies)
        .filter(([name]) => name !== 'protectLink')
        .map(([, spy]) => spy.mock.calls),
    );
  return { logger: spies satisfies Logger, spies, everything };
}

describe('the record', () => {
  const lost = async (): Promise<FetchResponse> => {
    throw new Error(`Network request failed for ${TOKEN}`);
  };

  it('never carries the token or the bearer, whatever fails', async () => {
    const { logger, everything } = spyLogger();
    const echo = failure('REFUSED_FOR_TEST', { message: `bad bearer ${TOKEN}` });
    const answers: ScoringFetch[] = [
      lost,
      answering(respond(422, echo)),
      answering(respond(403, failure(TOKEN))),
      answering(respond(401, failure('LINK_REVOKED'))),
      answering(respond(429, failure('RATE_LIMITED'))),
      answering(raw(201, `<html>${TOKEN}</html>`)),
    ];
    for (const answer of answers) {
      const { port } = portOver(answer, { logger });
      await port.append(LINK, FIXTURE, BODY);
      await port.bootstrap(LINK);
      await port.events(LINK, FIXTURE, 0);
      await port.rules(LINK, FIXTURE);
      await port.realtimeToken(LINK, FIXTURE);
    }
    const said = everything();
    expect(said).not.toContain(TOKEN);
    expect(said).not.toContain('Bearer');
    expect(said).not.toContain('bad bearer');
  });

  it('says a failure in the record, never silently: the call, what it came to and its status', async () => {
    const { port, entries } = portOver(answering(respond(422, failure('WRONG_PHASE'))));
    await port.append(LINK, FIXTURE, BODY);
    expect(entries()).toEqual([
      expect.objectContaining({
        level: 'warn',
        event: 'scoring.answer',
        fields: expect.objectContaining({
          op: 'append',
          kind: 'refused',
          status: 422,
          word: 'WRONG_PHASE',
        }),
      }),
    ]);
  });

  it('says why a call came to nothing: the problem, with no URL and no message', async () => {
    const { port, entries } = portOver(lost);
    await port.events(LINK, FIXTURE, 0);
    expect(entries()).toEqual([
      expect.objectContaining({
        level: 'warn',
        event: 'scoring.answer',
        fields: expect.objectContaining({ op: 'events', kind: 'offline', problem: 'network' }),
      }),
    ]);
  });

  it('says a 201 it cannot read as unreadable, and a refusal with no problem at all', async () => {
    const garbled = portOver(answering(raw(201, '{"ok":true,"data":{}}')));
    await garbled.port.append(LINK, FIXTURE, BODY);
    expect(garbled.entries()).toEqual([
      expect.objectContaining({
        fields: expect.objectContaining({
          op: 'append',
          kind: 'offline',
          status: 201,
          problem: 'unreadable',
        }),
      }),
    ]);
    const refused = portOver(answering(respond(422, failure('WRONG_PHASE'))));
    await refused.port.append(LINK, FIXTURE, BODY);
    expect(refused.entries()[0].fields).not.toHaveProperty('problem');
  });

  it('says nothing for an answer that is a success', async () => {
    const { port, entries } = portOver(answering(respond(201, CREATED)));
    await port.append(LINK, FIXTURE, BODY);
    expect(entries()).toEqual([]);
  });

  it('names a refusal’s word only when it looks like a code, never a free string', async () => {
    const { port, entries } = portOver(answering(respond(422, failure(TOKEN))));
    await port.append(LINK, FIXTURE, BODY);
    const [entry] = entries();
    expect(entry.fields).toMatchObject({ op: 'append', kind: 'refused', status: 422 });
    expect(entry.fields).not.toHaveProperty('word');
  });
});

describe('the record, in a run of the same failure', () => {
  const lost = async (): Promise<FetchResponse> => {
    throw new Error('Network request failed');
  };
  const answers = (entries: () => ReturnType<typeof parseRecordLine>[], event: string) =>
    entries().filter((entry) => entry.event === event);

  it('says the first failure, counts the repeats, and says the count when the run ends', async () => {
    let reply: ScoringFetch = lost;
    const { port, entries } = portOver((url, init) => reply(url, init));
    for (let poll = 0; poll < 4; poll += 1) await port.events(LINK, FIXTURE, 0);
    expect(answers(entries, 'scoring.answer')).toHaveLength(1);
    expect(answers(entries, 'scoring.answer.repeat')).toHaveLength(0);
    reply = answering(respond(200, ok([])));
    await port.events(LINK, FIXTURE, 0);
    const repeats = answers(entries, 'scoring.answer.repeat');
    expect(repeats).toHaveLength(1);
    expect(repeats[0].fields).toMatchObject({
      op: 'events',
      kind: 'offline',
      problem: 'network',
      count: 3,
    });
  });

  it('a failure after the run is a new line, and a run of one has no count line', async () => {
    let reply: ScoringFetch = lost;
    const { port, entries } = portOver((url, init) => reply(url, init));
    await port.events(LINK, FIXTURE, 0);
    reply = answering(respond(200, ok([])));
    await port.events(LINK, FIXTURE, 0);
    reply = lost;
    await port.events(LINK, FIXTURE, 0);
    expect(answers(entries, 'scoring.answer')).toHaveLength(2);
    expect(answers(entries, 'scoring.answer.repeat')).toHaveLength(0);
  });

  it('a different failure ends the run: the count first, then the new line', async () => {
    let reply: ScoringFetch = lost;
    const { port, entries } = portOver((url, init) => reply(url, init));
    for (let call = 0; call < 3; call += 1) await port.append(LINK, FIXTURE, BODY);
    reply = answering(respond(422, failure('WRONG_PHASE')));
    await port.append(LINK, FIXTURE, BODY);
    expect(entries().map((entry) => [entry.event, entry.fields.kind, entry.fields.count])).toEqual([
      ['scoring.answer', 'offline', undefined],
      ['scoring.answer.repeat', 'offline', 2],
      ['scoring.answer', 'refused', undefined],
    ]);
  });

  it('keeps a run for each call: a poll of events does not break the run of rules', async () => {
    const { port, entries } = portOver(lost);
    await port.events(LINK, FIXTURE, 0);
    await port.rules(LINK, FIXTURE);
    await port.events(LINK, FIXTURE, 0);
    await port.rules(LINK, FIXTURE);
    expect(answers(entries, 'scoring.answer').map((entry) => entry.fields.op)).toEqual([
      'events',
      'rules',
    ]);
  });

  it('an accepted append ends the run too: a failure after it is said again', async () => {
    let reply: ScoringFetch = lost;
    const { port, entries } = portOver((url, init) => reply(url, init));
    await port.append(LINK, FIXTURE, BODY);
    await port.append(LINK, FIXTURE, BODY);
    reply = answering(respond(201, CREATED));
    await port.append(LINK, FIXTURE, BODY);
    reply = lost;
    await port.append(LINK, FIXTURE, BODY);
    expect(entries().map((entry) => [entry.event, entry.fields.count])).toEqual([
      ['scoring.answer', undefined],
      ['scoring.answer.repeat', 1],
      ['scoring.answer', undefined],
    ]);
  });

  it('a refusal that repeats is counted like any other, with its word and status', async () => {
    const { port, entries } = portOver(answering(respond(422, failure('WRONG_PHASE'))));
    await port.append(LINK, FIXTURE, BODY);
    await port.append(LINK, FIXTURE, BODY);
    await port.append(LINK, FIXTURE, BODY);
    const accepted = portOver(answering(respond(201, CREATED)));
    expect(answers(entries, 'scoring.answer')).toHaveLength(1);
    expect(accepted.entries()).toEqual([]);
  });

  it('the same failure with another status is another line', async () => {
    let status = 422;
    const { port, entries } = portOver(async () => respond(status, failure('WRONG_PHASE')));
    await port.append(LINK, FIXTURE, BODY);
    status = 409;
    await port.append(LINK, FIXTURE, BODY);
    expect(answers(entries, 'scoring.answer')).toHaveLength(2);
  });
});

describe('the link’s token and the record', () => {
  it('the logger is handed the token before every call, one it will not even make included', async () => {
    const { logger, spies } = spyLogger();
    const { port } = portOver(answering(respond(200, ok([]))), { logger });
    await port.bootstrap(LINK);
    await port.events(LINK, FIXTURE, 0);
    await port.rules(LINK, FIXTURE);
    await port.append(LINK, FIXTURE, BODY);
    await port.realtimeToken(LINK, FIXTURE);
    expect(spies.protectLink.mock.calls).toEqual([[TOKEN], [TOKEN], [TOKEN], [TOKEN], [TOKEN]]);
    const foreign = { origin: 'https://evil.example', token: `${TOKEN}-foreign` };
    await port.events(foreign, FIXTURE, 0);
    expect(spies.protectLink).toHaveBeenLastCalledWith(`${TOKEN}-foreign`);
  });

  it('is handed it before the request is built: a call that throws while building has it too', async () => {
    const { logger, spies } = spyLogger();
    const { port } = portOver(answering(respond(200, ok([]))), { logger });
    await port.events(LINK, '\uD800', 0);
    expect(spies.protectLink).toHaveBeenCalledWith(TOKEN);
  });

  // A made-up token that is not `dl_`-shaped, so only protectLink (never the scrubber's own pattern) can mask it.
  it('the record masks the token from the first call on, wherever else it turns up in text', async () => {
    const token = 'zz-test-token-not-link-shaped-0123456789';
    const record = createRingRecord();
    const logger = createLogger({ record, now: () => 0 });
    // A session in hand, so free text is masked by value and not whole (logger.test.ts does the same).
    logger.protect({ secrets: ['tok-test-0000000000000'], streamIds: [] });
    const probe = () => logger.info('probe', { message: `x ${token} y` });
    probe();
    const { port } = portOver(answering(respond(200, ok([]))), { logger });
    await port.events({ origin: ORIGIN, token }, FIXTURE, 0);
    probe();
    const [before, after] = record
      .lines()
      .map(parseRecordLine)
      .filter((entry) => entry.event === 'probe');
    expect(before.fields.message).toBe(`x ${token} y`);
    expect(after.fields.message).toBe(`x ${SCRUBBED} y`);
  });
});

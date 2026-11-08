import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SavedDayCode } from '@/domain/mode/dayCode';
import {
  MATCHDAY_DAY_MAX_BYTES,
  MATCHDAY_TIMEOUT_MS,
  createFetchMatchDayPort,
} from '@/services/fetchMatchDayPort';
import type { ScoringFetch } from '@/services/fetchScoringPort';
import { MAX_BODY_BYTES, type FetchResponse } from '@/services/httpAsk';
import { createLogger, type Logger } from '@/services/logger';
import { createRingRecord, parseRecordLine } from '@/services/sessionRecord';
import { FIXTURE_DAY_TOKEN } from '../../test/fixtures/dayCode';
import { answered, fixtureOf, refusedWith } from '../../test/matchDayContracts';

/** Made up: the shape the web mints, never a real code. The bearer the port sends and must never say. */
const TOKEN = FIXTURE_DAY_TOKEN;
const ORIGIN = 'https://stg.seazn.club';
const CODE: SavedDayCode = { origin: ORIGIN, token: TOKEN };
const FIXTURE = '7b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e';
/** A made-up scoring link's secret on the build's host: `dl_` and 43 base64url characters. */
const LINK_SECRET = 'dl_Fake-Link_0123456789abcdefghijklmnopqrstuvw';
const LINK = `${ORIGIN}/score/${LINK_SECRET}`;
const DAY_URL = `${ORIGIN}/api/v1/match-day-code`;
const OPEN_URL = `${DAY_URL}/fixtures/${FIXTURE}/scoring-link`;

const DAY = answered(fixtureOf('capture-matchday-day.v1', 'valid-courts'));
const refusal = (code: string, extras: Record<string, unknown> = {}) =>
  refusedWith({ code, message: 'a developer string', ...extras });

const respond = (status: number, body: unknown = null): FetchResponse => ({
  status,
  headers: { get: () => null },
  text: async () => JSON.stringify(body),
});

const raw = (status: number, text: string, url?: string): FetchResponse => ({
  status,
  headers: { get: () => null },
  text: async () => text,
  ...(url === undefined ? {} : { url }),
});

const answering =
  (response: FetchResponse): ScoringFetch =>
  async () =>
    response;

type Call = Parameters<ScoringFetch>;

function portOver(
  fetch: ScoringFetch,
  overrides: { logger?: Logger; host?: string; timeoutMs?: number } = {},
) {
  const calls: Call[] = [];
  const record = createRingRecord();
  const logger = overrides.logger ?? createLogger({ record, now: () => 0 });
  const port = createFetchMatchDayPort({
    fetch: (url, init) => {
      calls.push([url, init]);
      return fetch(url, init);
    },
    logger,
    host: overrides.host ?? 'stg.seazn.club',
    ...(overrides.timeoutMs === undefined ? {} : { timeoutMs: overrides.timeoutMs }),
    now: () => Date.parse('2026-11-07T10:00:00Z'),
  });
  const entries = () => record.lines().map(parseRecordLine);
  return { port, calls, record, entries, logger };
}

/** Every logger call, with protectLink left out: it is handed the secrets on purpose, which is how the record masks them. */
function spyLogger() {
  const order: string[] = [];
  const spies = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    protect: vi.fn(),
    protectLink: vi.fn((secret: string) => order.push(`protect ${secret}`)),
    release: vi.fn(),
  };
  const everything = () =>
    JSON.stringify(
      Object.entries(spies)
        .filter(([name]) => name !== 'protectLink')
        .map(([, spy]) => spy.mock.calls),
    );
  return { logger: spies satisfies Logger, spies, everything, order };
}

const OFFLINE = { ok: false, offline: true };
const GONE = { ok: false, gone: true };

afterEach(() => vi.useRealTimers());

describe('what each call asks', () => {
  it('the request has the bearer and no token in the URL: day is a GET with no body, never cached, no redirect', async () => {
    const { port, calls } = portOver(answering(respond(200, DAY)));
    await port.day(CODE);
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0];
    expect(url).toBe(DAY_URL);
    expect(url).not.toContain('md_');
    expect(init.method).toBe('GET');
    expect(init.headers).toEqual({
      Authorization: `Bearer ${TOKEN}`,
      'Cache-Control': 'no-store',
      Accept: 'application/json',
    });
    expect(init.redirect).toBe('error');
    expect(init).not.toHaveProperty('body');
    expect(init.signal).toBeDefined();
  });

  it('open: POSTs the fixture’s scoring-link route with the same bearer and no body (the contract: "with no body")', async () => {
    const { port, calls } = portOver(answering(respond(200, answered({ kind: 'finished' }))));
    await port.open(CODE, FIXTURE);
    const [url, init] = calls[0];
    expect(url).toBe(OPEN_URL);
    expect(url).not.toContain('md_');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(init.redirect).toBe('error');
    expect(init).not.toHaveProperty('body');
    expect(init.headers).not.toHaveProperty('Content-Type');
  });

  it('puts a fixture id in the path as one segment, whatever it holds', async () => {
    const { port, calls } = portOver(answering(respond(200, answered({ kind: 'finished' }))));
    await port.open(CODE, '../x?y#z');
    expect(calls[0][0]).toBe(`${DAY_URL}/fixtures/..%2Fx%3Fy%23z/scoring-link`);
  });

  it('hands the token to the logger before it asks, so no line can carry it (F15)', async () => {
    const { logger, order } = spyLogger();
    const { port } = portOver(
      async () => {
        order.push('fetch');
        return respond(200, DAY);
      },
      { logger },
    );
    await port.day(CODE);
    await port.open(CODE, FIXTURE);
    expect(order).toEqual([`protect ${TOKEN}`, 'fetch', `protect ${TOKEN}`, 'fetch']);
  });

  it('review and approve ask nothing yet: the approval contract is not vendored, so they answer offline', async () => {
    const { port, calls } = portOver(answering(respond(200, DAY)));
    expect(await port.review(CODE, 'swiss', FIXTURE)).toEqual(OFFLINE);
    expect(await port.approve(CODE, 'draw', FIXTURE, 'hash', null)).toEqual(OFFLINE);
    expect(calls).toEqual([]);
  });
});

describe('the token goes only to the build’s Seazn host', () => {
  it.each([
    ['another Seazn host', 'https://seazn.club'],
    ['http', 'http://stg.seazn.club'],
    ['a port', 'https://stg.seazn.club:8443'],
    ['userinfo', 'https://x@stg.seazn.club'],
    ['a path', 'https://stg.seazn.club/x'],
  ])('a code on %s is offline, and nothing is asked', async (_, origin) => {
    const { port, calls } = portOver(answering(respond(200, DAY)));
    expect(await port.day({ origin, token: TOKEN })).toEqual(OFFLINE);
    expect(await port.open({ origin, token: TOKEN }, FIXTURE)).toEqual(OFFLINE);
    expect(calls).toEqual([]);
  });

  it('a build with no host trusts none', async () => {
    const { port, calls } = portOver(answering(respond(200, DAY)), { host: '' });
    expect(await port.day(CODE)).toEqual(OFFLINE);
    expect(calls).toEqual([]);
  });
});

describe('what the day read answers', () => {
  it('the day, parsed', async () => {
    const { port } = portOver(answering(respond(200, DAY)));
    const answer = await port.day(CODE);
    if (!answer.ok) throw new Error('the day was not read');
    expect(answer.value.competition.name).toBe('SAFE Open 2026');
    expect(answer.value.scope).toEqual({ kind: 'courts', label: 'Court 2' });
    expect(answer.value.expiresAt).toEqual(new Date('2026-11-07T23:00:00.000Z'));
  });

  // The contracts' statuses: 401 MD_UNKNOWN, 410 MD_WITHDRAWN, 410 MD_ENDED, 403 MD_NOT_OPEN with opens_at.
  it.each([
    [401, 'MD_UNKNOWN'],
    [410, 'MD_WITHDRAWN'],
    [410, 'MD_ENDED'],
    [403, 'MD_NOT_OPEN'],
  ])('401/410/403: %s %s is that refusal', async (status, code) => {
    const { port } = portOver(answering(respond(status, refusal(code))));
    expect(await port.day(CODE)).toEqual({ ok: false, refusal: code });
  });

  it('MD_NOT_OPEN hands on when the day opens', async () => {
    const body = refusal('MD_NOT_OPEN', { opens_at: '2026-11-07T23:00:00.000Z' });
    const { port } = portOver(answering(respond(403, body)));
    expect(await port.day(CODE)).toEqual({
      ok: false,
      refusal: 'MD_NOT_OPEN',
      opensAt: new Date(Date.UTC(2026, 10, 7, 23)),
    });
  });

  it('404 NOT_FOUND is gone: the envelope’s own answer, outside the nine words', async () => {
    const { port } = portOver(answering(respond(404, refusal('NOT_FOUND'))));
    expect(await port.day(CODE)).toEqual(GONE);
  });

  it('a 404 that is not the envelope’s (an edge’s page, another word) is offline, not gone', async () => {
    for (const body of [
      null,
      { ok: false, error: { code: 'OTHER' } },
      { error: { code: 'NOT_FOUND' } },
    ]) {
      const { port } = portOver(answering(respond(404, body)));
      expect(await port.day(CODE)).toEqual(OFFLINE);
    }
  });

  it.each([
    ['429 RATE_LIMITED: tried again at the next poll', 429, refusal('RATE_LIMITED')],
    ['a word that is not one of the nine', 403, refusal('FORBIDDEN')],
    ['a 5xx with the envelope', 500, refusal('INTERNAL')],
    ['a 5xx with none', 503, null],
    ['a 200 that is not the day', 200, answered({ courts: 'none' })],
    ['a refusal answered 200', 200, refusal('MD_ENDED')],
  ])('%s: offline, never a crash', async (_, status, body) => {
    const { port } = portOver(answering(respond(status, body)));
    expect(await port.day(CODE)).toEqual(OFFLINE);
  });

  it('a captive portal’s page under any status: offline', async () => {
    for (const status of [200, 401, 410, 404]) {
      const { port } = portOver(answering(raw(status, '<html>Sign in to the Wi-Fi</html>')));
      expect(await port.day(CODE)).toEqual(OFFLINE);
    }
  });
});

describe('what an open answers', () => {
  const link = (url: string, sport = 'badminton') =>
    answered({ kind: 'link', url, sport_key: sport });

  it('the match’s own scoring link on the build’s host, with its sport', async () => {
    const { port } = portOver(answering(respond(200, link(LINK, 'tabletennis'))));
    expect(await port.open(CODE, FIXTURE)).toEqual({
      ok: true,
      value: { kind: 'link', url: LINK, sportKey: 'tabletennis' },
    });
  });

  it('finished: nothing to score', async () => {
    const { port } = portOver(answering(respond(200, answered({ kind: 'finished' }))));
    expect(await port.open(CODE, FIXTURE)).toEqual({ ok: true, value: { kind: 'finished' } });
  });

  it('403 MD_OUT_OF_SCOPE is the open’s own answer: the match is not on the code’s courts', async () => {
    const { port } = portOver(answering(respond(403, refusal('MD_OUT_OF_SCOPE'))));
    expect(await port.open(CODE, FIXTURE)).toEqual({
      ok: true,
      value: { kind: 'refused', code: 'MD_OUT_OF_SCOPE' },
    });
  });

  it.each([
    [401, 'MD_UNKNOWN'],
    [410, 'MD_WITHDRAWN'],
    [410, 'MD_ENDED'],
    [403, 'MD_NOT_OPEN'],
  ])('the code’s own refusal: %s %s', async (status, code) => {
    const { port } = portOver(answering(respond(status, refusal(code))));
    expect(await port.open(CODE, FIXTURE)).toEqual({ ok: false, refusal: code });
  });

  it('404 NOT_FOUND (no such match) is gone, so the list is read again; 429 is offline', async () => {
    expect(
      await portOver(answering(respond(404, refusal('NOT_FOUND')))).port.open(CODE, FIXTURE),
    ).toEqual(GONE);
    expect(
      await portOver(answering(respond(429, refusal('RATE_LIMITED')))).port.open(CODE, FIXTURE),
    ).toEqual(OFFLINE);
  });

  // Ruling 3 of the dispatch: a link is handed on only if a scan of it would be (the recogniser's host rule).
  it.each([
    ['a foreign host', `https://seazn.club/score/${LINK_SECRET}`],
    ['userinfo', `https://stg.seazn.club@evil.example/score/${LINK_SECRET}`],
    ['userinfo naming the build’s host', `https://evil@stg.seazn.club/score/${LINK_SECRET}`],
    ['a port', `https://stg.seazn.club:8443/score/${LINK_SECRET}`],
  ])('a link on %s is offline, and the record names no link', async (_, url) => {
    const { logger, everything, spies } = spyLogger();
    const { port } = portOver(answering(respond(200, link(url))), { logger });
    expect(await port.open(CODE, FIXTURE)).toEqual(OFFLINE);
    expect(spies.protectLink).toHaveBeenCalledWith(LINK_SECRET);
    expect(spies.warn).toHaveBeenCalledWith(
      'matchday.answer',
      expect.objectContaining({ op: 'open', kind: 'offline', problem: 'foreign-link' }),
    );
    const said = everything();
    expect(said).not.toContain('dl_');
    expect(said).not.toContain('score/');
  });

  it('the production build takes production’s links, and only them', async () => {
    const production = `https://seazn.club/score/${LINK_SECRET}`;
    const { port } = portOver(answering(respond(200, link(production))), { host: 'seazn.club' });
    expect(await port.open({ origin: 'https://seazn.club', token: TOKEN }, FIXTURE)).toEqual({
      ok: true,
      value: { kind: 'link', url: production, sportKey: 'badminton' },
    });
  });

  it('protects the link’s secret before handing it on (F15)', async () => {
    const { logger, spies } = spyLogger();
    const { port } = portOver(answering(respond(200, link(LINK))), { logger });
    await port.open(CODE, FIXTURE);
    expect(spies.protectLink.mock.calls).toEqual([[TOKEN], [LINK_SECRET]]);
  });
});

describe('what is no answer: offline', () => {
  it('a network failure is offline', async () => {
    const { port } = portOver(async () => {
      throw new Error('Network request failed');
    });
    expect(await port.day(CODE)).toEqual(OFFLINE);
    expect(await port.open(CODE, FIXTURE)).toEqual(OFFLINE);
  });

  it('a fetch that never answers: offline after 8 s, the request aborted', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const { port } = portOver((_url, init) => {
      signal = init.signal;
      return new Promise<FetchResponse>(() => {});
    });
    const pending = port.day(CODE);
    await vi.advanceTimersByTimeAsync(MATCHDAY_TIMEOUT_MS - 1);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual(OFFLINE);
    expect(signal?.aborted).toBe(true);
    expect(MATCHDAY_TIMEOUT_MS).toBe(8000);
  });

  it('a body that trickles after the headers is bounded too', async () => {
    vi.useFakeTimers();
    const { port } = portOver(async () => ({
      status: 200,
      headers: { get: () => null },
      text: () => new Promise<string>(() => {}),
    }));
    const pending = port.open(CODE, FIXTURE);
    await vi.advanceTimersByTimeAsync(MATCHDAY_TIMEOUT_MS);
    expect(await pending).toEqual(OFFLINE);
  });

  it('a build can shorten the 8 s, never lengthen it', async () => {
    vi.useFakeTimers();
    const never: ScoringFetch = () => new Promise<FetchResponse>(() => {});
    const short = portOver(never, { timeoutMs: 1000 }).port.day(CODE);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await short).toEqual(OFFLINE);
    let settled = false;
    void portOver(never, { timeoutMs: 60_000 })
      .port.day(CODE)
      .then(() => {
        settled = true;
      });
    await vi.advanceTimersByTimeAsync(MATCHDAY_TIMEOUT_MS);
    expect(settled).toBe(true);
  });

  it('a redirect the platform followed (the answer’s URL is not the one asked): offline', async () => {
    const { port } = portOver(answering(raw(200, JSON.stringify(DAY), 'https://portal.example/')));
    expect(await port.day(CODE)).toEqual(OFFLINE);
  });

  it('an answer whose URL is the one asked, or that says none, is read', async () => {
    for (const url of [DAY_URL, '', undefined]) {
      const { port } = portOver(answering(raw(200, JSON.stringify(DAY), url)));
      expect((await port.day(CODE)).ok).toBe(true);
    }
  });

  // A whole competition's day is the one big answer: 1 MiB. An open's answer is a link: native's 64 KiB.
  it('the day reads a body up to 1 MiB, and one byte over is no answer, never one cut short', async () => {
    const padded = (bytes: number) => {
      const text = JSON.stringify({ ...DAY, pad: '' });
      return text.replace('"pad":""', `"pad":"${'x'.repeat(bytes - text.length)}"`);
    };
    expect(MATCHDAY_DAY_MAX_BYTES).toBe(1024 * 1024);
    const exact = portOver(answering(raw(200, padded(MATCHDAY_DAY_MAX_BYTES))));
    expect((await exact.port.day(CODE)).ok).toBe(true);
    const over = portOver(answering(raw(200, padded(MATCHDAY_DAY_MAX_BYTES + 1))));
    expect(await over.port.day(CODE)).toEqual(OFFLINE);
  });

  it('an open reads up to 64 KiB', async () => {
    const big = JSON.stringify({
      ...answered({ kind: 'finished' }),
      pad: 'x'.repeat(MAX_BODY_BYTES),
    });
    const { port } = portOver(answering(raw(200, big)));
    expect(await port.open(CODE, FIXTURE)).toEqual(OFFLINE);
  });

  it('a body that cannot be read at all: offline', async () => {
    const { port } = portOver(async () => ({
      status: 200,
      headers: { get: () => null },
      text: async () => {
        throw new Error('stream broke');
      },
    }));
    expect(await port.day(CODE)).toEqual(OFFLINE);
  });
});

describe('the record', () => {
  it('never carries the token, the bearer or a link, whatever fails: the fake logger receives no md_', async () => {
    const { logger, everything } = spyLogger();
    const answers: ScoringFetch[] = [
      async () => {
        throw new Error(`Network request failed for ${TOKEN}`);
      },
      answering(respond(410, refusal('MD_WITHDRAWN', { message: `bad bearer ${TOKEN}` }))),
      answering(respond(403, refusal(TOKEN))),
      answering(respond(429, refusal('RATE_LIMITED'))),
      answering(respond(404, refusal('NOT_FOUND'))),
      answering(raw(200, `<html>${TOKEN}</html>`)),
      answering(
        respond(
          200,
          answered({
            kind: 'link',
            url: `https://seazn.club/score/${LINK_SECRET}`,
            sport_key: 'x',
          }),
        ),
      ),
    ];
    for (const answer of answers) {
      const { port } = portOver(answer, { logger });
      await port.day(CODE);
      await port.open(CODE, FIXTURE);
      await port.review(CODE, 'swiss', FIXTURE);
      await port.approve(CODE, 'swiss', FIXTURE, 'h', 4);
    }
    const said = everything();
    expect(said).not.toContain('md_');
    expect(said).not.toContain('Bearer');
    expect(said).not.toContain('bad bearer');
    expect(said).not.toContain('dl_');
  });

  it('the real record masks the token even where a caller writes it', async () => {
    const { port, record, logger } = portOver(answering(respond(200, DAY)));
    await port.day(CODE);
    logger.warn('probe', { problem: TOKEN });
    expect(record.lines().join('\n')).not.toContain(TOKEN);
  });

  it('says a refusal: the call, what it came to, its status and its word', async () => {
    const { port, entries } = portOver(answering(respond(410, refusal('MD_WITHDRAWN'))));
    await port.day(CODE);
    expect(entries()).toEqual([
      expect.objectContaining({
        level: 'warn',
        event: 'matchday.answer',
        fields: expect.objectContaining({
          op: 'day',
          kind: 'refused',
          status: 410,
          word: 'MD_WITHDRAWN',
        }),
      }),
    ]);
  });

  it('says why a call came to nothing, with no URL and no message', async () => {
    const { port, entries } = portOver(async () => {
      throw new Error('Network request failed');
    });
    await port.open(CODE, FIXTURE);
    expect(entries()).toEqual([
      expect.objectContaining({
        event: 'matchday.answer',
        fields: expect.objectContaining({
          op: 'open',
          kind: 'offline',
          status: 0,
          problem: 'network',
        }),
      }),
    ]);
  });

  it('says the stubs’ offline too: a call that cannot be made is never silent', async () => {
    const { port, entries } = portOver(answering(respond(200, DAY)));
    await port.review(CODE, 'swiss', FIXTURE);
    expect(entries()).toEqual([
      expect.objectContaining({
        event: 'matchday.answer',
        fields: expect.objectContaining({ op: 'review', kind: 'offline', problem: 'no-contract' }),
      }),
    ]);
  });

  it('says nothing for a success', async () => {
    const { port, entries } = portOver(answering(respond(200, DAY)));
    await port.day(CODE);
    expect(entries()).toEqual([]);
  });

  // The list polls every 15 s (S4 design §5): an offline hour is one line and a count, not 240 lines.
  it('a run of the same failure is said once, counted at 2 and 10, and its count said again when it ends', async () => {
    let answer: FetchResponse = respond(503, null);
    const { port, entries } = portOver(async () => answer);
    for (let poll = 0; poll < 12; poll += 1) await port.day(CODE);
    answer = respond(200, DAY);
    await port.day(CODE);
    expect(entries().map((entry) => [entry.event, entry.fields.count ?? null])).toEqual([
      ['matchday.answer', null],
      ['matchday.answer.repeat', 2],
      ['matchday.answer.repeat', 10],
      ['matchday.answer.repeat', 11],
    ]);
  });

  it('a different failure, or another call, starts a run of its own', async () => {
    let answer: FetchResponse = respond(503, null);
    const { port, entries } = portOver(async () => answer);
    await port.day(CODE);
    await port.open(CODE, FIXTURE);
    answer = respond(410, refusal('MD_ENDED'));
    await port.day(CODE);
    expect(entries().map((entry) => [entry.fields.op, entry.fields.kind])).toEqual([
      ['day', 'offline'],
      ['open', 'offline'],
      ['day', 'refused'],
    ]);
  });
});

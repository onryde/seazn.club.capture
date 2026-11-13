import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SavedDayCode } from '@/domain/mode/dayCode';
import { createFetchMatchDayPort, MATCHDAY_TIMEOUT_MS } from '@/services/fetchMatchDayPort';
import type { ScoringFetch } from '@/services/fetchScoringPort';
import type { FetchResponse } from '@/services/httpAsk';
import { createLogger } from '@/services/logger';
import { createRingRecord, parseRecordLine } from '@/services/sessionRecord';
import { FIXTURE_DAY_TOKEN } from '../../test/fixtures/dayCode';
import { answered, fixtureOf, refusedWith } from '../../test/matchDayContracts';

/**
 * The call routes (capture-matchday-call.v1; S4 design §7a): candidates, preview, call and Undo over plain fetch. The
 * bearer is the code's `md_` token and goes nowhere else; the call is one request, never repeated by the port.
 */
const CALL = 'capture-matchday-call.v1';
const TOKEN = FIXTURE_DAY_TOKEN;
const ORIGIN = 'https://stg.seazn.club';
const CODE: SavedDayCode = { origin: ORIGIN, token: TOKEN };
const COURT = '7b1e4c2a-3d5f-4a6b-8c9d-0e1f2a3b4c5d';
const FIXTURE = '0a1b2c3d-4e5f-4a6b-9c8d-7e6f5a4b3c2d';
const ROOT = `${ORIGIN}/api/v1/match-day-code`;
const CALL_URL = `${ROOT}/fixtures/${FIXTURE}/call`;

const respond = (status: number, body: unknown = null): FetchResponse => ({
  status,
  headers: { get: () => null },
  text: async () => JSON.stringify(body),
});
const answering =
  (response: FetchResponse): ScoringFetch =>
  async () =>
    response;
type Call = Parameters<ScoringFetch>;

function portOver(fetch: ScoringFetch, host = 'stg.seazn.club') {
  const calls: Call[] = [];
  const record = createRingRecord();
  const logger = createLogger({ record, now: () => 0 });
  const port = createFetchMatchDayPort({
    fetch: (url, init) => {
      calls.push([url, init]);
      return fetch(url, init);
    },
    logger,
    host,
    now: () => Date.parse('2026-11-07T10:00:00Z'),
  });
  return { port, calls, lines: () => record.lines().map(parseRecordLine) };
}

const OFFLINE = { ok: false, offline: true };
const GONE = { ok: false, gone: true };
const refusal = (code: string, extras: Record<string, unknown> = {}) =>
  refusedWith({ code, message: 'a developer string', ...extras });

afterEach(() => vi.useRealTimers());

describe('what each call route asks', () => {
  it('candidates: a GET of the court’s route with the bearer, no body, never cached, no redirect', async () => {
    const { port, calls } = portOver(answering(respond(200, answered(fixtureOf(CALL, 'valid')))));
    await port.candidates(CODE, COURT);
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0];
    expect(url).toBe(`${ROOT}/courts/${COURT}/candidates`);
    expect(url).not.toContain('md_');
    expect(init.method).toBe('GET');
    expect(init.headers).toEqual({
      Authorization: `Bearer ${TOKEN}`,
      'Cache-Control': 'no-store',
      Accept: 'application/json',
    });
    expect(init.redirect).toBe('error');
    expect(init).not.toHaveProperty('body');
  });

  it('previewCall: a POST of the fixture’s call route with {court_id, preview: true} (request-valid-preview)', async () => {
    const { port, calls } = portOver(
      answering(respond(200, answered(fixtureOf(CALL, 'preview-valid-quiet')))),
    );
    await port.previewCall(CODE, FIXTURE, COURT);
    const [url, init] = calls[0];
    expect(url).toBe(CALL_URL);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      Authorization: `Bearer ${TOKEN}`,
      'Cache-Control': 'no-store',
      Accept: 'application/json',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(init.body))).toEqual(fixtureOf(CALL, 'request-valid-preview'));
  });

  it('call: the same route with preview false (request-valid-call), one request', async () => {
    const { port, calls } = portOver(
      answering(respond(200, answered(fixtureOf(CALL, 'call-valid')))),
    );
    await port.call(CODE, FIXTURE, COURT);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe(CALL_URL);
    expect(calls[0][1].method).toBe('POST');
    expect(JSON.parse(String(calls[0][1].body))).toEqual(fixtureOf(CALL, 'request-valid-call'));
  });

  it('undoCall: a DELETE of the same route with the bearer and no body', async () => {
    const { port, calls } = portOver(
      answering(respond(200, answered(fixtureOf(CALL, 'undo-valid')))),
    );
    await port.undoCall(CODE, FIXTURE);
    const [url, init] = calls[0];
    expect(url).toBe(CALL_URL);
    expect(init.method).toBe('DELETE');
    expect(init.headers).toEqual({
      Authorization: `Bearer ${TOKEN}`,
      'Cache-Control': 'no-store',
      Accept: 'application/json',
    });
    expect(init).not.toHaveProperty('body');
  });

  it('puts an id in the path as one segment, whatever it holds', async () => {
    const { port, calls } = portOver(answering(respond(200, null)));
    await port.candidates(CODE, '../x?y=1');
    await port.undoCall(CODE, 'a/b');
    expect(calls[0][0]).toBe(`${ROOT}/courts/..%2Fx%3Fy%3D1/candidates`);
    expect(calls[1][0]).toBe(`${ROOT}/fixtures/a%2Fb/call`);
  });

  it('a second call is a second request: the port keeps nothing', async () => {
    const { port, calls } = portOver(
      answering(respond(200, answered(fixtureOf(CALL, 'call-valid')))),
    );
    await Promise.all([port.call(CODE, FIXTURE, COURT), port.call(CODE, FIXTURE, COURT)]);
    expect(calls).toHaveLength(2);
  });

  it('a host that is not the build’s gets nothing: no request, offline', async () => {
    const { port, calls } = portOver(answering(respond(200, null)), 'seazn.club');
    expect(await port.candidates(CODE, COURT)).toEqual(OFFLINE);
    expect(await port.previewCall(CODE, FIXTURE, COURT)).toEqual(OFFLINE);
    expect(await port.call(CODE, FIXTURE, COURT)).toEqual(OFFLINE);
    expect(await port.undoCall(CODE, FIXTURE)).toEqual(OFFLINE);
    expect(calls).toHaveLength(0);
  });
});

describe('what each call route answers', () => {
  it('candidates, parsed', async () => {
    const { port } = portOver(answering(respond(200, answered(fixtureOf(CALL, 'valid')))));
    const answer = await port.candidates(CODE, COURT);
    expect(answer.ok && answer.value.candidates.map((c) => c.source)).toEqual([
      'thisCourt',
      'noCourt',
      'otherCourt',
    ]);
  });

  it('preview, call and undo, parsed', async () => {
    const preview = await portOver(
      answering(respond(200, answered(fixtureOf(CALL, 'preview-valid')))),
    ).port.previewCall(CODE, FIXTURE, COURT);
    expect(preview.ok && preview.value.warnings).toHaveLength(5);
    const called = await portOver(
      answering(respond(200, answered(fixtureOf(CALL, 'call-valid')))),
    ).port.call(CODE, FIXTURE, COURT);
    expect(called.ok && called.value.courtId).toBe(COURT);
    const undone = await portOver(
      answering(respond(200, answered(fixtureOf(CALL, 'undo-valid-no-court')))),
    ).port.undoCall(CODE, FIXTURE);
    expect(undone.ok && undone.value.courtId).toBeNull();
  });

  it.each([
    ['MD_NO_CALL', 403, {}, { code: 'MD_NO_CALL' }],
    ['MD_OUT_OF_SCOPE', 403, {}, { code: 'MD_OUT_OF_SCOPE' }],
    ['MD_WITHDRAWN', 410, {}, { code: 'MD_WITHDRAWN' }],
    ['MD_ENDED', 410, {}, { code: 'MD_ENDED' }],
    ['MD_UNKNOWN', 401, {}, { code: 'MD_UNKNOWN' }],
    [
      'MD_NOT_OPEN',
      403,
      { opens_at: '2026-11-06T23:00:00.000Z' },
      { code: 'MD_NOT_OPEN', opensAt: new Date('2026-11-06T23:00:00.000Z') },
    ],
    [
      'MD_CALL_REFUSED',
      409,
      { reason: 'player_busy', person_name: 'Ann Archer', court_name: 'Court 3' },
      {
        code: 'MD_CALL_REFUSED',
        reason: 'playerBusy',
        personName: 'Ann Archer',
        courtName: 'Court 3',
      },
    ],
  ])(
    '%s is a refusal the screen can say, from every route',
    async (code, status, extras, refused) => {
      const body = refusal(code, extras);
      const { port } = portOver(answering(respond(status, body)));
      const expected = { ok: false, refused };
      expect(await port.candidates(CODE, COURT)).toEqual(expected);
      expect(await port.previewCall(CODE, FIXTURE, COURT)).toEqual(expected);
      expect(await port.call(CODE, FIXTURE, COURT)).toEqual(expected);
      expect(await port.undoCall(CODE, FIXTURE)).toEqual(expected);
    },
  );

  it('404 NOT_FOUND is gone: the court or the match is no more', async () => {
    const { port } = portOver(answering(respond(404, refusal('NOT_FOUND'))));
    expect(await port.candidates(CODE, COURT)).toEqual(GONE);
    expect(await port.call(CODE, FIXTURE, COURT)).toEqual(GONE);
  });

  it('a 404 that is not the envelope’s, a 429, a 422 and a 500 are offline', async () => {
    for (const [status, body] of [
      [404, 'no'],
      [429, refusal('RATE_LIMITED')],
      [422, refusal('VALIDATION')],
      [500, refusal('INTERNAL')],
    ] as const) {
      const { port } = portOver(answering(respond(status, body)));
      expect(await port.call(CODE, FIXTURE, COURT)).toEqual(OFFLINE);
    }
  });

  it('another route’s word (an approval’s MD_STALE) is no call refusal: offline', async () => {
    const { port } = portOver(answering(respond(409, refusal('MD_STALE'))));
    expect(await port.call(CODE, FIXTURE, COURT)).toEqual(OFFLINE);
  });

  it('a 200 that does not parse is offline, never a call', async () => {
    const { port } = portOver(answering(respond(200, answered({ fixture_id: FIXTURE }))));
    expect(await port.call(CODE, FIXTURE, COURT)).toEqual(OFFLINE);
  });

  it('a call that never answers is offline after 8 s, the request aborted', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const { port } = portOver((_url, init) => {
      signal = init.signal;
      return new Promise<FetchResponse>(() => undefined);
    });
    const pending = port.call(CODE, FIXTURE, COURT);
    await vi.advanceTimersByTimeAsync(MATCHDAY_TIMEOUT_MS);
    expect(await pending).toEqual(OFFLINE);
    expect(signal?.aborted).toBe(true);
  });
});

describe('the record', () => {
  it('says a refused call with its word and the desk’s reason, never a name, a message or an id', async () => {
    const { port, lines } = portOver(
      answering(
        respond(
          409,
          refusal('MD_CALL_REFUSED', {
            reason: 'player_busy',
            person_name: 'Ann Archer',
            court_name: 'Court 3',
          }),
        ),
      ),
    );
    await port.call(CODE, FIXTURE, COURT);
    const said = lines().filter((line) => line?.event === 'matchday.answer');
    expect(said).toHaveLength(1);
    expect(said[0]?.fields).toEqual({
      op: 'call',
      kind: 'refused',
      status: 409,
      word: 'MD_CALL_REFUSED',
      reason: 'playerBusy',
    });
    const all = JSON.stringify(lines());
    for (const secret of [TOKEN, FIXTURE, COURT, 'Ann', 'Court 3', 'developer string']) {
      expect(all).not.toContain(secret);
    }
  });

  it('says a reason it does not know as the word `unknown`, still a refusal and not offline (final review m4)', async () => {
    const { port, lines } = portOver(
      answering(respond(409, refusal('MD_CALL_REFUSED', { reason: 'raining' }))),
    );
    const answer = await port.call(CODE, FIXTURE, COURT);
    expect(answer).toMatchObject({
      ok: false,
      refused: { code: 'MD_CALL_REFUSED', reason: 'unknown' },
    });
    expect(lines().at(-1)?.fields).toMatchObject({ kind: 'refused', reason: 'unknown' });
    expect(JSON.stringify(lines())).not.toContain('raining');
  });

  it('never rejects when the path cannot be built: a lone surrogate in an id is offline, nothing is sent (final review m5)', async () => {
    const { port, calls, lines } = portOver(answering(respond(200, null)));
    await expect(port.candidates(CODE, '\ud800')).resolves.toEqual(OFFLINE);
    expect(calls).toHaveLength(0);
    expect(JSON.stringify(lines())).not.toContain(TOKEN);
  });

  it('says a gone, an offline and a refusal of the other routes by their own call’s name', async () => {
    const gone = portOver(answering(respond(404, refusal('NOT_FOUND'))));
    await gone.port.undoCall(CODE, FIXTURE);
    expect(gone.lines().at(-1)?.fields).toMatchObject({ op: 'undo', kind: 'gone' });
    const noCall = portOver(answering(respond(403, refusal('MD_NO_CALL'))));
    await noCall.port.previewCall(CODE, FIXTURE, COURT);
    expect(noCall.lines().at(-1)?.fields).toEqual({
      op: 'preview',
      kind: 'refused',
      status: 403,
      word: 'MD_NO_CALL',
    });
    const down = portOver(answering(respond(500, null)));
    await down.port.candidates(CODE, COURT);
    expect(down.lines().at(-1)?.fields).toMatchObject({ op: 'candidates', kind: 'offline' });
  });
});

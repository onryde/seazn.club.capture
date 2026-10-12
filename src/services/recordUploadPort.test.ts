import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import list from '../../modules/capture-engine/src/scrub/allow-list.json';
import vectors from '../../modules/capture-engine/src/scrub/vectors.json';
import type { UploadCredential } from '@/domain/credentials/uploadCredential';
import { createLogger } from '@/services/logger';
import { codeUrl } from '@/services/fetchCodePort';
import {
  createRecordUploadPort,
  isSeaznCodeUrl,
  linesAreSafe,
  RECORD_MAX_BYTES,
  RECORD_TIMEOUT_MS,
  type PostFetch,
} from '@/services/recordUploadPort';
import type { LogFields } from '@/services/scrub';
import { seaznHosts, seaznOrigin } from '@/services/seaznHosts';
import { createRingRecord, parseRecordLine, toRecordLine } from '@/services/sessionRecord';

// Made up (AGENTS §13): a token of the QR's shape and a code URL that belong to nothing.
const TOKEN = 'AAAAAAAAAAAAAAAAAAAAAA';
const credential: UploadCredential = {
  codeUrl: 'https://stg.seazn.club/api/v1/capture/codes/abcdefghjkmn',
  token: TOKEN,
  expiresAtMs: null,
};
const line = (event: string, fields: Record<string, string | number | boolean | null> = {}) =>
  toRecordLine({ atMs: 0, level: 'info', event, fields });
const LINES = [line('paired'), line('live', { transport: 'srt' })];

type Answer = { status: number; json(): Promise<unknown> };

function port(answer: () => Promise<Answer>) {
  const record = createRingRecord();
  const fetch = vi.fn<PostFetch>(answer);
  return {
    fetch,
    record,
    upload: createRecordUploadPort({
      fetch,
      logger: createLogger({ record, now: () => 0 }),
      host: 'stg.seazn.club',
    }),
    sendLines: () => record.lines().filter((l) => l.includes('"kind":"record.send"')),
  };
}
const answered =
  (status: number, body: unknown = {}) =>
  async (): Promise<Answer> => ({ status, json: async () => body });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('Send record to Seazn (R3, R9)', () => {
  it('posts the lines as ndjson with the bearer to the code’s record path, and answers sent with the ref', async () => {
    const p = port(answered(201, { ref: 'R-7K2Q' }));
    const outcome = await p.upload.send(LINES, credential);
    expect(outcome).toEqual({
      result: 'sent',
      ref: 'R-7K2Q',
      status: 201,
      bytes: LINES.join('\n').length + 1,
    });
    expect(p.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = p.fetch.mock.calls[0] ?? [];
    // The path is a placeholder until the web publishes its contract (web brief §1: "Its path is the web's choice").
    expect(url).toBe(`${credential.codeUrl}/record`);
    expect(init).toMatchObject({ method: 'POST', body: `${LINES.join('\n')}\n` });
    expect(init?.headers).toEqual({
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/x-ndjson',
    });
  });

  it.each([
    [401, 'unauthorised'],
    [413, 'too-large'],
    [429, 'rate-limited'],
    [500, 'failed'],
    [200, 'failed'],
  ] as const)('answers %i as %s, without reading its body', async (status, result) => {
    const json = vi.fn(async () => ({ ref: 'R-1' }));
    const p = port(async () => ({ status, json }));
    expect(await p.upload.send(LINES, credential)).toEqual({
      result,
      ref: null,
      status,
      bytes: LINES.join('\n').length + 1,
    });
    expect(json).not.toHaveBeenCalled();
  });

  it.each([
    ['no ref', {}],
    ['a ref that is not text', { ref: 7 }],
    ['a ref longer than a short reference', { ref: 'R-'.padEnd(17, '7') }],
    ['a ref with a space', { ref: 'R 7K2Q' }],
    ['a body that is not an object', 'R-7K2Q'],
  ])('a 201 with %s is failed, with its status', async (_why, body) => {
    const p = port(answered(201, body));
    expect(await p.upload.send(LINES, credential)).toMatchObject({
      result: 'failed',
      ref: null,
      status: 201,
    });
  });

  it('a 201 whose body is not JSON is failed, with its status', async () => {
    const p = port(async () => ({
      status: 201,
      json: () => Promise.reject(new SyntaxError('Unexpected token')),
    }));
    expect(await p.upload.send(LINES, credential)).toMatchObject({ result: 'failed', status: 201 });
  });

  it('a network failure is failed, never thrown, and its error is never recorded', async () => {
    const thrown = port(async () => {
      throw new Error(`offline https://x/?token=${TOKEN}`);
    });
    expect(await thrown.upload.send(LINES, credential)).toMatchObject({
      result: 'failed',
      ref: null,
      status: null,
    });
    expect(thrown.record.lines().some((l) => l.includes(TOKEN) || l.includes('offline'))).toBe(
      false,
    );
  });

  it('a request that hangs is failed after 15 s, and its download is aborted', async () => {
    const hung = port(() => new Promise(() => undefined));
    const pending = hung.upload.send(LINES, credential);
    await vi.advanceTimersByTimeAsync(RECORD_TIMEOUT_MS - 1);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).result).toBe('failed');
    expect(hung.fetch.mock.calls[0]?.[1]?.signal.aborted).toBe(true);
  });

  it('an answer whose body never arrives is failed after 15 s too', async () => {
    const p = port(async () => ({ status: 201, json: () => new Promise(() => undefined) }));
    const pending = p.upload.send(LINES, credential);
    await vi.advanceTimersByTimeAsync(RECORD_TIMEOUT_MS);
    expect(await pending).toMatchObject({ result: 'failed', ref: null });
  });

  it('sends at most the last 1,000 lines', async () => {
    const p = port(answered(201, { ref: 'R-1' }));
    const many = Array.from({ length: 1_200 }, (_, i) => line('beat', { count: i }));
    await p.upload.send(many, credential);
    const body = String(p.fetch.mock.calls[0]?.[1]?.body);
    const sent = body.trim().split('\n');
    expect(sent).toHaveLength(1_000);
    expect(sent[0]).toContain('"count":200}');
    expect(sent.at(-1)).toContain('"count":1199}');
    expect(body).not.toContain('"count":199}');
  });

  it('a body over 1 MB sends nothing and says too-large', async () => {
    const p = port(answered(201, { ref: 'R-1' }));
    // 1,000 lines of about 1.1 KB each: past the web's 1 MB with the line count inside its 1,000.
    const big = Array.from({ length: 1_000 }, () =>
      line('vendor-log', { message: 'x'.repeat(1_100) }),
    );
    const outcome = await p.upload.send(big, credential);
    expect(outcome.result).toBe('too-large');
    expect(outcome.bytes).toBeGreaterThan(RECORD_MAX_BYTES);
    expect(p.fetch).not.toHaveBeenCalled();
  });

  it('an empty record sends nothing (an empty input)', async () => {
    const p = port(answered(201, { ref: 'R-1' }));
    expect(await p.upload.send([], credential)).toEqual({
      result: 'failed',
      ref: null,
      status: null,
      bytes: 0,
    });
    expect(p.fetch).not.toHaveBeenCalled();
  });

  it('records the result, the status and the bytes, never the ref or the token', async () => {
    const p = port(answered(201, { ref: 'R-7K2Q' }));
    await p.upload.send(LINES, credential);
    const [sent] = p.sendLines();
    expect(parseRecordLine(sent ?? '{}').fields).toEqual({
      result: 'sent',
      status: 201,
      bytes: LINES.join('\n').length + 1,
    });
    expect(sent).not.toContain('R-7K2Q');
    expect(sent).not.toContain(TOKEN);
  });

  // The precedent is the engine's malformed-snapshot line: a JS line that can land in native's record while a pairing
  // is held, so its kind and keys are the allow-list's, and native keeps them as written.
  it('its record line is the allow-list’s: the kind listed, result and status plain, bytes a scalar', () => {
    expect(Object.keys(list.kinds)).toContain('record.send');
    expect(list.plain).toEqual(expect.arrayContaining(['result', 'status']));
    expect(Object.keys(list.scalars)).toContain('bytes');
  });
});

describe('the upload fails closed (spec §7)', () => {
  const refuses = async (lines: readonly string[]) => {
    const p = port(answered(201, { ref: 'R-1' }));
    const outcome = await p.upload.send([...LINES, ...lines], credential);
    expect(p.fetch).not.toHaveBeenCalled();
    expect(outcome).toEqual({ result: 'refused-local', ref: null, status: null, bytes: 0 });
    expect(parseRecordLine(p.sendLines()[0] ?? '{}').fields).toMatchObject({
      result: 'refused-local',
    });
    return p;
  };

  // Both guards catch this one: the raw token is in the line, and the scrub would mask it in `message`.
  it('a line that carries the token sends nothing and says refused-local', async () => {
    const leaked = line('vendor-log', { message: 'url ?token=TOKEN_HERE' }).replace(
      'TOKEN_HERE',
      TOKEN,
    );
    const p = await refuses([leaked]);
    expect(p.record.lines().some((l) => l.includes(TOKEN))).toBe(false);
  });

  // A number passes the scrub under any key, so the token as a field's NAME leaves the scrub with nothing to change.
  // Both token checks see it: the raw text and the decoded text both name it.
  it('the token as a field name, holding a number, sends nothing', async () => {
    const named = JSON.stringify({ at: '1970-01-01T00:00:00.000Z', kind: 'beats', [TOKEN]: 1 });
    expect(linesAreSafe([named], 'some-other-token-00000')).toBe(true); // the scrub alone passes it
    await refuses([named]);
  });

  // M7 (preflight): only the raw check sees this one. A duplicate key: the text sent names the token, and the value a
  // reader decodes (the last one) does not. What is sent is the text.
  it('the token under a key written twice, the second time harmless, sends nothing', async () => {
    const twice = `{"at":"1970-01-01T00:00:00.000Z","kind":"beats","count":"${TOKEN}","count":1}`;
    expect(JSON.stringify(JSON.parse(twice))).not.toContain(TOKEN);
    await refuses([twice]);
  });

  // Minor 11 of the Batch 6 review: only the decoded check sees this one. The token as a field's name, written with
  // JSON escapes, is not in the raw text, and a reader decodes it to the token.
  it('the token as an escaped field name sends nothing', async () => {
    const escaped = [...TOKEN].map((c) => `\\u00${c.charCodeAt(0).toString(16)}`).join('');
    const hidden = `{"at":"1970-01-01T00:00:00.000Z","kind":"beats","${escaped}":1}`;
    expect(hidden).not.toContain(TOKEN);
    expect(Object.keys(JSON.parse(hidden) as object)).toContain(TOKEN);
    await refuses([hidden]);
  });

  // M7 (preflight): only the scrub comparison sees this one. No token anywhere, but a string under a key on no list,
  // which the scrub masks: the record would arrive different from the one written, so it does not go.
  it('a string under a key on no list sends nothing, with no token in it', async () => {
    const unlisted = line('beats', { note: 'a free-form word' });
    expect(unlisted).not.toContain(TOKEN);
    await refuses([unlisted]);
  });

  it('a kind the scrub would mask sends nothing', async () => {
    await refuses([line('a kind with spaces')]);
  });

  it('a field holding an object sends nothing', async () => {
    await refuses([
      JSON.stringify({ at: '1970-01-01T00:00:00.000Z', kind: 'beats', count: { n: 1 } }),
    ]);
  });

  it.each([
    ['not JSON', '{not json'],
    ['a number', '42'],
    ['an array', '[]'],
    ['null', 'null'],
    ['a string', '"paired"'],
    ['an object with no kind', '{"at":"1970-01-01T00:00:00.000Z"}'],
    ['a kind that is not text', '{"at":"1970-01-01T00:00:00.000Z","kind":7}'],
    // Minor 11 of the Batch 6 review: the two slots the scrub never reads.
    ['a line with no time', '{"kind":"beats"}'],
    ['a time that is no time', '{"at":"any text at all","kind":"beats"}'],
    ['a time that is a number', '{"at":0,"kind":"beats"}'],
    [
      'a level that is no level',
      '{"at":"1970-01-01T00:00:00.000Z","kind":"beats","level":"any text"}',
    ],
    ['a level that is not text', '{"at":"1970-01-01T00:00:00.000Z","kind":"beats","level":2}'],
  ])('%s is not a record line, and sends nothing', async (_why, text) => {
    await refuses([text]);
  });

  it.each(['debug', 'info', 'warn', 'error'] as const)(
    'a line at level %s, as the logger writes it, passes',
    (level) => {
      const written = toRecordLine({ atMs: 0, level, event: 'beats', fields: {} });
      expect(linesAreSafe([written], TOKEN)).toBe(true);
    },
  );
});

// Important 2 of the Batch 6 review: the Bearer goes only to the code's URL on the build's Seazn host, as native holds
// the same URL (`PairRequest`: "https://<host>/api/v1/capture/codes/<code>"). A stored URL is not trusted.
describe('the upload goes only to the build’s Seazn host', () => {
  const refusedFor = async (codeUrl: string, host = 'stg.seazn.club') => {
    const record = createRingRecord();
    const fetch = vi.fn<PostFetch>(answered(201, { ref: 'R-1' }));
    const upload = createRecordUploadPort({
      fetch,
      logger: createLogger({ record, now: () => 0 }),
      host,
    });
    const outcome = await upload.send(LINES, { ...credential, codeUrl });
    expect(fetch).not.toHaveBeenCalled();
    expect(outcome).toEqual({ result: 'refused-local', ref: null, status: null, bytes: 0 });
    expect(record.lines().some((l) => l.includes(TOKEN))).toBe(false);
  };

  it.each([
    ['a foreign host', 'https://evil.example/api/v1/capture/codes/abcdefghjkmn'],
    // As long as the build's, so what follows the code path's length is a code: only the whole URL tells.
    [
      'a foreign host as long as the build’s',
      'https://stg.seazn.evil/api/v1/capture/codes/abcdefghjkmn',
    ],
    ['plain http', 'http://stg.seazn.club/api/v1/capture/codes/abcdefghjkmn'],
    ['a lookalike host', 'https://stg.seazn.club.evil.example/api/v1/capture/codes/abcdefghjkmn'],
    [
      'userinfo before another host',
      'https://stg.seazn.club@evil.example/api/v1/capture/codes/abcdefghjkmn',
    ],
    ['the other environment’s host', 'https://seazn.club/api/v1/capture/codes/abcdefghjkmn'],
    ['a port', 'https://stg.seazn.club:8443/api/v1/capture/codes/abcdefghjkmn'],
    ['another path', 'https://stg.seazn.club/api/v1/other/abcdefghjkmn'],
    ['a path past the code', 'https://stg.seazn.club/api/v1/capture/codes/abcdefghjkmn/x'],
    ['a code that is not one', 'https://stg.seazn.club/api/v1/capture/codes/..%2F..%2Fother'],
    ['no code', 'https://stg.seazn.club/api/v1/capture/codes/'],
  ])('refuses %s, sending nothing', async (_why, codeUrl) => {
    await refusedFor(codeUrl);
  });

  it('trusts nothing with no host configured', async () => {
    await refusedFor('https:///api/v1/capture/codes/abcdefghjkmn', '');
  });

  // R1-4 of the Batch 6 re-review: the URL the app saves at a scan is built from `seaznOrigin`, and the check reads
  // `seaznHosts`. If the two ever disagreed, every real upload would be refused locally with the suite still green.
  let environments = 0;
  it.each(['production', undefined])('passes the app’s own code URL in the %s build', (env) => {
    const built = codeUrl(seaznOrigin(env), 'abcdefghjkmn');
    expect(isSeaznCodeUrl(built, seaznHosts(env)[0] ?? '')).toBe(true);
    environments += 1;
  });

  it('checked both builds (anti-vacuity)', () => {
    expect(environments).toBe(2);
  });

  it('sends to the code’s URL on the build’s host', async () => {
    const p = port(answered(201, { ref: 'R-1' }));
    expect((await p.upload.send(LINES, credential)).result).toBe('sent');
  });
});

// Preflight N18: what the scrub writes is safe to send, so a record the app wrote is never refused by its own rule.
// Each shared vector's row, written by the production logger holding the token (as a pairing does), and the row as
// the file says both sides write it, pass the check that guards the upload.
describe('every line the scrub writes passes the upload’s check (N18)', () => {
  const token = vectors.held.secrets[0] ?? '';
  let swept = 0;

  it('holds the vectors’ token, and the file has its 48 rows', () => {
    expect(token).toBe('tok-9f3c2a7e5b1d4680ab');
    expect(vectors.cases).toHaveLength(48);
  });

  it.each(vectors.cases.map((c) => [c.why, c] as const))('%s', (_why, c) => {
    const record = createRingRecord();
    const logger = createLogger({ record, now: () => 0 });
    logger.protect(vectors.held);
    logger.info('probe', { [c.key]: c.value } as LogFields);
    const written = record.lines()[0] ?? '';
    const asFiled = toRecordLine({
      atMs: 0,
      level: 'info',
      event: 'probe',
      fields: { [c.key]: c.expected } as LogFields,
    });
    expect(linesAreSafe([written], token)).toBe(true);
    expect(linesAreSafe([asFiled], token)).toBe(true);
    swept += 1;
  });

  it('passes every kind on the allow-list as a line of its own', () => {
    const kinds = Object.keys(list.kinds);
    expect(kinds.length).toBeGreaterThan(80);
    expect(
      linesAreSafe(
        kinds.map((kind) => line(kind)),
        token,
      ),
    ).toBe(true);
  });

  it('swept every row (anti-vacuity)', () => {
    expect(swept).toBe(48);
  });
});

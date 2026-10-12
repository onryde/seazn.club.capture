import { readdirSync, readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
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

/**
 * The web's record contract, vendored at 53f28ebfc and pinned by contractPins.test.ts: every path, limit and answer
 * below is read from it or from its fixtures, never typed here (recordContract.test.ts pins the app's copies).
 */
const CONTRACTS = new URL('../../contracts/', import.meta.url);
const FIXTURES = new URL('fixtures/capture-record.v1/', CONTRACTS);
type Schema = {
  readonly $id: string;
  readonly title: string;
  readonly description: string;
  readonly $defs: { readonly refusal: { readonly description: string } };
};
const contract = JSON.parse(
  readFileSync(new URL('capture-record.v1.json', CONTRACTS), 'utf8'),
) as Schema;
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`${name}.json`, FIXTURES), 'utf8'));
const FIXTURE_NAMES = readdirSync(FIXTURES)
  .map((file) => file.replace(/\.json$/, ''))
  .sort();
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
ajv.addSchema(contract);
const validator = (pointer = '') => {
  const validate = ajv.getSchema(`${contract.$id}${pointer === '' ? '' : `#${pointer}`}`);
  if (validate === undefined) throw new Error(`no schema at ${pointer}`);
  return validate;
};
/** Whether the contract admits this as one line of the body. */
const admitsLine = (value: unknown) => validator()(value) === true;
/** Whether any string value of a line is secret-shaped under the contract's S2–S5 (`$defs.secretShaped`). */
const secretShaped = (value: object) =>
  Object.values(value).some(
    (field) => typeof field === 'string' && validator('/$defs/secretShaped')(field) === true,
  );
/** The route, from the contract's title: "POST /api/v1/capture/codes/{code}/records". */
const ROUTE = /POST (\S+)/.exec(contract.title)?.[1] ?? '';
/** "at most 1000 non-empty lines and at most 1 MB (1048576 bytes)", from the contract's description. */
const MAX_BYTES = Number(/\((\d+) bytes\)/.exec(contract.description)?.[1]);
/** Each refusal word's status, from the refusal's own description ("401 code_ended (…), 404 …"). */
const STATUS_OF = new Map(
  [...contract.$defs.refusal.description.matchAll(/(\d{3}) ([a-z_]+) \(/g)].map(
    ([, status, word]) => [word ?? '', Number(status)] as const,
  ),
);
const OK = fixture('ok-valid') as { readonly ref: string };

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
  it('posts the lines as ndjson with the bearer to the contract’s route for the code, and answers sent with the ref', async () => {
    const p = port(answered(201, OK));
    const outcome = await p.upload.send(LINES, credential);
    expect(outcome).toEqual({
      result: 'sent',
      ref: OK.ref,
      status: 201,
      bytes: LINES.join('\n').length + 1,
    });
    expect(p.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = p.fetch.mock.calls[0] ?? [];
    expect(ROUTE).toBe('/api/v1/capture/codes/{code}/records');
    expect(url).toBe(`https://stg.seazn.club${ROUTE.replace('{code}', 'abcdefghjkmn')}`);
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
    const p = port(answered(201, OK));
    // 1,000 lines of about 1.1 KB each: past the web's 1 MB with the line count inside its 1,000.
    const big = Array.from({ length: 1_000 }, () =>
      line('vendor-log', { message: 'x'.repeat(1_100) }),
    );
    const outcome = await p.upload.send(big, credential);
    expect(outcome.result).toBe('too-large');
    expect(outcome.bytes).toBeGreaterThan(MAX_BYTES);
    expect(p.fetch).not.toHaveBeenCalled();
  });

  // The contract's limit is 1 MB as 1,048,576 bytes of the body as the server reads it, the trailing newline included.
  const ofBytes = (total: number) => {
    const lines = Array.from({ length: 999 }, () => line('beats'));
    const used = new TextEncoder().encode(`${lines.join('\n')}\n`).length;
    const last = line('vendor-log', { message: '' });
    // The last line's message fills what is left: one byte a character, plus that line's own newline.
    return [
      ...lines,
      last.replace('"message":""', `"message":"${'x'.repeat(total - used - last.length - 1)}"`),
    ];
  };

  it('a body of exactly the contract’s 1,048,576 bytes is sent', async () => {
    expect(MAX_BYTES).toBe(1_048_576);
    const p = port(answered(201, OK));
    const outcome = await p.upload.send(ofBytes(MAX_BYTES), credential);
    expect(outcome).toMatchObject({ result: 'sent', bytes: MAX_BYTES });
    expect(new TextEncoder().encode(String(p.fetch.mock.calls[0]?.[1]?.body)).length).toBe(
      MAX_BYTES,
    );
  });

  it('one byte more sends nothing and says too-large', async () => {
    const p = port(answered(201, OK));
    const outcome = await p.upload.send(ofBytes(MAX_BYTES + 1), credential);
    expect(outcome).toMatchObject({ result: 'too-large', bytes: MAX_BYTES + 1 });
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
    const p = port(answered(201, OK));
    await p.upload.send(LINES, credential);
    const [sent] = p.sendLines();
    expect(parseRecordLine(sent ?? '{}').fields).toEqual({
      result: 'sent',
      status: 201,
      bytes: LINES.join('\n').length + 1,
    });
    expect(sent).not.toContain(OK.ref);
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

  // Fix round 1 of Batch 11 (finding 2 of its review): a key the language treats specially is a key on no list like any
  // other. An assignment calls `__proto__`'s setter, so the parsed fields once lost it and the scrub comparison never
  // saw it; only the contract's key list kept the string home.
  const SPECIAL_KEYS = ['__proto__', 'constructor', 'prototype'] as const;
  const under = (key: string, value: string) =>
    `{"at":"1970-01-01T00:00:00.000Z","kind":"beats","${key}":${value}}`;

  it.each(SPECIAL_KEYS)(
    'a string under %s sends nothing, as under any key on no list',
    async (key) => {
      await refuses([under(key, '"a free-form word"')]);
    },
  );

  it.each(SPECIAL_KEYS)(
    'a number or the mask under %s is sent without it, as under any key on no list',
    async (key) => {
      const p = port(answered(201, OK));
      const outcome = await p.upload.send([under(key, '42'), under(key, '"***"')], credential);
      expect(outcome.result).toBe('sent');
      expect(String(p.fetch.mock.calls[0]?.[1]?.body)).toBe(
        '{"at":"1970-01-01T00:00:00.000Z","kind":"beats"}\n'.repeat(2),
      );
    },
  );

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
    // The contract's `at` (the beat's R5): ISO 8601, calendar-exact, seconds and a zone required. V8's Date.parse
    // reads each of these four as a time, the first as 2 March.
    ['a 30 February', '{"at":"2026-02-30T00:00:00.000Z","kind":"beats"}'],
    ['a time with no seconds', '{"at":"2026-10-11T21:19Z","kind":"beats"}'],
    ['a time with no zone', '{"at":"2026-10-11T21:19:03.123","kind":"beats"}'],
    ['a time in RFC 2822’s words', '{"at":"Sun, 11 Oct 2026 21:19:03 GMT","kind":"beats"}'],
    // Fix round 1 of Batch 11 (finding 3 of its review): the body is NDJSON, a record line to a line. A raw line break
    // between a line's tokens is still JSON, but the server would read two broken lines.
    ['a raw line feed between its tokens', '{"at":"1970-01-01T00:00:00.000Z",\n"kind":"beats"}'],
    [
      'a raw carriage return between its tokens',
      '{"at":"1970-01-01T00:00:00.000Z",\r"kind":"beats"}',
    ],
    ['a carriage return at its end', '{"at":"1970-01-01T00:00:00.000Z","kind":"beats"}\r'],
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

  // Native masks a level it does not vet (`SessionRecord.levelWord`), and the contract admits the mask: a line the
  // scrub wrote is never refused by the upload's own rule (N18).
  it('a level native masked passes', () => {
    const masked = '{"at":"2026-10-11T21:19:03.123Z","kind":"beats","level":"***"}';
    expect(admitsLine(JSON.parse(masked))).toBe(true);
    expect(linesAreSafe([masked], TOKEN)).toBe(true);
  });

  it('a line break written as JSON’s escape, inside a text, passes', () => {
    const escaped = line('vendor-log', { message: 'first\nsecond' });
    expect(escaped).toContain('first\\nsecond');
    expect(escaped).not.toMatch(/[\r\n]/);
    expect(linesAreSafe([escaped], TOKEN)).toBe(true);
  });

  it('a time with an offset, which the contract admits, passes', () => {
    const offset = '{"at":"2026-10-11T22:19:03+01:00","kind":"beats"}';
    expect(admitsLine(JSON.parse(offset))).toBe(true);
    expect(linesAreSafe([offset], TOKEN)).toBe(true);
  });
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
    const p = port(answered(201, OK));
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

// The answers, each from the contract's own fixtures (RD, the owner's ruling of 2026-10-12, relayed by the web: the
// app shows only the ref and says nothing about dropped lines; the server still returns `dropped`, and it is ignored).
describe('the answers, from the contract’s fixtures', () => {
  const OKS = FIXTURE_NAMES.filter((name) => name.startsWith('ok-'));
  const refAdmitted = (body: unknown) =>
    validator('/$defs/ok/properties/ref')((body as { ref?: unknown }).ref) === true;
  let sent = 0;
  let failed = 0;

  it('has the six 201 fixtures', () => {
    expect(OKS).toHaveLength(6);
  });

  it.each(OKS)(
    'a 201 with %s is sent when its ref is the contract’s, and only then',
    async (name) => {
      const body = fixture(name);
      const p = port(answered(201, body));
      const outcome = await p.upload.send(LINES, credential);
      // Only the ref decides: kept and dropped, valid or not, are never read (RD).
      if (refAdmitted(body)) {
        expect(outcome).toEqual({
          result: 'sent',
          ref: (body as { ref: string }).ref,
          status: 201,
          bytes: LINES.join('\n').length + 1,
        });
        sent += 1;
      } else {
        expect(outcome).toMatchObject({ result: 'failed', ref: null, status: 201 });
        failed += 1;
      }
    },
  );

  it('sent five (every dropped count ignored) and failed one, the ambiguous ref (anti-vacuity)', () => {
    expect([sent, failed]).toEqual([5, 1]);
  });

  it('a 201 whose every line was dropped (kept 0) is still sent, and says nothing of it', async () => {
    const body = fixture('ok-valid-all-dropped') as { ref: string; kept: number };
    expect(body.kept).toBe(0);
    const p = port(answered(201, body));
    expect(await p.upload.send(LINES, credential)).toEqual({
      result: 'sent',
      ref: body.ref,
      status: 201,
      bytes: LINES.join('\n').length + 1,
    });
  });

  it('reads each refusal word’s status from the contract: all six', () => {
    expect([...STATUS_OF.keys()].sort()).toEqual(
      [
        'code_ended',
        'invalid',
        'not_a_stream_code',
        'rate_limited',
        'too_large',
        'unavailable',
      ].sort(),
    );
  });

  // The brief's three (401, 413 too_large, 429); every other refusal is one failure. The status decides, and the
  // refusal's body is never read: what the operator sees is one line for every failure.
  const RESULT: Readonly<Record<string, string>> = {
    code_ended: 'unauthorised',
    too_large: 'too-large',
    rate_limited: 'rate-limited',
    not_a_stream_code: 'failed',
    invalid: 'failed',
    unavailable: 'failed',
  };
  const REFUSALS = FIXTURE_NAMES.filter((name) => name.startsWith('valid-') || name === 'tampered');

  it.each(REFUSALS)('%s, at its status, gives its result without its body read', async (name) => {
    const body = fixture(name) as { code: string };
    const status = STATUS_OF.get(body.code);
    expect(status).toBeDefined();
    const json = vi.fn(async () => body);
    const p = port(async () => ({ status: status ?? 0, json }));
    expect(await p.upload.send(LINES, credential)).toEqual({
      result: RESULT[body.code],
      ref: null,
      status,
      bytes: LINES.join('\n').length + 1,
    });
    expect(json).not.toHaveBeenCalled();
  });

  it('swept the six refusal words and the tampered one; `replaced` is never this route’s (R4)', () => {
    expect(REFUSALS).toHaveLength(7);
    expect((fixture('invalid-replaced') as { code: string }).code).toBe('replaced');
    expect(STATUS_OF.has('replaced')).toBe(false);
  });
});

/**
 * Every line fixture of the contract, as one line of a record, through the upload: sent as written, sent with the
 * fields the contract does not list dropped (Q4), or refused here, sending nothing. Expected outcomes are the
 * contract's verdicts and the app's rules, typed here, never the function's own answer.
 */
describe('every line fixture of the contract, through the upload', () => {
  type Outcome = 'as-written' | 'fitted' | 'refused-local' | 'shape-gap' | 'secret-gap';
  const EXPECTED: Readonly<Record<string, Outcome>> = {
    'line-invalid-at-epoch-ms': 'refused-local',
    'line-invalid-level': 'refused-local',
    'line-invalid-nested': 'refused-local',
    'line-invalid-never-key': 'fitted',
    'line-invalid-no-kind': 'refused-local',
    'line-invalid-plain-url': 'refused-local',
    // Class narrowings the app does not apply: no writer of ours puts a number or a boolean under `sid`, or more than
    // eight hex digits under `tokenTag` (batch 11's answers, Q4). Such a line is sent as written, and the server
    // refuses the record with 422.
    'line-invalid-sid-boolean': 'shape-gap',
    'line-invalid-sid-number': 'shape-gap',
    'line-invalid-tokenTag': 'shape-gap',
    'line-invalid-unlisted-scalar': 'fitted',
    'line-invalid-url-query': 'refused-local',
    'line-invalid-url-userinfo': 'refused-local',
    // S2–S5 are the server's second line (its spec §5), which the app does not run: the line shape
    // admits these, they leave as written, and the server refuses the record with 422. The app's own
    // rule is the token (S1, below), and the sending tok is no secret under any other token.
    'line-secret-bearer': 'secret-gap',
    'line-secret-ingest-url': 'secret-gap',
    'line-secret-sending-tok': 'as-written',
    'line-secret-srt-streamid': 'secret-gap',
    'line-secret-streamid-space': 'secret-gap',
    'line-secret-userinfo': 'secret-gap',
    // A string under an unlisted key that no scrub wrote (`cred`): the line did not come through a scrub (M7).
    'line-tampered': 'refused-local',
  };
  const LINE_FIXTURES = FIXTURE_NAMES.filter((name) => name.startsWith('line-'));
  const seen: Outcome[] = [];

  it('has 38 line fixtures, 19 of them valid', () => {
    expect(LINE_FIXTURES).toHaveLength(38);
    expect(LINE_FIXTURES.filter((name) => name.startsWith('line-valid'))).toHaveLength(19);
  });

  it.each(LINE_FIXTURES)('%s', async (name) => {
    const written = JSON.stringify(fixture(name));
    const expected = EXPECTED[name] ?? (name.startsWith('line-valid') ? 'as-written' : undefined);
    expect(expected).toBeDefined();
    const p = port(answered(201, OK));
    const outcome = await p.upload.send([written], credential);
    const body = p.fetch.mock.calls[0]?.[1]?.body;
    if (expected === 'refused-local') {
      expect(outcome.result).toBe('refused-local');
      expect(p.fetch).not.toHaveBeenCalled();
    } else {
      expect(outcome.result).toBe('sent');
      const [sent = ''] = String(body).split('\n');
      if (expected === 'fitted') {
        expect(sent).not.toBe(written);
      } else {
        expect(sent).toBe(written);
      }
      expect(admitsLine(JSON.parse(sent))).toBe(expected !== 'shape-gap');
      expect(secretShaped(JSON.parse(sent))).toBe(expected === 'secret-gap');
    }
    seen.push(expected ?? 'refused-local');
  });

  it('saw each outcome, by its count (anti-vacuity)', () => {
    const count = (outcome: Outcome) => seen.filter((s) => s === outcome).length;
    expect([
      count('as-written'),
      count('fitted'),
      count('refused-local'),
      count('shape-gap'),
      count('secret-gap'),
    ]).toEqual([20, 2, 8, 3, 5]);
  });

  // S1, the one secret rule the app runs itself: the Bearer that sends the record, anywhere in it.
  it('the sending-tok fixture, under its own token, sends nothing', async () => {
    const leaked = fixture('line-secret-sending-tok') as { state: string };
    const p = port(answered(201, OK));
    const outcome = await p.upload.send([JSON.stringify(leaked)], {
      ...credential,
      token: leaked.state,
    });
    expect(outcome.result).toBe('refused-local');
    expect(p.fetch).not.toHaveBeenCalled();
  });
});

/**
 * Q4 of the web's record design (batch 11's answers): the server refuses a body with any key its contract does not
 * list, a never key included even masked, where Share record masks it (`"key":"***"`). The upload drops that field from
 * its line and sends the line; Share record is unchanged.
 */
describe('a field the contract does not list is dropped from its line, and the line goes (Q4)', () => {
  const sent = async (lines: readonly string[]) => {
    const p = port(answered(201, OK));
    const outcome = await p.upload.send(lines, credential);
    expect(outcome.result).toBe('sent');
    return { p, lines: String(p.fetch.mock.calls[0]?.[1]?.body).trim().split('\n') };
  };

  it('an unlisted key, as the scrub writes it, is sent without that key', async () => {
    const record = createRingRecord();
    createLogger({ record, now: () => 0 }).warn('thermal', { status: 3, note: 'a free-form word' });
    const [written = ''] = record.lines();
    expect(written).toContain('"note":"***"');
    const { lines } = await sent([written]);
    expect(lines).toEqual([
      '{"at":"1970-01-01T00:00:00.000Z","kind":"thermal","level":"warn","status":3}',
    ]);
    // Share record shares the record as written: the mask stays there.
    expect(record.lines()).toEqual([written]);
  });

  it('an unlisted key holding a number is sent without it, the other lines untouched', async () => {
    const plain = line('live', { transport: 'srt' });
    const { lines } = await sent([plain, line('thermal', { status: 3, battery: 42 }), plain]);
    expect(lines).toEqual([
      plain,
      '{"at":"1970-01-01T00:00:00.000Z","kind":"thermal","status":3}',
      plain,
    ]);
  });

  it('a never key, masked, is sent without it', async () => {
    const { lines } = await sent([
      line('pair', { claim: 'new', slot: 0, tokenTag: 'c980ff38', tok: '***' }),
    ]);
    expect(lines).toEqual([
      '{"at":"1970-01-01T00:00:00.000Z","kind":"pair","claim":"new","slot":0,"tokenTag":"c980ff38"}',
    ]);
  });

  // The app's own keys that the contract at 53f28ebfc does not list yet (recordContract.test.ts names all five).
  it('record.send’s own bytes is sent without it, so a second send is not refused for the first one’s line', async () => {
    const p = port(answered(201, OK));
    await p.upload.send(LINES, credential);
    const [written = ''] = p.sendLines();
    expect(written).toContain('"bytes":');
    const { lines } = await sent([written]);
    expect(lines).toEqual([
      '{"at":"1970-01-01T00:00:00.000Z","kind":"record.send","result":"sent","status":201}',
    ]);
  });

  // A line left whole goes byte for byte, as written: native's `Decimal` writes 1.0, which a re-serialisation drops.
  it('a line with nothing to drop is sent as written, byte for byte', async () => {
    const decimal =
      '{"at":"2026-10-11T21:12:00.500Z","kind":"thermal","level":"warn","status":3,"headroom":1.0}';
    const { lines } = await sent([decimal]);
    expect(lines).toEqual([decimal]);
  });

  // The fail-closed checks run on the line as written, before anything is dropped: a token is never laundered away.
  it('the token as an unlisted key still sends nothing', async () => {
    const named = JSON.stringify({ at: '1970-01-01T00:00:00.000Z', kind: 'beats', [TOKEN]: 1 });
    const p = port(answered(201, OK));
    expect((await p.upload.send([named], credential)).result).toBe('refused-local');
    expect(p.fetch).not.toHaveBeenCalled();
  });

  it('a string under an unlisted key that no scrub wrote still sends nothing (M7)', async () => {
    const p = port(answered(201, OK));
    expect(
      (await p.upload.send([line('beats', { note: 'a free-form word' })], credential)).result,
    ).toBe('refused-local');
    expect(p.fetch).not.toHaveBeenCalled();
  });

  it('the size is the body as sent, after the drop', async () => {
    const { p } = await sent([line('thermal', { status: 3, battery: 42 })]);
    const body = String(p.fetch.mock.calls[0]?.[1]?.body);
    expect(body).toBe('{"at":"1970-01-01T00:00:00.000Z","kind":"thermal","status":3}\n');
    expect(p.sendLines().map((l) => parseRecordLine(l).fields.bytes)).toEqual([body.length]);
  });
});

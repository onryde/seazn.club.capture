import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import beats from './wire/beat-bodies.json';
import probe from './wire/scripted-probe.json';
import vectors from './wire/server-bodies.json';

/**
 * Review C4a m-4: the made-up server bodies the native tests answer with are the web's contract
 * shapes, checked here with ajv, so a fixture that drifts from the contract reds. PairWire.kt and the
 * host's ScriptedServer.kt each assert their bodies equal these vectors.
 */

/** The web repo's contracts at 7e75fd4a7, pinned by sha256 (PR C Task 1; beat unchanged since 5bb72e8a2). */
const PINNED = {
  'capture-beat.v1.json': 'e14329132400d45cd38e03b19cf85189fe35acb0b8b9a51e7ca98879fe07c736',
  'capture-descriptor.v1.json': '45fc9ad71f763ed0d34e654b729e4103e3d47c82fd6af1e9e46cc3ad5ef5ed55',
  'capture-scoring-link.v1.json':
    'f0f1188655f3ca83b3e42ce7fedd6f6210a3a141b0bcf02fa250eb2448b1c85f',
  'capture-start.v1.json': '012d6e3851e84d0ce659ad23449fa91b61f0d20cfac1e58f2ccbc7cbb0742bae',
} as const;

const contracts = new URL('../../../test/fixtures/contracts/', import.meta.url);
const text = (file: string) => readFileSync(new URL(file, contracts), 'utf8');

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const ids = new Map<string, string>();
for (const file of Object.keys(PINNED)) {
  const schema = JSON.parse(text(file)) as { $id: string };
  ajv.addSchema(schema);
  ids.set(file, schema.$id);
}

/** `capture-beat.v1.json#/$defs/answer` as the validator for that schema's id and pointer. */
function validator(ref: string) {
  const [file, pointer = ''] = ref.split('#');
  const id = ids.get(file ?? '');
  if (id === undefined) throw new Error(`no contract ${file}`);
  const validate = ajv.getSchema(pointer === '' ? id : `${id}#${pointer}`);
  if (validate === undefined) throw new Error(`no schema at ${ref}`);
  return validate;
}

function verdict(ref: string, body: unknown) {
  const validate = validator(ref);
  return validate(body)
    ? []
    : (validate.errors ?? []).map((e) => `${e.instancePath} ${e.message ?? ''}`);
}

const bodies = vectors.bodies;
const named = (name: string) => {
  const row = bodies.find((b) => b.name === name);
  if (row === undefined) throw new Error(`no body ${name}`);
  return row;
};

describe('the native tests answer with the web contract shapes', () => {
  it.each(Object.entries(PINNED))('%s is the pinned copy', (file, sha) => {
    expect(createHash('sha256').update(text(file)).digest('hex')).toBe(sha);
  });

  // The pin list's own count, so a dropped contract cannot pass by pinning fewer files.
  it('pins exactly 4 contracts', () => {
    expect(Object.keys(PINNED)).toHaveLength(4);
  });

  // The file's count, so an emptied or truncated file cannot pass by sweeping nothing (PV12).
  it('sweeps all 8 bodies, PairWire four and the host four', () => {
    expect(bodies.map((b) => b.name.split('/')[0])).toEqual([
      ...Array(4).fill('pair-wire'),
      ...Array(4).fill('host'),
    ]);
  });

  it.each(bodies.map((b) => [b.name, b.schema, b.body] as const))(
    '%s is a valid %s',
    (_name, schema, body) => {
      expect(verdict(schema, body)).toEqual([]);
    },
  );

  // The shapes the review found, each refused, so the check above is no check that passes anything.
  it.each([
    ['a beat with a venueTimezone', 'pair-wire/beat-waiting', { venueTimezone: 'Europe/London' }],
    [
      'a waiting beat with sid and endReason null',
      'pair-wire/beat-waiting',
      { sid: null, endReason: null },
    ],
    ['a live beat with endReason null', 'pair-wire/beat-live', { endReason: null }],
    ['a live beat with sid null', 'pair-wire/beat-live', { sid: null }],
    // startedBy is go-live's alone: a live beat that carried it would be refused.
    ['a live beat with startedBy', 'pair-wire/beat-live', { startedBy: 'organiser' }],
    ['a code answer with scheduledStart null', 'pair-wire/code-warming', { scheduledStart: null }],
    ['a code answer with no heartbeatUrl', 'pair-wire/code-warming', { heartbeatUrl: undefined }],
    ['a code answer with no startUrl', 'host/code-warming', { startUrl: undefined }],
    ['a start answer with a stray key', 'host/start-ok', { startedBy: 'organiser' }],
  ] as const)('%s is refused', (_why, name, change) => {
    const row = named(name);
    const body: Record<string, unknown> = { ...row.body, ...change };
    for (const [key, value] of Object.entries(change)) if (value === undefined) delete body[key];
    expect(verdict(row.schema, body)).not.toEqual([]);
  });
});

/**
 * C6 carry (Task 34): the debug build's scripted server answers the phone from a script, so the probe
 * script's bodies are the server's, checked here against the same contracts. A route's schema is the
 * status's: a 2xx is the route's answer, any other status its refusal.
 */
const ROUTE_SCHEMAS = {
  code: { ok: 'capture-descriptor.v1.json', refusal: 'capture-descriptor.v1.json#/$defs/refusal' },
  beat: { ok: 'capture-beat.v1.json#/$defs/answer', refusal: null },
  start: { ok: 'capture-start.v1.json#/$defs/ok', refusal: 'capture-start.v1.json#/$defs/refusal' },
} as const;

type ScriptedAnswer = { status?: number; body?: unknown; fail?: boolean };

const scripted = (Object.keys(ROUTE_SCHEMAS) as (keyof typeof ROUTE_SCHEMAS)[]).flatMap((route) =>
  ((probe as Record<string, unknown>)[route] as ScriptedAnswer[]).map(
    (answer, index) => [`${route}[${index}]`, route, answer] as const,
  ),
);

describe('the probe script answers with the web contract shapes', () => {
  // Its own count: one code, one beat, one start (PV12), so an emptied route cannot pass by sweeping nothing.
  it('sweeps the probe script, one answer per route', () => {
    expect(scripted.map(([name]) => name)).toEqual(['code[0]', 'beat[0]', 'start[0]']);
  });

  it.each(scripted)('%s is a valid answer for its status', (_name, route, answer) => {
    expect(answer.fail).toBeUndefined();
    const status = answer.status ?? 0;
    const schema =
      status >= 200 && status < 300 ? ROUTE_SCHEMAS[route].ok : ROUTE_SCHEMAS[route].refusal;
    expect(schema).not.toBeNull();
    expect(verdict(schema ?? '', answer.body)).toEqual([]);
  });

  // The waiting code's own URLs are where the phone beats and asks: the scripted server's routes.
  it('names the beats and start URLs of its own code, on the D3 path', () => {
    const body = probe.code[0]?.body;
    expect(body?.heartbeatUrl).toBe(
      `https://stg.seazn.club/api/v1/capture/codes/${body?.code}/beats`,
    );
    expect(body?.startUrl).toBe(`https://stg.seazn.club/api/v1/capture/codes/${body?.code}/start`);
  });

  // The brief's draft bodies, each refused: a check that passes them is no check.
  it.each([
    ['a waiting code with scheduledStart null', 'code', { scheduledStart: null }],
    ['a waiting code with sid and cred null', 'code', { sid: null, cred: null }],
    ['a waiting beat with a venueTimezone', 'beat', { venueTimezone: 'Europe/London' }],
  ] as const)('%s is refused', (_why, route, change) => {
    const answer = (probe as unknown as Record<string, ScriptedAnswer[]>)[route]?.[0];
    const body = { ...(answer?.body as Record<string, unknown>), ...change };
    expect(verdict(ROUTE_SCHEMAS[route].ok, body)).not.toEqual([]);
  });
});

/**
 * Item 4 (2026-10-05): the phone's own beat after a start failed locally for S carries `startFailed` and
 * `stopped: S` with sid and cause null, so the server ends S (T23) and the next start gets a fresh sid. The
 * body is the real machine's (StartTest.kt pins it field for field); here it meets the vendored contract.
 */
describe("the phone's start-failure beat is a capture-beat.v1 body", () => {
  const body = beats.startFailedStopped;

  it('validates, with startFailed and stopped together and sid and cause null', () => {
    expect(verdict('capture-beat.v1.json', body)).toEqual([]);
    expect([body.sid, body.cause]).toEqual([null, null]);
    expect([typeof body.startFailed, typeof body.stopped]).toEqual(['string', 'string']);
  });

  // The positive pair: the same check refuses a stopped that is not a session id, and a body missing stopped.
  it('is checked: a stopped that is not a uuid, or no stopped at all, is refused', () => {
    expect(verdict('capture-beat.v1.json', { ...body, stopped: 'sess_42' })).not.toEqual([]);
    const { stopped: _dropped, ...without } = body;
    expect(verdict('capture-beat.v1.json', without)).not.toEqual([]);
  });
});

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

/** The vendored contracts (plan D spec §3.1), pinned file for file by test/contractPins.test.ts. */
const contracts = new URL('../../../contracts/', import.meta.url);
const text = (file: string) => readFileSync(new URL(file, contracts), 'utf8');
/** The schemas: VENDORED.json's top-level files. The fixtures sit in folders below them. */
const SCHEMAS = Object.keys(
  (JSON.parse(text('VENDORED.json')) as { files: Record<string, string> }).files,
).filter((path) => !path.includes('/'));

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const ids = new Map<string, string>();
for (const file of SCHEMAS) {
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
  // The pin itself is test/contractPins.test.ts; here, that every vendored schema reached ajv.
  it('registers the six vendored schemas, the QR and the record among them', () => {
    expect([...SCHEMAS].sort()).toEqual([
      'capture-beat.v1.json',
      'capture-descriptor.v1.json',
      'capture-qr.v2.json',
      'capture-record.v1.json',
      'capture-scoring-link.v1.json',
      'capture-start.v1.json',
    ]);
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

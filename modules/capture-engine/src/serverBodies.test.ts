import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import vectors from './wire/server-bodies.json';

/**
 * Review C4a m-4: the made-up server bodies the native tests answer with are the web's contract
 * shapes, checked here with ajv, so a fixture that drifts from the contract reds. PairWire.kt and the
 * host's ScriptedServer.kt each assert their bodies equal these vectors.
 */

/** The web repo's contracts at 5bb72e8a2, pinned by sha256 (ruling of 2026-10-04 in the plan's progress file). */
const PINNED = {
  'capture-beat.v1.json': 'e14329132400d45cd38e03b19cf85189fe35acb0b8b9a51e7ca98879fe07c736',
  'capture-descriptor.v1.json': '3052101953e6998969749455a10b7343621e6b1c37908457c3520477b8a38612',
  'capture-start.v1.json': 'd48f45fee7d1a73da22da83f3406bcaeb6a0b1f1c734278313de294f9215b2ea',
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

  // The file's count, so an emptied or truncated file cannot pass by sweeping nothing (PV12).
  it('sweeps all 7 bodies, PairWire four and the host three', () => {
    expect(bodies.map((b) => b.name.split('/')[0])).toEqual([
      ...Array(4).fill('pair-wire'),
      ...Array(3).fill('host'),
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

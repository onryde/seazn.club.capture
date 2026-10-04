import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import type { LastEnd, Refusal } from '@/domain/session/Pairing';
import type { ServerSays } from '@/engine/contract/serverSays';
import { WIRE_VOCABULARY } from '@/engine/snapshotWire';
import serverBodies from '@/engine/wire/server-bodies.json';
import { REFUSAL_STATUS, SERVER_END, scriptFor } from './serverScript';

/**
 * The host answers the kit's `say` with these bodies, so each is held to the web's contract as the
 * host's own are (C4a m-4, serverBodies.test.ts): the pinned copies, through ajv.
 */
const contracts = new URL('./fixtures/contracts/', import.meta.url);
const read = (file: string) =>
  JSON.parse(readFileSync(new URL(file, contracts), 'utf8')) as Record<string, unknown>;
const beat = read('capture-beat.v1.json');
const start = read('capture-start.v1.json');
const descriptor = read('capture-descriptor.v1.json');

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
for (const schema of [beat, start, descriptor]) ajv.addSchema(schema);

function verdict(schema: Record<string, unknown>, pointer: string, body: unknown): string[] {
  const validate = ajv.getSchema(`${String(schema.$id)}#${pointer}`);
  if (validate === undefined) throw new Error(`no schema at ${pointer}`);
  return validate(body)
    ? []
    : (validate.errors ?? []).map((e) => `${e.instancePath} ${e.message ?? ''}`);
}

type Defs = { $defs: Record<string, { description: string; oneOf: Variant[] }> };
type Variant = { properties: Record<string, { const?: string; enum?: string[] }> };

/** The beat contract's `endReason` words: the server's side of LastEnd.of. */
const END_REASONS = (beat as Defs).$defs.answer!.oneOf.find(
  (variant) => variant.properties.state?.const === 'over',
)!.properties.endReason!.enum!;

/** Each refusal code's status, read from the start contract's own words ("409 no_destination, ..."). */
const STATUS_OF = new Map(
  [...(start as Defs).$defs.refusal!.description.matchAll(/(\d{3}) ([a-z_]+)/g)].map(
    ([, status, code]) => [code, Number(status)] as const,
  ),
);

const LAST_ENDS = [...WIRE_VOCABULARY.lastEnd] as LastEnd[];
const REFUSALS = [...WIRE_VOCABULARY.refusal] as Refusal[];

/** Every `ServerSays` there is, from the snapshot's own vocabulary. */
const EVERY_SAYING: readonly ServerSays[] = [
  { word: 'go-live', cause: 'organiser' },
  { word: 'go-live', cause: 'automatic' },
  { word: 'live' },
  ...LAST_ENDS.map((lastEnd) => ({ word: 'over', lastEnd }) as const),
  ...REFUSALS.map((refusal) => ({ word: 'refused', refusal }) as const),
  { word: 'replaced' },
  { word: 'taken' },
  { word: 'code-ended' },
];

/** The words the server never says: the phone's own ends and refusals. */
const NEVER_SAID: ReadonlySet<string> = new Set([
  'hold-window-expired',
  'stopped',
  'unknown',
  'start-failed',
]);
const detail = (says: ServerSays) =>
  'lastEnd' in says ? says.lastEnd : 'refusal' in says ? says.refusal : '';
const scripted = EVERY_SAYING.filter((says) => !NEVER_SAID.has(detail(says)));
const refused = EVERY_SAYING.filter((says) => NEVER_SAID.has(detail(says)));

/** The schema a script's body answers to: a beat's answer, or a refusal's `{code, message}`. */
function schemaOf(path: 'beat' | 'start', status: number): [Record<string, unknown>, string] {
  if (path === 'start') return [start, '/$defs/refusal'];
  // capture-beat.v1 names no refusal shape: a beat's 401 is every route's `{code, message}` refusal.
  return status === 200 ? [beat, '/$defs/answer'] : [descriptor, '/$defs/refusal'];
}

describe('the server script (Task 27)', () => {
  it('sweeps every ServerSays: 9 last ends, 5 refusals, 20 in all, 16 scripted and 4 refused', () => {
    expect([LAST_ENDS.length, REFUSALS.length]).toEqual([9, 5]);
    expect([EVERY_SAYING.length, scripted.length, refused.length]).toEqual([20, 16, 4]);
  });

  it.each(scripted.map((says) => [JSON.stringify(says), says] as const))(
    '%s scripts a contract shape',
    (_name, says) => {
      const script = scriptFor(says);
      const [schema, pointer] = schemaOf(script.path, script.status);
      expect(verdict(schema, pointer, script.body)).toEqual([]);
    },
  );

  it.each(refused.map((says) => [JSON.stringify(says), says] as const))(
    '%s is refused: the server never says it',
    (_name, says) => {
      expect(() => scriptFor(says)).toThrow(/^the server never (says|refuses with) /);
    },
  );

  it("maps the phone's last ends onto exactly the contract's 7 endReason words, one each", () => {
    expect(Object.values(SERVER_END).sort()).toEqual([...END_REASONS].sort());
    expect(END_REASONS).toHaveLength(7);
    expect(Object.keys(SERVER_END).sort()).toEqual(
      LAST_ENDS.filter((lastEnd) => !NEVER_SAID.has(lastEnd)).sort(),
    );
  });

  it("refuses each start with the contract's status for its code, and code_ended with 401", () => {
    const statuses = Object.entries(REFUSAL_STATUS).map(([code, status]) => [
      status,
      STATUS_OF.get(code),
    ]);
    expect(statuses).toHaveLength(3);
    for (const [status, contract] of statuses) expect(status).toBe(contract);
    expect(scriptFor({ word: 'code-ended' }).status).toBe(STATUS_OF.get('code_ended'));
  });

  // The sid the host's code answer opens (its m-4 vector), so a go-live's chain finds its own session.
  it("names the host's own session in every go-live, live and over, a uuid (I3)", () => {
    const session = serverBodies.bodies.find((row) => row.name === 'host/code-warming')?.body;
    const sid = session !== undefined && 'sid' in session ? session.sid : undefined;
    const named = scripted
      .map((says) => scriptFor(says).body as { sid?: string })
      .filter((body) => body.sid !== undefined);
    expect(named.map((body) => body.sid)).toEqual(Array(10).fill(sid));
    expect(sid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('keeps the cause a go-live names', () => {
    expect(
      (['organiser', 'automatic'] as const).map(
        (cause) => (scriptFor({ word: 'go-live', cause }).body as { startedBy: string }).startedBy,
      ),
    ).toEqual(['organiser', 'automatic']);
  });
});

import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import list from '../../modules/capture-engine/src/scrub/allow-list.json';
import {
  fitLine,
  isRecordTime,
  RECORD_AT,
  RECORD_LEVELS,
  RECORD_LINE_KEYS,
  RECORD_MAX_BYTES,
  RECORD_MAX_LINES,
  RECORD_PATH,
  RECORD_REF,
} from '@/services/recordContract';

/**
 * recordContract.ts against the vendored contract (pinned file for file by contractPins.test.ts): each value there is
 * read here from the file, never typed, so a re-vendor that moves one reds here first.
 */
type Property = { readonly pattern?: string; readonly enum?: readonly string[] };
type Schema = {
  readonly $id: string;
  readonly title: string;
  readonly description: string;
  readonly properties: Readonly<Record<string, Property>>;
  readonly $defs: { readonly ok: { readonly properties: { readonly ref: Property } } };
};
const contract = JSON.parse(
  readFileSync(new URL('../../contracts/capture-record.v1.json', import.meta.url), 'utf8'),
) as Schema;
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
ajv.addSchema(contract);
const judge = (pointer: string) => {
  const validate = ajv.getSchema(`${contract.$id}${pointer}`);
  if (validate === undefined) throw new Error(`no schema at ${pointer}`);
  return (value: unknown) => validate(value) === true;
};
const admitsLine = judge('');
const admitsRef = judge('#/$defs/ok/properties/ref');

describe('the record contract’s route and limits', () => {
  it('posts to the title’s route, under the code’s URL', () => {
    const route = /POST (\S+)/.exec(contract.title)?.[1];
    expect(route).toBe(`/api/v1/capture/codes/{code}${RECORD_PATH}`);
  });

  it('holds the description’s limits: 1000 non-empty lines and 1,048,576 bytes', () => {
    expect(contract.description).toContain(`at most ${RECORD_MAX_LINES} non-empty lines`);
    expect(contract.description).toContain(`at most 1 MB (${RECORD_MAX_BYTES} bytes)`);
  });
});

describe('the record contract’s ref', () => {
  it('is the contract’s pattern, character for character', () => {
    expect(RECORD_REF.source).toBe(contract.$defs.ok.properties.ref.pattern);
  });

  // Each judged by ajv against the contract, and the app's rule must agree on every one.
  const PROBES = [
    'R-7K2Q',
    'R-7K2QABCD',
    'R-7K2QABCDE',
    'R-7K2',
    'R-7K2O',
    'R-7K2I',
    'R-7K2L',
    'R-7K2U',
    'R-7k2q',
    'X-7K2Q',
    'R 7K2Q',
    'R-1',
    '',
  ];
  it.each(PROBES)('%j: the app reads it as the contract does', (probe) => {
    expect(RECORD_REF.test(probe)).toBe(admitsRef(probe));
  });

  it('admits two and refuses the rest (anti-vacuity)', () => {
    expect(PROBES.filter(admitsRef)).toEqual(['R-7K2Q', 'R-7K2QABCD']);
  });
});

describe('the record contract’s line: at and level', () => {
  it('holds the contract’s at pattern, character for character', () => {
    expect(RECORD_AT.source).toBe(contract.properties.at?.pattern);
  });

  const TIMES = [
    '2026-10-11T21:19:03.123Z',
    '2026-10-11T21:19:03Z',
    '2026-10-11T22:19:03.123+01:00',
    '2026-10-11T16:19:03-05:00',
    '2028-02-29T00:00:00Z',
    '2000-02-29T00:00:00Z',
    '2027-02-29T00:00:00Z',
    '1900-02-29T00:00:00Z',
    '2026-02-30T00:00:00.000Z',
    '2026-04-31T00:00:00Z',
    '2026-10-11T24:00:00Z',
    '2026-10-11T21:19Z',
    '2026-10-11T21:19:03',
    '2026-10-11 21:19:03Z',
    'Sun, 11 Oct 2026 21:19:03 GMT',
    '2026-10-11',
    '',
  ];
  it.each(TIMES)('%j: the app reads it as the contract does', (at) => {
    expect(isRecordTime(at)).toBe(admitsLine({ at, kind: 'beats' }));
  });

  it('admits six and refuses eleven, among them three that V8’s Date.parse reads as a time (anti-vacuity)', () => {
    const admitted = TIMES.filter((at) => admitsLine({ at, kind: 'beats' }));
    expect(admitted).toHaveLength(6);
    const lenient = TIMES.filter((at) => !admitted.includes(at) && Number.isFinite(Date.parse(at)));
    expect(lenient.length).toBeGreaterThanOrEqual(3);
  });

  it('refuses an at that is not text', () => {
    expect(isRecordTime(1791797943123)).toBe(false);
    expect(admitsLine({ at: 1791797943123, kind: 'beats' })).toBe(false);
  });

  it('holds the contract’s levels', () => {
    expect([...RECORD_LEVELS].sort()).toEqual([...(contract.properties.level?.enum ?? [])].sort());
  });
});

describe('the record contract’s keys', () => {
  it('lists the contract’s 97 keys, no more and no fewer', () => {
    expect([...RECORD_LINE_KEYS].sort()).toEqual(Object.keys(contract.properties).sort());
    expect(RECORD_LINE_KEYS.size).toBe(97);
  });

  it('lists no never key', () => {
    expect(list.never.filter((key) => RECORD_LINE_KEYS.has(key))).toEqual([]);
  });

  // The web takes its keys from the allow-list (capture ebac190 at web 55ac34d5d, which added the five the app wrote
  // after 7ea8f63). So no key the app writes is dropped from its line on the way (Q4); a key either side adds alone
  // reds this until the other moves.
  it('lists every key the app writes, and only those', () => {
    const written = [
      ...list.reserved,
      ...list.plain.map((key) => (list.reserved.includes(key) ? `field_${key}` : key)),
      ...list.publicUrl,
      ...list.text,
      ...Object.keys(list.scalars),
    ];
    expect(written.sort()).toEqual(Object.keys(contract.properties).sort());
    expect(written.filter((key) => !RECORD_LINE_KEYS.has(key))).toEqual([]);
  });
});

/**
 * Q7 of the web's record design, as capture corrected it (Batch 13, 6ebc91a): every fatal end writes
 * `ended {reason: "fatal-error", wasLive}`, so the web closes a pairing window at the kinds that mark an end, and not
 * at `engine-error`, which native also writes where the pairing goes on (the contract at a6cc1f038, web #944).
 */
describe('the record contract’s pairing windows (A2, Q7)', () => {
  /** The kinds the contract's A2 says a window "runs through the next" of, as the web's own test reads them. */
  const closing = () => {
    const kinds =
      /runs through the next ((?:`[a-z-]+`(?:, | or )?)+) line/.exec(contract.description)?.[1] ??
      '';
    return [...kinds.matchAll(/`([a-z-]+)`/g)].map(([, kind]) => kind ?? '').sort();
  };

  it('closes a window at unpaired, ended, pair-refused and reset, and never at engine-error', () => {
    expect(closing()).toEqual(['ended', 'pair-refused', 'reset', 'unpaired']);
  });

  it('closes only at kinds the allow-list lists', () => {
    const kinds = Object.keys(list.kinds);
    expect(closing().filter((kind) => !kinds.includes(kind))).toEqual([]);
  });

  // The two lines native writes on a fatal end, before air and on air, character for character as EngineTest.kt pins
  // them (its I1 tests): the web accepts each whole, so the window closes there.
  it.each([
    '{"at":"2026-09-21T14:13:20.000Z","kind":"ended","reason":"fatal-error","wasLive":false}',
    '{"at":"2026-09-21T14:13:20.500Z","kind":"ended","reason":"fatal-error","wasLive":true}',
  ])('admits %s whole', (written) => {
    expect(fitLine(written)).toBe(written);
    expect(admitsLine(JSON.parse(written))).toBe(true);
  });
});

describe('fitLine (Q4): what the contract does not list leaves the line, and the line stays', () => {
  it('drops an unlisted key, and the line it leaves is the contract’s', () => {
    const fitted = fitLine(
      '{"at":"2026-10-11T21:12:00.500Z","kind":"thermal","status":3,"battery":42}',
    );
    expect(fitted).toBe('{"at":"2026-10-11T21:12:00.500Z","kind":"thermal","status":3}');
    expect(admitsLine(JSON.parse(fitted))).toBe(true);
  });

  it('drops a never key, masked', () => {
    expect(fitLine('{"at":"2026-10-11T21:12:00.500Z","kind":"pair","slot":0,"tok":"***"}')).toBe(
      '{"at":"2026-10-11T21:12:00.500Z","kind":"pair","slot":0}',
    );
  });

  it('drops every unlisted key at once, and keeps the order of the rest', () => {
    expect(
      fitLine(
        '{"at":"2026-10-11T21:12:00.500Z","kind":"rejoin-retry","retryMs":500,"field_at":"x","failures":2,"code":"***"}',
      ),
    ).toBe('{"at":"2026-10-11T21:12:00.500Z","kind":"rejoin-retry","retryMs":500,"failures":2}');
  });

  // The five keys 55ac34d5d added, each in the line its writer writes: nothing to drop, so each goes as written.
  it.each([
    '{"at":"2026-10-11T21:31:40.918Z","kind":"record.send","result":"sent","status":201,"bytes":48213}',
    '{"at":"2026-10-11T21:14:02.250Z","kind":"rejoin-retry","level":"warn","retryMs":4000,"failures":2}',
    '{"at":"2026-10-11T21:05:12.004Z","kind":"preview-size","pickAspect16x9":true,"pickSource":"ours"}',
  ])('keeps %s whole, and the contract admits it', (written) => {
    expect(fitLine(written)).toBe(written);
    expect(admitsLine(JSON.parse(written))).toBe(true);
  });

  // Native's Decimal writes 1.0 and a JSON round trip writes 1: a whole line is never re-serialised.
  it('leaves a line with nothing to drop exactly as written', () => {
    const decimal =
      '{"at":"2026-10-11T21:12:00.500Z","kind":"thermal","headroom":1.0,"message":"10\\u201379"}';
    expect(fitLine(decimal)).toBe(decimal);
  });

  it('keeps a field named kind, written field_kind', () => {
    const written =
      '{"at":"2026-10-11T21:12:00.500Z","kind":"code.error","field_kind":"surface.unavailable"}';
    expect(fitLine(written)).toBe(written);
  });
});

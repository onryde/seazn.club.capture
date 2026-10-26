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
  RECORD_SID,
  RECORD_WINDOW_ENDS,
  RECORD_WINDOW_OPENS,
} from '@/services/recordContract';

/**
 * recordContract.ts against the vendored contract (pinned file for file by contractPins.test.ts): each value there is
 * read here from the file, never typed, so a re-vendor that moves one reds here first.
 */
type Property = {
  readonly pattern?: string;
  readonly enum?: readonly string[];
  readonly anyOf?: readonly Property[];
};
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
  it('lists the contract’s 104 keys, no more and no fewer', () => {
    expect([...RECORD_LINE_KEYS].sort()).toEqual(Object.keys(contract.properties).sort());
    expect(RECORD_LINE_KEYS.size).toBe(104);
  });

  it('lists no never key', () => {
    expect(list.never.filter((key) => RECORD_LINE_KEYS.has(key))).toEqual([]);
  });

  // The web takes its keys from the allow-list (capture ebac190 at web 55ac34d5d, which added the five the app wrote
  // after 7ea8f63; capture 2b4df80 at web f0feab16, the regulator's seven, R-990P). So no key the app writes is dropped
  // from its line on the way (Q4); a key either side adds alone reds this until the other moves.
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

  // The regulator's lines go whole: the reading on `bitrate` and all of `bitrate-held` (N41), and the contract admits
  // them. A negative send buffer is a reading SRT gives (P5: −336), and is sent as it is.
  it.each([
    '{"at":"2026-10-26T12:00:01.000Z","kind":"bitrate","from":1500000,"to":1125000,"reason":"backlog","egressBps":2000000,"dropped":0,"lost":0,"sendBufferMs":1200,"bandwidthBps":5000000}',
    '{"at":"2026-10-26T12:00:02.000Z","kind":"bitrate","from":1125000,"to":562500,"reason":"drops","egressBps":null,"dropped":12,"lost":3,"sendBufferMs":-336,"bandwidthBps":null}',
    '{"at":"2026-10-26T12:01:11.000Z","kind":"bitrate-held","target":500000,"egressBps":500000,"gateBps":505540,"count":6,"videoFps":30}',
  ])('sends %s whole', (written) => {
    expect(fitLine(written)).toBe(written);
    expect(admitsLine(JSON.parse(written))).toBe(true);
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
    expect(closing().length).toBeGreaterThan(0);
    expect(closing().filter((kind) => !kinds.includes(kind))).toEqual([]);
  });

  // N38 (the controller's ruling, 2026-10-12, amended 2026-10-13): Send record pins the line that opens a window until
  // the one of these that ended it has left the ring, so the app's copies are the description's, read as the web's own
  // test reads them.
  it('holds the description’s window ends, and the kind that opens one', () => {
    expect([...RECORD_WINDOW_ENDS].sort()).toEqual(closing());
    const opens = /a window opens at a `([a-z-]+)` line/.exec(contract.description)?.[1];
    expect(opens).toBe(RECORD_WINDOW_OPENS);
    expect(Object.keys(list.kinds)).toContain(RECORD_WINDOW_OPENS);
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

/**
 * A1: a line whose sid is the server's uuid is judged by its session; a masked or null sid is not (the contract's
 * `sid`). N38 pins a `broadcast-start` only when its sid is one A1 can judge.
 */
describe('the record contract’s sid (A1)', () => {
  it('is the contract’s uuid pattern, character for character', () => {
    const [uuid, masked, none] = contract.properties.sid?.anyOf ?? [];
    expect(RECORD_SID.source).toBe(uuid?.pattern);
    expect([masked, none]).toEqual([{ type: 'string', const: '***' }, { type: 'null' }]);
  });

  it.each([
    ['5f2c8a1e-3b4d-4e6f-8a9b-0c1d2e3f4a5b', true],
    ['5F2C8A1E-3B4D-4E6F-8A9B-0C1D2E3F4A5B', true],
    ['***', false],
    ['sess_42', false],
    ['5f2c8a1e-3b4d-4e6f-8a9b-0c1d2e3f4a5', false],
    ['5f2c8a1e-3b4d-9e6f-8a9b-0c1d2e3f4a5b', false],
  ])('reads %s as %s, as the contract does', (sid, judged) => {
    expect(RECORD_SID.test(sid)).toBe(judged);
    expect(admitsLine({ at: '2026-10-11T21:19:03.123Z', kind: 'live', sid })).toBe(
      judged || sid === '***',
    );
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

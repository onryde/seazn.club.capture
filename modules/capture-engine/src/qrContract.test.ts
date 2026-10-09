import { readdirSync, readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { parseStreamCode } from '@/domain/credentials/streamCode';
import vectors from './wire/code-vectors.json';

/**
 * Plan D spec §3.2: the QR, held to the vendored capture-qr.v2.json for the first time. A vector the schema
 * refuses is one the parser refuses; the verdict each row expects is the vector file's, written by hand (carry G1),
 * never the parser's. The reverse does not hold, by design: STRICTER names the two QRs the schema admits and the
 * parser refuses, and the web's tampered fixture (below) is the one the schema refuses and the parser reads.
 */
const contracts = new URL('../../../contracts/', import.meta.url);
const schema = JSON.parse(readFileSync(new URL('capture-qr.v2.json', contracts), 'utf8')) as {
  $id: string;
};
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const schemaAdmits = ajv.compile(schema);

const qr = (overrides: Record<string, unknown>) => ({
  v: 2,
  code: 'fx42hmnp7k2q',
  slot: 1,
  tok: 'tok-9f3c2a7e5b1d4680ab',
  ...overrides,
});
/**
 * The two QRs the schema admits and the parser refuses, known and deliberate (B1 review Minor 6). The schema bounds
 * slot and exp at 2^53 - 1 only; the parser is stricter, as streamCode.test.ts pins. A slot of 2^31 is past the largest
 * native holds (an Int; MAX_SLOT in streamCode.ts), and an exp of 2^53 - 1 seconds is past what a Date can hold, which
 * the parser never hands on as an Invalid Date. Named here, so a bound either side gains or loses is a decision.
 */
const STRICTER = [
  ['a slot of 2^31, past the largest native holds', qr({ slot: 2_147_483_648 })],
  ['an exp of 2^53 - 1, past what a Date can hold', qr({ exp: 9_007_199_254_740_991 })],
] as const;

const rows = [
  ...vectors.codes.map((row) => [`code: ${row.why}`, qr({ code: row.value }), row.ok] as const),
  ...vectors.tokens.map((row) => [`token: ${row.why}`, qr({ tok: row.value }), row.ok] as const),
];

describe("the phone's QR vectors against capture-qr.v2.json (plan D §3.2)", () => {
  it('sweeps 31 rows: 17 codes and 14 tokens, 8 the schema admits and 23 it refuses', () => {
    expect(rows).toHaveLength(31);
    expect(rows.filter(([, , ok]) => ok)).toHaveLength(8);
  });

  it.each(rows)('%s: the schema and the parser give the row its verdict', (_why, body, ok) => {
    expect(schemaAdmits(body)).toBe(ok);
    expect(parseStreamCode(body).ok).toBe(ok);
  });

  it.each(STRICTER)('%s: the schema admits it and the parser refuses it', (_why, body) => {
    expect(schemaAdmits(body)).toBe(true);
    expect(parseStreamCode(body).ok).toBe(false);
  });
});

const FIXTURES = new URL('fixtures/capture-qr.v2/', contracts);
const fixtures = readdirSync(FIXTURES)
  .filter((name) => name.endsWith('.json'))
  .sort();
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(name, FIXTURES), 'utf8'));

/**
 * The one fixture the schema refuses and the parser reads (plan D1, D-2): a valid QR plus a `cred` key, which the
 * schema's `additionalProperties: false` refuses and the parser drops, keeping nothing of it (streamCode.test.ts,
 * "keeps nothing a mis-issued code carries beyond the four fields"). Named here, so changing either side is a decision.
 */
const TOLERATED = new Set(['tampered.json']);

describe("the web's QR fixtures through the parser (plan D §3.2)", () => {
  it('reads all 12: 3 valid, 7 invalid, tampered and wrong-version', () => {
    expect(fixtures).toHaveLength(12);
    expect(fixtures.filter((name) => name.startsWith('valid'))).toEqual([
      'valid-exp-zero.json',
      'valid-exp.json',
      'valid.json',
    ]);
    expect(fixtures.filter((name) => name.startsWith('invalid'))).toHaveLength(7);
  });

  // The web names a fixture the schema admits `valid…`; every other name is one it refuses.
  it.each(fixtures)('%s: the parser refuses what the schema refuses', (name) => {
    const body = fixture(name);
    const admitted = name.startsWith('valid');
    expect(schemaAdmits(body)).toBe(admitted);
    expect(parseStreamCode(body).ok).toBe(admitted || TOLERATED.has(name));
  });

  it('keeps nothing of what the tolerated fixture carries beyond the schema', () => {
    const read = parseStreamCode(fixture('tampered.json'));
    expect(read.ok && Object.keys(read.value).sort()).toEqual([
      'code',
      'expiresAt',
      'slot',
      'token',
    ]);
  });
});

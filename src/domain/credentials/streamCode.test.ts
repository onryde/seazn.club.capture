import { describe, expect, it } from 'vitest';
import { parseStreamCode, parseStreamCodeText } from '@/domain/credentials/streamCode';

// Made up, inside capture-qr.v2 (web 5bb72e8a2): the code is 12 characters of the code alphabet,
// the token 22 of base64url (carry G1; the fixtures ruling replaces the plan's `fx-42`).
const wire = (overrides: Record<string, unknown> = {}) => ({
  v: 2,
  code: 'fx42hmnp7k2q',
  slot: 1,
  tok: 'tok-9f3c2a7e5b1d4680ab',
  exp: 1_790_100_000,
  ...overrides,
});

describe('the stream QR, v2 after the stable code (A1)', () => {
  it('reads the code, slot, token and expiry', () => {
    expect(parseStreamCode(wire())).toEqual({
      ok: true,
      value: {
        code: 'fx42hmnp7k2q',
        slot: 1,
        token: 'tok-9f3c2a7e5b1d4680ab',
        expiresAt: new Date(1_790_100_000_000),
      },
    });
  });

  it('reads a code with no exp as never expiring (the web never sends one)', () => {
    const { exp: _gone, ...noExp } = wire();
    expect(parseStreamCode(noExp)).toMatchObject({ ok: true, value: { expiresAt: null } });
  });

  it('reads exp 0, the schema minimum, as the epoch (carry D8)', () => {
    expect(parseStreamCode(wire({ exp: 0 }))).toMatchObject({
      ok: true,
      value: { expiresAt: new Date(0) },
    });
  });

  it('reads slot 0, the web PR-1 slot, and the largest slot native holds (T11 M3)', () => {
    expect(parseStreamCode(wire({ slot: 0 }))).toMatchObject({ ok: true, value: { slot: 0 } });
    expect(parseStreamCode(wire({ slot: 2_147_483_647 }))).toMatchObject({
      ok: true,
      value: { slot: 2_147_483_647 },
    });
  });

  it('refuses a pre-amendment v2, with a sid and credentials but no code', () => {
    const old = {
      v: 2,
      sid: 's-1',
      slot: 1,
      tok: 't',
      exp: 1_790_100_000,
      cred: {},
      preferred: 'srt',
    };
    expect(parseStreamCode(old)).toEqual({
      ok: false,
      error: { kind: 'missing-field', field: 'code' },
    });
  });

  it('keeps nothing a mis-issued code carries beyond the four fields', () => {
    const read = parseStreamCode(wire({ cred: { rtmps: { streamKey: 'fake-key-0000' } } }));
    expect(read.ok && Object.keys(read.value).sort()).toEqual([
      'code',
      'expiresAt',
      'slot',
      'token',
    ]);
    expect(JSON.stringify(read)).not.toContain('fake-key-0000');
  });

  it.each([
    ['v1', { v: 1 }, { kind: 'unsupported-version', found: 1 }],
    ['v3', { v: 3 }, { kind: 'unsupported-version', found: 3 }],
    ['a version in text', { v: '2' }, { kind: 'unsupported-version', found: null }],
    [
      'an empty code',
      { code: '' },
      { kind: 'invalid-field', field: 'code', reason: 'expected a non-empty string' },
    ],
    [
      'a code outside the code alphabet',
      { code: 'fx-42' },
      {
        kind: 'invalid-field',
        field: 'code',
        reason: 'expected 12 characters of the code alphabet',
      },
    ],
    [
      'a negative slot',
      { slot: -1 },
      { kind: 'invalid-field', field: 'slot', reason: 'expected an integer of at least 0' },
    ],
    [
      'a fractional slot',
      { slot: 1.5 },
      { kind: 'invalid-field', field: 'slot', reason: 'expected an integer of at least 0' },
    ],
    [
      'a slot past the largest native holds',
      { slot: 2_147_483_648 },
      { kind: 'invalid-field', field: 'slot', reason: 'expected an integer of at most 2147483647' },
    ],
    ['no token', { tok: undefined }, { kind: 'missing-field', field: 'tok' }],
    [
      'a token outside base64url',
      { tok: 'tok-9f3c2a7e5b1d4680' },
      { kind: 'invalid-field', field: 'tok', reason: 'expected 22 characters of base64url' },
    ],
    [
      'an exp in text',
      { exp: '1790100000' },
      { kind: 'invalid-field', field: 'exp', reason: 'expected an integer of at least 0' },
    ],
    [
      // The schema admits no null (carry D9): only an absent exp means none.
      'a null exp',
      { exp: null },
      { kind: 'invalid-field', field: 'exp', reason: 'expected an integer of at least 0' },
    ],
    [
      'a negative exp',
      { exp: -1 },
      { kind: 'invalid-field', field: 'exp', reason: 'expected an integer of at least 0' },
    ],
    [
      // A Date cannot hold it: never hand on an Invalid Date.
      'an exp past what a date can hold',
      { exp: 9_007_199_254_740_991 },
      { kind: 'invalid-field', field: 'exp', reason: 'out of range' },
    ],
  ])('refuses %s', (_name, overrides, error) => {
    expect(parseStreamCode(wire(overrides))).toEqual({ ok: false, error });
  });

  it('refuses text that is not a JSON object', () => {
    expect(parseStreamCodeText('not json')).toEqual({
      ok: false,
      error: { kind: 'not-an-object' },
    });
    expect(parseStreamCodeText('[1,2]')).toEqual({ ok: false, error: { kind: 'not-an-object' } });
  });

  it('reads a code from its text', () => {
    expect(parseStreamCodeText(JSON.stringify(wire({ exp: undefined })))).toEqual({
      ok: true,
      value: { code: 'fx42hmnp7k2q', slot: 1, token: 'tok-9f3c2a7e5b1d4680ab', expiresAt: null },
    });
  });
});

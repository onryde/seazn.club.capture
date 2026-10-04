import { describe, expect, it } from 'vitest';
import { MAX_RAW_LENGTH, recognise } from '@/domain/mode/recognise';
import { captureWire, FIXTURE_CODE, FIXTURE_TOKEN } from '../../../test/fixtures/wire';

const NOW = new Date('2026-10-03T13:00:00Z');
const HOSTS = ['stg.seazn.club'] as const;
const IN_ONE_HOUR = Math.floor(NOW.getTime() / 1000) + 3600;

/** Made-up code and token (test/fixtures/wire.ts). Never paste a real code into a test. */
const stream = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify(captureWire({ exp: IN_ONE_HOUR, ...overrides }));

describe('recognise — stream codes', () => {
  it("recognises the stable code's QR (A1)", () => {
    const raw = stream({ slot: 2 });
    expect(recognise(raw, NOW, HOSTS)).toEqual({
      outcome: 'code',
      code: {
        mode: 'stream',
        raw,
        code: FIXTURE_CODE,
        slot: 2,
        token: FIXTURE_TOKEN,
        expiresAt: new Date(IN_ONE_HOUR * 1000),
      },
    });
  });

  it('never expires a code with no exp', () => {
    const raw = JSON.stringify(captureWire({ exp: undefined }));
    const far = new Date('2099-01-01T00:00:00Z');
    expect(recognise(raw, far, HOSTS)).toMatchObject({
      outcome: 'code',
      code: { mode: 'stream', expiresAt: null },
    });
  });

  it('tolerates whitespace around a code copied off a screen', () => {
    const raw = `  ${stream()}\n`;
    expect(recognise(raw, NOW, HOSTS).outcome).toBe('code');
  });

  it('calls a code expired at the exact second of exp', () => {
    const exp = Math.floor(NOW.getTime() / 1000);
    expect(recognise(stream({ exp }), NOW, HOSTS)).toEqual({
      outcome: 'expired',
      mode: 'stream',
      at: new Date(exp * 1000),
    });
  });

  it('asks for an update on a newer version that still names a code', () => {
    expect(recognise(stream({ v: 3 }), NOW, HOSTS)).toEqual({
      outcome: 'newerVersion',
      mode: 'stream',
    });
  });

  it('treats a v1 code as foreign: there is no v1 path (spec §1, D6)', () => {
    expect(recognise(stream({ v: 1 }), NOW, HOSTS)).toEqual({ outcome: 'foreign' });
  });

  it('treats a pre-amendment v2, with a sid and credentials but no code, as foreign', () => {
    const before = {
      v: 2,
      sid: '5d9c1d0e-0000-4000-8000-000000000001',
      slot: 1,
      cred: { rtmps: { url: 'rtmps://ingest.example:443/live/', streamKey: 'fake-key-0000' } },
      exp: IN_ONE_HOUR,
      tok: FIXTURE_TOKEN,
    };
    expect(recognise(JSON.stringify(before), NOW, HOSTS)).toEqual({ outcome: 'foreign' });
  });

  it('treats a code with no token as foreign', () => {
    expect(recognise(stream({ tok: undefined }), NOW, HOSTS)).toEqual({ outcome: 'foreign' });
  });

  it.each([0, -1, '2', '3', 2.5])('treats version %j as foreign', (v) => {
    expect(recognise(stream({ v }), NOW, HOSTS)).toEqual({ outcome: 'foreign' });
  });

  it('does not claim a random JSON with a version number', () => {
    expect(recognise('{"v":2}', NOW, HOSTS)).toEqual({ outcome: 'foreign' });
  });

  // Carry G1: the full parse runs here, so a code the schema refuses is never offered, nor saved.
  it.each([
    ['a code outside the alphabet', { code: 'fx-42' }],
    ['a token of 20 characters', { tok: 'tok-9f3c2a7e5b1d4680' }],
    ['negative slot', { slot: -1 }],
    ['string slot', { slot: '0' }],
    ['a slot native cannot hold', { slot: 2_147_483_648 }],
    ['fractional exp', { exp: 1.5 }],
    ['a null exp', { exp: null }],
    ['exp beyond the date range', { exp: 1e13 }],
  ])('rejects a malformed v2 code: %s', (_label, overrides) => {
    expect(recognise(stream(overrides), NOW, HOSTS)).toEqual({ outcome: 'foreign' });
  });

  it.each(['{oops', '[]', 'null', '{}'])('rejects %s', (raw) => {
    expect(recognise(raw, NOW, HOSTS)).toEqual({ outcome: 'foreign' });
  });
});

describe('recognise — links', () => {
  it('recognises a scoring link on a Seazn host', () => {
    const raw = 'https://stg.seazn.club/score/abc_123-XYZ';
    expect(recognise(raw, NOW, HOSTS)).toEqual({
      outcome: 'code',
      code: { mode: 'scoring', raw, token: 'abc_123-XYZ' },
    });
  });

  it.each([
    'https://stg.seazn.club/score/abc123/',
    'https://stg.seazn.club/score/abc123?utm=print',
    'https://stg.seazn.club/score/abc123#top',
    'https://STG.Seazn.Club/score/abc123',
  ])('takes the token from %s', (raw) => {
    const result = recognise(raw, NOW, HOSTS);
    expect(result.outcome === 'code' && result.code.mode === 'scoring' && result.code.token).toBe(
      'abc123',
    );
  });

  it.each([
    'https://stg.seazn.club/fixtures/42',
    'https://stg.seazn.club/score/',
    'https://stg.seazn.club',
  ])('calls another Seazn link a page, not a code: %s', (raw) => {
    expect(recognise(raw, NOW, HOSTS)).toEqual({ outcome: 'seaznPage' });
  });

  it.each([
    ['lookalike suffix host', 'https://stg.seazn.club.evil.io/score/abc123'],
    ['host ending in a Seazn host', 'https://evilstg.seazn.club/score/abc123'],
    ['subdomain of a Seazn host', 'https://evil.stg.seazn.club/score/abc123'],
    ['foreign host', 'https://evil.io/score/abc123'],
    ['plain http', 'http://stg.seazn.club/score/abc123'],
    ['userinfo trick', 'https://stg.seazn.club@evil.io/score/abc123'],
    ['production host on a staging build', 'https://seazn.club/score/abc123'],
  ])('rejects a %s', (_label, raw) => {
    expect(recognise(raw, NOW, HOSTS)).toEqual({ outcome: 'foreign' });
  });
});

describe('recognise — hostile input', () => {
  it('never parses input over the limit', () => {
    const raw = stream({ code: 'x'.repeat(MAX_RAW_LENGTH) });
    expect(raw.length).toBeGreaterThan(MAX_RAW_LENGTH);
    expect(recognise(raw, NOW, HOSTS)).toEqual({ outcome: 'foreign' });
  });

  it.each(['', '   ', '\u0000\u0001\u0002', 'hello'])('rejects %j', (raw) => {
    expect(recognise(raw, NOW, HOSTS)).toEqual({ outcome: 'foreign' });
  });
});

import { describe, expect, it } from 'vitest';
import { MAX_RAW_LENGTH, recognise } from '@/domain/mode/recognise';
import { captureWire, FIXTURE_SID } from '../../../test/fixtures/wire';

const NOW = new Date('2026-10-03T13:00:00Z');
const HOSTS = ['stg.seazn.club'] as const;
const IN_ONE_HOUR = Math.floor(NOW.getTime() / 1000) + 3600;

/** Made-up credentials (test/fixtures/wire.ts). Never paste a real code into a test. */
const stream = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify(captureWire({ exp: IN_ONE_HOUR, ...overrides }));

describe('recognise — stream codes', () => {
  it('recognises a valid v2 stream code', () => {
    const raw = stream({ slot: 2 });
    expect(recognise(raw, NOW, HOSTS)).toEqual({
      outcome: 'code',
      code: {
        mode: 'stream',
        raw,
        sid: FIXTURE_SID,
        slot: 2,
        token: 'fake-token-00000000000000000000',
        expiresAt: new Date(IN_ONE_HOUR * 1000),
      },
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

  it('asks for an update on a newer version that is still ours', () => {
    expect(recognise(stream({ v: 3 }), NOW, HOSTS)).toEqual({
      outcome: 'newerVersion',
      mode: 'stream',
    });
  });

  it('treats a v1 code as foreign: there is no v1 path (spec §1, D6)', () => {
    expect(recognise(stream({ v: 1 }), NOW, HOSTS)).toEqual({ outcome: 'foreign' });
  });

  it('treats a v2 code with no token as foreign', () => {
    expect(recognise(stream({ tok: undefined }), NOW, HOSTS)).toEqual({ outcome: 'foreign' });
  });

  it.each([0, -1, '2', '3', 2.5])('treats version %j as foreign', (v) => {
    expect(recognise(stream({ v }), NOW, HOSTS)).toEqual({ outcome: 'foreign' });
  });

  it('runs the full parse: a v2 code with no SRT passphrase is foreign (D7)', () => {
    const { cred } = captureWire() as { cred: { srt: object; rtmps: object } };
    const noPassphrase = { ...cred, srt: { ...cred.srt, passphrase: undefined } };
    expect(recognise(stream({ cred: noPassphrase }), NOW, HOSTS)).toEqual({ outcome: 'foreign' });
  });

  it('does not claim a random JSON with a version number', () => {
    expect(recognise('{"v":2}', NOW, HOSTS)).toEqual({ outcome: 'foreign' });
  });

  it.each([
    ['missing rtmps', { cred: { srt: captureWire().cred } }],
    ['negative slot', { slot: -1 }],
    ['string slot', { slot: '0' }],
    ['fractional exp', { exp: 1.5 }],
    ['unknown preferred', { preferred: 'webrtc' }],
    ['empty sid', { sid: '' }],
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
    const raw = stream({ sid: 'x'.repeat(MAX_RAW_LENGTH) });
    expect(raw.length).toBeGreaterThan(MAX_RAW_LENGTH);
    expect(recognise(raw, NOW, HOSTS)).toEqual({ outcome: 'foreign' });
  });

  it.each(['', '   ', '\u0000\u0001\u0002', 'hello'])('rejects %j', (raw) => {
    expect(recognise(raw, NOW, HOSTS)).toEqual({ outcome: 'foreign' });
  });
});

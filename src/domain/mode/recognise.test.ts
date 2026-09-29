import { describe, expect, it } from 'vitest';
import { MAX_RAW_LENGTH, recognise } from '@/domain/mode/recognise';

const NOW = new Date('2026-10-03T13:00:00Z');
const HOSTS = ['stg.seazn.club'] as const;
const IN_ONE_HOUR = Math.floor(NOW.getTime() / 1000) + 3600;

/** Made-up credentials. Never paste a real code into a test. */
function streamPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    sid: '5d9c1d0e-0000-4000-8000-000000000001',
    slot: 0,
    cred: {
      srt: {
        url: 'srt://ingest.example:9001',
        streamId: 'fake',
        passphrase: 'fake-pass-0000',
        latencyMs: 2000,
      },
      rtmps: { url: 'rtmps://ingest.example/live', streamKey: 'fake-key' },
    },
    preferred: 'srt',
    exp: IN_ONE_HOUR,
    ...overrides,
  };
}

const stream = (overrides?: Record<string, unknown>) => JSON.stringify(streamPayload(overrides));

describe('recognise — stream codes', () => {
  it('recognises a valid v1 stream code', () => {
    const raw = stream({ slot: 2 });
    expect(recognise(raw, NOW, HOSTS)).toEqual({
      outcome: 'code',
      code: { mode: 'stream', raw, slot: 2, expiresAt: new Date(IN_ONE_HOUR * 1000) },
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
    expect(recognise(stream({ v: 2 }), NOW, HOSTS)).toEqual({
      outcome: 'newerVersion',
      mode: 'stream',
    });
  });

  it('does not claim a random JSON with a version number', () => {
    expect(recognise('{"v":2}', NOW, HOSTS)).toEqual({ outcome: 'foreign' });
  });

  it.each([
    ['missing rtmps', { cred: { srt: streamPayload().cred } }],
    ['negative slot', { slot: -1 }],
    ['string slot', { slot: '0' }],
    ['fractional exp', { exp: 1.5 }],
    ['unknown preferred', { preferred: 'webrtc' }],
    ['empty sid', { sid: '' }],
  ])('rejects a malformed v1 code: %s', (_label, overrides) => {
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

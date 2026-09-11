import { describe, expect, it } from 'vitest';
import { parseSessionCredentials } from '@/domain/credentials/parseSessionCredentials';

const validPayload = {
  v: 1,
  slotId: 'slot-a',
  holdWindowSeconds: 60,
  preferred: 'srt',
  overlayUrl: 'https://seazn.example/overlay/fixtures/f1',
  playbackUrl: 'https://playback.example/f1/manifest.m3u8',
  scoreUpdates: 'realtime',
  srt: { url: 'srt://ingest.example:9001', streamId: 'abc', latencyMs: 2000 },
  rtmps: { url: 'rtmps://ingest.example/live', streamKey: 'key-123' },
};

describe('parseSessionCredentials', () => {
  it('puts SRT first when it is preferred', () => {
    const result = parseSessionCredentials(validPayload);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.primary.transport).toBe('srt');
    expect(result.value.fallback.transport).toBe('rtmps');
  });

  it('honours a payload that prefers RTMPS', () => {
    const result = parseSessionCredentials({ ...validPayload, preferred: 'rtmps' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.primary.transport).toBe('rtmps');
    expect(result.value.fallback.transport).toBe('srt');
  });

  it('carries the hold window, because the app cannot infer it (C2)', () => {
    const result = parseSessionCredentials(validPayload);

    expect(result.ok && result.value.holdWindowSeconds).toBe(60);
  });

  // C1: whichever single transport arrived, the pair is incomplete and the
  // phone has no fallback to reach for when UDP is blocked at the ground.
  it('rejects a payload carrying only SRT', () => {
    const { rtmps, ...srtOnly } = validPayload;

    expect(parseSessionCredentials(srtOnly)).toEqual({
      ok: false,
      error: { kind: 'missing-fallback' },
    });
  });

  it('rejects a payload carrying only RTMPS', () => {
    const { srt, ...rtmpsOnly } = validPayload;

    expect(parseSessionCredentials(rtmpsOnly)).toEqual({
      ok: false,
      error: { kind: 'missing-fallback' },
    });
  });

  // N16: the overlay preview is unbuildable without these, so they are
  // required rather than optional.
  it('carries the fixture overlay and playback URLs', () => {
    const result = parseSessionCredentials(validPayload);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.overlayUrl).toBe('https://seazn.example/overlay/fixtures/f1');
    expect(result.value.playbackUrl).toBe('https://playback.example/f1/manifest.m3u8');
  });

  it('rejects a payload with no overlay URL', () => {
    const { overlayUrl, ...withoutOverlay } = validPayload;

    expect(parseSessionCredentials(withoutOverlay)).toEqual({
      ok: false,
      error: { kind: 'missing-field', field: 'overlayUrl' },
    });
  });

  it('reads the score-update entitlement', () => {
    const polled = { ...validPayload, scoreUpdates: 'polled' };

    expect(parseSessionCredentials(polled)).toMatchObject({
      ok: true,
      value: { scoreUpdates: 'polled' },
    });
  });

  // An unrecognised entitlement must fail rather than default to the
  // reassuring answer: the app tells the operator different things for each.
  it('rejects an unrecognised score-update entitlement', () => {
    const result = parseSessionCredentials({ ...validPayload, scoreUpdates: 'sometimes' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({ kind: 'invalid-field', field: 'scoreUpdates' });
  });

  it('keeps an optional SRT passphrase when present', () => {
    const encrypted = { ...validPayload, srt: { ...validPayload.srt, passphrase: 'hunter2' } };
    const result = parseSessionCredentials(encrypted);

    expect(result.ok && result.value.primary).toMatchObject({ passphrase: 'hunter2' });
  });

  it('omits the passphrase rather than storing undefined', () => {
    const result = parseSessionCredentials(validPayload);

    expect(result.ok && 'passphrase' in result.value.primary).toBe(false);
  });

  it('rejects an unknown contract version instead of guessing', () => {
    expect(parseSessionCredentials({ ...validPayload, v: 2 })).toEqual({
      ok: false,
      error: { kind: 'unsupported-version', found: 2 },
    });
  });

  // The reported path must be the path the parser actually walked.
  it('names a missing nested field by its full path', () => {
    const { latencyMs, ...srt } = validPayload.srt;

    expect(parseSessionCredentials({ ...validPayload, srt })).toEqual({
      ok: false,
      error: { kind: 'missing-field', field: 'srt.latencyMs' },
    });
  });

  it('names an invalid nested field by its full path', () => {
    const srt = { ...validPayload.srt, latencyMs: -1 };

    expect(parseSessionCredentials({ ...validPayload, srt })).toMatchObject({
      ok: false,
      error: { kind: 'invalid-field', field: 'srt.latencyMs' },
    });
  });

  it('names a missing top-level field without a path prefix', () => {
    const { slotId, ...withoutSlot } = validPayload;

    expect(parseSessionCredentials(withoutSlot)).toEqual({
      ok: false,
      error: { kind: 'missing-field', field: 'slotId' },
    });
  });

  // Each case is wrapped in its own tuple: `it.each` spreads bare array
  // elements into the test parameters, which would silently turn the array
  // case into a string and leave `isRecord`'s Array.isArray guard untested.
  it.each([[null], ['a string'], [42], [['an', 'array']], [undefined]])(
    'rejects %o as not an object',
    (input) => {
      expect(parseSessionCredentials(input)).toEqual({ ok: false, error: { kind: 'not-an-object' } });
    },
  );
});

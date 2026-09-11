import { describe, expect, it } from 'vitest';
import type { SessionCredentials } from '@/domain/credentials/StreamCredentials';
import { isExhausted, nextTransport } from '@/domain/policy/transportPolicy';

const credentials: SessionCredentials = {
  slotId: 'slot-a',
  holdWindowSeconds: 60,
  overlayUrl: 'https://seazn.example/overlay/fixtures/f1',
  playbackUrl: 'https://playback.example/f1/manifest.m3u8',
  scoreUpdates: 'realtime',
  primary: { transport: 'srt', url: 'srt://ingest:9001', streamId: 'abc', latencyMs: 2000 },
  fallback: { transport: 'rtmps', url: 'rtmps://ingest/live', streamKey: 'key-123' },
};

describe('transportPolicy', () => {
  it('tries the primary transport first', () => {
    expect(nextTransport(credentials, [])?.transport).toBe('srt');
  });

  it('falls back when UDP is blocked at the ground', () => {
    expect(nextTransport(credentials, ['srt'])?.transport).toBe('rtmps');
  });

  it('reports exhaustion once every rung has failed', () => {
    expect(nextTransport(credentials, ['srt', 'rtmps'])).toBeNull();
    expect(isExhausted(credentials, ['srt', 'rtmps'])).toBe(true);
  });

  it('is not exhausted while a rung remains', () => {
    expect(isExhausted(credentials, ['srt'])).toBe(false);
  });
});

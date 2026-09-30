/**
 * Made-up wire payloads (spec Ask). Never paste a real code or descriptor into
 * a test: stream codes carry the SRT passphrase and the RTMPS key.
 */

/** The same instant as TEST_NOW in test/fakePorts.ts, kept here so node tests need no fake ports. */
export const FIXTURE_NOW = new Date('2026-10-03T13:00:00Z');
export const FIXTURE_SID = '5d9c1d0e-0000-4000-8000-000000000001';

export const epochSeconds = (at: Date): number => Math.floor(at.getTime() / 1000);
const minutesFromNow = (minutes: number) => new Date(FIXTURE_NOW.getTime() + minutes * 60_000);

export function captureWire(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 2,
    sid: FIXTURE_SID,
    slot: 1,
    cred: {
      srt: {
        url: 'srt://ingest.example:778',
        streamId: 'fake-stream-id',
        passphrase: 'fake-pass-0000',
        latencyMs: 2000,
      },
      rtmps: { url: 'rtmps://ingest.example:443/live/', streamKey: 'fake-key-0000' },
    },
    preferred: 'srt',
    exp: epochSeconds(minutesFromNow(240)),
    tok: 'fake-token-00000000000000000000',
    ...overrides,
  };
}

/**
 * Every secret `captureWire` carries: the token, the SRT stream id and
 * passphrase, and the RTMPS key. Tests use it to prove none of them leaks.
 */
export const FIXTURE_SECRETS: readonly string[] = [
  'fake-token-00000000000000000000',
  'fake-stream-id',
  'fake-pass-0000',
  'fake-key-0000',
];

export const captureRaw = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify(captureWire(overrides));

export function descriptorWire(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sid: FIXTURE_SID,
    state: 'warming',
    playbackUrl: 'https://video.example/fake/manifest/video.m3u8',
    overlayUrl: 'https://stg.seazn.club/overlay/fixtures/fake-fixture',
    holdWindowSeconds: { srt: 183, rtmps: 183 },
    venueTimezone: 'Europe/London',
    label: 'Seazn XI v Fake CC',
    scoreUpdates: 'realtime',
    maxDurationMinutes: 300,
    warmingDeadline: epochSeconds(minutesFromNow(10)),
    exp: epochSeconds(minutesFromNow(240)),
    heartbeatUrl: 'https://stg.seazn.club/api/capture/sessions/fake/heartbeat',
    ...overrides,
  };
}

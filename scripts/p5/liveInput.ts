/**
 * Pure half of the P5 Cloudflare tooling. `cf.ts` does the I/O; everything
 * that can be wrong *silently* lives here, under test.
 *
 * Measured by the main repo (docs/superpowers/specs/2026-09-11-cloudflare-stream-measured.md):
 *  - U1-S7: `recording.timeoutSeconds` IS the playback hold window. Ruling 26 sets 180.
 *  - `timeoutSeconds: 0` is accepted and echoed as null — the platform default, silently.
 *  - U1-S4: `deleteRecordingAfterDays` floors at 30. Backstop only; cleanup deletes recordings.
 */

export const HOLD_WINDOW_SECONDS = 180;
export const RECORDING_BACKSTOP_DAYS = 30;
/** Design §4: generous, because YouTube's own 15–40 s dominates the budget. */
export const SRT_LATENCY_MS = 2000;

export type LiveInputRequest = {
  readonly meta: { readonly name: string };
  readonly recording: { readonly mode: 'automatic'; readonly timeoutSeconds: number };
  readonly deleteRecordingAfterDays: number;
};

export type CreatedInput = {
  readonly uid: string;
  readonly srt: { readonly url: string; readonly streamId: string; readonly passphrase: string };
  readonly rtmps: { readonly url: string; readonly streamKey: string };
};

export type SessionOptions = {
  readonly overlayUrl: string;
  readonly playbackUrl: string;
  /** Run C only: a deliberately wrong SRT address, to force the fallback. */
  readonly srtUrlOverride?: string;
};

export function buildLiveInputRequest(run: string): LiveInputRequest {
  return {
    meta: { name: `p5-spike-${run}` },
    recording: { mode: 'automatic', timeoutSeconds: HOLD_WINDOW_SECONDS },
    deleteRecordingAfterDays: RECORDING_BACKSTOP_DAYS,
  };
}

/** Cloudflare answers a cheerful 200 for settings it quietly changed. */
export function echoMismatches(sent: LiveInputRequest, echoed: unknown): readonly string[] {
  const input = asRecord(echoed);
  const recording = asRecord(input.recording);
  const checks: readonly (readonly [string, unknown, unknown])[] = [
    ['recording.mode', sent.recording.mode, recording.mode],
    ['recording.timeoutSeconds', sent.recording.timeoutSeconds, recording.timeoutSeconds],
    ['deleteRecordingAfterDays', sent.deleteRecordingAfterDays, input.deleteRecordingAfterDays],
  ];
  return checks
    .filter(([, want, got]) => want !== got)
    .map(([field, want, got]) => `${field}: sent ${String(want)}, got ${String(got)}`);
}

export function readCreatedInput(result: unknown): CreatedInput {
  const input = asRecord(result);
  const srt = asRecord(input.srt);
  const rtmps = asRecord(input.rtmps);
  return {
    uid: requireString(input.uid, 'uid'),
    srt: {
      url: requireString(srt.url, 'srt.url'),
      streamId: requireString(srt.streamId, 'srt.streamId'),
      passphrase: requireString(srt.passphrase, 'srt.passphrase'),
    },
    rtmps: {
      url: requireString(rtmps.url, 'rtmps.url'),
      streamKey: requireString(rtmps.streamKey, 'rtmps.streamKey'),
    },
  };
}

export function hlsManifestUrl(customerSubdomain: string, uid: string): string {
  return `https://${customerSubdomain}/${uid}/manifest/video.m3u8`;
}

/** The flat v1 shape `parseSessionCredentials` reads today (not the §7.6 contract). */
export function toSessionPayload(input: CreatedInput, options: SessionOptions) {
  return {
    v: 1,
    slotId: 'slot-0',
    holdWindowSeconds: HOLD_WINDOW_SECONDS,
    preferred: 'srt',
    overlayUrl: options.overlayUrl,
    playbackUrl: options.playbackUrl,
    scoreUpdates: 'realtime',
    srt: {
      url: options.srtUrlOverride ?? input.srt.url,
      streamId: input.srt.streamId,
      passphrase: input.srt.passphrase,
      latencyMs: SRT_LATENCY_MS,
    },
    rtmps: { url: input.rtmps.url, streamKey: input.rtmps.streamKey },
  } as const;
}

export type SessionPayload = ReturnType<typeof toSessionPayload>;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new Error(`Cloudflare response is missing ${field}`);
  }
  return value;
}

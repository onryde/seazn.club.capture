/**
 * A sum type, never a struct with optional fields (AGENTS.md §4).
 *
 * C1: both credential shapes must be in hand at scan time, because the phone
 * cannot re-scan a QR code when UDP turns out to be blocked at the ground.
 */

export type Transport = 'srt' | 'rtmps';

export type SrtCredentials = {
  readonly transport: 'srt';
  readonly url: string;
  readonly streamId: string;
  /** Required in v2 (D7): Cloudflare's SRT ingest is always encrypted. */
  readonly passphrase: string;
  /** Generous by default — the latency budget has headroom, YouTube's 15-40s dominates. */
  readonly latencyMs: number;
};

export type RtmpsCredentials = {
  readonly transport: 'rtmps';
  readonly url: string;
  readonly streamKey: string;
};

export type StreamCredentials = SrtCredentials | RtmpsCredentials;

/** Q3: a club without `realtime` polls at fifteen seconds. */
export type ScoreUpdates = 'realtime' | 'polled';

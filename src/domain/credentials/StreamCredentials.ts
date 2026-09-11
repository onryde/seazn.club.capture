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
  /** Absent means an unencrypted SRT session. */
  readonly passphrase?: string;
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

/**
 * Everything a scan hands the app. A session descriptor, not just credentials.
 *
 * `holdWindowSeconds` is C2: the front door's hold is a *behavioural* clause of
 * the contract, not decoration. It decides whether a resume is still the same
 * broadcast or a new one, and the app cannot infer it.
 *
 * The last three fields are N16: they do not exist in the contract yet, and are
 * required here on purpose. When the contract lands the compiler will find
 * every consumer; if it lands without them, the overlay preview is cut rather
 * than patched.
 */
export type SessionCredentials = {
  readonly slotId: string;
  readonly primary: StreamCredentials;
  readonly fallback: StreamCredentials;
  readonly holdWindowSeconds: number;
  /**
   * The Tier A browser-source route for this fixture — the same page the
   * club's OBS and the Fly Machine compositor consume. Supplied whole rather
   * than assembled from an id, so a route change never requires redeploying
   * phones (the same reasoning as C2's opaque endpoints).
   */
  readonly overlayUrl: string;
  /** LL-HLS playback of the composited output. WHEP is unavailable — see N11. */
  readonly playbackUrl: string;
  readonly scoreUpdates: ScoreUpdates;
};

import type { ScoreUpdates, Transport } from '@/domain/credentials/StreamCredentials';

export type DescriptorState = 'warming' | 'live' | 'ending' | 'completed' | 'failed';

/** Why the organiser's side ended a session (spec Ask 410), in the domain's words (D4). */
export type OrganiserEndReason =
  'stopped' | 'no-inbound-timeout' | 'target-rejected' | 'max-duration' | 'unknown';

/**
 * What the server says about a session (spec §2). Cached with the saved code
 * for the session's life; native fetches it again on every reconnect.
 */
export type SessionDescriptor = {
  readonly sid: string;
  readonly state: DescriptorState;
  readonly endReason: OrganiserEndReason | null;
  /** Required: the delivery watch depends on it (F-P5-13). */
  readonly playbackUrl: string;
  /**
   * The Tier A `/overlay/fixtures/[id]` route. `null` is no overlay: the
   * server sent the `/relay` variant, which the phone never loads (AGENTS §7).
   */
  readonly overlayUrl: string | null;
  /** C2: whether a resume is the same broadcast, per transport. */
  readonly holdWindowSeconds: Readonly<Record<Transport, number>>;
  /** IANA name. Every time the operator reads is shown in it (spec §2). */
  readonly venueTimezone: string;
  readonly label: string;
  readonly scoreUpdates: ScoreUpdates;
  readonly maxDurationMinutes: number;
  /** The web's 10-minute no-signal timeout: Go live must happen before it. */
  readonly warmingDeadline: Date;
  readonly expiresAt: Date;
  readonly heartbeatUrl: string;
};

/** Spec §2's closed set; D3 maps 5xx and a malformed 200 onto it. */
export type DescriptorError =
  | { readonly kind: 'invalid' }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'ended'; readonly endReason: OrganiserEndReason }
  | { readonly kind: 'offline' }
  | { readonly kind: 'rate-limited'; readonly retryAfterS: number };

/** D4: these two read "timed out" to the operator; every other reason reads "ended by the organiser". */
export function endedByTimeout(reason: OrganiserEndReason): boolean {
  return reason === 'no-inbound-timeout' || reason === 'max-duration';
}

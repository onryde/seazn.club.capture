/**
 * CD36: the build's environment, which names its Seazn and ingest hosts. In the
 * domain, not the port, so `services/seaznHosts.ts` may name it (the boundary
 * rule lets services import domain, never engine; review M10).
 */
export type Environment = 'production' | 'staging';

/** The two ways out (C1). Publish credentials themselves are native's (AGENTS §4). */
export type Transport = 'srt' | 'rtmps';

/** How the overlay learns a score (S1 decision 8), echoed in the broadcast. */
export type ScoreUpdates = 'realtime' | 'polled';

/** Who started the broadcast in hand (A2, A10, A16). */
export type Cause = 'organiser' | 'automatic' | 'operator' | 'rejoin';

/** A readiness check native judges (A11), in the order it reports the first that fails. */
export type NotReady = 'camera' | 'sound' | 'network' | 'held';

export const NOT_READY_ORDER: readonly NotReady[] = ['camera', 'sound', 'network', 'held'];

/** Native's verdict on each check; false when unknown. */
export type Readiness = Readonly<Record<NotReady, boolean>>;

export function firstNotReady(ready: Readiness): NotReady | null {
  return NOT_READY_ORDER.find((check) => !ready[check]) ?? null;
}

/** What the snapshot names the pairing by, and its waiting fields (amendment, The engine port). */
export type PairingInfo = {
  readonly code: string;
  readonly slot: number;
  readonly tokenTag: string;
  readonly automatic: boolean;
  readonly label: string;
  readonly venueTimezone: string;
  readonly scheduledStart: Date | null;
  readonly autoAllowed: boolean;
  readonly destinationName: string | null;
  readonly overlayUrl: string | null;
  readonly pollSeconds: number;
};

/** The broadcast's non-secret fields, while one is held. `cred` never crosses the bridge (A1, A5). */
export type BroadcastInfo = {
  readonly sid: string;
  readonly cause: Cause;
  readonly playbackUrl: string;
  readonly overlayUrl: string | null;
  readonly label: string;
  /** Per transport offered; SRT absent when the server offered none (A18). */
  readonly holdWindowSeconds: Readonly<Partial<Record<Transport, number>>>;
  readonly maxDurationMinutes: number;
  /**
   * Null when the server's answer named none it knows (carry T23, plan:11464):
   * native echoes what it read, and the snapshot vectors carry such a case.
   */
  readonly scoreUpdates: ScoreUpdates | null;
  readonly srtOffered: boolean;
};

/** A refused or failed start, until the next start or the end of the pairing. */
export type Refusal = 'no_destination' | 'no_credit' | 'not_entitled' | 'unknown' | 'start-failed';

/** Why the last broadcast ended without the operator, while back in Paired. */
export type LastEnd =
  | 'stopped-by-organiser'
  | 'stopped-automatically'
  | 'no-signal'
  | 'destination-refused'
  | 'max-duration'
  | 'phone-lost'
  | 'ended-by-seazn'
  | 'hold-window-expired'
  | 'stopped';

/** Why native left a pairing the operator did not end. */
export type UnpairReason = 'code-ended' | 'replaced' | 'taken' | 'permissions';

export type Unpaired = {
  readonly reason: UnpairReason;
  readonly code: string;
  readonly slot: number;
  readonly tokenTag: string;
};

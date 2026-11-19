/**
 * CD36: the build's environment, which names its Seazn and ingest hosts. In the
 * domain, not the port, so `services/seaznHosts.ts` may name it (the boundary
 * rule lets services import domain, never engine; review M10).
 */
export type Environment = 'production' | 'staging';

/** The two ways out (C1). Publish credentials themselves are native's (AGENTS §4). */
export type Transport = 'srt' | 'rtmps';

/** How the web overlay learns a score (S1 decision 8), echoed in the broadcast. */
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

/** A court's next streamed match, from the beat's `next` (court stream spec 2026-11-14 §5.3). Display only. */
export type NextMatch = { readonly label: string; readonly scheduledStart: Date | null };

/**
 * Why the server's automatic start of a court's match was refused: the waiting answer's `autoRefusal` (capture-beat.v1,
 * E2, 2026-11-17), the word the Match Day court card shows. Display only, and apart from `Refusal`, which is the phone's
 * own start's.
 */
export type AutoRefusal =
  | 'no_destination'
  | 'no_credit'
  | 'not_entitled'
  | 'destination_in_use'
  | 'unavailable'
  | 'competition_frozen'
  // Court device check (2026-11-19, web #1265): the court's only match was stopped by hand, so nothing starts it by
  // itself; the desk's Go live or this phone's hold does.
  | 'match_stopped';

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
  readonly pollSeconds: number;
  /** The descriptor's `stage.label` (W28) for the match in hand, shown verbatim; null with none. Display only. */
  readonly stageLabel: string | null;
  /**
   * The court's name on a court code (court stream §6.1), null on a fixture's code. The pairing is a court pairing
   * exactly when this is not null; native decides what that changes, JS only words it (AGENTS §2).
   */
  readonly court: string | null;
  /** The court's next streamed match, from the last beat (§5.3); null when none. Display only. */
  readonly next: NextMatch | null;
  /**
   * Why the server refused the court's automatic start, from the last waiting answer (E2); null when none stands, or
   * when native read a word it does not know. Display only: the court's paired line says it.
   */
  readonly autoRefusal: AutoRefusal | null;
  /**
   * The operator's Go live is waiting for the server's answer (`POST start` in flight), in Paired only (court stream
   * Task 13, P2). Native's fact (AGENTS §2): Go live shows "Starting…" and cannot be held until it clears.
   */
  readonly starting: boolean;
};

/** The broadcast's non-secret fields, while one is held. `cred` never crosses the bridge (A1, A5). */
export type BroadcastInfo = {
  readonly sid: string;
  readonly cause: Cause;
  readonly playbackUrl: string;
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
export type Refusal =
  | 'no_destination'
  | 'no_credit'
  | 'not_entitled'
  | 'no_match' // capture-start.v1's 409: a court with no streamed match in play
  | 'unknown'
  | 'start-failed';

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

/**
 * Why native left a pairing the operator did not end in the app. `forgotten` is the operator's Forget on the
 * notification (R6 of the D3 findings design): native's own input, which JS hears only from the snapshot.
 * `app-outdated` is a court claim the server refused because this build is below its court minimum (426
 * `app_outdated`, court device check 2026-11-19, web #1265): the code has not ended, the app needs updating.
 */
export type UnpairReason =
  'code-ended' | 'replaced' | 'taken' | 'permissions' | 'forgotten' | 'app-outdated';

export type Unpaired = {
  readonly reason: UnpairReason;
  readonly code: string;
  readonly slot: number;
  readonly tokenTag: string;
};
